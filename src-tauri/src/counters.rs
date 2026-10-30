//! 文件夹计数快照：后台重算写入小表，读取路径不再扫描 messages。
use crate::{models::*, store::Store};
use rusqlite::Connection;
use std::time::Duration;
use tauri::Emitter;

pub fn initialize(db: &Connection) -> Result<()> {
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS folder_counters(
            account_id TEXT NOT NULL,folder TEXT NOT NULL,
            total INTEGER NOT NULL DEFAULT 0,unread INTEGER NOT NULL DEFAULT 0,
            size INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(account_id,folder));
         CREATE TABLE IF NOT EXISTS counters_meta(
            id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL DEFAULT 0);
         INSERT OR IGNORE INTO counters_meta(id,revision) VALUES(1,0);",
    )
    .map_err(err)?;
    // 全库统计也放进这张单行表，列表读路径就不必每次扫 6 万行 search_documents
    // 和 INBOX 未读联表（冷缓存时这两项会占 1–2 秒）。迁移后强制重算一次。
    let mut migrated = false;
    for (column, definition) in [
        ("total", "INTEGER NOT NULL DEFAULT 0"),
        ("bytes", "INTEGER NOT NULL DEFAULT 0"),
        ("saved", "INTEGER NOT NULL DEFAULT 0"),
        ("unread", "INTEGER NOT NULL DEFAULT 0"),
    ] {
        if db
            .execute(
                &format!("ALTER TABLE counters_meta ADD COLUMN {column} {definition}"),
                [],
            )
            .is_ok()
        {
            migrated = true;
        }
    }
    if migrated {
        let _ = db.execute("UPDATE counters_meta SET revision=-1 WHERE id=1", []);
    }
    Ok(())
}

/// 导入进行中不刷新计数：每封邮件都会 bump query_revision，实时重算会把
/// 主窗的每次列表请求都拖慢数秒。
pub fn import_running(db: &Connection) -> bool {
    db.query_row(
        "SELECT EXISTS(SELECT 1 FROM eml_import_jobs WHERE status IN ('queued','running'))",
        [],
        |r| r.get::<_, bool>(0),
    )
    .unwrap_or(false)
}

pub fn computed_revision(db: &Connection) -> Result<i64> {
    db.query_row("SELECT revision FROM counters_meta WHERE id=1", [], |r| {
        r.get(0)
    })
    .map_err(err)
}

pub fn refresh_in(db: &Connection) -> Result<()> {
    let tx = db.unchecked_transaction().map_err(err)?;
    let revision: i64 = tx
        .query_row("SELECT version FROM query_revision WHERE id=1", [], |r| {
            r.get(0)
        })
        .map_err(err)?;
    tx.execute("DELETE FROM folder_counters", []).map_err(err)?;
    tx.execute(
        "INSERT INTO folder_counters(account_id,folder,total,unread,size)
         SELECT account_id,folder,COUNT(*),
                COALESCE(SUM(CASE WHEN is_read=0 THEN 1 ELSE 0 END),0),
                COALESCE(SUM(size),0)
         FROM (
            SELECT DISTINCT s.account_id,s.folder,s.mail_id,d.is_read,d.size
            FROM trusted_sources s JOIN search_documents d ON d.mail_id=s.mail_id
            WHERE d.trashed=0
              AND (s.active=1 OR (d.saved_locally=1 AND NOT EXISTS(
                    SELECT 1 FROM trusted_sources x
                    WHERE x.mail_id=s.mail_id AND x.active=1)))
         )
         GROUP BY account_id,folder",
        [],
    )
    .map_err(err)?;
    let (total, bytes, saved): (i64, i64, i64) = tx
        .query_row(
            "SELECT COUNT(*),
                    COALESCE(SUM(CASE WHEN saved_locally=1 THEN size ELSE 0 END),0),
                    COALESCE(SUM(saved_locally),0)
             FROM search_documents",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .map_err(err)?;
    let unread: i64 = tx
        .query_row(
            "SELECT COUNT(DISTINCT d.mail_id)
             FROM trusted_sources s JOIN search_documents d ON d.mail_id=s.mail_id
             WHERE s.folder='INBOX' COLLATE NOCASE AND s.active=1
               AND d.is_read=0 AND d.trashed=0",
            [],
            |r| r.get(0),
        )
        .map_err(err)?;
    tx.execute(
        "UPDATE counters_meta SET revision=?1,total=?2,bytes=?3,saved=?4,unread=?5 WHERE id=1",
        rusqlite::params![revision, total, bytes, saved, unread],
    )
    .map_err(err)?;
    tx.commit().map_err(err)
}

pub fn refresh(store: &Store) -> Result<()> {
    let db = store.db()?;
    refresh_in(&db)
}

fn stale(store: &Store) -> bool {
    let Ok(db) = store.db() else {
        return false;
    };
    if import_running(&db) {
        return false;
    }
    let current = db.query_row("SELECT version FROM query_revision WHERE id=1", [], |r| {
        r.get::<_, i64>(0)
    });
    let computed = computed_revision(&db);
    matches!((current, computed), (Ok(current), Ok(computed)) if current != computed)
}

pub fn start(store: Store, app: tauri::AppHandle) {
    std::thread::spawn(move || {
        let mut last_emit = std::time::Instant::now() - Duration::from_secs(10);
        let mut last_refresh = std::time::Instant::now() - Duration::from_secs(10);
        loop {
            // 收信时 revision 每秒都在变；重算本身要扫 6 万行。最多每 5 秒
            // 算一次，避免和收信写入抢写锁/磁盘，导致收取变慢。
            if stale(&store) && last_refresh.elapsed() >= Duration::from_secs(5) {
                if refresh(&store).is_ok() {
                    last_refresh = std::time::Instant::now();
                    if last_emit.elapsed() >= Duration::from_secs(5) {
                        // 收信回读状态时 revision 可能每秒都变；计数重算照常，但事件
                        // 最多每 5 秒发一次，避免前端被 mail-updated 带着反复重查。
                        last_emit = std::time::Instant::now();
                        let _ = app.emit("mail-updated", ());
                    }
                }
            }
            std::thread::sleep(Duration::from_secs(1));
        }
    });
}
