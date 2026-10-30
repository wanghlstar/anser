//! Persistent local mail import jobs. Imports never create remote provenance
//! and never run rules.
use crate::{archive, eml_input, mail_formats, models::*, store::Store};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::{path::Path, time::Instant};
use tauri::Emitter;

const MAX_FILES: usize = 1000;
const MAX_BATCH: u64 = 1024 * 1024 * 1024;
const MAX_TREE_FILES: usize = 20_000;
const MAX_TREE_BATCH: u64 = 8 * 1024 * 1024 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportItem {
    pub ordinal: i64,
    pub filename: String,
    pub folder: String,
    pub status: String,
    pub error: String,
    pub warnings: usize,
    pub mail_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportJob {
    pub id: String,
    pub account_id: String,
    pub folder: String,
    pub status: String,
    pub total: usize,
    pub bytes: u64,
    pub processed: usize,
    pub added: usize,
    pub upgraded: usize,
    pub duplicate: usize,
    pub failed: usize,
    pub warnings: usize,
    pub error: String,
    pub items: Vec<ImportItem>,
}

pub fn initialize(db: &Connection) -> Result<()> {
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS message_imports(mail_id TEXT PRIMARY KEY,hash TEXT NOT NULL,imported_at TEXT NOT NULL);
         CREATE TRIGGER IF NOT EXISTS import_message_delete AFTER DELETE ON messages BEGIN DELETE FROM message_imports WHERE mail_id=OLD.id; END;
         CREATE TABLE IF NOT EXISTS eml_import_jobs(id TEXT PRIMARY KEY,account_id TEXT NOT NULL,folder TEXT NOT NULL,status TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,bytes INTEGER NOT NULL,created_at TEXT NOT NULL,error TEXT NOT NULL DEFAULT '');
         CREATE TABLE IF NOT EXISTS eml_import_items(job_id TEXT NOT NULL,ordinal INTEGER NOT NULL,filename TEXT NOT NULL,path TEXT NOT NULL,fingerprint TEXT NOT NULL,status TEXT NOT NULL,error TEXT NOT NULL DEFAULT '',warnings INTEGER NOT NULL DEFAULT 0,mail_id TEXT NOT NULL DEFAULT '',byte_offset INTEGER NOT NULL DEFAULT 0,byte_length INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(job_id,ordinal));
         CREATE INDEX IF NOT EXISTS import_pending ON eml_import_jobs(status,created_at);
         UPDATE eml_import_jobs SET status='interrupted',revision=revision+1,error='interrupted' WHERE status IN ('prepared','queued','running');
         UPDATE eml_import_items SET path='',fingerprint='' WHERE job_id IN (SELECT id FROM eml_import_jobs WHERE status!='running');",
    )
    .map_err(err)?;
    let exists: bool = db
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM pragma_table_info('eml_import_items') WHERE name='target_folder')",
            [],
            |r| r.get(0),
        )
        .map_err(err)?;
    if !exists {
        db.execute(
            "ALTER TABLE eml_import_items ADD COLUMN target_folder TEXT NOT NULL DEFAULT ''",
            [],
        )
        .map_err(err)?;
    }
    Ok(())
}

fn folder(value: &str) -> Result<&str> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > 120 || value.chars().any(char::is_control) {
        Err("文件夹名称无效".into())
    } else {
        Ok(value)
    }
}

fn account_in(db: &Connection, id: &str) -> Result<Account> {
    let data: String = db
        .query_row("SELECT data FROM accounts WHERE id=?1", [id], |r| r.get(0))
        .map_err(|_| "账号已被删除".to_string())?;
    serde_json::from_str(&data).map_err(err)
}

fn import_account_in(db: &Connection, id: &str) -> Result<Account> {
    match account_in(db, id) {
        Ok(account) => Ok(account),
        Err(_) => crate::archive_groups::account_for_group(db, id)?
            .ok_or_else(|| "账号已被删除".to_string()),
    }
}

fn space(root: &Path, bytes: u64) -> Result<()> {
    let needed = crate::retention_budget::with_reserve(bytes).ok_or("可用空间不足")?;
    if fs2::available_space(root).map_err(|_| "存档目录不可用".to_string())? < needed {
        return Err("可用空间不足".into());
    }
    Ok(())
}

