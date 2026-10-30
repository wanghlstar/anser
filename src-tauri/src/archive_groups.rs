//! Local-only archive namespaces. Groups never participate in sync or server work.
use crate::{models::*, store::Store};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveGroup {
    pub id: String,
    pub name: String,
}

pub fn initialize(db: &Connection) -> Result<()> {
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS archive_groups(id TEXT PRIMARY KEY,name TEXT NOT NULL,created_at TEXT NOT NULL,sort_order INTEGER);
         CREATE TABLE IF NOT EXISTS local_folders(id TEXT PRIMARY KEY,group_id TEXT NOT NULL,path TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(group_id,path));",
    )
    .map_err(err)
}

fn name(value: &str) -> Result<&str> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > 80 || value.chars().any(char::is_control) {
        Err("归档组名称无效".into())
    } else {
        Ok(value)
    }
}

fn path(value: &str) -> Result<&str> {
    let value = value.trim().trim_matches('/');
    if value.is_empty()
        || value.chars().count() > 240
        || value.chars().any(char::is_control)
        || value.split('/').any(|part| part.trim().is_empty())
    {
        Err("文件夹名称无效".into())
    } else {
        Ok(value)
    }
}

pub fn account_for_group(db: &Connection, id: &str) -> Result<Option<Account>> {
    Store::archive_group_account_from(db, id)
}

impl Store {
    pub(crate) fn archive_group_account_from(db: &Connection, id: &str) -> Result<Option<Account>> {
        let name: Option<String> = db
            .query_row("SELECT name FROM archive_groups WHERE id=?1", [id], |r| {
                r.get(0)
            })
            .optional()
            .map_err(err)?;
        Ok(name.map(|name| Account {
            id: id.to_string(),
            name: name.clone(),
            email: name,
            provider: String::new(),
            protocol: "local".into(),
            incoming_host: String::new(),
            incoming_port: 0,
            incoming_tls: String::new(),
            smtp_host: String::new(),
            smtp_port: 0,
            smtp_tls: String::new(),
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
            read_only: true,
            frozen_at: None,
            sync_since: None,
        }))
    }
    pub fn archive_groups(&self) -> Result<Vec<ArchiveGroup>> {
        let db = self.db()?;
        let mut q = db
            .prepare("SELECT id,name FROM archive_groups ORDER BY sort_order,created_at,name")
            .map_err(err)?;
        let rows = q
            .query_map([], |r| {
                Ok(ArchiveGroup {
                    id: r.get(0)?,
                    name: r.get(1)?,
                })
            })
            .map_err(err)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(err)?;
        Ok(rows)
    }

    pub fn create_archive_group(&self, value: &str) -> Result<ArchiveGroup> {
        self.invalidate_archive_tree_cache();
        let name = name(value)?;
        let id = format!("archive:{}", uuid::Uuid::new_v4());
        self.db()?
            .execute(
                "INSERT INTO archive_groups(id,name,created_at) VALUES(?1,?2,?3)",
                params![id, name, chrono::Utc::now().to_rfc3339()],
            )
            .map_err(err)?;
        Ok(ArchiveGroup {
            id,
            name: name.to_string(),
        })
    }

    pub fn rename_archive_group(&self, id: &str, value: &str) -> Result<()> {
        self.invalidate_archive_tree_cache();
        let name = name(value)?;
        let changed = self
            .db()?
            .execute(
                "UPDATE archive_groups SET name=?2 WHERE id=?1",
                params![id, name],
            )
            .map_err(err)?;
        if changed == 0 {
            return Err("归档组不存在".into());
        }
        Ok(())
    }

    /// Empty folders live beside mail-derived folders and survive imports.
    pub fn create_archive_folder(&self, group_id: &str, value: &str) -> Result<()> {
        self.invalidate_archive_tree_cache();
        let path = path(value)?;
        let db = self.db()?;
        let exists: bool = db
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM archive_groups WHERE id=?1) OR EXISTS(SELECT 1 FROM accounts WHERE id=?1)",
                [group_id],
                |r| r.get(0),
            )
            .map_err(err)?;
        if !exists {
            return Err("归档组不存在".into());
        }
        db.execute(
            "INSERT OR IGNORE INTO local_folders(id,group_id,path,created_at) VALUES(?1,?2,?3,?4)",
            params![
                uuid::Uuid::new_v4().to_string(),
                group_id,
                path,
                chrono::Utc::now().to_rfc3339()
            ],
        )
        .map_err(err)?;
        Ok(())
    }

    /// Rename a user-facing folder inside a local archive group. The folder is
    /// a local filing label: no IMAP operation or MIME rewrite is involved.
    pub fn rename_archive_folder(&self, group_id: &str, old: &str, new: &str) -> Result<u64> {
        self.invalidate_archive_tree_cache();
        let old = path(old)?;
        let new = path(new)?;
        if old == new {
            return Ok(0);
        }
        let mut db = self.db()?;
        let group: bool = db
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM archive_groups WHERE id=?1)
                        OR EXISTS(SELECT 1 FROM accounts WHERE id=?1)",
                [group_id],
                |r| r.get(0),
            )
            .map_err(err)?;
        if !group {
            return Err("账号或归档组不存在".into());
        }
        let conflict: bool = db
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM local_folders WHERE group_id=?1 AND path=?2)
                 OR EXISTS(SELECT 1 FROM messages WHERE account_id=?1 AND json_extract(data,'$.localFolder')=?2)
                 OR EXISTS(SELECT 1 FROM sources WHERE account_id=?1 AND folder=?2)",
                params![group_id, new],
                |r| r.get(0),
            )
            .map_err(err)?;
        if conflict {
            return Err("同名文件夹已存在".into());
        }
        let tx = db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(err)?;
        let changed = tx
            .execute(
                "UPDATE messages SET data=json_set(data,'$.localFolder',?3,'$.sourceFolder',?3)
                 WHERE account_id=?1 AND json_extract(data,'$.localFolder')=?2",
                params![group_id, old, new],
            )
            .map_err(err)?;
        tx.execute(
            "UPDATE sources SET folder=?3 WHERE account_id=?1 AND folder=?2",
            params![group_id, old, new],
        )
        .map_err(err)?;
        tx.execute(
            "UPDATE local_folders SET path=?3 WHERE group_id=?1 AND path=?2",
            params![group_id, old, new],
        )
        .map_err(err)?;
        tx.commit().map_err(err)?;
        Ok(changed as u64)
    }
}
