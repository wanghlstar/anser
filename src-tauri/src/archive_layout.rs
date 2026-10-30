//! 存档布局迁移：v1 archive/<邮箱>/…、v2 archive/<账号 id>/… → v3 archive/<邮箱>__<短 id>/…
//!
//! 账号 id 是分段的稳定标识，同地址的两个分段因此各有独立目录。迁移按邮件
//! 逐条进行：先复制到新路径并校验，再更新数据库里的 relPath，最后在没有任何
//! 记录引用旧路径时删除旧文件。外置盘未挂载时把邮件记入 archive_migrations，
//! 下次启动继续重试；relPath 保持旧值，读取不受影响。

use crate::{
    archive,
    models::{err, Result},
    store::Store,
};
use rusqlite::params;
use std::{
    collections::BTreeSet,
    fs,
    path::{Path, PathBuf},
};

struct MoveJob {
    mail_id: String,
    hash: String,
    old_rel: String,
    new_rel: String,
}

impl Store {
    /// 启动时调用（已在 lib.rs 的 Store::new 内）。幂等，可重复执行。
    pub fn migrate_archive_layout(&self) -> Result<u64> {
        let prefs = self.preferences()?;
        let version = prefs.archive_layout_version;
        let pending = self.pending_archive_migrations()?;
        if version >= 3 && pending.is_empty() {
            return Ok(0);
        }
        let _gate = self.archive_gate.write().map_err(|e| e.to_string())?;
        if version < 3 {
            self.backup_before_layout_migration();
        }
        let roots = self
            .archive_roots
            .read()
            .map_err(|e| e.to_string())?
            .clone();
        let jobs = if version < 3 {
            self.archive_layout_jobs()?
        } else {
            pending
        };
        let mut migrated = 0u64;
        let mut moved_old = BTreeSet::new();
        let mut pending_count = 0u64;
        for job in &jobs {
            let exists: bool = self
                .db()?
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM messages WHERE id=?1)",
                    [&job.mail_id],
                    |r| r.get(0),
                )
                .map_err(err)?;
            if !exists {
                // 邮件在等待外置盘期间被删除，迁移表里的孤儿行不再重试。
                self.clear_archive_migration(&job.mail_id)?;
                continue;
            }
            if job.old_rel == job.new_rel {
                self.clear_archive_migration(&job.mail_id)?;
                continue;
            }
            match migrate_one(&roots, job) {
                Ok(()) => {
                    self.set_rel_path(&job.mail_id, &job.new_rel)?;
                    moved_old.insert(job.old_rel.clone());
                    self.clear_archive_migration(&job.mail_id)?;
                    migrated += 1;
                }
                Err(message) => {
                    pending_count += 1;
                    self.record_archive_migration(job, &message)?;
                }
            }
        }
        self.remove_unreferenced_old_files(&roots, &moved_old)?;
        if version < 3 {
            self.prune_empty_archive_dirs(&roots);
            self.mark_layout_version_3()?;
            // 目录改名后随盘索引里的链接会失效；迁移完成时重建一次。
            if prefs.archive_index_enabled {
                if let Some(ext) = prefs
                    .external_archive_dir
                    .as_deref()
                    .map(str::trim)
                    .filter(|path| !path.is_empty())
                {
                    let _ = self.write_portable_index(Path::new(ext));
                }
            }
            if migrated > 0 || pending_count > 0 {
                let _ = self.log(&format!(
                    "本地存档已按账号分段整理：迁移 {migrated} 封，待外置盘 {pending_count} 封"
                ));
            }
        }
        Ok(migrated)
    }

    fn archive_layout_jobs(&self) -> Result<Vec<MoveJob>> {
        let db = self.db()?;
        let mut stmt = db
            .prepare(
                "SELECT m.id, m.account_id, m.hash,
                        COALESCE(json_extract(m.data,'$.accountEmail'),
                                 json_extract(a.data,'$.email'),''),
                        COALESCE(json_extract(m.data,'$.sourceFolder'),''),
                        COALESCE(json_extract(m.data,'$.relPath'),'')
                 FROM messages m LEFT JOIN accounts a ON a.id=m.account_id
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
                ))
            })
            .map_err(err)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(err)?;
        let mut jobs = Vec::new();
        for (mail_id, account_id, hash, email, source_folder, old_rel) in rows {
            let old_rel = if old_rel.is_empty() {
                format!("archive/{hash}.eml")
            } else {
                old_rel
            };
            if old_rel.starts_with(&format!(
                "archive/{}/",
                archive::account_dir(&account_id, &email)
            )) {
                continue;
            }
            let folder = previous_folder(&old_rel).unwrap_or(source_folder);
            let Some(new_rel) = archive::rel_path_for(&account_id, &email, &folder, &hash) else {
                continue;
            };
            jobs.push(MoveJob {
                mail_id,
                hash,
                old_rel,
                new_rel,
            });
        }
        Ok(jobs)
    }

    fn pending_archive_migrations(&self) -> Result<Vec<MoveJob>> {
        let db = self.db()?;
        let mut stmt = db
            .prepare(
                "SELECT m.mail_id, COALESCE(json_extract(x.data,'$.accountId'),''),
                        COALESCE(json_extract(x.data,'$.hash'),''),
                        m.old_rel, m.new_rel
                 FROM archive_migrations m LEFT JOIN messages x ON x.id=m.mail_id",
            )
            .map_err(err)?;
        let rows = stmt
            .query_map([], |r| {
                Ok(MoveJob {
                    mail_id: r.get(0)?,
                    hash: r.get(2)?,
                    old_rel: r.get(3)?,
                    new_rel: r.get(4)?,
                })
            })
            .map_err(err)?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(err)
    }

    fn set_rel_path(&self, mail_id: &str, rel: &str) -> Result<()> {
        self.db()?
            .execute(
                "UPDATE messages SET data=json_set(data,'$.relPath',?2) WHERE id=?1",
                params![mail_id, rel],
            )
            .map_err(err)?;
        Ok(())
    }

    fn record_archive_migration(&self, job: &MoveJob, error: &str) -> Result<()> {
        self.db()?
            .execute(
                "INSERT INTO archive_migrations(mail_id,old_rel,new_rel,error,updated_at)
                 VALUES(?1,?2,?3,?4,?5)
                 ON CONFLICT(mail_id) DO UPDATE SET old_rel=excluded.old_rel,
                   new_rel=excluded.new_rel,error=excluded.error,updated_at=excluded.updated_at",
                params![
                    job.mail_id,
                    job.old_rel,
                    job.new_rel,
                    error,
                    chrono::Utc::now().to_rfc3339()
                ],
            )
            .map_err(err)?;
        Ok(())
    }

    fn clear_archive_migration(&self, mail_id: &str) -> Result<()> {
        self.db()?
            .execute("DELETE FROM archive_migrations WHERE mail_id=?1", [mail_id])
            .map_err(err)?;
        Ok(())
    }

    fn remove_unreferenced_old_files(
        &self,
        roots: &[PathBuf],
        old_rels: &BTreeSet<String>,
    ) -> Result<()> {
        if old_rels.is_empty() {
            return Ok(());
        }
        let db = self.db()?;
        let mut referenced = db
            .prepare(
                "SELECT EXISTS(SELECT 1 FROM messages WHERE json_extract(data,'$.relPath')=?1)",
            )
            .map_err(err)?;
        for rel in old_rels {
            let still_used: bool = referenced.query_row([rel], |r| r.get(0)).map_err(err)?;
            if still_used {
                continue;
            }
            for root in roots {
                let path = root.join(rel);
                if path.exists() {
                    let _ = fs::remove_file(path);
                }
            }
        }
        Ok(())
    }

    fn prune_empty_archive_dirs(&self, roots: &[PathBuf]) {
        for root in roots {
            prune_empty_dirs(&root.join("archive"));
        }
    }

    fn mark_layout_version_3(&self) -> Result<()> {
        let mut prefs = self.preferences()?;
        prefs.archive_layout_version = 3;
        self.save_preferences(&prefs)
    }

    fn backup_before_layout_migration(&self) {
        let dir = self.root.join("backups");
        let path = dir.join("mail-before-archive-layout-v3.sqlite3");
        if path.exists() || fs::create_dir_all(&dir).is_err() {
            return;
        }
        let Ok(db) = self.db() else { return };
        let _ = db.execute("VACUUM INTO ?1", [path.to_string_lossy().as_ref()]);
    }
}

