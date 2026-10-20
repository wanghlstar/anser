//! Ordered rule continuations. Only metadata and a read proof are durable;
//! fetched online bodies remain in memory unless a save action is matched.
use crate::{
    archive,
    archive_jobs::{self, ArchiveJob},
    models::*,
    operations, rule_operations, rules,
    store::Store,
};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::Emitter;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RuleRun {
    pub id: String,
    pub mail_id: String,
    pub source: ArchiveJob,
    pub configuration: String,
    pub rules: Vec<Rule>,
    pub remote_only: bool,
    #[serde(default)]
    pub retry_queues: bool,
    /// Read and star flags observed when the chain first matched. Ordered
    /// actions change them, so later steps evaluate conditions against this
    /// snapshot instead of the partially applied mail.
    #[serde(default)]
    pub observed: Option<rules::ObservedStatus>,
    pub cursor: usize,
    pub applied: u32,
    pub local_state: String,
    pub operations: Vec<String>,
    pub status: String,
    pub revision: i64,
    pub error: String,
    pub updated_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleRunView {
    pub id: String,
    pub account_email: String,
    pub subject: String,
    pub step: String,
    pub cursor: usize,
    pub total: usize,
    pub applied: u32,
    pub status: String,
    pub error: String,
    pub updated_at: String,
}

pub fn initialize(db: &rusqlite::Connection) -> Result<()> {
    db.execute_batch("CREATE TABLE IF NOT EXISTS rule_runs(id TEXT PRIMARY KEY,mail_id TEXT NOT NULL UNIQUE,data TEXT NOT NULL,status TEXT NOT NULL,cursor INTEGER NOT NULL,revision INTEGER NOT NULL,error TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS rule_runs_pending ON rule_runs(status,updated_at);
    UPDATE rule_runs SET status='queued',revision=revision+1,error='应用退出后继续规则处理' WHERE status='running';").map_err(err)
}

pub(crate) fn configuration(rs: &[Rule]) -> Result<String> {
    let mut rs = rules::expand(rs);
    for rule in &mut rs {
        rule.name.clear();
    }
    Ok(archive::digest(&serde_json::to_vec(&rs).map_err(err)?))
}

fn current_configuration(db: &rusqlite::Connection) -> Result<String> {
    let mut q = db
        .prepare("SELECT data FROM rules ORDER BY position")
        .map_err(err)?;
    let rows = q.query_map([], |r| r.get::<_, String>(0)).map_err(err)?;
    let rs = rows
        .map(|r| serde_json::from_str::<Rule>(&r.map_err(err)?).map_err(err))
        .collect::<Result<Vec<_>>>()?;
    configuration(&rs)
}

fn local_state(m: &Mail) -> Result<String> {
    serde_json::to_string(&(
        m.local_read_override,
        m.local_star_override,
        &m.local_folder,
        m.trashed,
    ))
    .map_err(err)
}

fn check_local_intent(job: &RuleRun, m: &Mail, rule: &Rule) -> Result<()> {
    let (read, star, folder, trashed): (Option<bool>, Option<bool>, String, bool) =
        serde_json::from_str(&job.local_state).map_err(|_| "旧规则任务缺少意图记录，请重新检查")?;
    let changed = match rule.action.as_str() {
        "read" | "unread" => read != m.local_read_override,
        "star" => star != m.local_star_override,
        "folder" | "saveFolder" => folder != m.local_folder,
        "trash" => trashed != m.trashed,
        _ => false,
    };
    if changed {
        return Err("此字段已被用户修改，未覆盖新的标记或归类；请核对后重试".into());
    }
    Ok(())
}

fn advance_local_intent(job: &mut RuleRun, m: &Mail, rule: &Rule) -> Result<()> {
    let mut state: (Option<bool>, Option<bool>, String, bool) =
        serde_json::from_str(&job.local_state).map_err(err)?;
    match rule.action.as_str() {
        "read" | "unread" => state.0 = m.local_read_override,
        "star" => state.1 = m.local_star_override,
        "folder" | "saveFolder" => state.2 = m.local_folder.clone(),
        "trash" => state.3 = m.trashed,
        _ => {}
    }
    job.local_state = serde_json::to_string(&state).map_err(err)?;
    Ok(())
}

const COLUMNS: &str = "data,status,cursor,revision,error,updated_at";

fn decode(row: &rusqlite::Row<'_>) -> rusqlite::Result<RuleRun> {
    let mut job: RuleRun = serde_json::from_str(&row.get::<_, String>(0)?).map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e))
    })?;
    job.status = row.get(1)?;
    job.cursor = row.get(2)?;
    job.revision = row.get(3)?;
    job.error = row.get(4)?;
    job.updated_at = row.get(5)?;
    Ok(job)
}

