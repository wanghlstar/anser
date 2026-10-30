use crate::{archive, models::*, store::Store};
use rusqlite::{params, OptionalExtension};
use std::collections::BTreeMap;
use std::sync::{
    atomic::{AtomicBool, AtomicUsize, Ordering},
    Arc,
};

/// 「重新编辑」草稿的收件人回显：带显示名时按 MIME 规范加引号
fn format_mailbox(address: &Address) -> String {
    if address.name.is_empty() {
        address.email.clone()
    } else {
        format!("{} <{}>", quote_display_name(&address.name), address.email)
    }
}
fn quote_display_name(name: &str) -> String {
    let special = |c: char| {
        c.is_whitespace() || matches!(c, ',' | ':' | ';' | '"' | '(' | ')' | '<' | '>' | '@')
    };
    if name.chars().any(special) {
        format!("\"{}\"", name.replace('\\', "\\\\").replace('"', "\\\""))
    } else {
        name.to_string()
    }
}

fn display_name(name: &str, email: &str) -> Option<String> {
    let name = name.trim();
    if name.is_empty() || name.contains('@') || name.eq_ignore_ascii_case(email) {
        None
    } else {
        Some(name.to_string())
    }
}

fn is_system_contact(email: &str) -> bool {
    let local = email.split('@').next().unwrap_or("").to_lowercase();
    local == "mailer-daemon"
        || local == "postmaster"
        || local == "noreply"
        || local == "no-reply"
        || local == "donotreply"
        || local == "do-not-reply"
        || local.starts_with("bounce")
}

#[derive(Default)]
pub struct SyncSchedule {
    last_sync: Option<i64>,
    last_tick: Option<i64>,
    wake_pending: bool,
}
impl SyncSchedule {
    pub fn due(&mut self, now: i64, interval: i64) -> bool {
        if self
            .last_tick
            .is_some_and(|last| now - last > 45 || now < last)
        {
            self.wake_pending = true;
        }
        self.last_tick = Some(now);
        self.wake_pending || self.last_sync.is_none_or(|last| now - last >= interval)
    }
    pub fn completed(&mut self, now: i64) {
        self.last_sync = Some(now);
        self.last_tick = Some(now);
        self.wake_pending = false;
    }
}

#[derive(Clone)]
struct HealthCache {
    mail_id: String,
    rel_path: String,
    size: u64,
    mtime_ns: i64,
    hash: String,
    status: String,
    error: String,
}

#[derive(Default)]
struct HealthOutcome {
    error: String,
    unavailable: bool,
    cache: Option<HealthCache>,
}

impl Store {
    pub fn preferences(&self) -> Result<Preferences> {
        use rusqlite::OptionalExtension;
        let data: Option<String> = self
            .db()?
            .query_row("SELECT data FROM preferences WHERE key='sync'", [], |r| {
                r.get(0)
            })
            .optional()
            .map_err(err)?;
        data.map(|data| serde_json::from_str(&data).map_err(err))
            .unwrap_or(Ok(Preferences::default()))
    }
    pub fn save_preferences(&self, p: &Preferences) -> Result<()> {
        if ![1, 5, 10, 15, 30, 60].contains(&p.sync_interval_minutes) {
            return Err("请选择有效的后台检查间隔".into());
        }
        if ![0, 3, 5, 10].contains(&p.send_countdown_seconds) {
            return Err("请选择有效的发送倒计时".into());
        }
        self.db()?.execute("INSERT INTO preferences(key,data) VALUES('sync',?1) ON CONFLICT(key) DO UPDATE SET data=excluded.data",[serde_json::to_string(p).map_err(err)?]).map_err(err)?;
        Ok(())
    }
    pub fn archive_health(&self) -> Result<ArchiveHealth> {
        self.archive_health_mode(false)
    }

    pub fn archive_health_mode(&self, deep: bool) -> Result<ArchiveHealth> {
        self.archive_health_with_progress(deep, Arc::new(AtomicBool::new(false)), |_, _| {})
    }