fn finish_in(db: &Connection, id: &str, status: &str, error: &str) -> Result<()> {
    let previous: String = db
        .query_row(
            "SELECT status FROM eml_import_jobs WHERE id=?1",
            [id],
            |r| r.get(0),
        )
        .map_err(err)?;
    db.execute(
        "UPDATE eml_import_jobs SET status=?2,revision=revision+1,error=?3 WHERE id=?1",
        params![id, status, error],
    )
    .map_err(err)?;
    db.execute(
        "UPDATE eml_import_items SET path='',fingerprint='' WHERE job_id=?1",
        [id],
    )
    .map_err(err)?;
    if previous != "prepared" {
        let (added, upgraded, duplicate, failed): (i64, i64, i64, i64) = db
            .query_row(
                "SELECT COALESCE(SUM(status='added'),0),COALESCE(SUM(status='upgraded'),0),COALESCE(SUM(status='duplicate'),0),COALESCE(SUM(status='failed'),0) FROM eml_import_items WHERE job_id=?1",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .map_err(err)?;
        let state = match status {
            "completed" => "完成",
            "cancelled" => "已取消",
            _ => "已中断",
        };
        db.execute(
            "INSERT INTO logs(time,message) VALUES(?1,?2)",
            params![
                chrono::Local::now().format("%m-%d %H:%M").to_string(),
                format!("邮件本地导入{state}：新增 {added}，补全 {upgraded}，重复 {duplicate}，失败 {failed}")
            ],
        )
        .map_err(err)?;
        db.execute(
            "DELETE FROM logs WHERE id NOT IN (SELECT id FROM logs ORDER BY id DESC LIMIT 500)",
            [],
        )
        .map_err(err)?;
    }
    Ok(())
}

impl Store {
    pub fn prepare_eml_import(
        &self,
        paths: &[String],
        account_id: &str,
        target: &str,
    ) -> Result<ImportJob> {
        let target = folder(target)?;
        let folders = vec![target.to_string(); paths.len()];
        self.prepare_eml_import_with_folders(
            paths, account_id, target, &folders, MAX_FILES, MAX_BATCH,
        )
    }

    /// Scan a directory tree and preserve each file's relative parent folder.
    /// `prefix` is prepended to every relative path; empty prefix imports into
    /// `本地导入` when files sit directly in the selected directory.
    pub fn prepare_eml_import_tree(
        &self,
        root: &str,
        account_id: &str,
        prefix: &str,
    ) -> Result<ImportJob> {
        let root = Path::new(root);
        if !root.is_dir() {
            return Err("请选择邮件文件夹".into());
        }
        let prefix = prefix.trim().trim_matches('/');
        let mut files = Vec::new();
        fn walk(dir: &Path, base: &Path, files: &mut Vec<(String, String)>) -> Result<()> {
            let mut entries = std::fs::read_dir(dir)
                .map_err(|_| "无法读取邮件文件夹".to_string())?
                .collect::<std::result::Result<Vec<_>, _>>()
                .map_err(|_| "无法读取邮件文件夹".to_string())?;
            entries.sort_by_key(|entry| entry.file_name());
            for entry in entries {
                let name = entry.file_name();
                if name.to_string_lossy().starts_with('.') {
                    continue;
                }
                let path = entry.path();
                let file_type = entry
                    .file_type()
                    .map_err(|_| "无法读取邮件文件夹".to_string())?;
                if file_type.is_dir() {
                    walk(&path, base, files)?;
                } else if file_type.is_file() && mail_formats::supported(&path) {
                    let relative = path
                        .parent()
                        .and_then(|parent| parent.strip_prefix(base).ok())
                        .map(|parent| {
                            parent
                                .components()
                                .map(|part| part.as_os_str().to_string_lossy())
                                .collect::<Vec<_>>()
                                .join("/")
                        })
                        .unwrap_or_default();
                    files.push((path.to_string_lossy().into_owned(), relative));
                    if files.len() > MAX_TREE_FILES {
                        return Err("每批最多 20000 封邮件".into());
                    }
                }
            }
            Ok(())
        }
        walk(root, root, &mut files)?;
        if files.is_empty() {
            return Err("文件夹中没有可导入的 EML/EMLX/MSG/MBOX 文件".into());
        }
        let mut paths = Vec::with_capacity(files.len());
        let mut folders = Vec::with_capacity(files.len());
        for (path, relative) in files {
            paths.push(path);
            let folder = [prefix, relative.as_str()]
                .into_iter()
                .filter(|part| !part.is_empty())
                .collect::<Vec<_>>()
                .join("/");
            folders.push(if folder.is_empty() {
                "本地导入".to_string()
            } else {
                folder
            });
        }
        let job_folder = if prefix.is_empty() {
            "按文件夹导入"
        } else {
            prefix
        };
        self.prepare_eml_import_with_folders(
            &paths,
            account_id,
            job_folder,
            &folders,
            MAX_TREE_FILES,
            MAX_TREE_BATCH,
        )
    }

    fn prepare_eml_import_with_folders(
        &self,
        paths: &[String],
        account_id: &str,
        job_folder: &str,
        folders: &[String],
        max_files: usize,
        max_batch: u64,
    ) -> Result<ImportJob> {
        if paths.is_empty() || paths.len() > max_files || paths.len() != folders.len() {
            return Err(format!("每批最多 {max_files} 个邮件文件"));
        }
        let job_folder = folder(job_folder)?;
        import_account_in(&self.db()?, account_id)?;
        let mut entries = Vec::new();
        let mut bytes = 0u64;
        for (path, target) in paths.iter().zip(folders) {
            let target = folder(target)?.to_string();
            let p = Path::new(path);
            let name = p
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .chars()
                .take(255)
                .collect::<String>();
            let checked = eml_input::metadata_for_import(p);
            if let Ok(meta) = std::fs::symlink_metadata(p) {
                if meta.is_file() {
                    bytes = bytes.checked_add(meta.len()).ok_or("批量文件过大")?;
                }
            }
            if bytes > max_batch {
                return Err(format!(
                    "每批合计不能超过 {} GiB",
                    max_batch / (1024 * 1024 * 1024)
                ));
            }
            match checked {
                Ok(meta) => {
                    let stamp = eml_input::fingerprint(&meta);
                    match mail_formats::ranges(p, &stamp) {
                        Ok(ranges) => {
                            let multiple = ranges.len() > 1;
                            for (index, (offset, length)) in ranges.into_iter().enumerate() {
                                let file_name = if multiple {
                                    format!("{name} · #{}", index + 1)
                                } else {
                                    name.clone()
                                };
                                let (status, error) = if length > eml_input::IMPORT_MAX_BYTES {
                                    (
                                        "failed",
                                        format!(
                                            "单封邮件超过 {} MB",
                                            eml_input::IMPORT_MAX_BYTES / (1024 * 1024)
                                        ),
                                    )
                                } else {
                                    ("pending", String::new())
                                };
                                entries.push((
                                    file_name,
                                    path.clone(),
                                    stamp.clone(),
                                    status,
                                    error,
                                    offset,
                                    length,
                                    target.clone(),
                                ));
                            }
                        }
                        Err(e) if e == "batchLimit" => {
                            return Err(format!("每批最多 {max_files} 封邮件"))
                        }
                        Err(e) => entries.push((
                            name,
                            path.clone(),
                            String::new(),
                            "failed",
                            e,
                            0,
                            0,
                            target.clone(),
                        )),
                    }
                }
                Err(e) => entries.push((
                    name,
                    path.clone(),
                    String::new(),
                    "failed",
                    e,
                    0,
                    0,
                    target.clone(),
                )),
            }
            if entries.len() > max_files {
                return Err(format!("每批最多 {max_files} 封邮件"));
            }
        }

        let _archive = self.archive_gate.read().map_err(err)?;
        space(&self.import_root()?, bytes)?;
        let mut db = self.db()?;
        let tx = db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(err)?;
        import_account_in(&tx, account_id)?;
        let active: bool = tx
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM eml_import_jobs WHERE status IN ('queued','running'))",
                [],
                |r| r.get(0),
            )
            .map_err(err)?;
        if active {
            return Err("已有导入任务正在运行，请稍后再试".into());
        }
        let id = uuid::Uuid::new_v4().to_string();
        tx.execute(
            "INSERT INTO eml_import_jobs(id,account_id,folder,status,bytes,created_at) VALUES(?1,?2,?3,'prepared',?4,?5)",
            params![id, account_id, job_folder, bytes, chrono::Utc::now().to_rfc3339()],
        )
        .map_err(err)?;
        for (i, (name, path, stamp, status, error, offset, length, target)) in
            entries.iter().enumerate()
        {
            tx.execute(
                "INSERT INTO eml_import_items(job_id,ordinal,filename,path,fingerprint,status,error,byte_offset,byte_length,target_folder) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
                params![
                    id,
                    i as i64,
                    name,
                    if *status == "pending" { path.as_str() } else { "" },
                    stamp,
                    status,
                    error,
                    offset,
                    length,
                    target
                ],
            )
            .map_err(err)?;
        }
        tx.commit().map_err(err)?;
        self.eml_import_job(&id, true)
    }

    pub fn eml_import_jobs(&self) -> Result<Vec<ImportJob>> {
        let db = self.db()?;
        let mut q = db
            .prepare("SELECT id FROM eml_import_jobs WHERE status!='prepared' ORDER BY created_at DESC LIMIT 30")
            .map_err(err)?;
        let ids = q
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(err)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(err)?;
        ids.iter()
            .map(|id| self.eml_import_job(id, false))
            .collect()
    }

    pub fn eml_import_job(&self, id: &str, details: bool) -> Result<ImportJob> {
        let db = self.db()?;
        let mut job = db
            .query_row(
                "SELECT id,account_id,folder,status,bytes,error FROM eml_import_jobs WHERE id=?1",
                [id],
                |r| {
                    Ok(ImportJob {
                        id: r.get(0)?,
                        account_id: r.get(1)?,
                        folder: r.get(2)?,
                        status: r.get(3)?,
                        bytes: r.get(4)?,
                        error: r.get(5)?,
                        total: 0,
                        processed: 0,
                        added: 0,
                        upgraded: 0,
                        duplicate: 0,
                        failed: 0,
                        warnings: 0,
                        items: vec![],
                    })
                },
            )
            .map_err(err)?;
        let (total, added, upgraded, duplicate, failed, processed, warnings): (
            i64,
            i64,
            i64,
            i64,
            i64,
            i64,
            i64,
        ) = db
            .query_row(
                "SELECT COUNT(*),
                        COALESCE(SUM(status='added'),0),
                        COALESCE(SUM(status='upgraded'),0),
                        COALESCE(SUM(status='duplicate'),0),
                        COALESCE(SUM(status='failed'),0),
                        COALESCE(SUM(status!='pending'),0),
                        COALESCE(SUM(CASE WHEN warnings>0 THEN 1 ELSE 0 END),0)
                 FROM eml_import_items WHERE job_id=?1",
                [id],
                |r| {
                    Ok((
                        r.get(0)?,
                        r.get(1)?,
                        r.get(2)?,
                        r.get(3)?,
                        r.get(4)?,
                        r.get(5)?,
                        r.get(6)?,
                    ))
                },
            )
            .map_err(err)?;
        job.total = total as usize;
        job.added = added as usize;
        job.upgraded = upgraded as usize;
        job.duplicate = duplicate as usize;
        job.failed = failed as usize;
        job.processed = processed as usize;
        job.warnings = warnings as usize;
        if details {
            // The dialog only renders failed rows. Do not send 15k+ item rows
            // on every progress poll for a large directory import.
            let mut q = db
                .prepare("SELECT ordinal,filename,target_folder,status,error,warnings,mail_id FROM eml_import_items WHERE job_id=?1 AND status='failed' ORDER BY ordinal")
                .map_err(err)?;
            job.items = q
                .query_map([id], |r| {
                    Ok(ImportItem {
                        ordinal: r.get(0)?,
                        filename: r.get(1)?,
                        folder: r.get(2)?,
                        status: r.get(3)?,
                        error: r.get(4)?,
                        warnings: r.get(5)?,
                        mail_id: r.get(6)?,
                    })
                })
                .map_err(err)?
                .collect::<std::result::Result<Vec<_>, _>>()
                .map_err(err)?;
        }
        Ok(job)
    }

    pub fn eml_import_action(&self, id: &str, action: &str) -> Result<()> {
        let mut db = self.db()?;
        let tx = db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(err)?;
        let (status, account): (String, String) = tx
            .query_row(
                "SELECT status,account_id FROM eml_import_jobs WHERE id=?1",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(err)?;
        match action {
            "start" if status == "prepared" => {
                import_account_in(&tx, &account)?;
                let active: bool = tx
                    .query_row(
                        "SELECT EXISTS(SELECT 1 FROM eml_import_jobs WHERE status IN ('queued','running'))",
                        [],
                        |r| r.get(0),
                    )
                    .map_err(err)?;
                if active {
                    return Err("已有导入任务正在运行，请稍后再试".into());
                }
                tx.execute(
                    "UPDATE eml_import_jobs SET status='queued' WHERE id=?1",
                    [id],
                )
                .map_err(err)?;
            }
            "cancel" if ["prepared", "queued", "running"].contains(&status.as_str()) => {
                finish_in(&tx, id, "cancelled", "")?
            }
            "clear" if !["queued", "running"].contains(&status.as_str()) => {
                tx.execute("DELETE FROM eml_import_items WHERE job_id=?1", [id])
                    .map_err(err)?;
                tx.execute("DELETE FROM eml_import_jobs WHERE id=?1", [id])
                    .map_err(err)?;
            }
            _ => return Err("导入任务状态已变化".into()),
        }
        tx.commit().map_err(err)
    }

    pub(crate) fn process_eml_import(&self, id: &str) -> Result<bool> {
        let db = self.db()?;
        db.execute(
            "UPDATE eml_import_jobs SET status='running' WHERE id=?1 AND status='queued'",
            [id],
        )
        .map_err(err)?;
        let claim: Option<(String, String, i64)> = db
            .query_row(
                "SELECT account_id,folder,revision FROM eml_import_jobs WHERE id=?1 AND status='running'",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()
            .map_err(err)?;
        let Some((account_id, job_target, revision)) = claim else {
            return Ok(false);
        };
        let next: Option<(i64, String, String, u64, u64, String)> = db
            .query_row(
                "SELECT ordinal,path,fingerprint,byte_offset,byte_length,target_folder FROM eml_import_items WHERE job_id=?1 AND status='pending' ORDER BY ordinal LIMIT 1",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)),
            )
            .optional()
            .map_err(err)?;
        let Some((ordinal, path, stamp, offset, length, item_target)) = next else {
            let mut db = self.db()?;
            let tx = db
                .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
                .map_err(err)?;
            let live: bool = tx
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM eml_import_jobs WHERE id=?1 AND status='running' AND revision=?2)",
                    params![id, revision],
                    |r| r.get(0),
                )
                .map_err(err)?;
            if live {
                finish_in(&tx, id, "completed", "")?;
            }
            tx.commit().map_err(err)?;
            return Ok(true);
        };
        let result = (|| -> Result<()> {
            let started = Instant::now();
            let raw =
                eml_input::read_message_for_import(
                    Path::new(&path),
                    Some(&stamp),
                    offset,
                    Some(length),
                )?;
            let projection = mail_formats::mime(&raw)?;
            let raw = projection.as_ref();
            if started.elapsed() > eml_input::TIME_LIMIT {
                return Err("budgetExceeded".into());
            }
            let mut account = import_account_in(&self.db()?, &account_id)?;
            account.save_locally = true;
            let (mut mail, _, _) =
                archive::parse(raw, &account, "").map_err(|_| "invalidMessage".to_string())?;
            let _archive = self.archive_gate.read().map_err(err)?;
            let import_root = self.import_root()?;
            space(&import_root, raw.len() as u64)?;
            let mut db = self.db()?;
            let tx = db
                .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
                .map_err(err)?;
            let live: bool = tx
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM eml_import_jobs WHERE id=?1 AND revision=?2 AND status='running')",
                    params![id, revision],
                    |r| r.get(0),
                )
                .map_err(err)?;
            if !live {
                return Err("staleImport".into());
            }
            let target = if item_target.is_empty() {
                job_target.clone()
            } else {
                item_target
            };
            folder(&target)?;
            let latest_account = import_account_in(&tx, &account_id)?;
            mail.account_email = latest_account.email.clone();
            mail.hash = archive::digest(raw);
            mail.size = raw.len() as u64;
            mail.saved_at = chrono::Utc::now().to_rfc3339();
            mail.account_id = account_id.clone();
            let mut existing: Option<String> = tx
                .query_row(
                    "SELECT data FROM messages WHERE account_id=?1 AND hash=?2",
                    params![account_id, mail.hash],
                    |r| r.get(0),
                )
                .optional()
                .map_err(err)?;
            let mut matched_message_id = false;
            if existing.is_none() && !mail.message_id.is_empty() {
                existing = tx
                    .query_row(
                        "SELECT data FROM messages WHERE account_id=?1 AND json_extract(data,'$.messageId')=?2 LIMIT 1",
                        params![account_id, mail.message_id],
                        |r| r.get(0),
                    )
                    .optional()
                    .map_err(err)?;
                matched_message_id = existing.is_some();
            }
            let mut outcome = "added";
            let mut item_error = "";
            let mut old_id = String::new();
            if let Some(data) = existing {
                let old: Mail = serde_json::from_str(&data).map_err(err)?;
                old_id = old.id.clone();
                mail.id = old.id.clone();
                if old.saved_locally || old.trashed {
                    outcome = "duplicate";
                    if old.trashed {
                        item_error = "邮件已在已删除中";
                    } else if matched_message_id {
                        item_error = "邮件已存在（Message-ID）";
                    }
                } else {
                    outcome = "upgraded";
                    mail.is_read = old.is_read;
                    mail.starred = old.starred;
                    mail.local_read_override = old.local_read_override;
                    mail.local_star_override = old.local_star_override;
                    mail.local_folder = if old.local_folder.is_empty() {
                        target.clone()
                    } else {
                        old.local_folder
                    };
                    mail.trashed = old.trashed;
                    mail.date = old.date;
                    mail.server_date = old.server_date;
                    mail.source_folder = old.source_folder;
                    mail.server_message_id = old.server_message_id;
                }
            } else {
                mail.id = uuid::Uuid::new_v4().to_string();
                mail.is_read = true;
                mail.local_folder = target.clone();
                mail.source_folder = target.clone();
            }
            mail.trashed = false;
            let mut rel_path = String::new();
            if outcome != "duplicate" {
                rel_path = archive::store_raw(
                    &import_root,
                    &mail.account_id,
                    &latest_account.email,
                    &target,
                    raw,
                )?;
                mail.saved_locally = true;
                mail.rel_path = Some(rel_path.clone());
                tx.execute(
                    "INSERT INTO messages(id,account_id,hash,data,parser_version) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(id) DO UPDATE SET data=excluded.data,parser_version=excluded.parser_version",
                    params![
                        mail.id,
                        mail.account_id,
                        mail.hash,
                        serde_json::to_string(&mail).map_err(err)?,
                        archive::PARSER_VERSION
                    ],
                )
                .map_err(err)?;
                tx.execute(
                    "INSERT OR IGNORE INTO sources(account_id,folder,remote_id,mail_id,active) VALUES(?1,?2,?3,?4,0)",
                    params![
                        mail.account_id,
                        target,
                        format!("local:{}", mail.id),
                        mail.id
                    ],
                )
                .map_err(err)?;
                tx.execute(
                    "INSERT OR IGNORE INTO message_imports(mail_id,hash,imported_at) VALUES(?1,?2,?3)",
                    params![mail.id, mail.hash, chrono::Utc::now().to_rfc3339()],
                )
                .map_err(err)?;
                let file = import_root.join(&rel_path);
                if let Ok(meta) = std::fs::metadata(&file) {
                    let mtime_ns = meta
                        .modified()
                        .ok()
                        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_nanos() as i64)
                        .unwrap_or(0);
                    tx.execute(
                        "INSERT INTO archive_health_cache(mail_id,rel_path,size,mtime_ns,hash,status,error,checked_at)
                         VALUES(?1,?2,?3,?4,?5,'healthy','',?6)
                         ON CONFLICT(mail_id) DO UPDATE SET rel_path=excluded.rel_path,size=excluded.size,mtime_ns=excluded.mtime_ns,hash=excluded.hash,status='healthy',error='',checked_at=excluded.checked_at",
                        params![
                            mail.id,
                            rel_path,
                            meta.len() as i64,
                            mtime_ns,
                            mail.hash,
                            chrono::Utc::now().to_rfc3339()
                        ],
                    )
                    .map_err(err)?;
                }
            }
            tx.execute(
                "UPDATE eml_import_items SET status=?3,error=?4,warnings=?5,mail_id=?6,path='',fingerprint='' WHERE job_id=?1 AND ordinal=?2",
                params![
                    id,
                    ordinal,
                    outcome,
                    item_error,
                    mail.parse_warnings.len(),
                    if old_id.is_empty() { mail.id } else { old_id }
                ],
            )
            .map_err(err)?;
            tx.commit().map_err(err)
        })();
        if let Err(error) = result {
            let code = match error.as_str() {
                "staleImport" => return Ok(false),
                "invalidFile"
                | "unreadable"
                | "tooLarge"
                | "fileChanged"
                | "invalidMessage"
                | "budgetExceeded"
                | "unsupportedMessage"
                | "unsupportedMboxVariant"
                | "账号已被删除"
                | "存档目录不可用"
                | "可用空间不足"
                | "archiveWriteFailed" => error.as_str(),
                _ => "数据库写入失败",
            };
            let mut db = self.db()?;
            let tx = db
                .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
                .map_err(err)?;
            let live: bool = tx
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM eml_import_jobs WHERE id=?1 AND status='running' AND revision=?2)",
                    params![id, revision],
                    |r| r.get(0),
                )
                .map_err(err)?;
            if live {
                if [
                    "账号已被删除",
                    "存档目录不可用",
                    "可用空间不足",
                    "数据库写入失败",
                ]
                .contains(&code)
                {
                    finish_in(&tx, id, "interrupted", code)?;
                } else {
                    tx.execute(
                        "UPDATE eml_import_items SET status='failed',error=?3,path='',fingerprint='' WHERE job_id=?1 AND ordinal=?2",
                        params![id, ordinal, code],
                    )
                    .map_err(err)?;
                }
            }
            tx.commit().map_err(err)?;
        }
        Ok(true)
    }
}