/// 旧 relPath 形如 archive/<邮箱>/<文件夹…>/<hash>.eml，取其中的文件夹部分。
fn previous_folder(rel: &str) -> Option<String> {
    let parts = rel.split('/').collect::<Vec<_>>();
    if parts.len() == 2 && parts[0] == "archive" && parts[1].ends_with(".eml") {
        return None; // 旧平面布局：只有 hash，用 sourceFolder 归属
    }
    if parts.len() >= 4 && parts[0] == "archive" {
        return Some(parts[2..parts.len() - 1].join("/"));
    }
    None
}

fn migrate_one(roots: &[PathBuf], job: &MoveJob) -> std::result::Result<(), String> {
    // 目标已存在：校验后直接改数据库（覆盖上次迁移中断的情况）。
    for root in roots {
        let target = root.join(&job.new_rel);
        if !target.exists() {
            continue;
        }
        let bytes = fs::read(&target).map_err(|e| format!("读取新存档失败：{e}"))?;
        if archive::digest(&bytes) != job.hash {
            return Err("新路径已有不同内容的文件，已保留原状".into());
        }
        return Ok(());
    }
    for root in roots {
        let from = root.join(&job.old_rel);
        if !from.exists() {
            continue;
        }
        let bytes = fs::read(&from).map_err(|e| format!("读取旧存档失败：{e}"))?;
        if archive::digest(&bytes) != job.hash {
            return Err("旧存档内容校验失败，已保留原状".into());
        }
        archive::atomic_write(&root.join(&job.new_rel), &bytes)?;
        return Ok(());
    }
    Err("存档不在本地，可能已归档到外置存档：请连接外置盘后重启重试".into())
}