    /// Quick mode trusts a healthy cache entry when path, size, mtime and hash
    /// are unchanged. Deep mode re-reads and re-parses every original.
    pub fn archive_health_with_progress<P>(
        &self,
        deep: bool,
        cancel: Arc<AtomicBool>,
        progress: P,
    ) -> Result<ArchiveHealth>
    where
        P: Fn(usize, usize) + Send + Sync,
    {
        let mails = {
            let db = self.db()?;
            let mut q = db
                .prepare("SELECT data FROM messages WHERE COALESCE(json_extract(data,'$.savedLocally'),1)=1 ORDER BY rowid")
                .map_err(err)?;
            let rows = q
                .query_map([], |r| r.get::<_, String>(0))
                .map_err(err)?
                .collect::<std::result::Result<Vec<String>, _>>()
                .map_err(err)?;
            rows.iter()
                .map(|row| serde_json::from_str::<Mail>(row).map_err(err))
                .collect::<Result<Vec<_>>>()?
        };
        let cache = self.archive_health_cache()?;
        let external = self
            .preferences()?
            .external_archive_dir
            .filter(|path| !path.trim().is_empty());
        let external_ready = external
            .as_deref()
            .is_none_or(|path| std::path::Path::new(path).is_dir());
        let workers = std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(4)
            .clamp(1, 8)
            .min(mails.len().max(1));
        let total = mails.len();
        let done = Arc::new(AtomicUsize::new(0));
        let outcomes = if workers == 1 {
            mails
                .iter()
                .map(|mail| {
                    if cancel.load(Ordering::Relaxed) {
                        return None;
                    }
                    let outcome = self.verify_archive_mail(mail, &cache, external_ready, deep);
                    let finished = done.fetch_add(1, Ordering::Relaxed) + 1;
                    progress(finished, total);
                    Some(outcome)
                })
                .collect::<Vec<_>>()
        } else {
            let mut all = Vec::with_capacity(mails.len());
            std::thread::scope(|scope| {
                let mut handles = Vec::new();
                let chunk_size = mails.len().div_ceil(workers);
                for chunk in mails.chunks(chunk_size) {
                    let store = self.clone();
                    let cache = cache.clone();
                    let cancel = cancel.clone();
                    let done = done.clone();
                    let progress = &progress;
                    handles.push(scope.spawn(move || {
                        chunk
                            .iter()
                            .map(|mail| {
                                if cancel.load(Ordering::Relaxed) {
                                    return None;
                                }
                                let outcome =
                                    store.verify_archive_mail(mail, &cache, external_ready, deep);
                                let finished = done.fetch_add(1, Ordering::Relaxed) + 1;
                                progress(finished, total);
                                Some(outcome)
                            })
                            .collect::<Vec<_>>()
                    }));
                }
                for handle in handles {
                    all.extend(handle.join().expect("archive health worker"));
                }
            });
            all
        };
        if cancel.load(Ordering::Relaxed) {
            return Err("已取消存档校验".into());
        }
        let mut checked = 0;
        let mut healthy = 0;
        let mut unavailable = 0;
        let mut problems = Vec::new();
        let mut writes = Vec::new();
        for (mail, outcome) in mails.iter().zip(outcomes.into_iter().flatten()) {
            if outcome.unavailable {
                unavailable += 1;
                continue;
            }
            checked += 1;
            if outcome.error.is_empty() {
                healthy += 1;
            } else {
                problems.push(ArchiveProblem {
                    mail_id: mail.id.clone(),
                    subject: mail.subject.clone(),
                    error: outcome.error.clone(),
                });
            }
            if let Some(entry) = outcome.cache {
                writes.push(entry);
            }
        }
        if !writes.is_empty() {
            let mut db = self.db()?;
            let tx = db
                .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
                .map_err(err)?;
            for entry in &writes {
                tx.execute(
                    "INSERT INTO archive_health_cache(mail_id,rel_path,size,mtime_ns,hash,status,error,checked_at)
                     VALUES(?1,?2,?3,?4,?5,?6,?7,?8)
                     ON CONFLICT(mail_id) DO UPDATE SET rel_path=excluded.rel_path,size=excluded.size,mtime_ns=excluded.mtime_ns,hash=excluded.hash,status=excluded.status,error=excluded.error,checked_at=excluded.checked_at",
                    params![
                        entry.mail_id,
                        entry.rel_path,
                        entry.size as i64,
                        entry.mtime_ns,
                        entry.hash,
                        entry.status,
                        entry.error,
                        chrono::Utc::now().to_rfc3339()
                    ],
                )
                .map_err(err)?;
            }
            tx.execute(
                "DELETE FROM archive_health_cache WHERE mail_id NOT IN (SELECT id FROM messages)",
                [],
            )
            .map_err(err)?;
            tx.commit().map_err(err)?;
        }
        Ok(ArchiveHealth {
            checked,
            healthy,
            external_archive_unavailable: !external_ready,
            unavailable,
            problems,
            checked_at: chrono::Utc::now().to_rfc3339(),
        })
    }