fn read_plan(db: &rusqlite::Connection, m: &Mail) -> Result<ArchiveJob> {
    let account: Option<String> = db
        .query_row(
            "SELECT data FROM accounts WHERE id=?1",
            [&m.account_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?;
    let account = account
        .map(|a| serde_json::from_str::<Account>(&a).map_err(err))
        .transpose()?;
    let source: Option<(String, String)> = db.query_row("SELECT folder,remote_id FROM trusted_sources WHERE account_id=?1 AND mail_id=?2 AND active=1 ORDER BY folder='INBOX' COLLATE NOCASE DESC,folder,remote_id LIMIT 1",params![m.account_id,m.id],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(err)?;
    let (folder, remote_id) = source.unwrap_or_default();
    Ok(ArchiveJob {
        id: String::new(),
        mail_id: m.id.clone(),
        account_id: m.account_id.clone(),
        account_email: m.account_email.clone(),
        subject: m.subject.clone(),
        folder,
        remote_id,
        identity: account
            .as_ref()
            .map(operations::identity)
            .unwrap_or_default(),
        expected_hash: m.hash.clone(),
        status: "read".into(),
        error: String::new(),
        revision: 0,
        updated_at: String::new(),
    })
}

fn content_matches(plan: &ArchiveJob, m: &Mail, hash: &str, header_hash: &str) -> Result<()> {
    if hash != plan.expected_hash && header_hash != plan.expected_hash {
        return Err("规则原件内容已变化，未执行后续动作".into());
    }
    if m.saved_locally && m.hash != hash {
        return Err("邮件已被另一原件替代，未执行旧规则任务".into());
    }
    Ok(())
}

fn load(db: &rusqlite::Connection, id: &str) -> Result<RuleRun> {
    db.query_row(
        &format!("SELECT {COLUMNS} FROM rule_runs WHERE id=?1"),
        [id],
        decode,
    )
    .map_err(err)
}

fn guard(
    db: &rusqlite::Connection,
    expected: &RuleRun,
    hash: &str,
    header_hash: &str,
) -> Result<(RuleRun, Account, Mail)> {
    let job = load(db, &expected.id)?;
    if job.status != "running" || job.revision != expected.revision {
        return Err("规则处理已暂停、取消或重新安排".into());
    }
    if current_configuration(db)? != job.configuration {
        return Err("规则配置已变化，旧任务不再执行".into());
    }
    let (a, m) = archive_jobs::proof(db, &job.source)?;
    content_matches(&job.source, &m, hash, header_hash)?;
    Ok((job, a, m))
}

fn write(db: &rusqlite::Connection, job: &mut RuleRun) -> Result<()> {
    job.updated_at = chrono::Utc::now().to_rfc3339();
    db.execute("UPDATE rule_runs SET data=?2,status=?3,cursor=?4,error=?5,updated_at=?6 WHERE id=?1 AND revision=?7",params![job.id,serde_json::to_string(job).map_err(err)?,job.status,job.cursor,job.error,job.updated_at,job.revision]).map_err(err)?;
    Ok(())
}

pub(crate) fn cancel_in(db: &rusqlite::Connection, ids: &[String]) -> Result<()> {
    let ids = serde_json::to_string(ids).map_err(err)?;
    db.execute("UPDATE directory_operations SET status='cancelled',error='规则处理已取消，未提交服务器操作' WHERE status IN ('queued','preparing','blocked') AND id IN (SELECT j.value FROM rule_runs r JOIN json_each(r.data,'$.operations') j WHERE r.status NOT IN ('completed','cancelled') AND r.id IN (SELECT value FROM json_each(?1)))",[&ids]).map_err(err)?;
    db.execute("UPDATE rule_runs SET status='cancelled',revision=revision+1,error='规则处理已取消' WHERE status NOT IN ('completed','cancelled') AND id IN (SELECT value FROM json_each(?1))",[ids]).map_err(err)?;
    Ok(())
}

pub(crate) fn cancel_account_in(db: &rusqlite::Connection, account: &str) -> Result<()> {
    let mut q=db.prepare("SELECT id FROM rule_runs WHERE status NOT IN ('completed','cancelled') AND (?1='' OR json_extract(data,'$.source.accountId')=?1)").map_err(err)?;
    let ids = q
        .query_map([account], |r| r.get::<_, String>(0))
        .map_err(err)?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(err)?;
    cancel_in(db, &ids)
}

pub(crate) fn cancel_mail_in(db: &rusqlite::Connection, mail: &str) -> Result<()> {
    let id: Option<String> = db
        .query_row(
            "SELECT id FROM rule_runs WHERE mail_id=?1 AND status NOT IN ('completed','cancelled')",
            [mail],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?;
    cancel_in(db, &id.into_iter().collect::<Vec<_>>())
}

impl Store {
    pub(crate) fn defer_rules(
        &self,
        mail: &Mail,
        observed: rules::ObservedStatus,
        configured: &[Rule],
        offset: usize,
        remote_only: bool,
    ) -> Result<bool> {
        let mut db = self.db()?;
        let tx = db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(err)?;
        let fingerprint = configuration(configured)?;
        if current_configuration(&tx)? != fingerprint {
            return Err("规则配置已变化，请重新执行".into());
        }
        let old = tx
            .query_row(
                &format!("SELECT {COLUMNS} FROM rule_runs WHERE mail_id=?1"),
                [&mail.id],
                decode,
            )
            .optional()
            .map_err(err)?;
        if old.as_ref().is_some_and(|j| {
            j.configuration == fingerprint
                && !matches!(j.status.as_str(), "completed" | "cancelled")
        }) {
            return Ok(true);
        }
        if old.as_ref().is_some_and(|j| {
            j.configuration == fingerprint && remote_only && j.status == "completed"
        }) {
            return Ok(true);
        }
        let data: String = tx
            .query_row("SELECT data FROM messages WHERE id=?1", [&mail.id], |r| {
                r.get(0)
            })
            .map_err(err)?;
        let m: Mail = serde_json::from_str(&data).map_err(err)?;
        if m.hash != mail.hash {
            return Err("邮件原件已变化，请重新执行规则".into());
        }
        let source = read_plan(&tx, &m)?;
        let failure = archive_jobs::proof(&tx, &source).err();
        let job = RuleRun {
            id: old
                .as_ref()
                .map(|j| j.id.clone())
                .unwrap_or_else(|| uuid::Uuid::new_v4().to_string()),
            mail_id: m.id.clone(),
            source,
            configuration: fingerprint,
            rules: configured[offset..].to_vec(),
            remote_only,
            retry_queues: false,
            observed: Some(observed),
            cursor: 0,
            applied: 0,
            local_state: local_state(&m)?,
            operations: Vec::new(),
            status: if failure.is_some() {
                "blocked"
            } else {
                "queued"
            }
            .into(),
            revision: old.map(|j| j.revision + 1).unwrap_or(1),
            error: failure.unwrap_or_default(),
            updated_at: chrono::Utc::now().to_rfc3339(),
        };
        tx.execute("INSERT INTO rule_runs VALUES(?1,?2,?3,?4,?5,?6,?7,?8) ON CONFLICT(mail_id) DO UPDATE SET data=excluded.data,status=excluded.status,cursor=excluded.cursor,revision=excluded.revision,error=excluded.error,updated_at=excluded.updated_at",params![job.id,job.mail_id,serde_json::to_string(&job).map_err(err)?,job.status,job.cursor,job.revision,job.error,job.updated_at]).map_err(err)?;
        tx.commit().map_err(err)?;
        Ok(true)
    }

    pub fn rule_runs(&self) -> Result<Vec<RuleRunView>> {
        let db = self.db()?;
        let mut q = db
            .prepare(&format!(
                "SELECT {COLUMNS} FROM rule_runs ORDER BY updated_at DESC LIMIT 100"
            ))
            .map_err(err)?;
        let result = q
            .query_map([], decode)
            .map_err(err)?
            .map(|r| {
                let job = r.map_err(err)?;
                Ok(RuleRunView {
                    id: job.id,
                    account_email: job.source.account_email,
                    subject: job.source.subject,
                    step: job
                        .rules
                        .get(if job.status == "completed" {
                            job.cursor.saturating_sub(1)
                        } else {
                            job.cursor
                        })
                        .map(|r| r.name.clone())
                        .unwrap_or_default(),
                    cursor: job.cursor,
                    total: job.rules.len(),
                    applied: job.applied,
                    status: job.status,
                    error: job.error,
                    updated_at: job.updated_at,
                })
            })
            .collect();
        result
    }

    #[cfg(test)]
    pub(crate) fn rule_run(&self, id: &str) -> Result<RuleRun> {
        load(&self.db()?, id)
    }

    pub(crate) fn claim_rule_run(&self, job: &RuleRun) -> Result<bool> {
        Ok(self.db()?.execute("UPDATE rule_runs SET status='running',error='' WHERE id=?1 AND revision=?2 AND status='queued'",params![job.id,job.revision]).map_err(err)?==1)
    }

    pub(crate) fn rule_blocks_directory(
        db: &rusqlite::Connection,
        operation_id: &str,
    ) -> Result<bool> {
        db.query_row("SELECT EXISTS(SELECT 1 FROM rule_runs r JOIN json_each(r.data,'$.operations') j WHERE j.value=?1 AND r.status!='completed')",[operation_id],|row|row.get(0)).map_err(err)
    }

    pub(crate) fn rule_blocks_move(db: &rusqlite::Connection, mail_id: &str) -> Result<bool> {
        db.query_row("SELECT EXISTS(SELECT 1 FROM rule_runs WHERE mail_id=?1 AND status NOT IN ('completed','cancelled'))",[mail_id],|r|r.get(0)).map_err(err)
    }

    pub fn rule_run_action(&self, id: &str, action: &str) -> Result<()> {
        let mut db = self.db()?;
        let tx = db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(err)?;
        let mut job = load(&tx, id)?;
        match action {
            "pause" if matches!(job.status.as_str(), "queued" | "running") => {
                job.status = "paused".into()
            }
            "resume" if job.status == "paused" => job.status = "queued".into(),
            "cancel" if !matches!(job.status.as_str(), "completed" | "cancelled") => {
                cancel_in(&tx, &[job.id.clone()])?;
                tx.commit().map_err(err)?;
                return Ok(());
            }
            "retry" if job.status == "blocked" => {
                if current_configuration(&tx)? != job.configuration {
                    return Err("规则已变化，请预览后重新执行新规则".into());
                }
                let data: String = tx
                    .query_row(
                        "SELECT data FROM messages WHERE id=?1",
                        [&job.mail_id],
                        |r| r.get(0),
                    )
                    .map_err(err)?;
                let m: Mail = serde_json::from_str(&data).map_err(err)?;
                job.source = read_plan(&tx, &m)?;
                archive_jobs::proof(&tx, &job.source)?;
                job.local_state = local_state(&m)?;
                job.retry_queues = true;
                job.status = "queued".into();
            }
            _ => return Err("规则处理状态已变化，请刷新".into()),
        }
        job.revision += 1;
        job.error.clear();
        job.updated_at = chrono::Utc::now().to_rfc3339();
        tx.execute(
            "UPDATE rule_runs SET data=?2,status=?3,revision=?4,error='',updated_at=?5 WHERE id=?1",
            params![
                job.id,
                serde_json::to_string(&job).map_err(err)?,
                job.status,
                job.revision,
                job.updated_at
            ],
        )
        .map_err(err)?;
        tx.commit().map_err(err)
    }

    pub(crate) fn process_rule_run(&self, expected: &RuleRun, raw: &[u8]) -> Result<()> {
        let (a, _) = archive_jobs::proof(&self.db()?, &expected.source)?;
        let parsed = archive::parse(raw, &a, &expected.source.folder)?.0;
        let hash = archive::digest(raw);
        let end = raw
            .windows(4)
            .position(|w| w == b"\r\n\r\n")
            .map(|p| p + 4)
            .unwrap_or(raw.len());
        let header_hash = archive::digest(&raw[..end]);
        loop {
            let _archive = self.archive_gate.read().map_err(err)?;
            let mut db = self.db()?;
            let tx = db
                .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
                .map_err(err)?;
            let (mut job, a, mut m) = guard(&tx, expected, &hash, &header_hash)?;
            if job.cursor >= job.rules.len() {
                job.status = "completed".into();
                write(&tx, &mut job)?;
                tx.commit().map_err(err)?;
                return Ok(());
            }
            let r = job.rules[job.cursor].clone();
            let mut evaluation = m.clone();
            evaluation.body = parsed.body.clone();
            evaluation.has_attachments = parsed.has_attachments;
            evaluation.size = parsed.size;
            evaluation.cc = parsed.cc.clone();
            evaluation.priority = parsed.priority.clone();
            evaluation.header_metadata_known = parsed.header_metadata_known;
            let decode_ok = !rules::body_decode_failed(&parsed);
            if r.conditions.iter().any(|c| c.field == "body")
                && rules::match_state_observed(&r, &m, job.observed, false)
                    == rules::MatchState::NeedsBody
                && !decode_ok
            {
                return Err("原件含解码异常，未按不完整正文执行规则，请核对邮件内容".into());
            }
            let state = rules::match_state_observed(&r, &evaluation, job.observed, decode_ok);
            let has_source = if rules::remote(&r) {
                rule_operations::resolve_source(&tx, &r, &m, &a)?.is_some()
            } else {
                true
            };
            let matched = state == rules::MatchState::Match
                && has_source
                && !(r.action == "unread" && crate::search::is_non_unread_mail(&tx, &m.id)?);
            let applicable = !job.remote_only || rules::remote(&r) || rules::saves(&r);
            if matched && applicable {
                let needs_save = rules::saves(&r)
                    || (r.action == "serverMove"
                        && !r.source_folder.is_empty()
                        && self.should_save_folder(&a, &r.source_folder)?);
                if needs_save && !m.saved_locally {
                    let status = Self::queue_archive_in(&tx, &m.id)?;
                    if status != "queued" {
                        return Err(format!(
                            "完整保存任务{status}，请在保存任务中处理后重试规则"
                        ));
                    }
                    let saved = Self::archive_job_for_mail_in(&tx, &m.id)?;
                    if tx
                        .execute(
                            "UPDATE archive_jobs SET status='running' WHERE id=?1 AND revision=?2 AND status='queued'",
                            params![saved.id, saved.revision],
                        )
                        .map_err(err)?
                        != 1
                    {
                        return Err("完整保存任务状态已变化，请重试规则".into());
                    }
                    self.complete_archive_in(&tx, &saved, raw)?;
                    let data: String = tx
                        .query_row("SELECT data FROM messages WHERE id=?1", [&m.id], |row| {
                            row.get(0)
                        })
                        .map_err(err)?;
                    m = serde_json::from_str(&data).map_err(err)?;
                }
                if let Err(error) = check_local_intent(&job, &m, &r) {
                    if r.action == "saveFolder" {
                        job.status = "blocked".into();
                        job.error = format!("完整原件已保存，但归类未执行：{error}");
                        write(&tx, &mut job)?;
                        tx.commit().map_err(err)?;
                        return Ok(());
                    }
                    return Err(error);
                }
                if rules::remote(&r) {
                    let mut remote_mail = m.clone();
                    remote_mail.body = evaluation.body.clone();
                    remote_mail.has_attachments = evaluation.has_attachments;
                    let retry = job.retry_queues && Self::unqueued_rule_failure_in(&tx, &r, &m.id)?;
                    Self::apply_remote_rule_in(&tx, &r, &remote_mail, retry)?;
                    let item: Option<(Option<String>, String, String)> = tx
                        .query_row(
                            "SELECT operation_id,status,error FROM rule_executions WHERE rule_id=?1 AND mail_id=?2 ORDER BY rowid DESC LIMIT 1",
                            params![r.id, m.id],
                            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                        )
                        .optional()
                        .map_err(err)?;
                    if let Some((op, status, error)) = item {
                        if status == "blocked" && op.is_none() {
                            job.status = "blocked".into();
                            job.error = error;
                            write(&tx, &mut job)?;
                            tx.commit().map_err(err)?;
                            return Ok(());
                        }
                        if let Some(id) = op {
                            if !job.operations.contains(&id) {
                                job.operations.push(id);
                            }
                        }
                    }
                } else {
                    m.has_attachments = parsed.has_attachments;
                    m.attachment_metadata_known = true;
                    match r.action.as_str() {
                        "folder" => m.local_folder = r.destination.clone(),
                        "saveFolder" if !job.remote_only => m.local_folder = r.destination.clone(),
                        "save" | "saveFolder" => {}
                        "read" => {
                            m.is_read = true;
                            m.local_read_override = Some(true);
                        }
                        "unread" => {
                            m.is_read = false;
                            m.local_read_override = Some(false);
                        }
                        "star" => {
                            m.starred = true;
                            m.local_star_override = Some(true);
                        }
                        "trash" => m.trashed = true,
                        _ => return Err("未知规则动作".into()),
                    }
                    tx.execute(
                        "UPDATE messages SET data=?2 WHERE id=?1",
                        params![m.id, serde_json::to_string(&m).map_err(err)?],
                    )
                    .map_err(err)?;
                }
                job.applied += 1;
                advance_local_intent(&mut job, &m, &r)?;
            }
            job.cursor += 1;
            if (matched && r.stop) || job.cursor == job.rules.len() {
                job.status = "completed".into();
            }
            write(&tx, &mut job)?;
            tx.commit().map_err(err)?;
            if !rules::remote(&r)
                && (r.action == "folder" || (r.action == "saveFolder" && !job.remote_only))
                && m.local_folder != "全部存档"
            {
                self.relocate_archive_after_move_unlocked(&m.local_folder, &m.id);
                if let Ok(updated) = self.mail(&m.id) {
                    m = updated;
                }
            }
            if job.status == "completed" {
                return Ok(());
            }
        }
    }

    fn fail_rule_run(&self, job: &RuleRun, error: &str) -> Result<()> {
        self.db()?.execute("UPDATE rule_runs SET status='blocked',error=?3,updated_at=?4 WHERE id=?1 AND revision=?2 AND status='running'",params![job.id,job.revision,error,chrono::Utc::now().to_rfc3339()]).map_err(err)?;
        Ok(())
    }
}

pub fn start(store: Store, app: tauri::AppHandle) {
    std::thread::spawn(move || loop {
        let next = (|| -> Result<Option<RuleRun>> {
            store.db()?.query_row(&format!("SELECT {COLUMNS} FROM rule_runs WHERE status='queued' ORDER BY updated_at LIMIT 1"),[],decode).optional().map_err(err)
        })();
        if let Ok(Some(job)) = next {
            let result = (|| -> Result<()> {
                let gate = crate::sync_control::folder_gate(
                    &store.root,
                    &job.source.account_id,
                    &job.source.folder,
                )?;
                let _folder = gate.lock().map_err(err)?;
                if !store.claim_rule_run(&job)? {
                    return Ok(());
                }
                let (a, m) = archive_jobs::proof(&store.db()?, &job.source)?;
                let raw = if m.saved_locally {
                    store.read_archive(m.rel_path.as_deref(), &m.hash)?
                } else {
                    crate::network::read_remote_source(
                        &store,
                        &a,
                        &m,
                        &job.source.folder,
                        &job.source.remote_id,
                    )?
                };
                store.process_rule_run(&job, &raw)
            })();
            if let Err(error) = result {
                let _ = store.fail_rule_run(&job, &error);
            }
            let _ = app.emit("mail-updated", ());
        }
        std::thread::sleep(std::time::Duration::from_secs(1));
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tests::{account, query, raw};

    fn fixture() -> (tempfile::TempDir, Store, Account, String, Vec<u8>) {
        let root = tempfile::tempdir().unwrap();
        let store = Store::new(root.path().into()).unwrap();
        let mut a = account();
        a.save_locally = false;
        store.save_account(&a).unwrap();
        let full = raw();
        let end = full.windows(4).position(|w| w == b"\r\n\r\n").unwrap() + 4;
        store
            .ingest(&a, "INBOX", "7:12", &full[..end], false)
            .unwrap();
        let id = store
            .db()
            .unwrap()
            .query_row("SELECT id FROM messages", [], |r| r.get::<_, String>(0))
            .unwrap();
        (root, store, a, id, full)
    }

    fn rule(a: &Account, action: &str) -> Rule {
        Rule {
            id: format!("rule-{action}"),
            name: action.into(),
            account_id: a.id.clone(),
            enabled: true,
            mode: "all".into(),
            conditions: vec![Condition {
                field: "subject".into(),
                operator: "contains".into(),
                value: "invoice".into(),
            }],
            actions: Vec::new(),
            action: action.into(),
            destination: if matches!(action, "saveFolder" | "folder") {
                "Invoices".into()
            } else {
                String::new()
            },
            source_folder: String::new(),
            stop: false,
        }
    }

    fn pending(store: &Store) -> RuleRun {
        let id = store.rule_runs().unwrap()[0].id.clone();
        store.rule_run(&id).unwrap()
    }

    #[test]
    fn one_rule_applies_ordered_local_actions_and_stops_after_its_last_step() {
        let (_root, store, account, id, _raw) = fixture();
        let mut combined = rule(&account, "folder");
        combined.actions = vec![
            RuleAction {
                action: "folder".into(),
                destination: "Invoices".into(),
                source_folder: String::new(),
            },
            RuleAction {
                action: "read".into(),
                destination: String::new(),
                source_folder: String::new(),
            },
        ];
        combined.stop = true;
        store
            .save_rules(&[combined.clone(), rule(&account, "star")])
            .unwrap();
        assert_eq!(store.run_rules().unwrap(), 2);
        let mail = store.mail(&id).unwrap();
        assert_eq!(mail.local_folder, "Invoices");
        assert!(mail.is_read);
        assert_eq!(mail.local_read_override, Some(true));
        assert!(!mail.starred);
        assert_eq!(store.rules().unwrap()[0].actions.len(), 2);
        assert_eq!(rules::expand(&[combined])[1].action, "read");
    }

    #[test]
    fn deferred_chain_keeps_status_conditions_from_the_first_match_snapshot() {
        let (_root, store, a, id, raw) = fixture();
        let mut chain = rule(&a, "read");
        chain.conditions = vec![Condition {
            field: "read".into(),
            operator: "equals".into(),
            value: "false".into(),
        }];
        chain.actions = vec![
            RuleAction {
                action: "read".into(),
                destination: String::new(),
                source_folder: String::new(),
            },
            RuleAction {
                action: "save".into(),
                destination: String::new(),
                source_folder: String::new(),
            },
        ];
        store.save_rules(&[chain]).unwrap();
        assert_eq!(store.run_rules().unwrap(), 1);
        let job = pending(&store);
        assert_eq!(job.cursor, 0);
        assert!(job.observed.is_some_and(|s| !s.is_read));
        assert!(store.claim_rule_run(&job).unwrap());
        store.process_rule_run(&job, &raw).unwrap();
        let m = store.mail(&id).unwrap();
        assert!(m.is_read);
        assert_eq!(m.local_read_override, Some(true));
        assert!(m.saved_locally);
        assert_eq!(store.rule_run(&job.id).unwrap().status, "completed");
    }

    #[test]
    fn save_folder_publishes_full_bytes_and_keeps_identity() {
        let (_root, store, a, id, raw) = fixture();
        let mut save = rule(&a, "saveFolder");
        save.stop = false;
        let mut star = rule(&a, "star");
        star.stop = true;
        store.save_rules(&[save, star]).unwrap();
        assert_eq!(store.run_rules().unwrap(), 1);
        let before = store.mail(&id).unwrap();
        let job = pending(&store);
        assert!(store.claim_rule_run(&job).unwrap());
        store.process_rule_run(&job, &raw).unwrap();
        let m = store.mail(&id).unwrap();
        assert_eq!(m.id, before.id);
        assert!(m.saved_locally && m.starred);
        assert_eq!(m.local_folder, "Invoices");
        let rel = m.rel_path.as_deref().unwrap();
        assert!(
            rel.contains("Invoices"),
            "完整保存并归类后应在目标目录: {rel}"
        );
        assert!(store.root.join(rel).exists());
        let job = store.rule_run(&job.id).unwrap();
        assert_eq!(
            (job.status.as_str(), job.cursor, job.applied),
            ("completed", 2, 2)
        );
        assert_eq!(store.archive_jobs().unwrap()[0].status, "completed");
    }

    #[test]
    fn remote_move_and_read_in_one_rule_keep_one_remote_operation() {
        let (_root, store, account, id) = crate::directory_operations::tests::fixture();
        let mut combined = rule(&account, "serverMove");
        combined.source_folder = "INBOX".into();
        combined.destination = "Archive".into();
        combined.actions = vec![
            RuleAction {
                action: "serverMove".into(),
                destination: "Archive".into(),
                source_folder: "INBOX".into(),
            },
            RuleAction {
                action: "read".into(),
                destination: String::new(),
                source_folder: String::new(),
            },
        ];
        store.save_rules(&[combined]).unwrap();
        assert_eq!(store.run_rules().unwrap(), 2);
        assert!(store.mail(&id).unwrap().is_read);
        assert_eq!(store.rule_executions().unwrap().len(), 1);
        assert_eq!(store.directory_operations().unwrap().len(), 1);
        store.run_rules().unwrap();
        assert_eq!(store.directory_operations().unwrap().len(), 1);
    }

    #[test]
    fn preview_reports_body_wait_without_reading_archive() {
        let (_root, store, a, _id, _raw) = fixture();
        let mut r = rule(&a, "folder");
        r.conditions[0] = Condition {
            field: "body".into(),
            operator: "contains".into(),
            value: "invoice".into(),
        };
        assert!(store
            .preview_rule(&r)
            .unwrap()
            .first()
            .is_some_and(|s| s.contains("等待完整邮件核对")));
    }

    #[test]
    fn unread_chain_does_not_touch_sent_or_draft_mail() {
        let (_root, store, a, id, _raw) = fixture();
        let mut m = store.mail(&id).unwrap();
        m.source_folder = "Sent".into();
        store.update_mail(&m).unwrap();
        let mut r = rule(&a, "unread");
        r.conditions[0].value = "invoice".into();
        store.save_rules(&[r]).unwrap();
        assert_eq!(store.run_rules().unwrap(), 0);
    }

    #[test]
    fn candidate_scan_keeps_conditions_scoped_to_listing_projection() {
        let (_root, store, a, _id, _raw) = fixture();
        let mut r = rule(&a, "folder");
        r.conditions[0].value = "missing".into();
        store.save_rules(&[r]).unwrap();
        assert_eq!(store.run_rules().unwrap(), 0);
        assert!(store.snapshot(&query()).unwrap().logs.is_empty());
    }
}