fn prune_empty_dirs(dir: &Path) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        if entry.file_type().is_ok_and(|t| t.is_dir()) {
            prune_empty_dirs(&entry.path());
        }
    }
    let empty = fs::read_dir(dir)
        .map(|mut e| e.next().is_none())
        .unwrap_or(false);
    if empty {
        let _ = fs::remove_dir(dir);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::Mail;
    use crate::tests::{account, raw};

    fn legacy_fixture() -> (tempfile::TempDir, Store, Mail) {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path().into()).unwrap();
        let a = account();
        store.save_account(&a).unwrap();
        store.ingest(&a, "INBOX", "7:1", &raw(), false).unwrap();
        let mail = store.snapshot(&crate::tests::query()).unwrap().messages[0].clone();
        // 还原成旧布局：archive/<邮箱>/INBOX/<hash>.eml
        let new_rel = mail.rel_path.clone().unwrap();
        let old_rel = new_rel.replacen(
            &archive::account_dir(&a.id, &a.email),
            &archive::readable_dir(&a.email),
            1,
        );
        std::fs::create_dir_all(store.root.join(&old_rel).parent().unwrap()).unwrap();
        std::fs::rename(store.root.join(&new_rel), store.root.join(&old_rel)).unwrap();
        store
            .db()
            .unwrap()
            .execute(
                "UPDATE messages SET data=json_set(data,'$.relPath',?1) WHERE id=?2",
                params![old_rel, mail.id],
            )
            .unwrap();
        let mut prefs = store.preferences().unwrap();
        prefs.archive_layout_version = 1;
        store.save_preferences(&prefs).unwrap();
        let mail = store.mail(&mail.id).unwrap();
        (dir, store, mail)
    }

    #[test]
    fn migrates_legacy_email_layout_to_account_id_and_is_idempotent() {
        let (_dir, store, mail) = legacy_fixture();
        let old_rel = mail.rel_path.clone().unwrap();
        assert!(old_rel.contains(&archive::readable_dir("test@example.com")));
        let migrated = store.migrate_archive_layout().unwrap();
        assert_eq!(migrated, 1);
        let moved = store.mail(&mail.id).unwrap();
        let new_rel = moved.rel_path.unwrap();
        assert!(new_rel.contains(&archive::account_dir("test-account", "test@example.com")));
        assert!(store.root.join(&new_rel).exists());
        assert!(!store.root.join(&old_rel).exists());
        assert_eq!(store.preferences().unwrap().archive_layout_version, 3);
        assert_eq!(store.migrate_archive_layout().unwrap(), 0);
        assert_eq!(
            store.read_archive(Some(&new_rel), &moved.hash).unwrap(),
            raw()
        );
    }

    #[test]
    fn migrates_v2_id_layout_to_readable_segment_directory() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path().into()).unwrap();
        let a = account();
        store.save_account(&a).unwrap();
        store.ingest(&a, "INBOX", "7:1", &raw(), false).unwrap();
        let mail = store.snapshot(&crate::tests::query()).unwrap().messages[0].clone();
        let v3_rel = mail.rel_path.clone().unwrap();
        let v2_rel = v3_rel.replacen(&archive::account_dir(&a.id, &a.email), &a.id, 1);
        std::fs::create_dir_all(store.root.join(&v2_rel).parent().unwrap()).unwrap();
        std::fs::rename(store.root.join(&v3_rel), store.root.join(&v2_rel)).unwrap();
        store
            .db()
            .unwrap()
            .execute(
                "UPDATE messages SET data=json_set(data,'$.relPath',?1) WHERE id=?2",
                params![v2_rel, mail.id],
            )
            .unwrap();
        let mut prefs = store.preferences().unwrap();
        prefs.archive_layout_version = 2;
        store.save_preferences(&prefs).unwrap();
        assert_eq!(store.migrate_archive_layout().unwrap(), 1);
        let moved = store.mail(&mail.id).unwrap();
        let rel = moved.rel_path.unwrap();
        assert!(rel.starts_with(&format!(
            "archive/{}/",
            archive::account_dir(&a.id, &a.email)
        )));
        assert!(rel.contains("test@example.com__"));
        assert!(store.root.join(&rel).exists());
        assert_eq!(store.preferences().unwrap().archive_layout_version, 3);
    }

    #[test]
    fn same_email_segments_keep_independent_directories() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path().into()).unwrap();
        let a = account();
        let mut b = a.clone();
        b.id = "second-account".into();
        b.name = "Seg 2".into();
        store.save_account(&a).unwrap();
        store.save_account(&b).unwrap();
        store.ingest(&a, "INBOX", "7:1", &raw(), false).unwrap();
        store.ingest(&b, "INBOX", "7:1", &raw(), false).unwrap();
        let mails = store.snapshot(&crate::tests::query()).unwrap().messages;
        assert_eq!(mails.len(), 2);
        for mail in mails {
            let rel = mail.rel_path.unwrap();
            assert!(rel.starts_with(&format!(
                "archive/{}/",
                archive::account_dir(&mail.account_id, &mail.account_email)
            )));
            assert!(store.root.join(&rel).exists());
        }
    }

    #[test]
    fn missing_external_file_stays_pending_and_keeps_old_path() {
        let (dir, store, mail) = legacy_fixture();
        std::fs::remove_file(store.root.join(mail.rel_path.as_ref().unwrap())).unwrap();
        let migrated = store.migrate_archive_layout().unwrap();
        assert_eq!(migrated, 0);
        assert_eq!(store.mail(&mail.id).unwrap().rel_path, mail.rel_path);
        let pending: i64 = store
            .db()
            .unwrap()
            .query_row("SELECT COUNT(*) FROM archive_migrations", [], |r| r.get(0))
            .unwrap();
        assert_eq!(pending, 1);
        // 文件恢复后（模拟外置盘重新挂载）下次启动继续迁移。
        std::fs::create_dir_all(dir.path().join("noop")).unwrap();
        let old = mail.rel_path.unwrap();
        std::fs::create_dir_all(store.root.join(&old).parent().unwrap()).unwrap();
        std::fs::write(store.root.join(&old), raw()).unwrap();
        assert_eq!(store.migrate_archive_layout().unwrap(), 1);
        assert_eq!(pending_count(&store), 0);
    }

    fn pending_count(store: &Store) -> i64 {
        store
            .db()
            .unwrap()
            .query_row("SELECT COUNT(*) FROM archive_migrations", [], |r| r.get(0))
            .unwrap()
    }
}