    fn archive_health_cache(&self) -> Result<std::collections::HashMap<String, HealthCache>> {
        let db = self.db()?;
        let mut q = db
            .prepare(
                "SELECT mail_id,rel_path,size,mtime_ns,hash,status,error FROM archive_health_cache",
            )
            .map_err(err)?;
        let rows = q
            .query_map([], |r| {
                Ok(HealthCache {
                    mail_id: r.get(0)?,
                    rel_path: r.get(1)?,
                    size: r.get::<_, i64>(2)? as u64,
                    mtime_ns: r.get(3)?,
                    hash: r.get(4)?,
                    status: r.get(5)?,
                    error: r.get(6)?,
                })
            })
            .map_err(err)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(err)?;
        Ok(rows
            .into_iter()
            .map(|entry| (entry.mail_id.clone(), entry))
            .collect())
    }

    fn verify_archive_mail(
        &self,
        mail: &Mail,
        cache: &std::collections::HashMap<String, HealthCache>,
        external_ready: bool,
        deep: bool,
    ) -> HealthOutcome {
        let rel = mail
            .rel_path
            .clone()
            .unwrap_or_else(|| format!("archive/{}.eml", mail.hash));
        let path = self.archive_file_path(&rel);
        if path.is_none() && !external_ready {
            return HealthOutcome {
                unavailable: true,
                ..HealthOutcome::default()
            };
        }
        let Some((path, size, mtime_ns)) = path else {
            return HealthOutcome {
                error: "存档文件不存在".into(),
                cache: Some(HealthCache {
                    mail_id: mail.id.clone(),
                    rel_path: rel,
                    size: 0,
                    mtime_ns: 0,
                    hash: mail.hash.clone(),
                    status: "problem".into(),
                    error: "存档文件不存在".into(),
                }),
                ..HealthOutcome::default()
            };
        };
        if !deep {
            if let Some(entry) = cache.get(&mail.id) {
                if entry.rel_path == rel
                    && entry.size == size
                    && entry.mtime_ns == mtime_ns
                    && entry.hash == mail.hash
                {
                    return HealthOutcome {
                        error: if entry.status == "healthy" {
                            String::new()
                        } else {
                            entry.error.clone()
                        },
                        ..HealthOutcome::default()
                    };
                }
            }
        }
        let error = self
            .read_archive(Some(&rel), &mail.hash)
            .and_then(|raw| {
                let parsed = mailparse::parse_mail(&raw).map_err(err)?;
                let mut parts = Vec::new();
                archive::leaves(&parsed, &mut parts);
                for part in parts {
                    archive::decoded_bytes(part)?;
                }
                Ok(())
            })
            .err()
            .unwrap_or_default();
        let status = if error.is_empty() {
            "healthy"
        } else {
            "problem"
        };
        HealthOutcome {
            error: error.clone(),
            cache: Some(HealthCache {
                mail_id: mail.id.clone(),
                rel_path: rel,
                size,
                mtime_ns,
                hash: mail.hash.clone(),
                status: status.into(),
                error,
            }),
            ..HealthOutcome::default()
        }
    }

