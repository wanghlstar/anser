use crate::{archive, models::*, rules};
use rusqlite::{params, Connection, OptionalExtension};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, RwLock,
    },
};
#[derive(Clone)]
pub struct Store {
    pub root: PathBuf,
    /// 存档读取根顺序：内部根优先，其后是外置存档根（冷库）
    pub archive_roots: std::sync::Arc<std::sync::RwLock<Vec<PathBuf>>>,
    pub(crate) archive_gate: Arc<RwLock<()>>,
    pub(crate) conversation_cache: Arc<Mutex<Option<(i64, Arc<crate::conversation::Index>)>>>,
    pub(crate) tray_unread_cache: Arc<Mutex<Option<(i64, u64)>>>,
    pub(crate) archive_tree_cache: Arc<
        Mutex<Option<(i64, std::time::Instant, Vec<LocalArchiveGroup>)>>,
    >,
    pub(crate) page_cache: Arc<Mutex<Vec<(String, std::time::Instant, crate::paging::Page)>>>,
    /// 设置页打开时立刻要的存档统计：外置文件逐个 stat 较慢，缓存 30 秒。
    pub(crate) tier_pending_cache: Arc<Mutex<Option<(std::time::Instant, (u64, u64, bool))>>>,
    pub(crate) tier_log_cache: Arc<Mutex<Option<(std::time::Instant, TierLog)>>>,
    /// 分层归档只允许一个实例在跑（启动定时与「立即归档」可能撞车）。
    pub(crate) tier_busy: Arc<AtomicBool>,
}
struct TierGuard<'a>(&'a AtomicBool);
impl Drop for TierGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}
impl Store {
    pub fn new(root: PathBuf) -> Result<Self> {
        fs::create_dir_all(&root).map_err(err)?;
        let s = Self {
            root,
            archive_roots: Arc::new(RwLock::new(Vec::new())),
            archive_gate: Arc::new(RwLock::new(())),
            conversation_cache: Arc::new(Mutex::new(None)),
            tray_unread_cache: Arc::new(Mutex::new(None)),
            archive_tree_cache: Arc::new(Mutex::new(None)),
            page_cache: Arc::new(Mutex::new(Vec::new())),
            tier_pending_cache: Arc::new(Mutex::new(None)),
            tier_log_cache: Arc::new(Mutex::new(None)),
            tier_busy: Arc::new(AtomicBool::new(false)),
        };
        let db = s.db()?;
        db.execute_batch("PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY,data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY,account_id TEXT NOT NULL,hash TEXT NOT NULL,data TEXT NOT NULL,UNIQUE(account_id,hash)); CREATE TABLE IF NOT EXISTS sources(account_id TEXT,folder TEXT,remote_id TEXT,mail_id TEXT,active INTEGER NOT NULL DEFAULT 1,PRIMARY KEY(account_id,folder,remote_id)); CREATE TABLE IF NOT EXISTS rules(id TEXT PRIMARY KEY,position INTEGER,data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS logs(id INTEGER PRIMARY KEY,time TEXT,message TEXT); CREATE TABLE IF NOT EXISTS drafts(id TEXT PRIMARY KEY,data TEXT); CREATE TABLE IF NOT EXISTS outbox(id TEXT PRIMARY KEY,status TEXT,data TEXT,raw BLOB); CREATE INDEX IF NOT EXISTS messages_account ON messages(account_id); CREATE INDEX IF NOT EXISTS messages_message_id ON messages(account_id,json_extract(data,'$.messageId'));").map_err(err)?;
        crate::eml_imports::initialize(&db)?;
        crate::archive_groups::initialize(&db)?;
        let has_active: bool = db
            .prepare("PRAGMA table_info(sources)")
            .map_err(err)?
            .query_map([], |r| r.get::<_, String>(1))
            .map_err(err)?
            .any(|r| r.as_deref() == Ok("active"));
        if !has_active {
            db.execute(
                "ALTER TABLE sources ADD COLUMN active INTEGER NOT NULL DEFAULT 1",
                [],
            )
            .map_err(err)?;
        }
        let has_parser_version = db
            .prepare("PRAGMA table_info(messages)")
            .map_err(err)?
            .query_map([], |r| r.get::<_, String>(1))
            .map_err(err)?
            .any(|r| r.as_deref() == Ok("parser_version"));
        if !has_parser_version {
            db.execute(
                "ALTER TABLE messages ADD COLUMN parser_version INTEGER NOT NULL DEFAULT 0",
                [],
            )
            .map_err(err)?;
        }
        db.execute_batch("CREATE TABLE IF NOT EXISTS folder_mappings(account_id TEXT PRIMARY KEY,data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS remote_folders(account_id TEXT NOT NULL,name TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(account_id,name)); CREATE TABLE IF NOT EXISTS contacts(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL COLLATE NOCASE UNIQUE); CREATE TABLE IF NOT EXISTS contact_blacklist(email TEXT PRIMARY KEY COLLATE NOCASE,created_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS archive_health_slot(id INTEGER PRIMARY KEY CHECK(id=1),slot TEXT NOT NULL DEFAULT '');
        CREATE TABLE IF NOT EXISTS archive_health_cache(mail_id TEXT PRIMARY KEY,rel_path TEXT NOT NULL,size INTEGER NOT NULL,mtime_ns INTEGER NOT NULL,hash TEXT NOT NULL,status TEXT NOT NULL,error TEXT NOT NULL DEFAULT '',checked_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS preferences(key TEXT PRIMARY KEY,data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS tier_log(id INTEGER PRIMARY KEY AUTOINCREMENT,mail_id TEXT NOT NULL,subject TEXT NOT NULL DEFAULT '',sender TEXT NOT NULL DEFAULT '',date TEXT NOT NULL DEFAULT '',archived_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS calendar_events(id TEXT PRIMARY KEY,title TEXT NOT NULL,start TEXT NOT NULL,end TEXT NOT NULL,all_day INTEGER NOT NULL DEFAULT 0,location TEXT NOT NULL DEFAULT '',notes TEXT NOT NULL DEFAULT '',color TEXT NOT NULL DEFAULT 'blue',reminder_minutes INTEGER,repeat TEXT NOT NULL DEFAULT 'none',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,source_mail_id TEXT NOT NULL DEFAULT '',meeting_url TEXT NOT NULL DEFAULT '',meeting_code TEXT NOT NULL DEFAULT '',meeting_provider TEXT NOT NULL DEFAULT ''); CREATE INDEX IF NOT EXISTS calendar_events_range ON calendar_events(start,end); CREATE TABLE IF NOT EXISTS calendar_reminder_log(event_id TEXT NOT NULL,occurrence_start TEXT NOT NULL,fired_at TEXT NOT NULL,PRIMARY KEY(event_id,occurrence_start)); CREATE TABLE IF NOT EXISTS calendar_exceptions(event_id TEXT NOT NULL,occurrence_start TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT '',PRIMARY KEY(event_id,occurrence_start)); CREATE TABLE IF NOT EXISTS calendar_subscriptions(id TEXT PRIMARY KEY,name TEXT NOT NULL,url TEXT NOT NULL,color TEXT NOT NULL DEFAULT 'blue',enabled INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL DEFAULT '',updated_at TEXT NOT NULL DEFAULT '',last_synced_at TEXT NOT NULL DEFAULT '',last_error TEXT NOT NULL DEFAULT ''); CREATE TABLE IF NOT EXISTS calendar_subscription_events(subscription_id TEXT NOT NULL,id TEXT NOT NULL,title TEXT NOT NULL,start TEXT NOT NULL,end TEXT NOT NULL,all_day INTEGER NOT NULL DEFAULT 0,location TEXT NOT NULL DEFAULT '',notes TEXT NOT NULL DEFAULT '',color TEXT NOT NULL DEFAULT 'blue',reminder_minutes INTEGER,repeat TEXT NOT NULL DEFAULT 'none',created_at TEXT NOT NULL DEFAULT '',updated_at TEXT NOT NULL DEFAULT '',PRIMARY KEY(subscription_id,id)); CREATE INDEX IF NOT EXISTS calendar_subscription_events_range ON calendar_subscription_events(start,end);")
            .map_err(err)?;
        for (column, definition) in [
            ("error", "TEXT NOT NULL DEFAULT ''"),
            ("updated_at", "TEXT NOT NULL DEFAULT ''"),
            ("scheduled_at", "TEXT NOT NULL DEFAULT ''"),
            ("raw_hash", "TEXT NOT NULL DEFAULT ''"),
        ] {
            let exists = db
                .prepare("PRAGMA table_info(outbox)")
                .map_err(err)?
                .query_map([], |r| r.get::<_, String>(1))
                .map_err(err)?
                .any(|r| r.as_deref() == Ok(column));
            if !exists {
                db.execute(
                    &format!("ALTER TABLE outbox ADD COLUMN {column} {definition}"),
                    [],
                )
                .map_err(err)?;
            }
        }
        db.execute("UPDATE outbox SET status='uncertain',error='应用在发送完成前退出，请先检查服务端已发送邮件' WHERE status='sending'", []).map_err(err)?;
        for (column, definition) in [
            ("source_mail_id", "TEXT NOT NULL DEFAULT ''"),
            ("meeting_url", "TEXT NOT NULL DEFAULT ''"),
            ("meeting_code", "TEXT NOT NULL DEFAULT ''"),
            ("meeting_provider", "TEXT NOT NULL DEFAULT ''"),
        ] {
            let exists = db
                .prepare("PRAGMA table_info(calendar_events)")
                .map_err(err)?
                .query_map([], |r| r.get::<_, String>(1))
                .map_err(err)?
                .any(|r| r.as_deref() == Ok(column));
            if !exists {
                db.execute(
                    &format!("ALTER TABLE calendar_events ADD COLUMN {column} {definition}"),
                    [],
                )
                .map_err(err)?;
            }
        }
        db.execute(
            "CREATE INDEX IF NOT EXISTS calendar_events_source_mail ON calendar_events(source_mail_id)",
            [],
        )
        .map_err(err)?;

        // Maintain a small listing projection atomically with every archive write,
        // including rule application, restore and parser migrations. Bodies remain
        // in messages and the original MIME archive; list refreshes never load them.
        db.execute_batch("BEGIN IMMEDIATE;
            CREATE INDEX IF NOT EXISTS sources_mail_active ON sources(mail_id, active, folder COLLATE NOCASE, account_id);
            CREATE TABLE IF NOT EXISTS message_listing(id TEXT PRIMARY KEY, account_id TEXT NOT NULL, data TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS listing_account ON message_listing(account_id);
            CREATE TABLE IF NOT EXISTS conversation_revision(id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL);
            INSERT OR IGNORE INTO conversation_revision VALUES(1,0);
            CREATE TABLE IF NOT EXISTS maintenance_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS messages_parser_version ON messages(parser_version);
            CREATE TRIGGER IF NOT EXISTS listing_insert AFTER INSERT ON messages BEGIN
                INSERT INTO message_listing VALUES(NEW.id,NEW.account_id,json_set(NEW.data,'$.body',''));
                UPDATE conversation_revision SET version=version+1;
            END;
            CREATE TRIGGER IF NOT EXISTS listing_update AFTER UPDATE OF data ON messages BEGIN
                UPDATE message_listing SET account_id=NEW.account_id,data=json_set(NEW.data,'$.body','') WHERE id=NEW.id;
                UPDATE conversation_revision SET version=version+1;
            END;
            CREATE TRIGGER IF NOT EXISTS listing_delete AFTER DELETE ON messages BEGIN
                DELETE FROM message_listing WHERE id=OLD.id;
                UPDATE conversation_revision SET version=version+1;
            END;
            COMMIT;").map_err(err)?;
        // 投影已由插入触发器维护；只有缺失时才全量回填，避免每次启动扫 6 万行 messages。
        let missing: i64 = db
            .query_row(
                "SELECT (SELECT COUNT(*) FROM messages)-(SELECT COUNT(*) FROM message_listing)",
                [],
                |r| r.get(0),
            )
            .unwrap_or(0);
        if missing != 0 {
            db.execute(
                "INSERT OR IGNORE INTO message_listing SELECT id,account_id,json_set(data,'$.body','') FROM messages",
                [],
            )
            .map_err(err)?;
        }
        db.execute_batch("CREATE TABLE IF NOT EXISTS archive_migrations(mail_id TEXT PRIMARY KEY,old_rel TEXT NOT NULL,new_rel TEXT NOT NULL,error TEXT NOT NULL DEFAULT '',updated_at TEXT NOT NULL DEFAULT '');").map_err(err)?;
        crate::operations::initialize(&db)?;
        crate::folder_health::initialize(&db)?;
        crate::counters::initialize(&db)?;
        crate::directory_operations::initialize(&db)?;
        crate::sent_uploads::initialize(&db)?;
        crate::rule_operations::initialize(&db)?;
        crate::rule_runs::initialize(&db)?;
        crate::retention::initialize(&db)?;
        crate::archive_jobs::initialize(&db)?;
        crate::search::initialize(&db)?;
        // 归档组文件夹按 (账号, 目录) 过滤；把过滤列和排序时间放进一个索引，
        // 3.9 万封的计数/翻页就不用回表冷读正文页。首次升级建索引约一次。
        let _ = db.execute(
            "CREATE INDEX IF NOT EXISTS search_folder_view
             ON search_documents(account_id,local_folder,saved_locally,trashed,instant)",
            [],
        );
        crate::paging::initialize(&db)?;
        crate::compose_files::initialize(&db)?;
        crate::notification_open::initialize(&db)?;
        s.migrate_folder_roles()?;
        s.recover_archive_deletion()?;
        s.refresh_archive_roots()?; // 必须先于元数据刷新：读取存档依赖根列表
        if let Err(error) = s.migrate_archive_layout() {
            s.log(&format!("存档布局迁移待处理：{error}"))?;
        }
        Ok(s)
    }
    fn maintenance_done(&self, key: &str) -> bool {
        let Ok(db) = self.db() else { return true };
        db.query_row(
            "SELECT EXISTS(SELECT 1 FROM maintenance_meta WHERE key=?1)",
            [key],
            |r| r.get::<_, bool>(0),
        )
        .unwrap_or(true)
    }
    fn mark_maintenance(&self, key: &str) {
        if let Ok(db) = self.db() {
            let _ = db.execute(
                "INSERT OR REPLACE INTO maintenance_meta(key,value) VALUES(?1,'1')",
                [key],
            );
        }
    }
    /// 启动后的后台维护。历史存档只做一次性的补齐/迁移，完成后打标记，
    /// 不再每次启动全量扫描；日常操作只走查询和事件触发。
    pub(crate) fn startup_maintenance(&self) {
        // 解析器升级后的元数据补齐：parser_version 有索引，正常情况下 0 行。
        if let Err(error) = self.refresh_archive_metadata() {
            let _ = self.log(&format!("存档元数据补齐待处理：{error}"));
        }
        if !self.maintenance_done("attachment_names_v1") {
            if self.refresh_attachment_names().is_ok() {
                self.mark_maintenance("attachment_names_v1");
            }
        }
        if let Err(error) = self.normalize_source_rows() {
            let _ = self.log(&format!("来源归位待处理：{error}"));
        }
        // 路径修复会移动/改写历史存档，只在版本升级后执行一次，之后不再碰。
        if !self.maintenance_done("archive_paths_v1") {
            if self.repair_archive_paths().is_ok() {
                self.mark_maintenance("archive_paths_v1");
            }
        }
        if let Err(error) = self.cleanup_old_compose_files() {
            let _ = self.log(&format!("写信附件清理待处理：{error}"));
        }
    }
    /// 按当前偏好重算存档读取根：内部根优先，其后是外置存档根。
    pub fn refresh_archive_roots(&self) -> Result<()> {
        let mut roots = vec![self.root.clone()];
        if let Some(ext) = self
            .preferences()?
            .external_archive_dir
            .filter(|p| !p.trim().is_empty())
        {
            let ext = PathBuf::from(ext.trim());
            if ext != self.root {
                roots.push(ext);
            }
        }
        *self.archive_roots.write().map_err(|e| e.to_string())? = roots;
        Ok(())
    }
    /// Root for newly imported originals. External is opt-in and must be
    /// reachable; otherwise fail instead of silently writing somewhere else.
    pub fn import_root(&self) -> Result<PathBuf> {
        let prefs = self.preferences()?;
        if prefs.import_location == "external" {
            let ext = prefs
                .external_archive_dir
                .filter(|p| !p.trim().is_empty())
                .map(|p| PathBuf::from(p.trim()));
            let Some(ext) = ext else {
                return Err("尚未设置外置存档位置，无法导入到外置".into());
            };
            if !ext.is_dir() {
                return Err("外置存档目录不可用，无法导入".into());
            }
            return Ok(ext);
        }
        Ok(self.root.clone())
    }
    /// 按根顺序读取存档（内部优先、外置兜底）
    pub fn read_archive(&self, rel_path: Option<&str>, hash: &str) -> Result<Vec<u8>> {
        let roots = self
            .archive_roots
            .read()
            .map_err(|e| e.to_string())?
            .clone();
        archive::read_raw(&roots, rel_path, hash)
    }
    // Write transactions use IMMEDIATE so the busy timeout applies before any
    // snapshot is read. DEFERRED read-to-write upgrades can fail with BUSY_SNAPSHOT.
    /// 分层年龄判定：以邮件日期为准，日期缺失或不可解析时回退本地存档时间。
    fn older_than_cutoff(
        date: &str,
        saved_at: &str,
        cutoff: &chrono::DateTime<chrono::Utc>,
    ) -> bool {
        let ts = chrono::DateTime::parse_from_rfc3339(date)
            .or_else(|_| chrono::DateTime::parse_from_rfc3339(saved_at))
            .ok();
        match ts {
            Some(t) => t.with_timezone(&chrono::Utc) < *cutoff,
            None => false, // 时间不可靠的不搬迁
        }
    }
    /// 预览：当前有多少封/多少字节待搬迁，以及外置根是否可达。
    pub fn tier_pending(&self) -> Result<(u64, u64, bool)> {
        let prefs = self.preferences()?;
        let ext = match prefs.external_archive_dir.filter(|p| !p.trim().is_empty()) {
            Some(e) => PathBuf::from(e.trim()),
            None => return Ok((0, 0, false)),
        };
        let reachable = ext.is_dir();
        let days = prefs.archive_retention_days;
        if days == 0 || !reachable {
            return Ok((0, 0, reachable));
        }
        if let Some((cached_at, value)) = *self.tier_pending_cache.lock().map_err(|e| e.to_string())?
        {
            if cached_at.elapsed() < std::time::Duration::from_secs(30) {
                return Ok(value);
            }
        }
        let cutoff = chrono::Utc::now() - chrono::Duration::days(days as i64);
        let db = self.db()?;
        let mut stmt = db
            .prepare(
                "SELECT COALESCE(json_extract(data,'$.relPath'),''), json_extract(data,'$.date'),
                        json_extract(data,'$.savedAt')
                 FROM message_listing WHERE COALESCE(json_extract(data,'$.savedLocally'),1)=1",
            )
            .map_err(err)?;
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                ))
            })
            .map_err(err)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(err)?;
        let mut count = 0u64;
        let mut bytes = 0u64;
        for (rel, date, saved_at) in rows {
            if rel.is_empty() || !self.root.join(&rel).exists() {
                continue; // 已搬迁或在线邮件
            }
            if Self::older_than_cutoff(&date, &saved_at, &cutoff) {
                count += 1;
                bytes += std::fs::metadata(self.root.join(&rel))
                    .map(|m| m.len())
                    .unwrap_or(0);
            }
        }
        let value = (count, bytes, reachable);
        *self.tier_pending_cache.lock().map_err(|e| e.to_string())? =
            Some((std::time::Instant::now(), value));
        Ok(value)
    }

    pub fn invalidate_tier_caches(&self) {
        if let Ok(mut cache) = self.tier_pending_cache.lock() {
            *cache = None;
        }
        if let Ok(mut cache) = self.tier_log_cache.lock() {
            *cache = None;
        }
    }
    /// 规范存档目录名：把旧版 encoded 文件夹名（&bfFuL2XlaMA-）重命名为解码后的
    /// 真实名称（深港日检），逐文件搬迁并更新 relPath。幂等，可重复执行。
    pub fn normalize_archive_paths(&self) -> Result<u64> {
        let _archive = self.archive_gate.write().map_err(|e| e.to_string())?;
        let db = self.db()?;
        let mut stmt = db
            .prepare(
                "SELECT id, json_extract(data,'$.hash'), account_id, json_extract(data,'$.accountEmail'),
                        json_extract(data,'$.sourceFolder'), COALESCE(json_extract(data,'$.relPath'),'')
                 FROM message_listing WHERE COALESCE(json_extract(data,'$.savedLocally'),1)=1",
            )
            .map_err(err)?;
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, String>(4)?,
                    r.get::<_, String>(5)?,
                ))
            })
            .map_err(err)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(err)?;
        let mut moved = 0u64;
        let roots = self
            .archive_roots
            .read()
            .map_err(|e| e.to_string())?
            .clone();
        for (id, hash, account, email, folder, old_rel) in rows {
            if old_rel.is_empty() {
                continue;
            }
            let new_rel = match archive::rel_path_for(&account, &email, &folder, &hash) {
                Some(r) => r,
                None => continue,
            };
            if new_rel == old_rel {
                continue;
            }
            // 找到现存文件所在根，搬到新相对路径
            let mut done = false;
            for root in &roots {
                let from = root.join(&old_rel);
                if !from.exists() {
                    continue;
                }
                let to = root.join(&new_rel);
                if to.exists() {
                    let _ = std::fs::remove_file(&from); // 目标已存在同内容
                } else if let Some(parent) = to.parent() {
                    if std::fs::create_dir_all(parent).is_err() {
                        continue;
                    }
                    if std::fs::rename(&from, &to).is_err() {
                        continue;
                    }
                }
                done = true;
                break;
            }
            if done {
                let mut mail: Mail = serde_json::from_str(
                    &db.query_row("SELECT data FROM messages WHERE id=?1", [&id], |r| {
                        r.get::<_, String>(0)
                    })
                    .map_err(err)?,
                )
                .map_err(err)?;
                mail.rel_path = Some(new_rel);
                db.execute(
                    "UPDATE messages SET data=?2 WHERE id=?1",
                    params![id, serde_json::to_string(&mail).map_err(err)?],
                )
                .map_err(err)?;
                moved += 1;
            }
        }
        Ok(moved)
    }
    /// 彻底删除本地记录与存档文件（服务器删除确认后调用）。
    /// 先删数据库行、后删文件：任何一步失败都不会留下"有记录无文件"的坏状态。
    pub fn purge_mail(&self, id: &str) -> Result<()> {
        let mail = self.mail(id)?;
        let rel = mail
            .rel_path
            .clone()
            .unwrap_or_else(|| format!("archive/{}.eml", mail.hash));
        {
            let mut db = self.db()?;
            let tx = db
                .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
                .map_err(err)?;
            tx.execute("DELETE FROM sources WHERE mail_id=?1", [id])
                .map_err(err)?;
            crate::rule_runs::cancel_mail_in(&tx, id)?;
            // server_operations 无 mail_id 列，mailId 存在 data JSON 里
            tx.execute(
                "DELETE FROM server_operations WHERE json_extract(data,'$.mailId')=?1",
                [id],
            )
            .map_err(err)?;
            tx.execute("DELETE FROM messages WHERE id=?1", [id])
                .map_err(err)?;
            tx.commit().map_err(err)?;
        }
        let roots = self
            .archive_roots
            .read()
            .map_err(|e| e.to_string())?
            .clone();
        for root in &roots {
            let p = root.join(&rel);
            if p.exists() {
                let _ = std::fs::remove_file(p);
            }
        }
        Ok(())
    }
    /// 取回：把外置根的存档文件搬回内部根（外置盘不在时跳过）。
    pub fn tier_recall(&self) -> Result<u64> {
        let prefs = self.preferences()?;
        let ext = match prefs.external_archive_dir.filter(|p| !p.trim().is_empty()) {
            Some(e) => PathBuf::from(e.trim()),
            None => return Ok(0),
        };
        if ext == self.root || !ext.is_dir() {
            return Ok(0);
        }
        let _archive = self.archive_gate.write().map_err(|e| e.to_string())?;
        let db = self.db()?;
        let mut stmt = db
            .prepare(
                "SELECT json_extract(data,'$.hash'), COALESCE(json_extract(data,'$.relPath'),'')
                 FROM message_listing WHERE COALESCE(json_extract(data,'$.savedLocally'),1)=1",
            )
            .map_err(err)?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .map_err(err)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(err)?;
        let mut recalled = 0u64;
        for (hash, rel) in rows {
            if rel.is_empty() {
                continue;
            }
            let from = ext.join(&rel);
            let to = self.root.join(&rel);
            if !from.exists() || to.exists() {
                continue;
            }
            if let Some(parent) = to.parent() {
                if std::fs::create_dir_all(parent).is_err() {
                    continue;
                }
            }
            match std::fs::copy(&from, &to) {
                Ok(_) => {
                    let ok = std::fs::read(&to)
                        .map(|b| archive::digest(&b) == hash)
                        .unwrap_or(false);
                    if ok {
                        let _ = std::fs::remove_file(&from);
                        recalled += 1;
                    } else {
                        let _ = std::fs::remove_file(&to);
                    }
                }
                Err(_) => continue,
            }
        }
        Ok(recalled)
    }
    /// 分层归档：把超过保留天数的存档文件从内部根搬迁到外置存档根。
    /// 跨设备用"复制+校验+删除"（rename 跨文件系统会失败）；外置根未配置时跳过。
    pub fn tier_archives(&self) -> Result<TierReport> {
        let prefs = self.preferences()?;
        let mut report = TierReport::default();
        let ext = match prefs.external_archive_dir.filter(|p| !p.trim().is_empty()) {
            Some(e) => PathBuf::from(e.trim()),
            None => {
                report.skipped = true;
                return Ok(report);
            }
        };
        if ext == self.root {
            report.skipped = true;
            return Ok(report);
        }
        let days = prefs.archive_retention_days;
        if days == 0 {
            report.skipped = true; // 永久保留本地
            return Ok(report);
        }
        let cutoff = chrono::Utc::now() - chrono::Duration::days(days as i64);
        if self.tier_busy.swap(true, Ordering::SeqCst) {
            report.skipped = true;
            return Ok(report);
        }
        let _tier_guard = TierGuard(&self.tier_busy);
        let db = self.db()?;
        let mut stmt = db
            .prepare(
                "SELECT id, json_extract(data,'$.hash'), COALESCE(json_extract(data,'$.relPath'),''),
                        json_extract(data,'$.date'), json_extract(data,'$.savedAt'),
                        COALESCE(json_extract(data,'$.subject'),''),
                        COALESCE(json_extract(data,'$.sender'),'')
                 FROM message_listing WHERE COALESCE(json_extract(data,'$.savedLocally'),1)=1",
            )
            .map_err(err)?;
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, String>(4)?,
                    r.get::<_, String>(5)?,
                    r.get::<_, String>(6)?,
                ))
            })
            .map_err(err)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(err)?;
        let mut writes = 0u32;
        for (id, hash, rel, date, saved_at, subject, sender) in rows {
            if rel.is_empty() {
                continue;
            }
            if !Self::older_than_cutoff(&date, &saved_at, &cutoff) {
                report.pending += 1;
                continue;
            }
            let from = self.root.join(&rel);
            if !from.exists() {
                continue; // 已在外置根或在线邮件
            }
            let to = ext.join(&rel);
            if to.exists() {
                // 外置已有同内容文件：校验后只在校验通过的瞬间拿写锁删本地，
                // 不在整个扫描/复制期间占着 archive_gate（否则打开邮件会等）。
                match std::fs::read(&to) {
                    Ok(bytes) if archive::digest(&bytes) == hash => {
                        {
                            let _gate = self.archive_gate.write().map_err(|e| e.to_string())?;
                            let _ = std::fs::remove_file(&from);
                        }
                        report.moved += 1;
                        Self::log_tier_move(&db, &id, &subject, &sender, &date);
                    }
                    _ => report.errors.push(format!(
                        "{}：外置目标校验失败，保留本地",
                        &id[..8.min(id.len())]
                    )),
                }
                continue;
            }
            if let Some(parent) = to.parent() {
                if let Err(e) = std::fs::create_dir_all(parent) {
                    report
                        .errors
                        .push(format!("{}：{e}", &id[..8.min(id.len())]));
                    continue;
                }
            }
            // 先复制到同目录临时文件（不占 archive_gate），校验通过后再拿写锁
            // 原子改名并删本地。外置盘慢时也只锁住一次 rename。
            let tmp = to.with_file_name(format!(
                ".{}.tier-{}.tmp",
                to.file_name().and_then(|n| n.to_str()).unwrap_or("mail"),
                std::process::id()
            ));
            match std::fs::copy(&from, &tmp) {
                Ok(_) => {
                    let ok = std::fs::read(&tmp)
                        .map(|b| archive::digest(&b) == hash)
                        .unwrap_or(false);
                    if ok {
                        let renamed = {
                            let _gate = self.archive_gate.write().map_err(|e| e.to_string())?;
                            let renamed = std::fs::rename(&tmp, &to).is_ok();
                            if renamed {
                                let _ = std::fs::remove_file(&from);
                            }
                            renamed
                        };
                        if renamed {
                            report.moved += 1;
                            report.moved_bytes +=
                                std::fs::metadata(&to).map(|m| m.len()).unwrap_or(0);
                            Self::log_tier_move(&db, &id, &subject, &sender, &date);
                            writes += 1;
                            if writes % 10 == 0 {
                                // 外置盘慢：每搬 10 封让出 100ms，避免长时间占满 I/O。
                                std::thread::sleep(std::time::Duration::from_millis(100));
                            }
                        } else {
                            let _ = std::fs::remove_file(&tmp);
                            report
                                .errors
                                .push(format!("{}：外置改名失败", &id[..8.min(id.len())]));
                        }
                    } else {
                        let _ = std::fs::remove_file(&tmp);
                        report
                            .errors
                            .push(format!("{}：复制校验失败", &id[..8.min(id.len())]));
                    }
                }
                Err(e) => {
                    let _ = std::fs::remove_file(&tmp);
                    report
                        .errors
                        .push(format!("{}：{e}", &id[..8.min(id.len())]));
                }
            }
        }
        if prefs.archive_index_enabled {
            report.index_written = self.write_portable_index(&ext).is_ok();
        }
        Ok(report)
    }
    /// 记录一封邮件成功搬迁到外置根（归档日志）。
    fn log_tier_move(db: &Connection, mail_id: &str, subject: &str, sender: &str, date: &str) {
        let _ = db.execute(
            "INSERT INTO tier_log(mail_id,subject,sender,date,archived_at) VALUES(?1,?2,?3,?4,?5)",
            params![
                mail_id,
                subject,
                sender,
                date,
                chrono::Utc::now().to_rfc3339()
            ],
        );
    }
    /// 归档日志：外置盘存档总数 + 最近 50 条归档记录（新的在前）。
    /// 首次查看时按外置盘现存文件回填一次，覆盖本功能上线前已归档的邮件。
    pub fn tier_log(&self) -> Result<TierLog> {
        let cached = self
            .tier_log_cache
            .lock()
            .map_err(|e| e.to_string())?
            .clone();
        if let Some((cached_at, value)) = cached {
            if cached_at.elapsed() < std::time::Duration::from_secs(30) {
                return Ok(value);
            }
        }
        let prefs = self.preferences()?;
        let ext = prefs
            .external_archive_dir
            .filter(|p| !p.trim().is_empty())
            .map(|p| PathBuf::from(p.trim()))
            .filter(|p| p.is_dir());
        let db = self.db()?;
        let logged: i64 = db
            .query_row("SELECT COUNT(*) FROM tier_log", [], |r| r.get(0))
            .map_err(err)?;
        if logged == 0 {
            if let Some(ext) = ext.as_ref() {
                let mut stmt = db
                    .prepare(
                        "SELECT id, COALESCE(json_extract(data,'$.relPath'),''),
                                json_extract(data,'$.date'),
                                COALESCE(json_extract(data,'$.subject'),''),
                                COALESCE(json_extract(data,'$.sender'),'')
                         FROM message_listing WHERE COALESCE(json_extract(data,'$.savedLocally'),1)=1",
                    )
                    .map_err(err)?;
                let rows = stmt
                    .query_map([], |r| {
                        Ok((
                            r.get::<_, String>(0)?,
                            r.get::<_, String>(1)?,
                            r.get::<_, String>(2)?,
                            r.get::<_, String>(3)?,
                            r.get::<_, String>(4)?,
                        ))
                    })
                    .map_err(err)?
                    .collect::<std::result::Result<Vec<_>, _>>()
                    .map_err(err)?;
                for (id, rel, date, subject, sender) in rows {
                    if rel.is_empty() {
                        continue;
                    }
                    let archived_at = std::fs::metadata(ext.join(&rel))
                        .and_then(|m| m.modified())
                        .ok()
                        .map(|t| chrono::DateTime::<chrono::Utc>::from(t).to_rfc3339())
                        .unwrap_or_else(|| chrono::Utc::now().to_rfc3339());
                    let _ = db.execute(
                        "INSERT INTO tier_log(mail_id,subject,sender,date,archived_at) VALUES(?1,?2,?3,?4,?5)",
                        params![id, subject, sender, date, archived_at],
                    );
                }
            }
        }
        let (total, total_bytes) = match ext.as_ref() {
            Some(ext) => {
                let mut stmt = db
                    .prepare(
                        "SELECT COALESCE(json_extract(data,'$.relPath'),'')
                         FROM message_listing WHERE COALESCE(json_extract(data,'$.savedLocally'),1)=1",
                    )
                    .map_err(err)?;
                let rels = stmt
                    .query_map([], |r| r.get::<_, String>(0))
                    .map_err(err)?
                    .collect::<std::result::Result<Vec<_>, _>>()
                    .map_err(err)?;
                let mut count = 0u64;
                let mut bytes = 0u64;
                for rel in rels {
                    if rel.is_empty() {
                        continue;
                    }
                    if let Ok(meta) = std::fs::metadata(ext.join(&rel)) {
                        count += 1;
                        bytes += meta.len();
                    }
                }
                (Some(count), Some(bytes))
            }
            None => (None, None),
        };
        let mut stmt = db
            .prepare(
                "SELECT subject,sender,date,archived_at FROM tier_log
                 ORDER BY archived_at DESC, id DESC LIMIT 50",
            )
            .map_err(err)?;
        let entries = stmt
            .query_map([], |r| {
                Ok(TierLogEntry {
                    subject: r.get(0)?,
                    sender: r.get(1)?,
                    date: r.get(2)?,
                    archived_at: r.get(3)?,
                })
            })
            .map_err(err)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(err)?;
        let value = TierLog {
            total,
            total_bytes,
            entries,
        };
        *self.tier_log_cache.lock().map_err(|e| e.to_string())? =
            Some((std::time::Instant::now(), value.clone()));
        Ok(value)
    }
    /// 在外置存档根生成随盘索引 index.html：按账号/文件夹分组，
    /// 列出日期/发件人/主题并链接到对应 .eml（任何机器浏览器可读）。
    pub fn write_portable_index(&self, ext: &Path) -> Result<usize> {
        let db = self.db()?;
        let mut stmt = db
            .prepare(
                "SELECT m.account_id,
                        COALESCE(json_extract(a.data,'$.name'), json_extract(m.data,'$.accountEmail')),
                        json_extract(m.data,'$.accountEmail'),
                        json_extract(m.data,'$.relPath'), json_extract(m.data,'$.date'),
                        json_extract(m.data,'$.sender'), json_extract(m.data,'$.subject')
                 FROM message_listing m LEFT JOIN accounts a ON a.id=m.account_id
                 WHERE COALESCE(json_extract(m.data,'$.savedLocally'),1)=1",
            )
            .map_err(err)?;
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, String>(4)?,
                    r.get::<_, String>(5)?,
                    r.get::<_, String>(6)?,
                ))
            })
            .map_err(err)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(err)?;
        // 只收录物理上在外置根里的文件，保证链接可点；按账号 id 分组，
        // 同地址的不同分段不会混在一起，标题优先显示账号名称。
        let mut groups: BTreeMap<
            String,
            (
                String,
                BTreeMap<String, Vec<(String, String, String, String)>>,
            ),
        > = BTreeMap::new();
        let mut total = 0usize;
        for (account_id, name, email, rel, date, sender, subject) in rows {
            if rel.is_empty() || !ext.join(&rel).exists() {
                continue;
            }
            let folder = std::path::Path::new(&rel)
                .parent()
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or_default();
            let label = if name.trim().is_empty() {
                email
            } else {
                format!("{name} · {email}")
            };
            groups
                .entry(account_id)
                .or_insert_with(|| (label, BTreeMap::new()))
                .1
                .entry(folder)
                .or_default()
                .push((date, sender, subject, rel));
            total += 1;
        }
        // 每个文件夹内按邮件日期倒序，最新的在最上面；无法解析日期的排最后。
        for (_, (_, folders)) in groups.iter_mut() {
            for mails in folders.values_mut() {
                mails.sort_by(|a, b| {
                    let at = chrono::DateTime::parse_from_rfc3339(&a.0)
                        .map(|d| d.timestamp())
                        .unwrap_or(i64::MIN);
                    let bt = chrono::DateTime::parse_from_rfc3339(&b.0)
                        .map(|d| d.timestamp())
                        .unwrap_or(i64::MIN);
                    bt.cmp(&at).then_with(|| b.0.cmp(&a.0))
                });
            }
        }
        let escape = |s: &str| {
            s.replace('&', "&amp;")
                .replace('<', "&lt;")
                .replace('>', "&gt;")
                .replace('"', "&quot;")
        };
        let link = |rel: &str| {
            rel.split('/')
                .map(|part| {
                    part.bytes().fold(String::new(), |mut acc, b| {
                        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~') {
                            acc.push(b as char);
                        } else {
                            acc.push_str(&format!("%{b:02X}"));
                        }
                        acc
                    })
                })
                .collect::<Vec<_>>()
                .join("/")
        };
        let mut html = String::from(
            "<!DOCTYPE html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\">             <title>雁信存档索引</title><style>             body{font-family:-apple-system,\"PingFang SC\",sans-serif;margin:24px;color:#1d1d1f}             h1{font-size:20px}h2{margin:20px 0 4px}h3{margin:12px 0 2px;color:#555;font-size:14px}             table{border-collapse:collapse;width:100%;margin-bottom:18px}             td{padding:5px 8px;border-bottom:1px solid #eee;font-size:13px}             a{color:#06c;text-decoration:none}td.d{color:#666;white-space:nowrap}             </style></head><body><h1>雁信存档索引</h1><p>点击邮件将下载并用邮件客户端打开。</p>",
        );
        for (_, (account, folders)) in &groups {
            html.push_str(&format!("<h2>{}</h2>", escape(account)));
            for (folder, mails) in folders {
                html.push_str(&format!("<h3>{}</h3><table>", escape(folder)));
                for (date, sender, subject, rel) in mails {
                    html.push_str(&format!(
                        "<tr><td class=\"d\">{}</td><td>{}</td><td><a href=\"{}\" download>{}</a></td></tr>",
                        escape(&date.chars().take(10).collect::<String>()),
                        escape(sender),
                        link(rel),
                        escape(subject),
                    ));
                }
                html.push_str("</table>");
            }
        }
        html.push_str("</body></html>");
        std::fs::write(ext.join("index.html"), html).map_err(err)?;
        Ok(total)
    }
    /// MOVE 完成后把本地存档文件搬到新服务器文件夹名下，并更新 relPath。
    /// 在数据库提交之后调用：文件失败只记录日志——relPath 不变，读取始终指向
    /// 真实文件，磁盘布局滞后但不会读坏；成功则磁盘/界面/服务器三方一致。
    pub(crate) fn relocate_archive_after_move(&self, target_folder: &str, mail_id: &str) {
        let _archive = match self.archive_gate.write() {
            Ok(g) => g,
            Err(_) => return,
        };
        self.relocate_archive_after_move_unlocked(target_folder, mail_id);
    }
    /// 调用方已持有 `archive_gate` 读锁时使用（规则执行/入库期间），避免读写锁自锁。
    pub(crate) fn relocate_archive_after_move_unlocked(&self, target_folder: &str, mail_id: &str) {
        let db = match self.db() {
            Ok(d) => d,
            Err(_) => return,
        };
        let data: String =
            match db.query_row("SELECT data FROM messages WHERE id=?1", [mail_id], |r| {
                r.get(0)
            }) {
                Ok(d) => d,
                Err(_) => return,
            };
        let mut mail: Mail = match serde_json::from_str(&data) {
            Ok(m) => m,
            Err(_) => return,
        };
        let new_rel = match archive::rel_path_for(
            &mail.account_id,
            &mail.account_email,
            target_folder,
            &mail.hash,
        ) {
            Some(r) => r,
            None => return, // 账号/文件夹信息不足，保持原路径
        };
        let old_rel = mail
            .rel_path
            .clone()
            .unwrap_or_else(|| format!("archive/{}.eml", mail.hash));
        if old_rel == new_rel {
            return;
        }
        let roots = match self.archive_roots.read() {
            Ok(r) => r.clone(),
            Err(_) => return,
        };
        let mut moved = false;
        for root in roots {
            let from = root.join(&old_rel);
            if !from.exists() {
                continue;
            }
            let to = root.join(&new_rel);
            if to.exists() {
                // 目标已有同内容文件（另一文件夹存过）：校验后移除源文件
                match std::fs::read(&to) {
                    Ok(bytes) if archive::digest(&bytes) == mail.hash => {
                        let _ = std::fs::remove_file(&from);
                        moved = true;
                    }
                    _ => return, // 目标不是同内容：保持原状
                }
            } else {
                let result = (|| -> std::result::Result<(), String> {
                    if let Some(parent) = to.parent() {
                        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                    }
                    std::fs::rename(&from, &to).map_err(|e| e.to_string())
                })();
                if let Err(e) = result {
                    let _ = self.log(&format!(
                        "存档文件移动到「{target_folder}」失败（{}）：{e}",
                        &mail.hash.get(..8).unwrap_or("")
                    ));
                    return;
                }
                moved = true;
            }
            break;
        }
        if !moved {
            return; // 没有本地文件（在线阅读邮件）
        }
        mail.rel_path = Some(new_rel);
        if let Err(e) = self.update_mail(&mail) {
            let _ = self.log(&format!("存档路径更新失败：{e}"));
        }
    }
    /// 服务器来源已删除时，按规则把本地存档归位到目标目录。
    ///
    /// 规则移动过的邮件在服务器上被清理后，旧的收件箱来源行会让它在
    /// `folderTotals`/列表的本地存档兜底里重新计入收件箱。这里把存档文件
    /// 搬到规则目标目录，并只保留目标来源行，保证同一封邮件只归属一个目录。
    /// 返回是否实际发生了变更。
    fn rehome_local_mail(&self, destination: &str, mail_id: &str) -> Result<bool> {
        if destination.is_empty() {
            return Ok(false);
        }
        let db = self.db()?;
        // 只在整封邮件已无任何活跃服务器来源时归位；否则删除来源行会丢掉
        // 仍然有效的服务器映射。
        let has_active: bool = db
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sources WHERE mail_id=?1 AND active=1)",
                [mail_id],
                |r| r.get(0),
            )
            .map_err(err)?;
        if has_active {
            return Ok(false);
        }
        // 目标目录必须已有来源行，避免为服务器上从未存在的目录凭空建索引。
        let has_target: bool = db
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sources WHERE mail_id=?1 AND folder=?2 COLLATE NOCASE)",
                params![mail_id, destination],
                |r| r.get(0),
            )
            .map_err(err)?;
        // 本地导入的邮件只有 inactive 的 local: 来源，没有服务器目标来源。
        // 规则分发时允许把这条本地来源改到目标文件夹，仍然不产生服务器操作。
        let local_source: bool = db
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sources WHERE mail_id=?1 AND active=0 AND remote_id LIKE 'local:%')",
                [mail_id],
                |r| r.get(0),
            )
            .map_err(err)?;
        if !has_target && !local_source {
            return Ok(false);
        }
        let before = self.mail(mail_id)?.rel_path;
        self.relocate_archive_after_move(destination, mail_id);
        let after = self.mail(mail_id)?;
        let expected = archive::rel_path_for(
            &after.account_id,
            &after.account_email,
            destination,
            &after.hash,
        );
        if after.rel_path != expected {
            return Ok(false); // 本地没有可搬迁的存档，保持原状
        }
        let removed = if has_target {
            db.execute(
                "DELETE FROM sources WHERE mail_id=?1 AND folder<>?2 COLLATE NOCASE",
                params![mail_id, destination],
            )
            .map_err(err)?
        } else {
            db.execute(
                "UPDATE sources SET folder=?2 WHERE mail_id=?1 AND active=0 AND remote_id LIKE 'local:%'",
                params![mail_id, destination],
            )
            .map_err(err)?
        };
        let changed = removed > 0 || before != after.rel_path;
        if changed {
            self.log(&format!(
                "本地规则归档 · {} → {}",
                after.subject, destination
            ))?;
        }
        Ok(changed)
    }
    /// 补存完成后把文件整理到唯一归属目录，避免服务器已移动的邮件在
    /// 本地仍按旧目录计数。
    pub(crate) fn normalize_mail_location(&self, mail_id: &str) -> Result<bool> {
        let db = self.db()?;
        let mut stmt = db
            .prepare(
                "SELECT s.folder FROM trusted_sources s JOIN messages m ON m.id=s.mail_id
                 WHERE s.mail_id=?1
                   AND (s.active=1 OR (COALESCE(json_extract(m.data,'$.savedLocally'),1)=1
                     AND NOT EXISTS(SELECT 1 FROM trusted_sources x
                                    WHERE x.mail_id=s.mail_id AND x.active=1)))
                   AND COALESCE(json_extract(m.data,'$.trashed'),0)=0
                 GROUP BY s.folder",
            )
            .map_err(err)?;
        let counted = stmt
            .query_map([mail_id], |r| r.get::<_, String>(0))
            .map_err(err)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(err)?;
        if counted.len() != 1 {
            return Ok(false);
        }
        let mail = self.mail(mail_id)?;
        let Some(target) = archive::rel_path_for(
            &mail.account_id,
            &mail.account_email,
            &counted[0],
            &mail.hash,
        ) else {
            return Ok(false);
        };
        if mail.rel_path.as_deref() == Some(target.as_str()) {
            return Ok(false);
        }
        let current = mail
            .rel_path
            .clone()
            .unwrap_or_else(|| format!("archive/{}.eml", mail.hash));
        let roots = self
            .archive_roots
            .read()
            .map_err(|e| e.to_string())?
            .clone();
        if !roots.iter().any(|root| root.join(&current).exists()) {
            return Ok(false);
        }
        self.relocate_archive_after_move(&counted[0], mail_id);
        Ok(self.mail(mail_id)?.rel_path.as_deref() == Some(target.as_str()))
    }
    /// 修复规则移动后遗留的归档路径，并把唯一归属目录的邮件整理到该目录：
    /// 文件已经搬走但 relPath 仍指向旧目录时修复；服务器仍有活跃来源、但文件
    /// 留在旧目录时也搬回统计归属的目录，保证磁盘布局与数量一致。
    /// 只采用能通过 SHA-256 校验、且属于该邮件来源目录的现存文件。
    fn repair_archive_paths(&self) -> Result<u64> {
        let db = self.db()?;
        let roots = self
            .archive_roots
            .read()
            .map_err(|e| e.to_string())?
            .clone();
        let rows = db
            .prepare(
                "SELECT id, data FROM messages
                 WHERE COALESCE(json_extract(data,'$.savedLocally'),1)=1",
            )
            .map_err(err)?
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .map_err(err)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(err)?;
        let mut source_folders = db
            .prepare("SELECT DISTINCT folder FROM sources WHERE mail_id=?1")
            .map_err(err)?;
        let mut counted_folders = db
            .prepare(
                "SELECT s.folder FROM trusted_sources s JOIN messages m ON m.id=s.mail_id
                 WHERE s.mail_id=?1
                   AND (s.active=1 OR (COALESCE(json_extract(m.data,'$.savedLocally'),1)=1
                     AND NOT EXISTS(SELECT 1 FROM trusted_sources x
                                    WHERE x.mail_id=s.mail_id AND x.active=1)))
                   AND COALESCE(json_extract(m.data,'$.trashed'),0)=0
                 GROUP BY s.folder",
            )
            .map_err(err)?;
        let mut fixed = 0u64;
        for (id, data) in rows {
            let mut mail: Mail = serde_json::from_str(&data).map_err(err)?;
            let current = mail
                .rel_path
                .clone()
                .unwrap_or_else(|| format!("archive/{}.eml", mail.hash));
            let current_exists = roots.iter().any(|root| root.join(&current).exists());
            // 唯一统计归属目录：把文件整理过去，磁盘布局与数量保持一致。
            let counted = counted_folders
                .query_map([&id], |r| r.get::<_, String>(0))
                .map_err(err)?
                .collect::<std::result::Result<Vec<_>, _>>()
                .map_err(err)?;
            if counted.len() == 1 {
                if let Some(target) = archive::rel_path_for(
                    &mail.account_id,
                    &mail.account_email,
                    &counted[0],
                    &mail.hash,
                ) {
                    if target != current && current_exists {
                        self.relocate_archive_after_move(&counted[0], &id);
                        let moved = self
                            .mail(&id)
                            .ok()
                            .and_then(|updated| updated.rel_path)
                            .is_some_and(|rel| rel == target);
                        if moved {
                            fixed += 1;
                        }
                        continue;
                    }
                }
            }
            if current_exists {
                continue;
            }
            let mut folders = source_folders
                .query_map([&id], |r| r.get::<_, String>(0))
                .map_err(err)?
                .collect::<std::result::Result<Vec<_>, _>>()
                .map_err(err)?;
            if !mail.source_folder.is_empty() {
                folders.push(mail.source_folder.clone());
            }
            folders.sort();
            folders.dedup_by(|a, b| a.eq_ignore_ascii_case(b));
            for folder in folders {
                let Some(candidate) = archive::rel_path_for(
                    &mail.account_id,
                    &mail.account_email,
                    &folder,
                    &mail.hash,
                ) else {
                    continue;
                };
                if candidate == current {
                    continue;
                }
                let Some(root) = roots.iter().find(|root| root.join(&candidate).exists()) else {
                    continue;
                };
                let Ok(bytes) = std::fs::read(root.join(&candidate)) else {
                    continue;
                };
                if archive::digest(&bytes) != mail.hash {
                    continue;
                }
                mail.rel_path = Some(candidate);
                self.update_mail(&mail)?;
                fixed += 1;
                break;
            }
        }
        if fixed > 0 {
            self.log(&format!("存档路径已修复/整理 {fixed} 封"))?;
        }
        Ok(fixed)
    }
    /// 已确认的 MOVE 只保留目标来源：删除目标目录之外的失效旧来源行，
    /// 并在目标目录内只保留一条（优先活跃行）。复制/标签产生的活跃来源
    /// 不动，避免把真正的多目录副本删掉。
    fn normalize_source_row(&self, mail_id: &str) -> Result<bool> {
        let db = self.db()?;
        let target: Option<String> = db
            .query_row(
                "SELECT target FROM directory_operations
                 WHERE json_extract(data,'$.mailId')=?1
                   AND kind='move' AND status='completed'
                 ORDER BY updated_at DESC, rowid DESC LIMIT 1",
                [mail_id],
                |r| r.get(0),
            )
            .optional()
            .map_err(err)?;
        let Some(target) = target else {
            return Ok(false);
        };
        let has_target: bool = db
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sources WHERE mail_id=?1 AND folder=?2 COLLATE NOCASE)",
                params![mail_id, target],
                |r| r.get(0),
            )
            .map_err(err)?;
        if !has_target {
            return Ok(false);
        }
        let mut changed = db
            .execute(
                "DELETE FROM sources WHERE mail_id=?1 AND active=0 AND folder<>?2 COLLATE NOCASE",
                params![mail_id, target],
            )
            .map_err(err)?
            > 0;
        let kept: Option<String> = db
            .query_row(
                "SELECT remote_id FROM sources WHERE mail_id=?1 AND folder=?2 COLLATE NOCASE
                 ORDER BY active DESC, rowid DESC LIMIT 1",
                params![mail_id, target],
                |r| r.get(0),
            )
            .optional()
            .map_err(err)?;
        if let Some(remote) = kept {
            changed |= db
                .execute(
                    "DELETE FROM sources WHERE mail_id=?1 AND folder=?2 COLLATE NOCASE
                     AND remote_id<>?3",
                    params![mail_id, target, remote],
                )
                .map_err(err)?
                > 0;
        }
        if changed {
            let _ = self.normalize_mail_location(mail_id);
        }
        Ok(changed)
    }
    fn refresh_attachment_names(&self) -> Result<()> {
        let mut db = self.db()?;
        let rows = db
            .prepare(
                "SELECT data FROM messages WHERE json_extract(data,'$.hasAttachments')=1 AND json_type(data,'$.attachmentNames') IS NULL",
            )
            .map_err(err)?
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(err)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(err)?;
        for data in rows {
            let mut mail: Mail = serde_json::from_str(&data).map_err(err)?;
            if !mail.saved_locally {
                continue;
            }
            let Ok(raw) = self.read_archive(mail.rel_path.as_deref(), &mail.hash) else {
                continue;
            };
            let Ok(names) = archive::attachment_names(&raw) else {
                continue;
            };
            mail.attachment_names = names;
            db.execute(
                "UPDATE messages SET data=?2 WHERE id=?1",
                params![mail.id, serde_json::to_string(&mail).map_err(err)?],
            )
            .map_err(err)?;
        }
        Ok(())
    }
    fn completed_move_mail_ids(&self) -> Result<std::collections::HashSet<String>> {
        let db = self.db()?;
        let mut q = db
            .prepare(
                "SELECT DISTINCT json_extract(data,'$.mailId') FROM directory_operations
                 WHERE kind='move' AND status='completed'
                   AND json_extract(data,'$.mailId')<>''",
            )
            .map_err(err)?;
        let rows = q
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(err)?;
        rows.collect::<std::result::Result<std::collections::HashSet<_>, _>>()
            .map_err(err)
    }
    fn normalize_source_rows(&self) -> Result<u64> {
        let moved = self.completed_move_mail_ids()?;
        if moved.is_empty() {
            return Ok(0);
        }
        let db = self.db()?;
        let ids = db
            .prepare("SELECT mail_id FROM sources GROUP BY mail_id HAVING COUNT(*) > 1")
            .map_err(err)?
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(err)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(err)?;
        let mut normalized = 0u64;
        for id in ids.into_iter().filter(|id| moved.contains(id)) {
            if self.normalize_source_row(&id)? {
                normalized += 1;
            }
        }
        if normalized > 0 {
            self.log(&format!("来源归位 {normalized} 封"))?;
        }
        Ok(normalized)
    }
    fn normalize_folder_sources(&self, account: &str, folder: &str) -> Result<u64> {
        let moved = self.completed_move_mail_ids()?;
        if moved.is_empty() {
            return Ok(0);
        }
        let db = self.db()?;
        let ids = db
            .prepare(
                "SELECT DISTINCT mail_id FROM sources
                 WHERE account_id=?1 AND folder=?2",
            )
            .map_err(err)?
            .query_map(params![account, folder], |r| r.get::<_, String>(0))
            .map_err(err)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(err)?;
        let mut normalized = 0u64;
        for id in ids.into_iter().filter(|id| moved.contains(id)) {
            if self.normalize_source_row(&id)? {
                normalized += 1;
            }
        }
        if normalized > 0 {
            self.log(&format!("来源归位 {normalized} 封"))?;
        }
        Ok(normalized)
    }
    /// 本地存档树：按账号与来源文件夹聚合已完整存档的邮件数。
    /// 分组口径与列表过滤一致：以 sources 行为准，只算活跃来源行，外加整封
    /// 邮件已无任何活跃来源的存档邮件（服务器上已删除，仅存本地存档）按原
    /// 来源行归组；被规则挪走的邮件只计目标文件夹，不收回收件箱。
    pub(crate) fn invalidate_archive_tree_cache(&self) {
        if let Ok(mut cache) = self.archive_tree_cache.lock() {
            *cache = None;
        }
    }
    pub fn local_archive_tree(&self) -> Result<Vec<LocalArchiveGroup>> {
        let db = self.db()?;
        let importing = crate::counters::import_running(&db);
        let revision: i64 = db
            .query_row("SELECT version FROM query_revision WHERE id=1", [], |r| {
                r.get(0)
            })
            .map_err(err)?;
        if let Some((cached_revision, cached_at, cached)) = self
            .archive_tree_cache
            .lock()
            .map_err(|e| e.to_string())?
            .as_ref()
        {
            // 侧栏只用于展开文件夹，不再显示数字；导入期间保持旧树，
            // 避免每次逐封 revision 变化都重扫 sources。
            if importing
                || *cached_revision == revision
                || cached_at.elapsed() < std::time::Duration::from_secs(5)
            {
                return Ok(cached.clone());
            }
        }
        let mut stmt = db
            .prepare(
                "WITH sent AS MATERIALIZED (
                     SELECT rf.account_id, rf.name FROM remote_folders rf
                     WHERE EXISTS(SELECT 1 FROM json_each(rf.data,'$.roles') WHERE value='sent')
                 ), active AS MATERIALIZED (
                     SELECT DISTINCT mail_id FROM trusted_sources WHERE active=1
                 )
                 SELECT s.account_id, s.folder,
                        MAX(COALESCE(json_extract(rf.data,'$.displayName'),'')), MAX(s.active)
                 FROM search_documents d
                 JOIN trusted_sources s ON s.mail_id = d.mail_id
                 LEFT JOIN remote_folders rf ON rf.account_id = s.account_id AND rf.name = s.folder
                 LEFT JOIN active a ON a.mail_id = s.mail_id
                 LEFT JOIN sent fx ON fx.account_id = s.account_id AND fx.name = s.folder
                 WHERE d.saved_locally=1 AND d.trashed=0 AND s.folder<>''
                       AND (s.active=1 OR a.mail_id IS NULL)
                       AND NOT (s.active=1 AND (s.folder='Sent' OR fx.name IS NOT NULL))
                 GROUP BY s.account_id, s.folder",
            )
            .map_err(err)?;
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, Option<String>>(2)?.unwrap_or_default(),
                    r.get::<_, Option<i64>>(3)?.unwrap_or(0) == 0,
                ))
            })
            .map_err(err)?;
        let mut groups: BTreeMap<String, LocalArchiveGroup> = BTreeMap::new();
        for row in rows {
            let (account_id, folder, display_name, local_only) = row.map_err(err)?;
            groups
                .entry(account_id.clone())
                .or_insert_with(|| LocalArchiveGroup {
                    account_id,
                    account_email: String::new(),
                    name: String::new(),
                    folders: Vec::new(),
                })
                .folders
                .push(LocalArchiveFolder {
                    name: folder,
                    display_name,
                    local_only,
                });
        }
        let mut out: Vec<_> = groups.into_values().collect();
        let accounts = self.accounts()?;
        let archive_names = self
            .archive_groups()?
            .into_iter()
            .map(|g| (g.id, g.name))
            .collect::<std::collections::HashMap<_, _>>();
        for g in &mut out {
            if let Some(account) = accounts.iter().find(|a| a.id == g.account_id) {
                g.name = account.name.clone();
                g.account_email = account.email.clone();
            }
            if let Some(name) = archive_names.get(&g.account_id) {
                g.name = name.clone();
            }
        }
        for (id, name) in &archive_names {
            if !out.iter().any(|g| &g.account_id == id) {
                out.push(LocalArchiveGroup {
                    account_id: id.clone(),
                    account_email: String::new(),
                    name: name.clone(),
                    folders: Vec::new(),
                });
            }
        }
        let mut empty = db
            .prepare("SELECT group_id,path FROM local_folders ORDER BY path")
            .map_err(err)?;
        let empty_rows = empty
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .map_err(err)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(err)?;
        for (group_id, path) in empty_rows {
            if !out.iter().any(|g| g.account_id == group_id) {
                out.push(LocalArchiveGroup {
                    account_id: group_id.clone(),
                    account_email: String::new(),
                    name: archive_names
                        .get(&group_id)
                        .cloned()
                        .unwrap_or_default(),
                    folders: Vec::new(),
                });
            }
            if let Some(group) = out.iter_mut().find(|g| g.account_id == group_id) {
                if !group.folders.iter().any(|f| f.name == path) {
                    group.folders.push(LocalArchiveFolder {
                        name: path.clone(),
                        display_name: path,
                        local_only: true,
                    });
                }
            }
        }
        for g in &mut out {
            g.folders
                .sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        }
        *self
            .archive_tree_cache
            .lock()
            .map_err(|e| e.to_string())? =
            Some((revision, std::time::Instant::now(), out.clone()));
        Ok(out)
    }
    /// 把当前数据库做一致快照到目标路径（迁移/备份共用）。
    pub fn vacuum_into(&self, destination: &Path) -> Result<()> {
        let _archive = self.archive_gate.read().map_err(err)?;
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent).map_err(err)?;
        }
        let db = self.db()?;
        db.execute("VACUUM INTO ?1", [destination.to_string_lossy().as_ref()])
            .map_err(err)?;
        Ok(())
    }
    pub fn db(&self) -> Result<Connection> {
        let c = Connection::open(self.root.join("mail.sqlite3")).map_err(err)?;
        c.busy_timeout(std::time::Duration::from_secs(10))
            .map_err(err)?;
        // 冷读走 mmap 少一次拷贝；30 MB 页缓存让 6 万行扫描少换页。
        // 每个命令都会新开连接，所以必须逐连接设置。
        c.execute_batch("PRAGMA mmap_size=268435456; PRAGMA cache_size=-30000;")
            .map_err(err)?;
        Ok(c)
    }
    pub fn accounts(&self) -> Result<Vec<Account>> {
        let db = self.db()?;
        let mut q = db
            .prepare("SELECT data FROM accounts ORDER BY rowid DESC")
            .map_err(err)?;
        let rows = q.query_map([], |r| r.get::<_, String>(0)).map_err(err)?;
        rows.map(|r| serde_json::from_str(&r.map_err(err)?).map_err(err))
            .collect()
    }
    pub fn account(&self, id: &str) -> Result<Account> {
        crate::remote::ReceiveLookup::new(self)?.account(id)
    }
    pub fn save_account(&self, a: &Account) -> Result<()> {
        a.validate()?;
        self.db()?.execute("INSERT INTO accounts(id,data) VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET data=excluded.data",params![a.id,serde_json::to_string(a).map_err(err)?]).map_err(err)?;
        Ok(())
    }
    /// 冻结为只读分段：停止收信，取消尚未提交的服务器操作；本地存档维护
    /// （补存、分层、校验、导入）不受影响。
    pub fn freeze_account(&self, id: &str) -> Result<()> {
        let mut a = self.account(id)?;
        a.read_only = true;
        a.enabled = false;
        a.frozen_at = Some(chrono::Utc::now().to_rfc3339());
        self.save_account(&a)?;
        self.cancel_server_work(id, "账号已冻结为只读分段")?;
        self.log(&format!("{} 已冻结为只读分段", a.email))
    }
    /// 恢复为可写分段；不会自动补收，用户需要重新启用并可能重新打开收信。
    pub fn unfreeze_account(&self, id: &str) -> Result<()> {
        let mut a = self.account(id)?;
        a.read_only = false;
        a.frozen_at = None;
        self.save_account(&a)?;
        self.log(&format!("{} 已恢复为可写分段", a.email))
    }
    fn cancel_server_work(&self, id: &str, reason: &str) -> Result<()> {
        let db = self.db()?;
        db.execute(
            "UPDATE server_operations SET status='blocked',revision=revision+1,error=?2
             WHERE account_id=?1 AND status IN ('queued','running')",
            params![id, reason],
        )
        .map_err(err)?;
        db.execute(
            "UPDATE directory_operations SET status='cancelled',error=?2
             WHERE account_id=?1 AND status IN ('queued','blocked')",
            params![id, reason],
        )
        .map_err(err)?;
        Ok(())
    }
    // Local preferences do not require credentials or a server connection test.
    pub fn edit_account_preferences(&self, account: &Account) -> Result<()> {
        account.validate()?;
        let mut db = self.db()?;
        let tx = db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(err)?;
        let data: String = tx
            .query_row(
                "SELECT data FROM accounts WHERE id=?1",
                [&account.id],
                |r| r.get(0),
            )
            .map_err(err)?;
        let mut current: Account = serde_json::from_str(&data).map_err(err)?;
        if !current.same_connection(account) {
            return Err("连接配置已变化，请重新验证并保存".into());
        }
        current.name = account.name.clone();
        current.save_locally = account.save_locally;
        tx.execute(
            "UPDATE accounts SET data=?2 WHERE id=?1",
            params![current.id, serde_json::to_string(&current).map_err(err)?],
        )
        .map_err(err)?;
        tx.commit().map_err(err)
    }
    // A completed sync may have begun before local preferences were edited.
    pub fn save_sync_status(&self, account: &Account) -> Result<()> {
        let mut db = self.db()?;
        let tx = db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(err)?;
        let data: Option<String> = tx
            .query_row(
                "SELECT data FROM accounts WHERE id=?1",
                [&account.id],
                |r| r.get(0),
            )
            .optional()
            .map_err(err)?;
        if let Some(data) = data {
            let mut current: Account = serde_json::from_str(&data).map_err(err)?;
            if current.same_connection(account) {
                // A long sweep may fail after a newer inbox job succeeds. Its
                // old checkpoint must not move the latest success backwards.
                if let Some(incoming) = account
                    .last_sync
                    .as_deref()
                    .and_then(|time| chrono::DateTime::parse_from_rfc3339(time).ok())
                {
                    let prior = current
                        .last_sync
                        .as_deref()
                        .and_then(|time| chrono::DateTime::parse_from_rfc3339(time).ok());
                    if prior.is_none_or(|prior| incoming >= prior) {
                        current.last_sync = account.last_sync.clone();
                    }
                }
                current.error = account.error.clone();
                tx.execute(
                    "UPDATE accounts SET data=?2 WHERE id=?1",
                    params![current.id, serde_json::to_string(&current).map_err(err)?],
                )
                .map_err(err)?;
            }
        }
        tx.commit().map_err(err)
    }
    /// 每账号配置「全部/未读」聚合范围；None 或空列表都表示恢复默认（只算 INBOX）。
    pub fn save_inbox_folders(
        &self,
        account_id: &str,
        folders: Option<Vec<String>>,
    ) -> Result<Account> {
        let mut selected: Vec<String> = Vec::new();
        for folder in folders.unwrap_or_default() {
            let name = folder.trim();
            if name.is_empty() {
                return Err("文件夹名称不能为空".into());
            }
            if !selected.iter().any(|kept| kept == name) {
                selected.push(name.to_string());
            }
        }
        let mut db = self.db()?;
        let tx = db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(err)?;
        let stored: Option<String> = tx
            .query_row("SELECT data FROM accounts WHERE id=?1", [account_id], |r| {
                r.get(0)
            })
            .optional()
            .map_err(err)?;
        if stored.is_none() {
            return Err("账号不存在，收件箱范围未保存".into());
        }
        if selected.is_empty() {
            tx.execute(
                "UPDATE accounts SET data=json_remove(data,'$.inboxFolders') WHERE id=?1",
                [account_id],
            )
            .map_err(err)?;
        } else {
            tx.execute(
                "UPDATE accounts SET data=json_set(data,'$.inboxFolders',json(?2)) WHERE id=?1",
                params![account_id, serde_json::to_string(&selected).map_err(err)?],
            )
            .map_err(err)?;
        }
        let data: String = tx
            .query_row("SELECT data FROM accounts WHERE id=?1", [account_id], |r| {
                r.get(0)
            })
            .map_err(err)?;
        let account: Account = serde_json::from_str(&data).map_err(err)?;
        tx.commit().map_err(err)?;
        Ok(account)
    }
    pub fn edit_account(&self, a: &Account) -> Result<()> {
        let old = self.account(&a.id)?;
        if a.email != old.email {
            return Err("修改邮箱地址请添加新账号，已有存档仍保留原账号来源".into());
        }
        a.validate()?;
        let source_changed = old.protocol != a.protocol
            || old.incoming_host != a.incoming_host
            || old.incoming_port != a.incoming_port
            || old.username != a.username;
        let mut next = a.clone();
        next.enabled = old.enabled;
        // 分段状态只由冻结/恢复入口修改，编辑连接配置不能意外解冻或改变收信起点。
        next.read_only = old.read_only;
        next.frozen_at = old.frozen_at.clone();
        next.sync_since = old.sync_since.clone();
        next.last_sync = if source_changed {
            None
        } else {
            old.last_sync.clone()
        };
        next.error = None;
        let mut db = self.db()?;
        let tx = db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(err)?;
        tx.execute(
            "UPDATE accounts SET data=json_set(?2,'$.serverRetentionDays',json_extract(data,'$.serverRetentionDays')) WHERE id=?1",
            params![a.id, serde_json::to_string(&next).map_err(err)?],
        )
        .map_err(err)?;
        if crate::operations::identity(&old) != crate::operations::identity(a) {
            tx.execute("UPDATE folder_health SET identity=?2,reason='账号配置已修改，旧来源须经完整收取重新核对' WHERE account_id=?1", params![a.id,crate::operations::identity(a)]).map_err(err)?;
            tx.execute("UPDATE server_operations SET status='blocked',revision=revision+1,error='账号连接配置已变化，请重新收取后再操作' WHERE account_id=?1 AND status!='completed'", [&a.id]).map_err(err)?;
        }
        if source_changed {
            let removed = tx
                .execute("DELETE FROM folder_health WHERE account_id=?1", [&a.id])
                .map_err(err)?;
            if removed > 0 {
                tx.execute(
                    "UPDATE conversation_revision SET version=version+1 WHERE id=1",
                    [],
                )
                .map_err(err)?;
            }
            tx.execute("DELETE FROM sources WHERE account_id=?1", [&a.id])
                .map_err(err)?;
            tx.execute("DELETE FROM remote_folders WHERE account_id=?1", [&a.id])
                .map_err(err)?;
            tx.execute("DELETE FROM folder_mappings WHERE account_id=?1", [&a.id])
                .map_err(err)?;
            tx.execute("DELETE FROM folder_retention WHERE account_id=?1", [&a.id])
                .map_err(err)?;
        }
        tx.commit().map_err(err)
    }
    pub fn remove_account(&self, id: &str) -> Result<()> {
        let mut db = self.db()?;
        let tx = db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(err)?;
        tx.execute(
            "DELETE FROM messages WHERE account_id=?1 AND json_extract(data,'$.savedLocally')=0",
            [id],
        )
        .map_err(err)?;
        tx.execute("DELETE FROM folder_health WHERE account_id=?1", [id])
            .map_err(err)?;
        tx.execute("DELETE FROM folder_mappings WHERE account_id=?1", [id])
            .map_err(err)?;
        tx.execute("DELETE FROM remote_folders WHERE account_id=?1", [id])
            .map_err(err)?;
        tx.execute("DELETE FROM folder_retention WHERE account_id=?1", [id])
            .map_err(err)?;
        tx.execute("UPDATE archive_jobs SET status='cancelled',revision=revision+1,error='账号已移除，本地存档保留' WHERE json_extract(data,'$.accountId')=?1 AND status!='completed'",[id]).map_err(err)?;
        crate::rule_runs::cancel_account_in(&tx, id)?;
        tx.execute("UPDATE server_operations SET status='blocked',revision=revision+1,error='账号已移除，本地存档保留' WHERE account_id=?1 AND status!='completed'", [id]).map_err(err)?;
        tx.execute("DELETE FROM accounts WHERE id=?1", [id])
            .map_err(err)?;
        tx.commit().map_err(err)?;
        self.log("已移除账号，所有本地存档均已保留")
    }
    /// 移除账号并清除本地存档：账号行、服务器目录、草稿、发送记录与待执行任务，
    /// 以及该账号在内部根和外置根下的 .eml 存档文件一并删除。先删库、后删文件，
    /// 任何一步失败都不会留下"有记录无文件"的坏状态。
    pub fn purge_account(&self, id: &str) -> Result<()> {
        let _archive = self.archive_gate.write().map_err(|e| e.to_string())?;
        let email: String = self
            .db()?
            .query_row(
                "SELECT json_extract(data,'$.email') FROM accounts WHERE id=?1",
                [id],
                |r| r.get(0),
            )
            .optional()
            .map_err(err)?
            // 账号行已移除时退回邮件里的账号邮箱，仍能定位存档目录
            .or_else(|| {
                self.db()
                    .ok()?
                    .query_row(
                        "SELECT json_extract(data,'$.accountEmail') FROM messages WHERE account_id=?1 LIMIT 1",
                        [id],
                        |r| r.get(0),
                    )
                    .optional()
                    .ok()
                    .flatten()
            })
            .unwrap_or_default();
        let mut db = self.db()?;
        let tx = db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(err)?;
        let rels = tx
            .prepare(
                "SELECT COALESCE(json_extract(data,'$.relPath'),'') FROM messages
                 WHERE account_id=?1 AND COALESCE(json_extract(data,'$.savedLocally'),1)=1",
            )
            .map_err(err)?
            .query_map([id], |r| r.get::<_, String>(0))
            .map_err(err)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(err)?;
        // 同一邮箱可能被多个账号使用，只有最后一个账号清除时才删账号存档目录
        let shares_email: bool = tx
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM accounts WHERE id!=?1 AND json_extract(data,'$.email')=?2)",
                params![id, email],
                |r| r.get(0),
            )
            .map_err(err)?;
        tx.execute(
            "DELETE FROM rule_runs WHERE mail_id IN (SELECT id FROM messages WHERE account_id=?1)",
            [id],
        )
        .map_err(err)?;
        tx.execute(
            "DELETE FROM rule_executions WHERE mail_id IN (SELECT id FROM messages WHERE account_id=?1)",
            [id],
        )
        .map_err(err)?;
        tx.execute(
            "DELETE FROM archive_jobs WHERE mail_id IN (SELECT id FROM messages WHERE account_id=?1)",
            [id],
        )
        .map_err(err)?;
        tx.execute("DELETE FROM messages WHERE account_id=?1", [id])
            .map_err(err)?;
        tx.execute("DELETE FROM sources WHERE account_id=?1", [id])
            .map_err(err)?;
        tx.execute("DELETE FROM folder_health WHERE account_id=?1", [id])
            .map_err(err)?;
        tx.execute("DELETE FROM folder_mappings WHERE account_id=?1", [id])
            .map_err(err)?;
        tx.execute("DELETE FROM remote_folders WHERE account_id=?1", [id])
            .map_err(err)?;
        tx.execute("DELETE FROM folder_retention WHERE account_id=?1", [id])
            .map_err(err)?;
        tx.execute("DELETE FROM server_operations WHERE account_id=?1", [id])
            .map_err(err)?;
        tx.execute("DELETE FROM directory_operations WHERE account_id=?1", [id])
            .map_err(err)?;
        tx.execute("DELETE FROM sent_uploads WHERE account_id=?1", [id])
            .map_err(err)?;
        tx.execute(
            "DELETE FROM drafts WHERE json_extract(data,'$.accountId')=?1",
            [id],
        )
        .map_err(err)?;
        tx.execute(
            "DELETE FROM outbox WHERE json_extract(data,'$.accountId')=?1",
            [id],
        )
        .map_err(err)?;
        tx.execute("DELETE FROM accounts WHERE id=?1", [id])
            .map_err(err)?;
        tx.commit().map_err(err)?;
        let roots = self
            .archive_roots
            .read()
            .map_err(|e| e.to_string())?
            .clone();
        for root in &roots {
            for rel in &rels {
                let p = root.join(rel);
                if p.exists() {
                    let _ = std::fs::remove_file(p);
                }
            }
            let own = root.join("archive").join(archive::account_dir(id, &email));
            if own.is_dir() {
                let _ = std::fs::remove_dir_all(own);
            }
            if !email.is_empty() && !shares_email {
                let dir = root.join("archive").join(archive::readable_dir(&email));
                if dir.is_dir() {
                    let _ = std::fs::remove_dir_all(dir);
                }
            }
        }
        self.log("已移除账号，本地存档已一并清除")
    }
    pub fn rules(&self) -> Result<Vec<Rule>> {
        let db = self.db()?;
        let mut q = db
            .prepare("SELECT data FROM rules ORDER BY position")
            .map_err(err)?;
        let rows = q.query_map([], |r| r.get::<_, String>(0)).map_err(err)?;
        rows.map(|r| serde_json::from_str(&r.map_err(err)?).map_err(err))
            .collect()
    }
    /// 导出规则：按账号筛选（空 = 全部），保持执行顺序。
    /// `include_global` 控制是否带上全局规则（accountId 为空）；
    /// 默认带上，否则导出的规则在别处导入会丢掉通用条件。
    pub fn export_rules(&self, account_ids: &[String], include_global: bool) -> Result<Vec<Rule>> {
        Ok(self
            .rules()?
            .into_iter()
            .filter(|r| {
                if r.account_id.is_empty() {
                    include_global || account_ids.is_empty()
                } else {
                    account_ids.is_empty() || account_ids.contains(&r.account_id)
                }
            })
            .collect())
    }
    /// 删除本地文件夹：把该文件夹下的邮件移回默认桶「全部存档」，
    /// 侧栏的平铺列表是 localFolder 去重值，清空后该文件夹自然消失。
    /// Rename a virtual local folder. Archive paths stay unchanged because the
    /// local folder is a user tag; no server or MIME operation is involved.
    pub fn rename_local_folder(&self, old: &str, new: &str) -> Result<u64> {
        let old = old.trim();
        let new = new.trim();
        if old.is_empty() || old == "全部存档" || new.is_empty() || new == "全部存档" {
            return Err("本地文件夹名称无效".into());
        }
        if new.chars().count() > 120 || new.chars().any(char::is_control) {
            return Err("本地文件夹名称过长或包含控制字符".into());
        }
        if old == new {
            return Ok(0);
        }
        let db = self.db()?;
        let exists: bool = db
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM messages WHERE json_extract(data,'$.localFolder')=?1)",
                [new],
                |row| row.get(0),
            )
            .map_err(err)?;
        if exists {
            return Err("同名本地文件夹已存在".into());
        }
        let changed = db
            .execute(
                "UPDATE messages SET data=json_set(data,'$.localFolder',?2)
                 WHERE json_extract(data,'$.localFolder')=?1",
                rusqlite::params![old, new],
            )
            .map_err(err)?;
        Ok(changed as u64)
    }
    pub fn clear_local_folder(&self, name: &str) -> Result<usize> {
        if name.trim().is_empty() || name == "全部存档" {
            return Ok(0);
        }
        let ids: Vec<String> = {
            let db = self.db()?;
            let mut q = db
                .prepare("SELECT id FROM messages WHERE json_extract(data,'$.localFolder')=?1")
                .map_err(err)?;
            let rows = q
                .query_map([name], |r| r.get::<_, String>(0))
                .map_err(err)?
                .collect::<std::result::Result<Vec<String>, _>>()
                .map_err(err)?;
            rows
        };
        for id in &ids {
            let mut mail = self.mail(id)?;
            mail.local_folder = "全部存档".into();
            self.update_mail(&mail)?;
            self.relocate_archive_after_move(&mail.source_folder, &mail.id);
        }
        Ok(ids.len())
    }
    /// 本机归档重定：把服务器已删（或非 IMAP）邮件的归档目录从当前改为 target。
    /// 只调整 inactive 来源行，不触发任何服务器操作；服务器仍有活跃来源时应改用服务器移动。
    /// 返回本机归档实际发生变化的邮件是否成功（错误信息用于前端提示）。
    pub fn move_local_archive(&self, id: &str, target: &str) -> Result<()> {
        let target = target.trim();
        if target.is_empty() {
            return Err("目标文件夹不能为空".into());
        }
        let mail = self.mail(id)?;
        let mut db = self.db()?;
        let has_active: bool = db
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM trusted_sources WHERE mail_id=?1 AND active=1)",
                [id],
                |r| r.get(0),
            )
            .map_err(err)?;
        if has_active {
            return Err("该邮件在服务器上仍可移动，应使用服务器移动".into());
        }
        let tx = db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(err)?;
        let inactive: u64 = tx
            .query_row(
                "SELECT COUNT(*) FROM sources WHERE mail_id=?1 AND account_id=?2 AND active=0",
                params![mail.id, mail.account_id],
                |r| r.get(0),
            )
            .map_err(err)?;
        if inactive == 0 {
            // 纯本机邮件没有任何来源行：补一条 inactive 归档行，让存档树能按目标目录归组
            tx.execute(
                "INSERT INTO sources(account_id,folder,remote_id,mail_id,active) VALUES(?1,?2,?3,?4,0)",
                params![
                    mail.account_id,
                    target,
                    format!("local:{}", mail.id),
                    mail.id
                ],
            )
            .map_err(err)?;
            tx.commit().map_err(err)?;
            return Ok(());
        }
        let elsewhere: u64 = tx
            .query_row(
                "SELECT COUNT(*) FROM sources WHERE mail_id=?1 AND account_id=?2 AND active=0 AND folder<>?3",
                params![mail.id, mail.account_id, target],
                |r| r.get(0),
            )
            .map_err(err)?;
        if elsewhere == 0 {
            // 归档行已全部在目标目录，无需变更
            tx.commit().map_err(err)?;
            return Ok(());
        }
        // 目标已有该邮件的归档行时先清掉，避免主键 (account_id,folder,remote_id) 冲突
        tx.execute(
            "DELETE FROM sources WHERE mail_id=?1 AND account_id=?2 AND folder=?3",
            params![mail.id, mail.account_id, target],
        )
        .map_err(err)?;
        tx.execute(
            "UPDATE sources SET folder=?3 WHERE mail_id=?1 AND account_id=?2 AND active=0",
            params![mail.id, mail.account_id, target],
        )
        .map_err(err)?;
        tx.commit().map_err(err)?;
        Ok(())
    }
    pub fn save_rules(&self, rs: &[Rule]) -> Result<()> {
        for r in rs {
            rules::validate(r)?;
        }
        let mut db = self.db()?;
        let tx = db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(err)?;
        tx.execute("DELETE FROM rules", []).map_err(err)?;
        for (i, r) in rs.iter().enumerate() {
            tx.execute(
                "INSERT INTO rules VALUES(?1,?2,?3)",
                params![r.id, i, serde_json::to_string(r).map_err(err)?],
            )
            .map_err(err)?;
        }
        let hash = crate::rule_runs::configuration(rs)?;
        let ids = {
            let mut q = tx.prepare("SELECT id FROM rule_runs WHERE status NOT IN ('completed','cancelled') AND json_extract(data,'$.configuration')!=?1").map_err(err)?;
            let rows = q
                .query_map([hash], |row| row.get::<_, String>(0))
                .map_err(err)?;
            rows.collect::<std::result::Result<Vec<_>, _>>()
                .map_err(err)?
        };
        crate::rule_runs::cancel_in(&tx, &ids)?;
        tx.commit().map_err(err)
    }
    pub fn mail(&self, id: &str) -> Result<Mail> {
        let raw: String = self
            .db()?
            .query_row("SELECT data FROM messages WHERE id=?1", [id], |r| r.get(0))
            .map_err(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => "邮件不存在，可能已被删除".into(),
                e => err(e),
            })?;
        serde_json::from_str(&raw).map_err(err)
    }
    pub fn update_mail(&self, m: &Mail) -> Result<()> {
        self.db()?
            .execute(
                "UPDATE messages SET data=?2 WHERE id=?1",
                params![m.id, serde_json::to_string(m).map_err(err)?],
            )
            .map_err(err)?;
        Ok(())
    }
    /// Persist a local rule flag and, unless a directory MOVE/COPY already
    /// carries it, enqueue the same intent for the server atomically.
    fn update_mail_with_flag(
        &self,
        m: &Mail,
        action: &str,
        value: bool,
        sync_server: bool,
    ) -> Result<()> {
        let mut db = self.db()?;
        let tx = db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(err)?;
        if sync_server {
            crate::operations::enqueue(&tx, m, action, value)?;
        }
        tx.execute(
            "UPDATE messages SET data=?2 WHERE id=?1",
            params![m.id, serde_json::to_string(m).map_err(err)?],
        )
        .map_err(err)?;
        tx.commit().map_err(err)
    }
    #[cfg(test)]
    pub fn has_source(&self, account: &str, folder: &str, remote: &str) -> Result<bool> {
        self.db()?.query_row("SELECT EXISTS(SELECT 1 FROM sources WHERE account_id=?1 AND folder=?2 AND remote_id=?3)",params![account,folder,remote],|r|r.get(0)).map_err(err)
    }
    pub fn ingest(
        &self,
        a: &Account,
        folder: &str,
        remote: &str,
        raw: &[u8],
        read: bool,
    ) -> Result<bool> {
        self.ingest_with_flags(a, folder, remote, raw, read, false)
    }
    pub(crate) fn ingest_with_flags(
        &self,
        a: &Account,
        folder: &str,
        remote: &str,
        raw: &[u8],
        read: bool,
        starred: bool,
    ) -> Result<bool> {
        let _archive = self.archive_gate.read().map_err(err)?;
        // A cleanup can disable retention while a FETCH is in flight. Do not
        // republish an old request as a local archive after it finishes.
        let mut a = a.clone();
        // Only a confirmed local SMTP record can bypass receiving retention.
        // A real server folder also named Sent must obey the latest scope.
        let local_sent = folder == "Sent" && self.db()?.query_row("SELECT EXISTS(SELECT 1 FROM outbox WHERE id=?1 AND status='sent' AND json_extract(data,'$.accountId')=?2)", params![remote,a.id], |r|r.get::<_,bool>(0)).map_err(err)?;
        if !local_sent {
            if let Ok(current) = self.account(&a.id) {
                a.save_locally &= self.should_save_folder(&current, folder)?;
            }
        }
        let a = &a;
        let (mut mail, _, _) = archive::parse(raw, a, folder)?;
        if !mail.parse_warnings.is_empty() {
            self.log(&format!(
                "文件夹「{folder}」邮件 {remote} 部分内容编码异常；{}：{}",
                if a.save_locally {
                    "完整原件将保留"
                } else {
                    "服务器原件未修改"
                },
                mail.parse_warnings.join("；")
            ))?;
        }
        let save = a.save_locally;
        let hash = archive::digest(raw);
        let rel_path = if save {
            Some(archive::store_raw(
                &self.root,
                &mail.account_id,
                &mail.account_email,
                &mail.source_folder,
                raw,
            )?)
        } else {
            None
        }; // durable, complete MIME before DB success or rule execution
        mail.hash = hash.clone();
        mail.rel_path = rel_path;
        let mut db = self.db()?;
        let tx = db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(err)?;
        let existing: Option<String> = tx
            .query_row(
                "SELECT id FROM messages WHERE account_id=?1 AND hash=?2",
                params![a.id, hash],
                |r| r.get(0),
            )
            .optional()
            .map_err(err)?;
        let is_new = existing.is_none();
        let mut upgraded = false;
        if let Some(id) = existing {
            mail.id = id;
            let data: String = tx
                .query_row("SELECT data FROM messages WHERE id=?1", [&mail.id], |r| {
                    r.get(0)
                })
                .map_err(err)?;
            let old: Mail = serde_json::from_str(&data).map_err(err)?;
            if save && !old.saved_locally {
                mail.is_read = old.is_read;
                mail.starred = old.starred;
                mail.local_read_override = old.local_read_override;
                mail.local_star_override = old.local_star_override;
                mail.trashed = old.trashed;
                mail.local_folder = old.local_folder;
                mail.server_date = old.server_date;
                if mail.date.is_empty() {
                    mail.date = mail.server_date.clone();
                }
                tx.execute(
                    "UPDATE messages SET data=?2,parser_version=?3 WHERE id=?1",
                    params![
                        mail.id,
                        serde_json::to_string(&mail).map_err(err)?,
                        archive::PARSER_VERSION
                    ],
                )
                .map_err(err)?;
                upgraded = true;
            }
        } else {
            // Preserve identity and local actions when an online-only message
            // later gains a complete archive after the account setting changes.
            let previous: Option<String> = tx.query_row("SELECT m.data FROM sources s JOIN messages m ON m.id=s.mail_id WHERE s.account_id=?1 AND s.folder=?2 AND s.remote_id=?3", params![a.id,folder,remote], |r| r.get(0)).optional().map_err(err)?;
            if let Some(data) = previous {
                let old: Mail = serde_json::from_str(&data).map_err(err)?;
                if !old.saved_locally {
                    mail.id = old.id;
                    mail.is_read = old.is_read;
                    mail.starred = old.starred;
                    mail.local_read_override = old.local_read_override;
                    mail.local_star_override = old.local_star_override;
                    mail.trashed = old.trashed;
                    mail.local_folder = old.local_folder;
                    mail.server_date = old.server_date;
                }
            } else {
                mail.is_read = read;
                mail.starred = starred;
            }
            mail.saved_locally = save;
            if !save {
                mail.body.clear();
            }
            if mail.date.is_empty() {
                mail.date = mail.server_date.clone();
            }
            tx.execute("INSERT INTO messages(id,account_id,hash,data,parser_version) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(id) DO UPDATE SET hash=excluded.hash,data=excluded.data,parser_version=excluded.parser_version", params![mail.id,a.id,hash,serde_json::to_string(&mail).map_err(err)?,archive::PARSER_VERSION]).map_err(err)?;
        }
        tx.execute("INSERT INTO sources(account_id,folder,remote_id,mail_id) VALUES(?1,?2,?3,?4) ON CONFLICT(account_id,folder,remote_id) DO UPDATE SET mail_id=excluded.mail_id,active=1",params![a.id,folder,remote,mail.id]).map_err(err)?;
        tx.commit().map_err(err)?;
        // A deduplicated MIME can acquire its rule source on a later folder scan.
        if is_new || upgraded {
            self.apply_rules(&mail.id)?;
        } else {
            self.apply_rules_inner(&mail.id, true)?;
        }
        Ok(is_new)
    }
    pub fn apply_rules(&self, id: &str) -> Result<u32> {
        self.apply_rules_inner(id, false)
    }
    fn apply_rules_inner(&self, id: &str, remote_only: bool) -> Result<u32> {
        let configured = self.rules()?;
        if remote_only
            && !rules::expand(&configured)
                .iter()
                .any(|r| r.enabled && rules::remote(r))
        {
            return Ok(0);
        }
        self.apply_configured_rules(self.mail(id)?, &configured, remote_only)
    }
    fn apply_configured_rules(
        &self,
        mut m: Mail,
        configured: &[Rule],
        remote_only: bool,
    ) -> Result<u32> {
        let expanded = rules::expand(configured);
        let configured = expanded.as_slice();
        // Freeze the state that first matched this rule chain. Ordered actions
        // legitimately change read/star/folder flags, so later steps must not
        // re-read those flags or "未读 → 标已读 → 归类" would stop after step one.
        let observed = rules::ObservedStatus::of(&m);
        if Self::rule_blocks_move(&self.db()?, &m.id)? {
            return Ok(0);
        }
        if m.saved_locally && !remote_only {
            self.read_archive(m.rel_path.as_deref(), &m.hash)?;
        }
        let non_unread = crate::search::is_non_unread_mail(&self.db()?, &m.id)?;
        // 冻结分段只执行本地动作（已读/星标/本地文件夹），服务器动作一律跳过。
        let read_only = self.account(&m.account_id).is_ok_and(|a| a.read_only);
        // Determine all required reads/saves before scheduling any earlier MOVE.
        // The continuation owns the full chain and keeps directory tasks held
        // until every ordered step has finished successfully.
        for rule in configured {
            if non_unread && rule.action == "unread" {
                continue;
            }
            if read_only && (rules::remote(rule) || rule.action == "delete") {
                continue;
            }
            let state =
                rules::match_state_observed(rule, &m, Some(observed), rules::body_available(&m));
            if !self.rule_has_source(rule, &m)? {
                continue;
            }
            let applicable = !remote_only || rules::remote(rule) || rules::saves(rule) || rule.stop;
            if applicable
                && (state == rules::MatchState::NeedsBody
                    || (state == rules::MatchState::Match
                        && !m.saved_locally
                        && (rules::saves(rule)
                            || (rule.action == "serverMove"
                                && !rule.source_folder.is_empty()
                                && self.should_save_folder(
                                    &self.account(&m.account_id)?,
                                    &rule.source_folder,
                                )?))))
            {
                self.defer_rules(&m, observed, configured, 0, remote_only)?;
                return Ok(1);
            }
            if state == rules::MatchState::Match && rule.stop {
                break;
            }
        }
        let mut count = 0;
        for (position, r) in configured.iter().enumerate() {
            if non_unread && r.action == "unread" {
                continue;
            }
            if read_only && rules::remote(r) {
                continue;
            }
            if !self.rule_has_source(r, &m)? {
                // 服务器来源已被删除：serverMove 无法再提交，但本地存档仍应
                // 按规则归位，否则旧收件箱来源行会让它重新计入收件箱。
                if rules::remote(r)
                    && !remote_only
                    && r.action == "serverMove"
                    && m.saved_locally
                    && self.rehome_local_mail(&r.destination, &m.id)?
                {
                    // 后续动作（read/star 等）会用内存里的 m 重新写整条记录，
                    // 必须带上刚更新过的 relPath，否则会把旧路径写回去。
                    if let Ok(updated) = self.mail(&m.id) {
                        m = updated;
                    }
                    count += 1;
                    if r.stop {
                        break;
                    }
                }
                continue;
            }
            let state =
                rules::match_state_observed(r, &m, Some(observed), rules::body_available(&m));
            if state == rules::MatchState::NeedsBody
                && (!remote_only || rules::remote(r) || rules::saves(r) || r.stop)
            {
                self.defer_rules(&m, observed, configured, position, remote_only)?;
                count += 1;
                break;
            }
            if remote_only && !rules::remote(&r) {
                if state == rules::MatchState::Match && rules::saves(r) && !m.saved_locally {
                    self.defer_rules(&m, observed, configured, position, remote_only)?;
                    count += 1;
                    break;
                }
                if state == rules::MatchState::Match && r.stop {
                    break;
                }
                continue;
            }
            if state == rules::MatchState::Match {
                if (rules::saves(r)
                    || (r.action == "serverMove"
                        && !r.source_folder.is_empty()
                        && self
                            .should_save_folder(&self.account(&m.account_id)?, &r.source_folder)?))
                    && !m.saved_locally
                {
                    self.defer_rules(&m, observed, configured, position, remote_only)?;
                    count += 1;
                    break;
                }
                if rules::remote(&r) {
                    let flags = rules::chain_flags(configured, position);
                    if self.apply_remote_rule_with_flags(&r, &m, false, Some(observed), &flags)? {
                        count += 1;
                    } else {
                        continue;
                    }
                    if r.stop || Self::unqueued_rule_failure_in(&self.db()?, r, &m.id)? {
                        break;
                    }
                    continue;
                }
                if r.action == "delete" {
                    self.change_mail(&m.id, "delete", "true")?;
                    self.log(&format!("规则「{}」已彻底删除 · {}", r.name, m.subject))?;
                    count += 1;
                    if r.stop {
                        break;
                    }
                    continue;
                }
                let flag = match r.action.as_str() {
                    "folder" => {
                        m.local_folder = r.destination.clone();
                        None
                    }
                    "saveFolder" => {
                        m.local_folder = r.destination.clone();
                        None
                    }
                    "save" => None,
                    "read" => {
                        m.is_read = true;
                        m.local_read_override = Some(true);
                        Some(("read", true))
                    }
                    "unread" => {
                        m.is_read = false;
                        m.local_read_override = Some(false);
                        Some(("read", false))
                    }
                    "star" => {
                        m.starred = true;
                        m.local_star_override = Some(true);
                        Some(("star", true))
                    }
                    "trash" => {
                        m.trashed = true;
                        None
                    }
                    _ => return Err("未知动作".into()),
                };
                if let Some((action, value)) = flag {
                    self.update_mail_with_flag(
                        &m,
                        action,
                        value,
                        !rules::chain_has_remote(configured, position),
                    )?;
                } else {
                    self.update_mail(&m)?;
                }
                if matches!(r.action.as_str(), "folder" | "saveFolder") {
                    self.relocate_archive_after_move_unlocked(&m.local_folder, &m.id);
                    if let Ok(updated) = self.mail(&m.id) {
                        m = updated;
                    }
                }
                if r.action == "trash" {
                    let queued = if r.destination.trim().is_empty() {
                        self.queue_trash_moves(&m.id)
                    } else {
                        self.queue_trash_moves_to(&m.id, Some(&r.destination))
                    };
                    if let Err(error) = queued {
                        let _ = self.log(&format!("规则移到服务器废纸篓失败：{error}"));
                    }
                }
                self.log(&format!("规则「{}」已执行 · {}", r.name, m.subject))?;
                count += 1;
                if r.stop {
                    break;
                }
            }
        }
        Ok(count)
    }
    pub fn reconcile_folder(
        &self,
        account: &str,
        folder: &str,
        remote_ids: &[String],
    ) -> Result<()> {
        let mut db = self.db()?;
        let tx = db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(err)?;
        tx.execute(
            "UPDATE sources SET active=0 WHERE account_id=?1 AND folder=?2",
            params![account, folder],
        )
        .map_err(err)?;
        for id in remote_ids {
            tx.execute(
                "UPDATE sources SET active=1 WHERE account_id=?1 AND folder=?2 AND remote_id=?3",
                params![account, folder, id],
            )
            .map_err(err)?;
        }
        tx.execute("DELETE FROM messages WHERE account_id=?1 AND json_extract(data,'$.savedLocally')=0 AND NOT EXISTS(SELECT 1 FROM sources WHERE mail_id=messages.id AND active=1) AND NOT EXISTS(SELECT 1 FROM rule_runs r WHERE r.mail_id=messages.id AND r.status NOT IN ('completed','cancelled')) AND NOT EXISTS(SELECT 1 FROM directory_operations d WHERE d.account_id=messages.account_id AND json_extract(d.data,'$.mailId')=messages.id AND d.status NOT IN ('completed','cancelled'))", [account]).map_err(err)?;
        tx.commit().map_err(err)?;
        self.normalize_folder_sources(account, folder)?;
        Ok(())
    }
    pub fn preview_rule(&self, rule: &Rule) -> Result<Vec<String>> {
        rules::validate(rule)?;
        let mut rule = rule.clone();
        rule.enabled = true;
        let db = self.db()?;
        let mut q = db
            .prepare("SELECT data FROM message_listing ORDER BY rowid")
            .map_err(err)?;
        let mut matches = Vec::new();
        for row in q.query_map([], |r| r.get::<_, String>(0)).map_err(err)? {
            let m: Mail = serde_json::from_str(&row.map_err(err)?).map_err(err)?;
            let mut state = rules::match_state(&rule, &m, false);
            // 列表投影没有正文；需要正文/大小/未知头时才读取完整记录。
            if state == rules::MatchState::NeedsBody && m.saved_locally {
                let full = self.mail(&m.id)?;
                state = rules::match_state(&rule, &full, rules::body_available(&full));
            }
            let available = rules::expand(std::slice::from_ref(&rule))
                .iter()
                .try_fold(false, |found, step| -> Result<bool> {
                    Ok(found || self.rule_has_source(step, &m)?)
                })?;
            if state != rules::MatchState::NoMatch && available {
                matches.push(if state == rules::MatchState::NeedsBody {
                    format!("{}（等待完整邮件核对）", m.subject)
                } else {
                    m.subject
                });
            }
        }
        Ok(matches)
    }
    pub fn run_rules(&self) -> Result<u32> {
        // Freeze the ordered configuration once per historical scan. Use the
        // body-free projection unless a condition actually needs stored text;
        // unrelated archives must not be opened or hashed by a scoped rule.
        let configured = self.rules()?;
        if !configured.iter().any(|r| r.enabled) {
            return Ok(0);
        }
        let db = self.db()?;
        let mut q = db
            .prepare("SELECT data FROM message_listing ORDER BY rowid")
            .map_err(err)?;
        let candidates = q
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(err)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(err)?;
        let mut n = 0;
        for data in candidates {
            let mail: Mail = serde_json::from_str(&data).map_err(err)?;
            // NeedsBody 也要作为候选：完整记录可能就在本地，读取后可以确认。
            if configured
                .iter()
                .any(|rule| rules::match_state(rule, &mail, false) != rules::MatchState::NoMatch)
            {
                // Load the current full record only for candidates. Conditions
                // and stop ordering are evaluated again before any mutation.
                n += self.apply_configured_rules(self.mail(&mail.id)?, &configured, false)?;
            }
        }
        self.normalize_source_rows()?;
        Ok(n)
    }
    pub fn archive_health_slot(&self) -> Result<String> {
        Ok(self
            .db()?
            .query_row("SELECT slot FROM archive_health_slot WHERE id=1", [], |r| {
                r.get(0)
            })
            .optional()
            .map_err(err)?
            .unwrap_or_default())
    }
    pub fn set_archive_health_slot(&self, slot: &str) -> Result<()> {
        self.db()?
            .execute(
                "INSERT INTO archive_health_slot(id,slot) VALUES(1,?1) ON CONFLICT(id) DO UPDATE SET slot=excluded.slot",
                [slot],
            )
            .map_err(err)?;
        Ok(())
    }
    pub fn log(&self, msg: &str) -> Result<()> {
        let db = self.db()?;
        db.execute(
            "INSERT INTO logs(time,message) VALUES(?1,?2)",
            params![chrono::Local::now().format("%m-%d %H:%M").to_string(), msg],
        )
        .map_err(err)?;
        db.execute(
            "DELETE FROM logs WHERE id NOT IN (SELECT id FROM logs ORDER BY id DESC LIMIT 500)",
            [],
        )
        .map_err(err)?;
        Ok(())
    }
    pub fn snapshot(&self, q: &Query) -> Result<Snapshot> {
        let db = self.db()?;
        let phrase = crate::search::phrase(&q.search);
        let where_sql = crate::search::listing_predicate(phrase.is_some(), false);
        // RFC3339 strings may carry different offsets. Order by the instant,
        // before grouping/pagination; keep unknown dates last and ties stable.
        let limit = q.limit.clamp(1, 5000) as i64;
        let mut matched = 0u64;
        let mut messages = if q.list_mode == ListMode::Conversations {
            let mut st = db
                .prepare(&format!(
                    "SELECT data FROM readable_listing listing WHERE {where_sql} ORDER BY julianday(json_extract(data,'$.date')) DESC, id ASC"
                ))
                .map_err(err)?;
            let rows = st
                .query_map(
                    params![
                        q.account_id,
                        q.search,
                        q.folder,
                        q.view,
                        q.unread_only,
                        q.starred_only,
                        q.attachments_only,
                        q.search_field,
                        q.remote_folder,
                        phrase.as_deref().unwrap_or("")
                    ],
                    |r| r.get::<_, String>(0),
                )
                .map_err(err)?;
            let messages = rows
                .map(|r| serde_json::from_str(&r.map_err(err)?).map_err(err))
                .collect::<Result<Vec<Mail>>>()?;
            let index = self.conversation_index(&q.account_id)?;
            let summaries = crate::conversation::summaries(messages, &index);
            matched = summaries.len() as u64;
            summaries
        } else {
            matched = db
                .query_row(
                    &format!("SELECT COUNT(*) FROM readable_listing listing WHERE {where_sql}"),
                    params![
                        q.account_id,
                        q.search,
                        q.folder,
                        q.view,
                        q.unread_only,
                        q.starred_only,
                        q.attachments_only,
                        q.search_field,
                        q.remote_folder,
                        phrase.as_deref().unwrap_or("")
                    ],
                    |r| r.get::<_, u64>(0),
                )
                .map_err(err)?;
            let mut st = db
                .prepare(&format!(
                    "SELECT data FROM readable_listing listing WHERE {where_sql} ORDER BY julianday(json_extract(data,'$.date')) DESC, id ASC LIMIT ?11"
                ))
                .map_err(err)?;
            let rows = st
                .query_map(
                    params![
                        q.account_id,
                        q.search,
                        q.folder,
                        q.view,
                        q.unread_only,
                        q.starred_only,
                        q.attachments_only,
                        q.search_field,
                        q.remote_folder,
                        phrase.as_deref().unwrap_or(""),
                        limit
                    ],
                    |r| r.get::<_, String>(0),
                )
                .map_err(err)?;
            rows.map(|r| serde_json::from_str(&r.map_err(err)?).map_err(err))
                .map(|mail: Result<Mail>| {
                    mail.map(|mut mail| {
                        mail.conversation_id.clear();
                        mail.conversation_count = 1;
                        mail
                    })
                })
                .collect::<Result<Vec<Mail>>>()?
        };
        messages.truncate(limit as usize);
        self.snapshot_metadata(&db, messages, matched)
    }
    fn snapshot_counters(
        &self,
        db: &Connection,
    ) -> Result<(Stats, Vec<String>, Vec<FolderUnread>, Vec<FolderUnread>)> {
        // 读路径绝不写库：这里若同步重算，会和后台计数线程/同步抢写锁，
        // busy_timeout 长达 10 秒，列表偶发卡 1–3 秒。计数最多滞后 1 秒，
        // 由后台线程按 revision 重算即可。
        let revision: i64 = db
            .query_row("SELECT version FROM query_revision WHERE id=1", [], |r| {
                r.get(0)
            })
            .map_err(err)?;
        // 列表请求在只读事务里（is_autocommit=false），绝不在此写库：同步重算会
        // 和后台计数线程/收信抢写锁，busy_timeout 长达 10 秒。非事务路径（旧的
        // snapshot / 测试）才允许就地补齐，保证统计与刚写入的数据一致。
        if db.is_autocommit() && !crate::counters::import_running(db) {
            if crate::counters::computed_revision(db)? != revision {
                let _ = crate::counters::refresh_in(db);
            }
        }
        let (computed, stats) = db
            .query_row(
                "SELECT revision,total,unread,bytes,saved FROM counters_meta WHERE id=1",
                [],
                |r| {
                    Ok((
                        r.get::<_, i64>(0)?,
                        Stats {
                            total: r.get::<_, i64>(1)?.max(0) as u64,
                            unread: r.get::<_, i64>(2)?.max(0) as u64,
                            bytes: r.get::<_, i64>(3)?.max(0) as u64,
                            saved: r.get::<_, i64>(4)?.max(0) as u64,
                        },
                    ))
                },
            )
            .map_err(err)?;
        // 后台线程通常 1 秒内补齐；只有刚收到新邮件、窗口未过时的这一小段
        // 才退回完整统计，避免读到旧的 0 或错误数字。
        let stats = if computed == revision {
            stats
        } else {
            let (total, bytes, saved): (u64, u64, u64) = db
                .query_row(
                    "SELECT COUNT(*),
                            COALESCE(SUM(CASE WHEN saved_locally=1 THEN size ELSE 0 END),0),
                            COALESCE(SUM(saved_locally),0)
                     FROM search_documents",
                    [],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
                )
                .map_err(err)?;
            let unread: u64 = db
                .query_row(
                    "SELECT COUNT(DISTINCT d.mail_id)
                     FROM trusted_sources s JOIN search_documents d ON d.mail_id=s.mail_id
                     WHERE s.folder='INBOX' COLLATE NOCASE AND s.active=1
                       AND d.is_read=0 AND d.trashed=0",
                    [],
                    |r| r.get(0),
                )
                .map_err(err)?;
            Stats {
                total,
                unread,
                bytes,
                saved,
            }
        };
        let mut fs = db
            .prepare(
                "SELECT DISTINCT local_folder FROM search_documents
                 WHERE local_folder!='全部存档' ORDER BY 1",
            )
            .map_err(err)?;
        let folders = fs
            .query_map([], |r| r.get(0))
            .map_err(err)?
            .collect::<std::result::Result<Vec<String>, _>>()
            .map_err(err)?;
        let folder_totals = folder_counter_rows(db, "total")?;
        let folder_unread = folder_counter_rows(db, "unread")?;
        Ok((stats, folders, folder_unread, folder_totals))
    }
    pub(crate) fn snapshot_metadata(
        &self,
        db: &Connection,
        messages: Vec<Mail>,
        matched: u64,
    ) -> Result<Snapshot> {
        let (stats, folders, folder_unread, folder_totals) = self.snapshot_counters(db)?;
        let mut ls = db
            .prepare("SELECT time || '  ' || message FROM logs ORDER BY id DESC LIMIT 30")
            .map_err(err)?;
        let logs = ls
            .query_map([], |r| {
                r.get::<_, String>(0)
                    .map(|message| crate::remote::display_activity(&message))
            })
            .map_err(err)?
            .collect::<std::result::Result<Vec<String>, _>>()
            .map_err(err)?;
        Ok(Snapshot {
            accounts: json_rows::<Account>(db, "SELECT data FROM accounts ORDER BY rowid DESC")?
                .into_iter()
                .map(|mut account| {
                    account.error = account
                        .error
                        .as_deref()
                        .map(crate::remote::display_activity);
                    account
                })
                .collect(),
            rules: json_rows(db, "SELECT data FROM rules ORDER BY position")?,
            messages,
            folders,
            stats,
            logs,
            data_dir: self.root.to_string_lossy().into(),
            matched,
            remote_folders: self.remote_folders_in(db, None)?,
            folder_unread,
            folder_totals,
        })
    }
    /// 菜单栏图标的未读总数：口径与「全部收件箱」未读徽标一致——
    /// 按每账号生效的 inboxFolders 过滤（未配置的账号只算 INBOX），
    /// 排除废纸篓，并包含服务器已删但本地存档仍在的邮件。
    pub fn tray_unread_count(&self) -> Result<u64> {
        let db = self.db()?;
        let revision: i64 = db
            .query_row("SELECT version FROM query_revision WHERE id=1", [], |r| {
                r.get(0)
            })
            .map_err(err)?;
        if let Some((cached_revision, count)) = *self
            .tray_unread_cache
            .lock()
            .map_err(|e| e.to_string())?
        {
            if cached_revision == revision {
                return Ok(count);
            }
        }
        // Read scalar flags from the search projection instead of parsing the
        // full JSON record for every message on every tray tick.
        let count = db
            .query_row(
                "SELECT COUNT(DISTINCT s.mail_id)
                 FROM trusted_sources s
                 JOIN search_documents d ON d.mail_id = s.mail_id
                 JOIN accounts a ON a.id = s.account_id
                 WHERE (s.active=1 OR (d.saved_locally=1 AND NOT EXISTS(SELECT 1 FROM trusted_sources x WHERE x.mail_id=s.mail_id AND x.active=1)))
                       AND d.is_read=0
                       AND d.trashed=0
                       AND CASE WHEN json_extract(a.data,'$.inboxFolders') IS NULL
                                THEN s.folder='INBOX' COLLATE NOCASE
                                ELSE EXISTS(SELECT 1 FROM json_each(a.data,'$.inboxFolders') WHERE value=s.folder) END",
                [],
                |r| r.get::<_, u64>(0),
            )
            .map_err(err)?;
        *self
            .tray_unread_cache
            .lock()
            .map_err(|e| e.to_string())? = Some((revision, count));
        Ok(count)
    }
    /// 已物化会话图里的归属；不重建全量图。图里没有的新邮件按单封显示。
    pub(crate) fn conversation_membership(&self, id: &str, trashed: bool) -> Result<(String, u64)> {
        let db = self.db()?;
        let root: Option<String> = db
            .query_row(
                "SELECT root FROM conversation_members WHERE mail_id=?1",
                [id],
                |r| r.get(0),
            )
            .optional()
            .map_err(err)?;
        let Some(root) = root else {
            return Ok((id.to_string(), 1));
        };
        let count: Option<i64> = db
            .query_row(
                "SELECT count FROM conversation_counts WHERE root=?1 AND trashed=?2",
                params![root, trashed],
                |r| r.get(0),
            )
            .optional()
            .map_err(err)?;
        Ok((root, count.unwrap_or(1).max(1) as u64))
    }
    pub(crate) fn save_last_page(&self, page: &crate::paging::Page) {
        let path = self.root.join("last-page.json");
        let Ok(data) = serde_json::to_vec(page) else { return };
        let tmp = self.root.join("last-page.json.tmp");
        if std::fs::write(&tmp, data).is_ok() {
            let _ = std::fs::rename(&tmp, &path);
        }
    }
    pub(crate) fn last_page(&self) -> Option<crate::paging::Page> {
        std::fs::read(self.root.join("last-page.json"))
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
    }
    pub fn detail(&self, id: &str) -> Result<Detail> {
        let mut mail = self.mail(id)?;
        let (root, count) = self.conversation_membership(id, mail.trashed)?;
        mail.conversation_id = root;
        mail.conversation_count = count as usize;
        let raw = self.message_raw(&mail)?;
        let (parsed, html, attachments) =
            archive::parse(&raw, &self.account_for_mail(&mail), &mail.source_folder)?;
        mail.body = parsed.body;
        mail.has_attachments = parsed.has_attachments;
        mail.sender_on_behalf_of = parsed.sender_on_behalf_of;
        let (reply_to, to, cc) = archive::reply_addresses(&raw)?;
        Ok(Detail {
            original_hash: archive::digest(&raw),
            mail,
            html,
            attachments,
            reply_to,
            to,
            cc,
        })
    }
    fn reparse(&self, mail: &Mail) -> Result<(Mail, String, Vec<AttachmentInfo>)> {
        let raw = self.read_archive(mail.rel_path.as_deref(), &mail.hash)?;
        let fake = self.account_for_mail(mail);
        archive::parse(&raw, &fake, &mail.source_folder)
    }
    pub(crate) fn account_for_mail(&self, mail: &Mail) -> Account {
        Account {
            id: mail.account_id.clone(),
            email: mail.account_email.clone(),
            name: String::new(),
            provider: String::new(),
            protocol: "imap".into(),
            incoming_host: String::new(),
            incoming_port: 993,
            incoming_tls: "tls".into(),
            smtp_host: String::new(),
            smtp_port: 465,
            smtp_tls: "tls".into(),
            username: String::new(),
            smtp_username: String::new(),
            auth: "password".into(),
            oauth_client_id: String::new(),
            enabled: false,
            save_locally: true,
            server_retention_days: None,
            inbox_folders: None,
            last_sync: None,
            error: None,
            read_only: false,
            frozen_at: None,
            sync_since: None,
        }
    }
    fn refresh_archive_metadata(&self) -> Result<()> {
        let mut db = self.db()?;
        let tx = db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(err)?;
        let rows = tx
            .prepare("SELECT data, parser_version FROM messages WHERE parser_version < ?1")
            .map_err(err)?
            .query_map([archive::PARSER_VERSION], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
            })
            .map_err(err)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(err)?;
        let mut failed = 0;
        for (data, version) in rows {
            let mut mail: Mail = serde_json::from_str(&data).map_err(err)?;
            if version >= 3 {
                // 旧记录结构已经完整，只缺后来新增的头字段，不重新解码正文/附件。
                let Ok(raw) = self.read_archive(mail.rel_path.as_deref(), &mail.hash) else {
                    if !mail.saved_locally {
                        // 仅在线记录没有原件，标记头信息未知，下一次同步取在线头块。
                        mail.header_metadata_known = false;
                        tx.execute(
                            "UPDATE messages SET data=?2,parser_version=?3 WHERE id=?1",
                            params![
                                mail.id,
                                serde_json::to_string(&mail).map_err(err)?,
                                archive::PARSER_VERSION
                            ],
                        )
                        .map_err(err)?;
                        continue;
                    }
                    failed += 1;
                    continue;
                };
                let Ok((cc, priority, sender_on_behalf_of)) = archive::header_metadata(&raw) else {
                    failed += 1;
                    continue;
                };
                mail.cc = cc;
                mail.priority = priority;
                mail.sender_on_behalf_of = sender_on_behalf_of;
                mail.header_metadata_known = true;
            } else {
                let Ok((parsed, _, _)) = self.reparse(&mail) else {
                    // Missing/corrupt archives remain unchanged and retry next startup.
                    failed += 1;
                    continue;
                };
                mail.date = if parsed.date.is_empty() {
                    mail.server_date.clone()
                } else {
                    parsed.date
                };
                mail.sender = parsed.sender;
                mail.sender_on_behalf_of = parsed.sender_on_behalf_of;
                mail.recipients = parsed.recipients;
                mail.cc = parsed.cc;
                mail.priority = parsed.priority;
                mail.header_metadata_known = parsed.header_metadata_known;
                mail.subject = parsed.subject;
                mail.body = parsed.body;
                mail.preview = parsed.preview;
                mail.message_id = parsed.message_id;
                mail.in_reply_to = parsed.in_reply_to;
                mail.references = parsed.references;
            }
            tx.execute(
                "UPDATE messages SET data=?2,parser_version=?3 WHERE id=?1",
                params![
                    mail.id,
                    serde_json::to_string(&mail).map_err(err)?,
                    archive::PARSER_VERSION
                ],
            )
            .map_err(err)?;
        }
        tx.commit().map_err(err)?;
        if failed > 0 {
            self.log(&format!(
                "{failed} 封存档因文件缺失、校验或解析失败，未更新显示信息；原记录已保留"
            ))?;
        }
        Ok(())
    }
    pub fn drafts(&self) -> Result<Vec<Compose>> {
        let db = self.db()?;
        let mut q = db
            .prepare("SELECT data FROM drafts ORDER BY rowid DESC")
            .map_err(err)?;
        let rows = q.query_map([], |r| r.get::<_, String>(0)).map_err(err)?;
        rows.map(|r| serde_json::from_str(&r.map_err(err)?).map_err(err))
            .collect()
    }
    pub fn save_draft(&self, d: &Compose) -> Result<()> {
        self.save_draft_with_files(d)
    }
    pub(crate) fn save_draft_record(&self, d: &Compose) -> Result<()> {
        let db = self.db()?;
        let locked: bool = db.query_row("SELECT EXISTS(SELECT 1 FROM outbox WHERE id=?1 AND status IN ('scheduled','overdue','paused','sending','sent'))", [&d.id], |r| r.get(0)).map_err(err)?;
        if locked {
            return Err("邮件已进入发送记录，请在那里修改计划或取消后编辑".into());
        }
        db.execute(
            "INSERT INTO drafts VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
            params![d.id, serde_json::to_string(d).map_err(err)?],
        )
        .map_err(err)?;
        Ok(())
    }
    pub fn backup(&self, destination: &Path) -> Result<String> {
        let _archive = self.archive_gate.read().map_err(err)?;
        let folder = destination.join(format!(
            "Mail-backup-{}-{}",
            chrono::Local::now().format("%Y%m%d-%H%M%S"),
            &uuid::Uuid::new_v4().to_string()[..8]
        ));
        fs::create_dir_all(folder.join("archive")).map_err(err)?;
        let db = self.db()?;
        db.execute(
            "VACUUM INTO ?1",
            [folder.join("snapshot.sqlite3").to_string_lossy().as_ref()],
        )
        .map_err(err)?;
        let snap = Connection::open(folder.join("snapshot.sqlite3")).map_err(err)?;
        let mut stmt = snap
            .prepare("SELECT DISTINCT hash, COALESCE(json_extract(data,'$.relPath'),'') FROM messages WHERE COALESCE(json_extract(data,'$.savedLocally'),1)=1")
            .map_err(err)?;
        for h in stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .map_err(err)?
        {
            let (hash, rel) = h.map_err(err)?;
            let rel = if rel.is_empty() {
                None
            } else {
                Some(rel.as_str())
            };
            archive::atomic_write(
                &folder.join("archive").join(format!("{hash}.eml")),
                &self.read_archive(rel, &hash)?,
            )?;
        }
        drop(stmt);
        snap.execute_batch("DELETE FROM accounts; DELETE FROM folder_retention; DELETE FROM archive_jobs; DELETE FROM rule_runs; DELETE FROM drafts; DELETE FROM compose_files; DELETE FROM compose_sessions; DELETE FROM outbox; DELETE FROM sent_uploads; DELETE FROM logs; DELETE FROM server_operations; DELETE FROM folder_health; DELETE FROM directory_operations; DELETE FROM rule_executions; VACUUM;").map_err(err)?;
        archive::atomic_write(
            &folder.join("manifest.json"),
            br#"{"format":"mail-desktop-archive","version":1}"#,
        )?;
        Ok(folder.to_string_lossy().into())
    }
    pub fn restore(&self, folder: &Path) -> Result<usize> {
        let _archive = self.archive_gate.read().map_err(err)?;
        let manifest: serde_json::Value =
            serde_json::from_slice(&fs::read(folder.join("manifest.json")).map_err(err)?)
                .map_err(err)?;
        if manifest["format"] != "mail-desktop-archive" || manifest["version"] != 1 {
            return Err("不支持的备份格式".into());
        }
        let source = Connection::open_with_flags(
            folder.join("snapshot.sqlite3"),
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        )
        .map_err(err)?;
        let mut q = source.prepare("SELECT data FROM messages").map_err(err)?;
        let rows = q.query_map([], |r| r.get::<_, String>(0)).map_err(err)?;
        let mut messages = Vec::new();
        for row in rows {
            let m: Mail = serde_json::from_str(&row.map_err(err)?).map_err(err)?;
            if !m.saved_locally {
                continue;
            }
            let raw = archive::read_raw(&[folder.to_path_buf()], None, &m.hash)?;
            let rel = archive::store_raw(
                &self.root,
                &m.account_id,
                &m.account_email,
                &m.source_folder,
                &raw,
            )?;
            let mut m = m;
            m.rel_path = Some(rel);
            if m.saved_locally {
                messages.push(m);
            }
        }
        let has_table = |name: &str| -> Result<bool> {
            source
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1)",
                    [name],
                    |r| r.get(0),
                )
                .map_err(err)
        };
        let mut restored_rules = Vec::<Rule>::new();
        if has_table("rules")? {
            let mut q = source
                .prepare("SELECT data FROM rules ORDER BY position")
                .map_err(err)?;
            for row in q.query_map([], |r| r.get::<_, String>(0)).map_err(err)? {
                let rule: Rule = serde_json::from_str(&row.map_err(err)?).map_err(err)?;
                rules::validate(&rule)?;
                restored_rules.push(rule);
            }
        }
        let mut restored_contacts = Vec::<Contact>::new();
        if has_table("contacts")? {
            let mut q = source
                .prepare("SELECT id,name,email FROM contacts ORDER BY rowid")
                .map_err(err)?;
            for row in q
                .query_map([], |r| {
                    Ok(Contact {
                        id: r.get(0)?,
                        name: r.get(1)?,
                        email: r.get(2)?,
                    })
                })
                .map_err(err)?
            {
                let contact = row.map_err(err)?;
                if contact.id.is_empty()
                    || contact.email.parse::<lettre::Address>().is_err()
                    || contact.name.contains(['\r', '\n'])
                {
                    return Err("备份中的联系人信息无效".into());
                }
                restored_contacts.push(contact);
            }
        }
        let mut db = self.db()?;
        let tx = db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(err)?;
        let mut count = 0;
        for m in messages {
            count += tx
                .execute(
                    "INSERT OR IGNORE INTO messages(id,account_id,hash,data) VALUES(?1,?2,?3,?4)",
                    params![
                        m.id,
                        m.account_id,
                        m.hash,
                        serde_json::to_string(&m).map_err(err)?
                    ],
                )
                .map_err(err)?;
        }
        let mut position: i64 = tx
            .query_row("SELECT COALESCE(MAX(position),-1)+1 FROM rules", [], |r| {
                r.get(0)
            })
            .map_err(err)?;
        let mut rule_count = 0;
        for rule in restored_rules {
            let n = tx
                .execute(
                    "INSERT OR IGNORE INTO rules(id,position,data) VALUES(?1,?2,?3)",
                    params![
                        rule.id,
                        position,
                        serde_json::to_string(&rule).map_err(err)?
                    ],
                )
                .map_err(err)?;
            position += n as i64;
            rule_count += n;
        }
        let mut contact_count = 0;
        for contact in restored_contacts {
            contact_count += tx
                .execute(
                    "INSERT OR IGNORE INTO contacts(id,name,email) VALUES(?1,?2,?3)",
                    params![contact.id, contact.name, contact.email],
                )
                .map_err(err)?;
        }
        tx.commit().map_err(err)?;
        self.refresh_archive_metadata()?;
        self.log(&format!(
            "备份恢复：新增 {count} 封邮件、{rule_count} 条规则、{contact_count} 位联系人"
        ))?;
        Ok(count)
    }
}

pub(crate) fn json_rows<T: serde::de::DeserializeOwned>(
    db: &Connection,
    sql: &str,
) -> Result<Vec<T>> {
    let mut query = db.prepare(sql).map_err(err)?;
    let rows = query
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(err)?;
    rows.map(|r| serde_json::from_str(&r.map_err(err)?).map_err(err))
        .collect()
}

fn folder_counter_rows(db: &Connection, column: &str) -> Result<Vec<FolderUnread>> {
    let mut q = db
        .prepare(&format!(
            "SELECT account_id, folder, {column} FROM folder_counters"
        ))
        .map_err(err)?;
    let rows = q
        .query_map([], |r| {
            Ok(FolderUnread {
                account_id: r.get(0)?,
                folder: r.get(1)?,
                count: r.get(2)?,
            })
        })
        .map_err(err)?;
    rows.collect::<std::result::Result<Vec<_>, _>>()
        .map_err(err)
}