#[cfg(test)]
mod migration_drill {
    /// 在真实数据的完整副本上演练迁移：
    /// ANSER_MIGRATION_DRILL=/tmp/anser-seg-drill cargo test migration_drill -- --ignored --nocapture
    #[test]
    #[ignore]
    fn drill_on_copied_data_root() {
        let root = std::env::var("ANSER_MIGRATION_DRILL").expect("需要 ANSER_MIGRATION_DRILL");
        let store = super::Store::new(root.into()).unwrap();
        let prefs = store.preferences().unwrap();
        assert_eq!(prefs.archive_layout_version, 3);
        let db = store.db().unwrap();
        let (saved, sources, pending): (i64, i64, i64) = db
            .query_row(
                "SELECT (SELECT COUNT(*) FROM messages WHERE COALESCE(json_extract(data,'$.savedLocally'),1)=1),
                        (SELECT COUNT(*) FROM sources),
                        (SELECT COUNT(*) FROM archive_migrations)",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        let rels = db
            .prepare("SELECT id, hash, COALESCE(json_extract(data,'$.relPath'),'') FROM messages WHERE COALESCE(json_extract(data,'$.savedLocally'),1)=1")
            .unwrap()
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                ))
            })
            .unwrap()
            .collect::<std::result::Result<Vec<_>, _>>()
            .unwrap();
        let mut unreadable = 0;
        let mut wrong_layout = 0;
        for (id, hash, rel) in &rels {
            if store.read_archive(Some(rel), hash).is_err() {
                unreadable += 1;
                eprintln!("不可读 {id} {rel}");
            }
            if !rel.starts_with("archive/") {
                wrong_layout += 1;
            }
        }
        eprintln!(
            "演练结果：存档 {saved}，来源 {sources}，待外置盘 {pending}，不可读 {unreadable}，异常路径 {wrong_layout}"
        );
        // 外置盘未挂载时，这些文件保持旧 relPath 并留在待迁移表里；
        // 挂载后下次启动会继续迁移。内置存档必须全部可读。
        assert_eq!(unreadable as i64, pending);
        assert_eq!(wrong_layout, 0);
    }
}