    fn archive_file_path(&self, rel: &str) -> Option<(std::path::PathBuf, u64, i64)> {
        let roots = self.archive_roots.read().ok()?.clone();
        for root in roots {
            let path = root.join(rel);
            let Ok(meta) = std::fs::metadata(&path) else {
                continue;
            };
            if !meta.is_file() {
                continue;
            }
            let mtime_ns = meta
                .modified()
                .ok()
                .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_nanos() as i64)
                .unwrap_or(0);
            return Some((path, meta.len(), mtime_ns));
        }
        None
    }

    pub fn contacts(&self) -> Result<Vec<Contact>> {
        let db = self.db()?;
        let mut query = db
            .prepare("SELECT id,name,email FROM contacts ORDER BY name COLLATE NOCASE,email")
            .map_err(err)?;
        let rows = query
            .query_map([], |r| {
                Ok(Contact {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    email: r.get(2)?,
                })
            })
            .map_err(err)?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(err)
    }
    pub fn save_contact(&self, contact: &Contact) -> Result<()> {
        let email = contact.email.trim();
        if email.parse::<lettre::Address>().is_err() || contact.name.contains(['\r', '\n']) {
            return Err("请填写有效的联系人邮箱和姓名".into());
        }
        if contact.id.trim().is_empty() {
            return Err("联系人标识不能为空".into());
        }
        self.db()?.execute("INSERT INTO contacts(id,name,email) VALUES(?1,?2,?3) ON CONFLICT(id) DO UPDATE SET name=excluded.name,email=excluded.email",
            params![contact.id,contact.name.trim(),email]).map_err(|e| match e {
                rusqlite::Error::SqliteFailure(ref code, _) if code.code == rusqlite::ErrorCode::ConstraintViolation => "该邮箱已存在于通讯录中".to_string(),
                other => err(other),
            })?;
        Ok(())
    }
    pub fn contact_blacklist(&self) -> Result<Vec<String>> {
        let db = self.db()?;
        let mut query = db
            .prepare("SELECT email FROM contact_blacklist ORDER BY email")
            .map_err(err)?;
        let rows = query
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(err)?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(err)
    }

    pub fn set_contact_ignored(&self, email: &str, ignored: bool) -> Result<()> {
        let email = email.trim();
        if email.parse::<lettre::Address>().is_err() {
            return Err("请填写有效的联系人邮箱".into());
        }
        let db = self.db()?;
        if ignored {
            db.execute(
                "INSERT OR IGNORE INTO contact_blacklist(email,created_at) VALUES(?1,?2)",
                params![email, chrono::Utc::now().to_rfc3339()],
            )
            .map_err(err)?;
        } else {
            db.execute(
                "DELETE FROM contact_blacklist WHERE email=?1 COLLATE NOCASE",
                [email],
            )
            .map_err(err)?;
        }
        Ok(())
    }

    pub fn contact_history(&self) -> Result<Vec<ContactCandidate>> {
        #[derive(Default)]
        struct Seen {
            count: u32,
            names: BTreeMap<String, u32>,
            last_seen: String,
        }
        let own: std::collections::BTreeSet<String> = self
            .accounts()?
            .into_iter()
            .flat_map(|account| {
                [account.email, account.username]
                    .into_iter()
                    .filter(|value| !value.trim().is_empty())
                    .map(|value| value.trim().to_lowercase())
            })
            .collect();
        let blocked: std::collections::BTreeSet<String> =
            self.contact_blacklist()?.into_iter().collect();
        let mut candidates = BTreeMap::<String, Seen>::new();
        let db = self.db()?;
        let mut query = db
            .prepare("SELECT data FROM message_listing ORDER BY rowid")
            .map_err(err)?;
        for row in query
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(err)?
        {
            let mail: Mail = serde_json::from_str(&row.map_err(err)?).map_err(err)?;
            if mail.trashed {
                continue;
            }
            let mut present = std::collections::BTreeSet::new();
            for value in [&mail.sender, &mail.recipients, &mail.cc] {
                for address in archive::addresses(value).unwrap_or_default() {
                    let email = address.email.trim().to_lowercase();
                    if email.parse::<lettre::Address>().is_err()
                        || own.contains(&email)
                        || blocked.contains(&email)
                        || is_system_contact(&email)
                        || !present.insert(email.clone())
                    {
                        continue;
                    }
                    let seen = candidates.entry(email).or_default();
                    seen.count += 1;
                    if !address.name.trim().is_empty() {
                        *seen
                            .names
                            .entry(address.name.trim().to_string())
                            .or_default() += 1;
                    }
                    if mail.date > seen.last_seen {
                        seen.last_seen = mail.date.clone();
                    }
                }
            }
        }
        let mut out: Vec<_> = candidates
            .into_iter()
            .map(|(email, seen)| ContactCandidate {
                name: seen
                    .names
                    .into_iter()
                    .max_by(|a, b| a.1.cmp(&b.1).then_with(|| b.0.cmp(&a.0)))
                    .map(|(name, _)| name)
                    .unwrap_or_default(),
                email,
                count: seen.count,
                last_seen: seen.last_seen,
            })
            .collect();
        out.sort_by(|a, b| {
            b.count
                .cmp(&a.count)
                .then_with(|| b.last_seen.cmp(&a.last_seen))
                .then_with(|| a.email.cmp(&b.email))
        });
        out.truncate(2000);
        Ok(out)
    }

    pub fn import_contacts(&self, candidates: &[ContactCandidate]) -> Result<ContactImportResult> {
        let mut db = self.db()?;
        let tx = db.transaction().map_err(err)?;
        let mut imported = 0;
        let mut skipped = 0;
        for candidate in candidates {
            let email = candidate.email.trim();
            if email.parse::<lettre::Address>().is_err() {
                skipped += 1;
                continue;
            }
            let exists: bool = tx
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM contacts WHERE email=?1 COLLATE NOCASE) OR EXISTS(SELECT 1 FROM contact_blacklist WHERE email=?1 COLLATE NOCASE)",
                    [email],
                    |r| r.get(0),
                )
                .map_err(err)?;
            if exists {
                skipped += 1;
                continue;
            }
            let name = candidate.name.trim().replace(['\r', '\n'], " ");
            tx.execute(
                "INSERT INTO contacts(id,name,email) VALUES(?1,?2,?3)",
                params![uuid::Uuid::new_v4().to_string(), name, email],
            )
            .map_err(err)?;
            imported += 1;
        }
        tx.commit().map_err(err)?;
        Ok(ContactImportResult { imported, skipped })
    }

    pub fn contact_suggestions(&self) -> Result<Vec<Address>> {
        let blocked: std::collections::BTreeSet<String> =
            self.contact_blacklist()?.into_iter().collect();
        let mut addresses = BTreeMap::<String, (Address, u32)>::new();
        let db = self.db()?;
        let mut query = db
            .prepare("SELECT data FROM message_listing ORDER BY rowid DESC LIMIT 1000")
            .map_err(err)?;
        for row in query
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(err)?
        {
            let mail: Mail = serde_json::from_str(&row.map_err(err)?).map_err(err)?;
            for value in [&mail.sender, &mail.recipients] {
                for address in archive::addresses(value).unwrap_or_default() {
                    if address.email.parse::<lettre::Address>().is_err() {
                        continue;
                    }
                    let key = address.email.to_lowercase();
                    if blocked.contains(&key) {
                        continue;
                    }
                    let mut address = address;
                    address.name = display_name(&address.name, &address.email).unwrap_or_default();
                    let entry = addresses.entry(key).or_insert((address, 0));
                    entry.1 += 1;
                }
            }
        }
        for c in self.contacts()? {
            addresses.insert(
                c.email.to_lowercase(),
                (
                    Address {
                        name: c.name,
                        email: c.email,
                    },
                    u32::MAX,
                ),
            );
        }
        let mut items: Vec<_> = addresses.into_values().collect();
        items.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.email.cmp(&b.0.email)));
        Ok(items.into_iter().take(200).map(|(a, _)| a).collect())
    }
    pub fn outbox(&self) -> Result<Vec<OutboxRecord>> {
        let db = self.db()?;
        let mut query = db.prepare("SELECT id,status,data,error,updated_at,raw,scheduled_at FROM outbox ORDER BY CASE WHEN status IN ('scheduled','overdue','paused') THEN 0 ELSE 1 END,scheduled_at, rowid DESC LIMIT 100").map_err(err)?;
        let rows = query
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, String>(4)?,
                    r.get::<_, Vec<u8>>(5)?,
                    r.get::<_, String>(6)?,
                ))
            })
            .map_err(err)?;
        let mut out = Vec::new();
        for row in rows {
            let (id, status, data, error, updated_at, raw, scheduled_at) = row.map_err(err)?;
            let draft: Compose = serde_json::from_str(&data).map_err(err)?;
            let hash = archive::digest(&raw);
            let (exists, rel): (bool, String) = db
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM messages WHERE account_id=?1 AND hash=?2), COALESCE((SELECT json_extract(data,'$.relPath') FROM messages WHERE account_id=?1 AND hash=?2 LIMIT 1),'')",
                    params![draft.account_id, hash],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .map_err(err)?;
            let archived = exists
                && self
                    .read_archive(
                        if rel.is_empty() {
                            None
                        } else {
                            Some(rel.as_str())
                        },
                        &hash,
                    )
                    .is_ok();
            let server_copy = self.sent_upload(&id)?;
            let server_copy_available = self
                .account(&draft.account_id)
                .is_ok_and(|a| a.enabled && !a.read_only && a.protocol == "imap");
            out.push(OutboxRecord {
                id,
                status,
                draft,
                error,
                updated_at,
                archived,
                scheduled_at,
                server_copy,
                server_copy_available,
            });
        }
        Ok(out)
    }
    /// 重新编辑已发送邮件：用存档原件生成新草稿，保留收件人/抄送/主题与附件。
    /// 重新发送会创建一封新邮件，不会改动原来的已发送记录。
    pub fn reedit_sent_mail(&self, id: &str) -> Result<Compose> {
        let mail = self.mail(id)?;
        let raw = self.message_raw(&mail)?;
        // 复用 recover_outbox_draft 的附件落盘逻辑（draft-assets/<新草稿 id>/…）
        let seed = Compose {
            forward_source: None,
            forward_files: Vec::new(),
            signature: None,
            id: uuid::Uuid::new_v4().to_string(),
            account_id: mail.account_id.clone(),
            to: String::new(),
            cc: String::new(),
            bcc: String::new(),
            subject: String::new(),
            body: String::new(),
            html: String::new(),
            format: String::new(),
            source: String::new(),
            attachments: Vec::new(),
            in_reply_to: String::new(),
            reply_anchor_id: String::new(),
            references: Vec::new(),
            quote: None,
            delivery_body: None,
            delivery_html: None,
        };
        let mut draft =
            self.recover_outbox_draft(&serde_json::to_string(&seed).map_err(err)?, &raw)?;
        // 正文/HTML 从存档原件重新解析：seed 只有账号，正文必须来自邮件本身
        let account = self.account_for_mail(&mail);
        let (parsed, html, _) = archive::parse(&raw, &account, &mail.source_folder)?;
        draft.body = parsed.body;
        draft.format = if html.is_empty() {
            "plain".into()
        } else {
            "rich".into()
        };
        draft.html = html;
        draft.subject = mail.subject.clone();
        // 收件人/抄送取原件头部；密送不存头部，重新发送时按需再填。
        // 显示名里的逗号/分号必须保留引号，否则会被当成地址分隔符拆错。
        draft.to = archive::header_addresses(&raw, "To")?
            .iter()
            .map(format_mailbox)
            .collect::<Vec<_>>()
            .join(", ");
        draft.cc = archive::header_addresses(&raw, "Cc")?
            .iter()
            .map(format_mailbox)
            .collect::<Vec<_>>()
            .join(", ");
        draft.bcc = String::new();
        // 签名块的拆分交给前端：原件的签名要单独取出、按原格式作为本封签名，
        // 不能留在正文里被富文本编辑器重排，也不能发送时再追加一次。
        self.save_draft(&draft)?;
        Ok(draft)
    }
    pub fn outbox_draft(&self, id: &str, confirm_duplicate: bool) -> Result<Compose> {
        let db = self.db()?;
        let (status, data, raw): (String, String, Vec<u8>) = db
            .query_row(
                "SELECT status,data,raw FROM outbox WHERE id=?1",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .map_err(err)?;
        if status != "failed" && status != "uncertain" {
            return Err("这条发送记录不能重新发送".into());
        }
        if status == "uncertain" && !confirm_duplicate {
            return Err("请先检查服务端已发送文件夹，并确认仍要准备重发".into());
        }
        self.account(
            &serde_json::from_str::<Compose>(&data)
                .map_err(err)?
                .account_id,
        )?;
        let draft = self.recover_outbox_draft(&data, &raw)?;
        self.save_draft(&draft)?;
        // Preparing a draft never sends it; retain the original protected record.
        Ok(draft)
    }
    pub fn archive_outbox(&self, id: &str) -> Result<()> {
        let (status, data, raw): (String, String, Vec<u8>) = self
            .db()?
            .query_row(
                "SELECT status,data,raw FROM outbox WHERE id=?1",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .map_err(err)?;
        if status != "sent" {
            return Err("仅 SMTP 已确认的邮件可恢复为已发送存档".into());
        }
        let draft: Compose = serde_json::from_str(&data).map_err(err)?;
        let mut account = self.account(&draft.account_id)?;
        // This is an explicit local recovery, independent of received-mail retention.
        account.save_locally = true;
        self.ingest(&account, "Sent", id, &raw, true)?;
        if let Some(upload) = self.sent_upload(id)?.filter(|u| {
            u.status == "completed"
                && !u.server_message_id.is_empty()
                && u.identity == crate::operations::identity(&account)
        }) {
            self.db()?.execute("UPDATE messages SET data=json_set(data,'$.serverMessageId',?3) WHERE id=(SELECT mail_id FROM sources WHERE account_id=?1 AND folder='Sent' AND remote_id=?2)",params![account.id,id,upload.server_message_id]).map_err(err)?;
        }
        self.db()?
            .execute("DELETE FROM drafts WHERE id=?1", [id])
            .map_err(err)?;
        Ok(())
    }
    /// 删除单条发送记录：仅限已终结的记录（发送中/待发送仍要保留，可取消或重发）。
    /// 已归档到本地存档的邮件不受影响，删的只是回执。
    pub fn delete_outbox(&self, id: &str) -> Result<()> {
        let mut db = self.db()?;
        let tx = db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(err)?;
        let status: Option<String> = tx
            .query_row("SELECT status FROM outbox WHERE id=?1", [id], |r| r.get(0))
            .optional()
            .map_err(err)?;
        let Some(status) = status else {
            return Err("发送记录不存在或已删除，请刷新后重试".into());
        };
        if matches!(
            status.as_str(),
            "sending" | "scheduled" | "overdue" | "paused"
        ) {
            return Err("这封邮件还在发送流程中，请先取消计划或等待结果".into());
        }
        tx.execute("DELETE FROM outbox WHERE id=?1", [id])
            .map_err(err)?;
        tx.execute("DELETE FROM sent_uploads WHERE id=?1", [id])
            .map_err(err)?;
        tx.commit().map_err(err)
    }
    /// 清空「发送成功」记录：失败/未确认/进行中的保留，仍可编辑重发。
    /// 已归档的本地邮件副本不受影响。
    pub fn clear_sent_outbox(&self) -> Result<usize> {
        let mut db = self.db()?;
        let tx = db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(err)?;
        let ids = tx
            .prepare("SELECT id FROM outbox WHERE status='sent'")
            .map_err(err)?
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(err)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(err)?;
        for id in &ids {
            tx.execute("DELETE FROM sent_uploads WHERE id=?1", [id])
                .map_err(err)?;
        }
        tx.execute("DELETE FROM outbox WHERE status='sent'", [])
            .map_err(err)?;
        tx.commit().map_err(err)?;
        Ok(ids.len())
    }
}