pub fn start(store: Store, app: tauri::AppHandle) {
    std::thread::spawn(move || loop {
        let id = store.db().and_then(|db| {
            db.query_row(
                "SELECT id FROM eml_import_jobs WHERE status IN ('queued','running') ORDER BY created_at LIMIT 1",
                [],
                |r| r.get::<_, String>(0),
            )
            .optional()
            .map_err(err)
        });
        if let Ok(Some(id)) = id {
            let tick = Instant::now();
            loop {
                if !store.process_eml_import(&id).unwrap_or(false)
                    || tick.elapsed().as_millis() >= 500
                {
                    break;
                }
            }
            // 导入期间每 500ms 广播一次 mail-updated 会让主窗持续全量重查列表，
            // 单封事务又占着写锁，菜单点击因此明显卡顿；只在任务结束时刷新一次，
            // 进度由导入面板自己轮询 eml_import_job。
            let running = store
                .db()
                .and_then(|db| {
                    db.query_row(
                        "SELECT EXISTS(SELECT 1 FROM eml_import_jobs WHERE id=?1 AND status='running')",
                        [&id],
                        |r| r.get::<_, bool>(0),
                    )
                    .map_err(err)
                })
                .unwrap_or(false);
            if !running {
                // 会话图在导入期间反复失效；结束前预热一次，第一次点列表不再卡。
                let _ = store.warm_listing();
                let _ = app.emit("mail-updated", ());
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(500));
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tests::{account, query, raw};
    use std::fs;

    fn fixture() -> (tempfile::TempDir, Store, Account, String) {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path().join("store")).unwrap();
        let a = account();
        store.save_account(&a).unwrap();
        let path = dir.path().join("邮件.EML");
        fs::write(&path, raw()).unwrap();
        (dir, store, a, path.to_string_lossy().into_owned())
    }

    fn run(store: &Store, paths: &[String], a: &Account, target: &str) -> ImportJob {
        let job = store.prepare_eml_import(paths, &a.id, target).unwrap();
        store.eml_import_action(&job.id, "start").unwrap();
        for _ in 0..1002 {
            if !store.process_eml_import(&job.id).unwrap() {
                break;
            }
        }
        store.eml_import_job(&job.id, true).unwrap()
    }

    fn with_message_id(id: &str, raw: &[u8]) -> Vec<u8> {
        let mut message = format!("Message-ID: <{id}>\r\n").into_bytes();
        message.extend_from_slice(raw);
        message
    }

    #[test]
    fn import_dedupes_message_id_without_merging_same_subject() {
        let (dir, store, a, _path) = fixture();
        let first_path = dir.path().join("first.eml");
        let same_id_path = dir.path().join("same-id.eml");
        fs::write(&first_path, with_message_id("same@example.test", &raw())).unwrap();
        fs::write(
            &same_id_path,
            with_message_id("same@example.test", &crate::tests::raw2()),
        )
        .unwrap();
        assert_eq!(
            run(
                &store,
                &[first_path.to_string_lossy().into_owned()],
                &a,
                "本地导入"
            )
            .added,
            1
        );
        let duplicate = run(
            &store,
            &[same_id_path.to_string_lossy().into_owned()],
            &a,
            "本地导入",
        );
        assert_eq!((duplicate.added, duplicate.duplicate), (0, 1));

        // Same subject but different Message-ID must remain two messages.
        let one = dir.path().join("one.eml");
        let two = dir.path().join("two.eml");
        fs::write(&one, with_message_id("one@example.test", &raw())).unwrap();
        fs::write(&two, with_message_id("two@example.test", &raw())).unwrap();
        let same_subject = run(
            &store,
            &[
                one.to_string_lossy().into_owned(),
                two.to_string_lossy().into_owned(),
            ],
            &a,
            "本地导入",
        );
        assert_eq!(same_subject.added, 2);
    }

    #[test]
    fn import_job_imports_and_deduplicates_a_file() {
        let (_dir, store, a, path) = fixture();
        let first = run(&store, &[path.clone()], &a, "本地导入");
        assert_eq!((first.added, first.duplicate, first.processed), (1, 0, 1));
        let mail = store.snapshot(&query()).unwrap().messages.remove(0);
        assert_eq!(mail.local_folder, "本地导入");
        assert!(mail.saved_locally);
        let second = run(&store, &[path], &a, "本地导入");
        assert_eq!((second.added, second.duplicate), (0, 1));
    }

    #[test]
    fn import_job_rejects_more_than_the_batch_limit() {
        let (_dir, store, a, path) = fixture();
        let paths = vec![path; 1001];
        assert!(store
            .prepare_eml_import(&paths, &a.id, "本地导入")
            .unwrap_err()
            .contains("1000"));
    }

    #[test]
    fn import_job_splits_mbox_into_messages() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path().join("store")).unwrap();
        let a = account();
        store.save_account(&a).unwrap();
        let mbox = format!(
            "From a@example.test Mon Oct 27 10:00:00 2026\n{}From b@example.test Mon Oct 27 10:00:00 2026\n{}",
            String::from_utf8(raw()).unwrap(),
            String::from_utf8(crate::tests::raw2()).unwrap()
        );
        let path = dir.path().join("mail.mbox");
        fs::write(&path, mbox).unwrap();
        let job = run(&store, &[path.to_string_lossy().into_owned()], &a, "Mbox");
        assert_eq!((job.total, job.added), (2, 2));
    }

    #[test]
    fn import_tree_preserves_relative_folders() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path().join("store")).unwrap();
        let a = account();
        store.save_account(&a).unwrap();
        let root = dir.path().join("Foxmail2026");
        fs::create_dir_all(root.join("收件箱")).unwrap();
        fs::create_dir_all(root.join("项目/客户")).unwrap();
        fs::write(root.join("收件箱/one.eml"), raw()).unwrap();
        fs::write(root.join("项目/客户/two.eml"), crate::tests::raw2()).unwrap();
        let job = store
            .prepare_eml_import_tree(&root.to_string_lossy(), &a.id, "Foxmail2026")
            .unwrap();
        assert_eq!(job.total, 2);
        store.eml_import_action(&job.id, "start").unwrap();
        for _ in 0..10 {
            if !store.process_eml_import(&job.id).unwrap() {
                break;
            }
        }
        let folders: Vec<_> = store
            .snapshot(&query())
            .unwrap()
            .messages
            .into_iter()
            .map(|mail| mail.local_folder)
            .collect();
        assert!(folders.contains(&"Foxmail2026/收件箱".to_string()));
        assert!(folders.contains(&"Foxmail2026/项目/客户".to_string()));
    }

    #[test]
    fn archive_group_imports_into_a_virtual_segment() {
        let (_dir, store, _a, path) = fixture();
        let group = store.create_archive_group("Foxmail2026").unwrap();
        store.create_archive_folder(&group.id, "收件箱").unwrap();
        store.create_archive_folder(&group.id, "空文件夹").unwrap();
        let job = store
            .prepare_eml_import(&[path], &group.id, "收件箱")
            .unwrap();
        store.eml_import_action(&job.id, "start").unwrap();
        for _ in 0..10 {
            if !store.process_eml_import(&job.id).unwrap() {
                break;
            }
        }
        let tree = store.local_archive_tree().unwrap();
        let row = tree.iter().find(|g| g.account_id == group.id).unwrap();
        assert_eq!(row.name, "Foxmail2026");
        assert!(row.folders.iter().any(|f| f.name == "收件箱"));
        assert!(row.folders.iter().any(|f| f.name == "空文件夹"));
    }

    #[test]
    fn import_can_write_originals_to_the_external_archive_root() {
        let (_dir, store, a, path) = fixture();
        let external = tempfile::tempdir().unwrap();
        let mut prefs = store.preferences().unwrap();
        prefs.external_archive_dir = Some(external.path().to_string_lossy().into_owned());
        prefs.import_location = "external".into();
        store.save_preferences(&prefs).unwrap();
        let job = store.prepare_eml_import(&[path], &a.id, "收件箱").unwrap();
        store.eml_import_action(&job.id, "start").unwrap();
        for _ in 0..10 {
            if !store.process_eml_import(&job.id).unwrap() {
                break;
            }
        }
        let mail = store
            .snapshot(&crate::tests::query())
            .unwrap()
            .messages
            .remove(0);
        let rel = mail.rel_path.unwrap();
        assert!(external.path().join(&rel).is_file());
        assert!(!store.root.join(&rel).exists());
    }

    #[test]
    fn archive_group_rename_and_delete_remove_its_local_mail() {
        let (_dir, store, _a, path) = fixture();
        let group = store.create_archive_group("旧组").unwrap();
        store.create_archive_folder(&group.id, "收件箱").unwrap();
        let job = store
            .prepare_eml_import(&[path], &group.id, "收件箱")
            .unwrap();
        store.eml_import_action(&job.id, "start").unwrap();
        for _ in 0..10 {
            if !store.process_eml_import(&job.id).unwrap() {
                break;
            }
        }
        store.rename_archive_group(&group.id, "新组").unwrap();
        let tree = store.local_archive_tree().unwrap();
        assert!(tree.iter().any(|g| g.name == "新组"));
        assert_eq!(store.delete_archive_group(&group.id).unwrap(), 1);
        assert!(!store
            .local_archive_tree()
            .unwrap()
            .iter()
            .any(|g| g.account_id == group.id));
        assert!(!store
            .snapshot(&crate::tests::query())
            .unwrap()
            .messages
            .iter()
            .any(|m| m.account_id == group.id));
    }

    #[test]
    fn archive_group_folder_rename_and_delete_are_group_scoped() {
        let (_dir, store, _a, path) = fixture();
        let group = store.create_archive_group("项目组").unwrap();
        store.create_archive_folder(&group.id, "收件箱").unwrap();
        let job = store
            .prepare_eml_import(&[path], &group.id, "收件箱")
            .unwrap();
        store.eml_import_action(&job.id, "start").unwrap();
        for _ in 0..10 {
            if !store.process_eml_import(&job.id).unwrap() {
                break;
            }
        }
        assert_eq!(
            store
                .rename_archive_folder(&group.id, "收件箱", "归档")
                .unwrap(),
            1
        );
        let tree = store.local_archive_tree().unwrap();
        let row = tree.iter().find(|g| g.account_id == group.id).unwrap();
        assert!(row.folders.iter().any(|f| f.name == "归档"));
        assert!(!row.folders.iter().any(|f| f.name == "收件箱"));
        assert_eq!(
            store.snapshot(&crate::tests::query()).unwrap().messages[0].local_folder,
            "归档"
        );
        assert_eq!(
            store
                .delete_archive_group_folder(&group.id, "归档")
                .unwrap(),
            1
        );
        let tree = store.local_archive_tree().unwrap();
        let row = tree.iter().find(|g| g.account_id == group.id).unwrap();
        assert!(row.folders.is_empty());
        assert!(store
            .snapshot(&crate::tests::query())
            .unwrap()
            .messages
            .is_empty());
    }

    #[test]
    fn import_writes_health_cache_for_quick_checks() {
        let (_dir, store, _a, path) = fixture();
        let job = store
            .prepare_eml_import(&[path], "test-account", "收件箱")
            .unwrap();
        store.eml_import_action(&job.id, "start").unwrap();
        for _ in 0..10 {
            if !store.process_eml_import(&job.id).unwrap() {
                break;
            }
        }
        let count: i64 = store
            .db()
            .unwrap()
            .query_row("SELECT COUNT(*) FROM archive_health_cache", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn import_job_cancel_does_not_publish_later_items() {
        let (_dir, store, a, path) = fixture();
        let job = store
            .prepare_eml_import(&[path.clone(), path], &a.id, "本地导入")
            .unwrap();
        store.eml_import_action(&job.id, "start").unwrap();
        assert!(store.process_eml_import(&job.id).unwrap());
        store.eml_import_action(&job.id, "cancel").unwrap();
        let cancelled = store.eml_import_job(&job.id, true).unwrap();
        assert_eq!(cancelled.status, "cancelled");
        assert_eq!(store.eml_import_jobs().unwrap().len(), 1);
    }
}
