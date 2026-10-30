use crate::{archive, models::*, network, store::Store};
use mailparse::MailHeaderMap;
use rusqlite::{params, OptionalExtension};

/// 账号收信起点（UTC）。接受 RFC3339 或 YYYY-MM-DD（按 UTC 零点）。
pub fn sync_cutoff(a: &Account) -> Option<chrono::DateTime<chrono::Utc>> {
    let raw = a.sync_since.as_deref()?.trim();
    if raw.is_empty() {
        return None;
    }
    chrono::DateTime::parse_from_rfc3339(raw)
        .map(|d| d.with_timezone(&chrono::Utc))
        .or_else(|_| {
            chrono::NaiveDate::parse_from_str(raw, "%Y-%m-%d")
                .map(|d| d.and_hms_opt(0, 0, 0).unwrap().and_utc())
        })
        .ok()
}

/// 邮件是否早于 sync_since。服务器 INTERNALDATE 优先，缺失时回退 Date 头；
/// 日期未知保守放行，避免漏收新邮件。
pub fn sync_since_skips(a: &Account, raw: &[u8], server_date: Option<&str>) -> bool {
    let Some(cutoff) = sync_cutoff(a) else {
        return false;
    };
    let date = server_date.and_then(archive::parse_date).or_else(|| {
        mailparse::parse_headers(raw)
            .ok()
            .and_then(|(headers, _)| headers.get_first_value("Date"))
            .and_then(|value| archive::parse_date(&value))
    });
    date.and_then(|date| chrono::DateTime::parse_from_rfc3339(&date).ok())
        .is_some_and(|date| date.with_timezone(&chrono::Utc) < cutoff)
}
/// Reuse prepared reads while receiving, without keeping a read transaction or
/// a snapshot across network requests. Account/retention/source edits remain
/// visible on the next check; writers never wait for this connection.
pub(crate) struct ReceiveLookup {
    db: rusqlite::Connection,
}
impl ReceiveLookup {
    pub fn new(store: &Store) -> Result<Self> {
        Ok(Self { db: store.db()? })
    }
    pub fn account(&self, id: &str) -> Result<Account> {
        let data: Option<String> = self
            .db
            .prepare_cached("SELECT data FROM accounts WHERE id=?1")
            .map_err(err)?
            .query_row([id], |r| r.get(0))
            .optional()
            .map_err(err)?;
        serde_json::from_str(&data.ok_or_else(|| "账号不存在".to_string())?).map_err(err)
    }
    pub fn source_available(&self, account: &Account, folder: &str, remote: &str) -> Result<bool> {
        let save = crate::retention::effective_save(&self.db, account, folder)?;
        let data: Option<String> = self.db.prepare_cached("SELECT m.data FROM sources s JOIN message_listing m ON m.id=s.mail_id AND m.account_id=s.account_id WHERE s.account_id=?1 AND s.folder=?2 AND s.remote_id=?3 AND NOT EXISTS(SELECT 1 FROM folder_health h WHERE h.account_id=s.account_id AND h.folder=s.folder)").map_err(err)?
            .query_row(params![account.id, folder, remote], |r| r.get(0)).optional().map_err(err)?;
        Ok(data
            .and_then(|s| serde_json::from_str::<Mail>(&s).ok())
            .is_some_and(|m| m.saved_locally || (!save && m.header_metadata_known)))
    }
}
impl Store {
    pub fn save_remote_folders(&self, account: &str, folders: &[RemoteFolder]) -> Result<()> {
        let mut db = self.db()?;
        let tx = db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(err)?;
        let mappings = read_mappings(&tx, account)?;
        tx.execute("DELETE FROM remote_folders WHERE account_id=?1", [account])
            .map_err(err)?;
        for folder in folders {
            let mut folder = folder.clone();
            normalize_folder(&mut folder);
            folder.detected_roles = Some(
                folder
                    .detected_roles
                    .clone()
                    .unwrap_or_else(|| folder.roles.clone()),
            );
            apply_mappings(&mut folder, &mappings);
            tx.execute(
                "INSERT INTO remote_folders VALUES(?1,?2,?3)",
                params![
                    account,
                    folder.name,
                    serde_json::to_string(&folder).map_err(err)?
                ],
            )
            .map_err(err)?;
        }
        tx.commit().map_err(err)
    }
    // Cached pre-role LIST results remain usable before a network connection.
    pub(crate) fn migrate_folder_roles(&self) -> Result<()> {
        let folders = self.remote_folders(None)?;
        let mut db = self.db()?;
        let tx = db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(err)?;
        for folder in folders {
            tx.execute(
                "UPDATE remote_folders SET data=?3 WHERE account_id=?1 AND name=?2",
                params![
                    folder.account_id,
                    folder.name,
                    serde_json::to_string(&folder).map_err(err)?
                ],
            )
            .map_err(err)?;
        }
        tx.commit().map_err(err)
    }
    pub fn remote_folders(&self, account: Option<&str>) -> Result<Vec<RemoteFolder>> {
        let db = self.db()?;
        self.remote_folders_in(&db, account)
    }
    /// After a confirmed server-side trash empty, retire local sources in that
    /// folder and purge records/archive files that have no other live copy.
    pub fn purge_empty_server_trash_locals(&self, account_id: &str, folder: &str) -> Result<u64> {
        let db = self.db()?;
        let ids = {
            let mut query = db
                .prepare(
                    "SELECT DISTINCT mail_id FROM sources
                     WHERE account_id=?1 AND folder=?2 COLLATE NOCASE AND active=1",
                )
                .map_err(err)?;
            let rows = query
                .query_map(rusqlite::params![account_id, folder], |row| row.get(0))
                .map_err(err)?;
            rows.collect::<std::result::Result<Vec<String>, _>>()
                .map_err(err)?
        };
        if ids.is_empty() {
            return Ok(0);
        }
        db.execute(
            "UPDATE sources SET active=0 WHERE account_id=?1 AND folder=?2 COLLATE NOCASE",
            rusqlite::params![account_id, folder],
        )
        .map_err(err)?;
        let mut purged = 0u64;
        for id in ids {
            let remaining: bool = db
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM sources WHERE mail_id=?1 AND active=1)",
                    [&id],
                    |row| row.get(0),
                )
                .map_err(err)?;
            if !remaining {
                self.purge_mail(&id)?;
                purged += 1;
            }
        }
        Ok(purged)
    }

    /// Deleted mail that the server trash empty cannot cover: local-only or
    /// offline copies flagged as trashed, and copies whose live source is still
    /// outside the trash folder.
    pub fn local_trash_count(&self, account_id: &str, folder: &str) -> Result<u64> {
        let db = self.db()?;
        db.query_row(
            "SELECT COUNT(*) FROM messages m
             WHERE m.account_id=?1 AND json_extract(m.data,'$.trashed')=1
               AND NOT EXISTS(SELECT 1 FROM sources s WHERE s.mail_id=m.id AND s.active=1 AND s.folder=?2 COLLATE NOCASE)",
            params![account_id, folder],
            |row| row.get(0),
        )
        .map_err(err)
    }
    /// Purge the account's locally deleted mail: local-only copies are erased
    /// at once, copies still live on the server are queued for permanent
    /// deletion so the clear also removes them.
    pub fn purge_local_trash_for_account(&self, account_id: &str, folder: &str) -> Result<u64> {
        let db = self.db()?;
        let mut query = db
            .prepare(
                "SELECT m.id FROM messages m
                 WHERE m.account_id=?1 AND json_extract(m.data,'$.trashed')=1
                   AND NOT EXISTS(SELECT 1 FROM sources s WHERE s.mail_id=m.id AND s.active=1 AND s.folder=?2 COLLATE NOCASE)",
            )
            .map_err(err)?;
        let rows = query
            .query_map(params![account_id, folder], |row| row.get::<_, String>(0))
            .map_err(err)?;
        let ids = rows
            .collect::<std::result::Result<Vec<String>, _>>()
            .map_err(err)?;
        drop(query);
        let mut cleared = 0u64;
        for id in ids {
            let live: bool = db
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM sources WHERE mail_id=?1 AND active=1)",
                    [&id],
                    |row| row.get(0),
                )
                .map_err(err)?;
            if live {
                let _ = self.change_mail(&id, "delete", "true");
            } else {
                self.purge_mail(&id)?;
            }
            cleared += 1;
        }
        Ok(cleared)
    }
    /// Validate that a cached IMAP folder is a server trash role before any
    /// destructive operation. The caller still performs UID-level deletion.
    pub fn server_trash_account(
        &self,
        account_id: &str,
        folder: &str,
    ) -> Result<crate::models::Account> {
        let account = self.account(account_id)?;
        if account.protocol != "imap" {
            return Err("POP3 不支持服务器废纸篓".into());
        }
        if account.read_only {
            return Err("只读分段不能清空服务器废纸篓".into());
        }
        let metadata = self
            .remote_folders(Some(account_id))?
            .into_iter()
            .find(|item| item.name == folder)
            .ok_or("服务器文件夹不存在，请刷新目录后重试")?;
        if !metadata.roles.contains(&crate::models::FolderRole::Trash) {
            return Err("该文件夹不是服务器废纸篓".into());
        }
        Ok(account)
    }

    pub(crate) fn remote_folders_in(
        &self,
        db: &rusqlite::Connection,
        account: Option<&str>,
    ) -> Result<Vec<RemoteFolder>> {
        let mut q = db.prepare("SELECT data FROM remote_folders WHERE ?1='' OR account_id=?1 ORDER BY name COLLATE NOCASE").map_err(err)?;
        let rows = q
            .query_map([account.unwrap_or("")], |r| r.get::<_, String>(0))
            .map_err(err)?
            .map(|r| {
                let mut folder: RemoteFolder =
                    serde_json::from_str(&r.map_err(err)?).map_err(err)?;
                folder.sync_error = db
                    .query_row(
                        "SELECT reason FROM folder_health WHERE account_id=?1 AND folder=?2",
                        rusqlite::params![folder.account_id, folder.name],
                        |r| r.get(0),
                    )
                    .optional()
                    .map_err(err)?;
                if folder.detected_roles.is_none() {
                    normalize_folder(&mut folder);
                    folder.detected_roles = Some(folder.roles.clone());
                }
                Ok(folder)
            })
            .collect();
        rows
    }
    pub fn folder_settings(&self, account: &str) -> Result<FolderSettings> {
        self.account(account)?;
        Ok(FolderSettings {
            folders: self.remote_folders(Some(account))?,
            mappings: read_mappings(&self.db()?, account)?,
        })
    }
    pub fn save_folder_mappings(&self, account: &str, mappings: &[FolderMapping]) -> Result<()> {
        let mut db = self.db()?;
        let tx = db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(err)?;
        let data: String = tx
            .query_row("SELECT data FROM accounts WHERE id=?1", [account], |r| {
                r.get(0)
            })
            .map_err(|_| "账号不存在".to_string())?;
        let a: Account = serde_json::from_str(&data).map_err(err)?;
        if a.protocol != "imap" {
            return Err("POP3 不支持服务器文件夹映射".into());
        }
        let mut statement = tx
            .prepare("SELECT data FROM remote_folders WHERE account_id=?1")
            .map_err(err)?;
        let mut folders = statement
            .query_map([account], |r| r.get::<_, String>(0))
            .map_err(err)?
            .map(|row| serde_json::from_str::<RemoteFolder>(&row.map_err(err)?).map_err(err))
            .collect::<Result<Vec<_>>>()?;
        drop(statement);
        let mut roles = Vec::new();
        let mut destinations = Vec::new();
        for mapping in mappings {
            if mapping.role == FolderRole::Inbox {
                return Err("收件箱由服务器定义，不能重新指定".into());
            }
            if roles.contains(&mapping.role) {
                return Err("同一用途只能设置一次".into());
            }
            roles.push(mapping.role);
            if let Some(name) = &mapping.folder {
                let folder = folders
                    .iter()
                    .find(|f| &f.name == name)
                    .ok_or("选择的服务器文件夹已不存在，请刷新目录")?;
                if !folder.selectable || self.folder_isolated_reason(account, name)?.is_some() {
                    return Err("该目录不能存放邮件，请选择子文件夹".into());
                }
                if folder.name.eq_ignore_ascii_case("INBOX")
                    || folder.roles.contains(&FolderRole::Inbox)
                {
                    return Err("不能将收件箱指定为其他特殊用途".into());
                }
                if destinations.contains(name) {
                    return Err("一个文件夹只能手动指定为一种用途".into());
                }
                destinations.push(name.clone());
            }
        }
        tx.execute("INSERT INTO folder_mappings VALUES(?1,?2) ON CONFLICT(account_id) DO UPDATE SET data=excluded.data", params![account, serde_json::to_string(mappings).map_err(err)?]).map_err(err)?;
        for folder in &mut folders {
            if folder.detected_roles.is_none() {
                folder.detected_roles = Some(folder.roles.clone());
            }
            apply_mappings(folder, mappings);
            tx.execute(
                "UPDATE remote_folders SET data=?3 WHERE account_id=?1 AND name=?2",
                params![
                    account,
                    folder.name,
                    serde_json::to_string(folder).map_err(err)?
                ],
            )
            .map_err(err)?;
        }
        tx.commit().map_err(err)
    }
    pub fn source(&self, id: &str) -> Result<(String, String)> {
        let db = self.db()?;
        let source=db.query_row("SELECT folder,remote_id FROM trusted_sources WHERE mail_id=?1 AND active=1 ORDER BY folder='INBOX' COLLATE NOCASE DESC LIMIT 1",[id],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(err)?;
        if let Some(source) = source {
            return Ok(source);
        }
        let isolated:bool=db.query_row("SELECT EXISTS(SELECT 1 FROM sources s JOIN folder_health h ON h.account_id=s.account_id AND h.folder=s.folder WHERE s.mail_id=?1 AND s.active=1)",[id],|r|r.get(0)).map_err(err)?;
        Err(if isolated {
            "这封邮件的服务器来源尚未通过核查，请重新收取真实文件夹后再打开"
        } else {
            "邮件已不在服务器上，且没有本地副本"
        }
        .into())
    }
    pub fn source_available(&self, a: &Account, folder: &str, remote: &str) -> Result<bool> {
        ReceiveLookup::new(self)?.source_available(a, folder, remote)
    }
    pub(crate) fn cached_flag_uids(
        &self,
        account: &Account,
        folder: &str,
        validity: u32,
    ) -> Result<std::collections::HashSet<u32>> {
        if self.folder_isolated_reason(&account.id, folder)?.is_some() {
            return Ok(Default::default());
        }
        let db = self.db()?;
        let mut stmt = db.prepare("SELECT s.remote_id FROM sources s JOIN message_listing m ON m.id=s.mail_id AND m.account_id=s.account_id WHERE s.account_id=?1 AND s.folder=?2 AND (?3=0 OR json_extract(m.data,'$.savedLocally')=1)").map_err(err)?;
        let rows = stmt
            .query_map(
                params![
                    account.id,
                    folder,
                    self.should_save_folder(account, folder)?
                ],
                |r| r.get::<_, String>(0),
            )
            .map_err(err)?;
        let mut uids = std::collections::HashSet::new();
        for row in rows {
            if let Some((Some(v), uid, None)) =
                crate::operations::remote_identity(&row.map_err(err)?)
            {
                if v == validity {
                    uids.insert(uid);
                }
            }
        }
        Ok(uids)
    }
    /// Merge observations without enqueueing a write back to the server. A
    /// single canonical active location controls flags on a deduplicated mail:
    /// INBOX first, then its original location, then a deterministic fallback.
    pub(crate) fn merge_remote_flags(
        &self,
        account: &Account,
        folder: &str,
        flags: &[(String, bool, bool)],
    ) -> Result<usize> {
        let mut db = self.db()?;
        let tx = db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(err)?;
        let current: Option<String> = tx
            .query_row(
                "SELECT data FROM accounts WHERE id=?1",
                [&account.id],
                |r| r.get(0),
            )
            .optional()
            .map_err(err)?;
        let Some(current) = current else {
            return Ok(0);
        };
        let current: Account = serde_json::from_str(&current).map_err(err)?;
        let identity = crate::operations::identity(account);
        if !current.enabled
            || current.protocol != "imap"
            || crate::operations::identity(&current) != identity
        {
            return Ok(0);
        }
        let mut changed = 0;
        let mut stmt = tx.prepare("WITH observed AS (SELECT m.id,json_set(data,
                '$.isRead',CASE WHEN json_extract(m.data,'$.localReadOverride') IS NOT NULL OR EXISTS(SELECT 1 FROM server_operations o WHERE o.account_id=?1 AND o.folder=?2 AND o.remote_id=?3 AND json_extract(o.data,'$.mailId')=m.id AND o.action='read' AND o.status IN ('queued','running','blocked') AND json_extract(o.data,'$.identity')=?6 AND json_extract(o.data,'$.value')=json_extract(m.data,'$.isRead')) THEN json(CASE json_extract(m.data,'$.isRead') WHEN 1 THEN 'true' ELSE 'false' END) ELSE json(?4) END,
                '$.starred',CASE WHEN json_extract(m.data,'$.localStarOverride') IS NOT NULL OR EXISTS(SELECT 1 FROM server_operations o WHERE o.account_id=?1 AND o.folder=?2 AND o.remote_id=?3 AND json_extract(o.data,'$.mailId')=m.id AND o.action='star' AND o.status IN ('queued','running','blocked') AND json_extract(o.data,'$.identity')=?6 AND json_extract(o.data,'$.value')=json_extract(m.data,'$.starred')) THEN json(CASE json_extract(m.data,'$.starred') WHEN 1 THEN 'true' ELSE 'false' END) ELSE json(?5) END) AS next_data
                FROM trusted_sources target JOIN messages m ON m.id=target.mail_id AND m.account_id=target.account_id WHERE target.account_id=?1 AND target.folder=?2 AND target.remote_id=?3 AND target.active=1
                AND ?2=(SELECT s.folder FROM trusted_sources s JOIN message_listing origin ON origin.id=s.mail_id WHERE s.account_id=?1 AND s.mail_id=m.id AND s.active=1 ORDER BY s.folder='INBOX' COLLATE NOCASE DESC,s.folder=json_extract(origin.data,'$.sourceFolder') DESC,s.folder COLLATE NOCASE,s.folder LIMIT 1))
                UPDATE messages SET data=(SELECT next_data FROM observed WHERE observed.id=messages.id) WHERE id IN (SELECT observed.id FROM observed JOIN messages original ON original.id=observed.id WHERE observed.next_data!=original.data)").map_err(err)?;
        for (remote, read, star) in flags {
            // Pending, running and rejected writes protect each flag separately.
            // Completed writes don't suppress later changes from other clients.
            // Only an intention for this exact current account/source applies.
            changed += stmt
                .execute(params![
                    account.id,
                    folder,
                    remote,
                    read.to_string(),
                    star.to_string(),
                    identity
                ])
                .map_err(err)?;
        }
        drop(stmt);
        tx.commit().map_err(err)?;
        Ok(changed)
    }
    pub fn unknown_dates(&self, account: &str, folder: &str) -> Result<Vec<String>> {
        let db = self.db()?;
        let mut q=db.prepare("SELECT s.remote_id FROM sources s JOIN message_listing m ON m.id=s.mail_id WHERE s.account_id=?1 AND s.folder=?2 AND s.active=1 AND json_extract(m.data,'$.date')=''").map_err(err)?;
        let rows = q
            .query_map(params![account, folder], |r| r.get(0))
            .map_err(err)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(err);
        rows
    }
    pub fn set_server_date(
        &self,
        account: &str,
        folder: &str,
        remote: &str,
        date: &str,
    ) -> Result<()> {
        let Some(date) = archive::parse_date(date).or_else(|| {
            chrono::DateTime::parse_from_rfc3339(date)
                .ok()
                .map(|d| d.to_rfc3339())
        }) else {
            return Ok(());
        };
        self.db()?.execute("UPDATE messages SET data=json_set(data,'$.serverDate',?4,'$.date',CASE WHEN json_extract(data,'$.date')='' THEN ?4 ELSE json_extract(data,'$.date') END) WHERE id IN (SELECT mail_id FROM sources WHERE account_id=?1 AND folder=?2 AND remote_id=?3)",params![account,folder,remote,date]).map_err(err)?;
        Ok(())
    }
    pub fn set_remote_metadata(
        &self,
        account: &str,
        folder: &str,
        remote: &str,
        size: Option<u32>,
        attachments: Option<bool>,
        cc: &str,
        priority: &str,
        sender_on_behalf_of: &str,
    ) -> Result<()> {
        self.db()?.execute("UPDATE messages SET data=json_set(data,'$.size',COALESCE(?4,json_extract(data,'$.size')),'$.hasAttachments',json(CASE COALESCE(?5,json_extract(data,'$.hasAttachments')) WHEN 1 THEN 'true' ELSE 'false' END),'$.attachmentMetadataKnown',json(CASE WHEN ?5 IS NOT NULL OR json_extract(data,'$.attachmentMetadataKnown')=1 THEN 'true' ELSE 'false' END),'$.cc',?6,'$.priority',?7,'$.senderOnBehalfOf',?8,'$.headerMetadataKnown',json('true')) WHERE id IN (SELECT mail_id FROM sources WHERE account_id=?1 AND folder=?2 AND remote_id=?3)",params![account,folder,remote,size,attachments,cc,priority,sender_on_behalf_of]).map_err(err)?;
        Ok(())
    }
    pub fn mail_metadata(&self, id: &str) -> Result<Mail> {
        let data: String = self
            .db()?
            .query_row("SELECT data FROM message_listing WHERE id=?1", [id], |r| {
                r.get(0)
            })
            .map_err(err)?;
        let mut mail: Mail = serde_json::from_str(&data).map_err(err)?;
        let (root, count) = self.conversation_membership(id, mail.trashed)?;
        mail.conversation_id = root;
        mail.conversation_count = count as usize;
        Ok(mail)
    }
    pub fn message_raw(&self, mail: &Mail) -> Result<Vec<u8>> {
        let _archive = self.archive_gate.read().map_err(err)?;
        let current = self.mail(&mail.id)?;
        let mail = &current;
        if mail.saved_locally {
            self.read_archive(mail.rel_path.as_deref(), &mail.hash)
        } else {
            network::read_remote(self, &self.account(&mail.account_id)?, mail)
        }
    }
}

fn read_mappings(db: &rusqlite::Connection, account: &str) -> Result<Vec<FolderMapping>> {
    let data: Option<String> = db
        .query_row(
            "SELECT data FROM folder_mappings WHERE account_id=?1",
            [account],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?;
    data.map(|s| serde_json::from_str(&s).map_err(err))
        .unwrap_or_else(|| Ok(Vec::new()))
}
fn apply_mappings(folder: &mut RemoteFolder, mappings: &[FolderMapping]) {
    folder.roles = folder
        .detected_roles
        .clone()
        .unwrap_or_else(|| folder.roles.clone());
    // Explicit destinations override discovery on that folder. Unassigned roles
    // stay as discovered elsewhere; a missing destination never silently falls back.
    folder
        .roles
        .retain(|role| !mappings.iter().any(|m| &m.role == role));
    if let Some(mapping) = mappings
        .iter()
        .find(|m| m.folder.as_deref() == Some(&folder.name))
    {
        folder.roles = vec![mapping.role];
    }
    normalize_folder(folder);
}

// RFC 6154 roles are authoritative. Exact conventional names are a fallback
// for servers without SPECIAL-USE; never classify by a substring of a user path.
pub fn folder_roles<'a>(
    name: &str,
    delimiter: Option<&str>,
    attributes: impl IntoIterator<Item = &'a str>,
) -> Vec<FolderRole> {
    let mut roles = Vec::new();
    if name.eq_ignore_ascii_case("INBOX") {
        roles.push(FolderRole::Inbox);
    }
    for attr in attributes {
        let role = match attr.to_ascii_lowercase().as_str() {
            "\\sent" => FolderRole::Sent,
            "\\drafts" => FolderRole::Drafts,
            "\\trash" => FolderRole::Trash,
            "\\junk" | "\\spam" => FolderRole::Junk,
            "\\archive" => FolderRole::Archive,
            "\\all" | "\\allmail" => FolderRole::All,
            "\\flagged" | "\\starred" => FolderRole::Flagged,
            _ => continue,
        };
        if !roles.contains(&role) {
            roles.push(role);
        }
    }
    if !roles.is_empty() {
        return roles;
    }
    let decoded = display_name(name);
    let (parent, leaf) = delimiter
        .and_then(|d| decoded.rsplit_once(d))
        .unwrap_or(("", &decoded));
    if !["", "inbox", "[gmail]", "[googlemail]"].contains(&parent.to_ascii_lowercase().as_str()) {
        return roles;
    }
    let role = match leaf.to_lowercase().as_str() {
        "inbox" | "收件箱" => FolderRole::Inbox,
        "sent" | "sent messages" | "sent items" | "sent mail" | "已发送" | "已发送邮件" => {
            FolderRole::Sent
        }
        "drafts" | "draft" | "草稿" | "草稿箱" => FolderRole::Drafts,
        "trash" | "deleted messages" | "deleted items" | "已删除" | "已删除邮件" | "废纸篓" => {
            FolderRole::Trash
        }
        "junk" | "junk email" | "spam" | "垃圾邮件" | "垃圾箱" => FolderRole::Junk,
        "archive" | "archives" | "归档" | "存档" => FolderRole::Archive,
        "all mail" | "所有邮件" => FolderRole::All,
        "starred" | "星标邮件" => FolderRole::Flagged,
        _ => return roles,
    };
    roles.push(role);
    roles
}
pub fn listed_folder(account: &str, name: &imap::types::Name) -> RemoteFolder {
    let mut folder = RemoteFolder {
        account_id: account.into(),
        detected_roles: None,
        sync_error: None,
        name: name.name().into(),
        display_name: display_name(name.name()),
        delimiter: name.delimiter().map(str::to_string),
        selectable: !name
            .attributes()
            .contains(&imap::types::NameAttribute::NoSelect),
        roles: folder_roles(
            name.name(),
            name.delimiter(),
            name.attributes().iter().filter_map(|a| {
                if let imap::types::NameAttribute::Custom(value) = a {
                    Some(value.as_ref())
                } else {
                    None
                }
            }),
        ),
    };
    normalize_folder(&mut folder);
    folder
}
pub(crate) fn normalize_folder(folder: &mut RemoteFolder) {
    folder.display_name = display_name(&folder.name);
    if folder.roles.is_empty() && folder.detected_roles.is_none() {
        folder.roles = folder_roles(&folder.name, folder.delimiter.as_deref(), []);
    }
    let label = match folder.roles.first() {
        Some(FolderRole::Inbox) => "收件箱",
        Some(FolderRole::Sent) => "已发送",
        Some(FolderRole::Drafts) => "草稿箱",
        Some(FolderRole::Trash) => "已删除",
        Some(FolderRole::Junk) => "垃圾邮件",
        Some(FolderRole::Archive) => "归档",
        Some(FolderRole::All) => "所有邮件",
        Some(FolderRole::Flagged) => "星标邮件",
        None => return,
    };
    let decoded = display_name(&folder.name);
    folder.display_name = if let Some((parent, _)) = folder
        .delimiter
        .as_deref()
        .and_then(|d| decoded.rsplit_once(d))
    {
        format!("{parent}{}{label}", folder.delimiter.as_deref().unwrap())
    } else {
        label.into()
    };
}
pub fn excluded_from_auto_sync(folder: &RemoteFolder) -> bool {
    folder
        .roles
        .iter()
        .any(|role| matches!(role, FolderRole::Trash | FolderRole::Junk))
}
// IMAP modified UTF-7 is a wire name; never pass a decoded display name back
// to SELECT. Retain exact wire names in queries and source tracking.
/// 把用户输入的文件夹名编码为 IMAP modified UTF-7（中文 → &base64-）。
pub fn encode_folder_name(name: &str) -> String {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let name = name.trim();
    if name.is_empty() {
        return String::new();
    }
    let needs_encoding = name
        .chars()
        .any(|c| !c.is_ascii() || c == '&' || (c as u32) < 0x20 || (c as u32) == 0x7f);
    if !needs_encoding {
        return name.to_string();
    }
    let mut out = String::new();
    let mut buf: Vec<u16> = Vec::new();
    let flush = |out: &mut String, buf: &mut Vec<u16>| {
        if buf.is_empty() {
            return;
        }
        let bytes: Vec<u8> = buf.iter().flat_map(|u| u.to_be_bytes()).collect();
        let mut encoded = STANDARD.encode(&bytes).replace('/', ",");
        while encoded.len() % 4 != 0 {
            encoded.push('=');
        }
        out.push('&');
        out.push_str(&encoded);
        out.push('-');
        buf.clear();
    };
    for c in name.chars() {
        if c == '&' {
            flush(&mut out, &mut buf);
            out.push_str("&-");
        } else if c.is_ascii() && (c as u32) >= 0x20 && (c as u32) != 0x7f {
            flush(&mut out, &mut buf);
            out.push(c);
        } else {
            let mut tmp = [0u16; 2];
            for u in c.encode_utf16(&mut tmp) {
                buf.push(*u);
            }
        }
    }
    flush(&mut out, &mut buf);
    out
}

pub fn display_name(name: &str) -> String {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let mut out = String::new();
    let mut tail = name;
    while let Some(i) = tail.find('&') {
        out.push_str(&tail[..i]);
        tail = &tail[i + 1..];
        let Some(end) = tail.find('-') else {
            out.push('&');
            out.push_str(tail);
            return out;
        };
        let token = &tail[..end];
        if token.is_empty() {
            out.push('&');
        } else {
            let mut encoded = token.replace(',', "/");
            while encoded.len() % 4 != 0 {
                encoded.push('=');
            }
            let decoded = STANDARD
                .decode(encoded)
                .ok()
                .filter(|b| b.len() % 2 == 0)
                .and_then(|b| {
                    String::from_utf16(
                        &b.chunks_exact(2)
                            .map(|p| u16::from_be_bytes([p[0], p[1]]))
                            .collect::<Vec<_>>(),
                    )
                    .ok()
                });
            out.push_str(&decoded.unwrap_or_else(|| format!("&{token}-")));
        }
        tail = &tail[end + 1..];
    }
    out.push_str(tail);
    if out.eq_ignore_ascii_case("INBOX") {
        "收件箱".into()
    } else {
        out
    }
}

// Render folder names in activity/error text once at the display boundary.
// Keep stored diagnostics and protocol paths intact, including older logs.
pub fn display_activity(message: &str) -> String {
    const PREFIX: &str = "文件夹「";
    let mut out = String::with_capacity(message.len());
    let mut tail = message;
    while let Some(start) = tail.find(PREFIX) {
        let name_start = start + PREFIX.len();
        let Some(end) = tail[name_start..].find('」') else {
            break;
        };
        out.push_str(&tail[..name_start]);
        out.push_str(&display_name(&tail[name_start..name_start + end]));
        out.push('」');
        tail = &tail[name_start + end + '」'.len_utf8()..];
    }
    out.push_str(tail);
    out
}

#[cfg(test)]
mod folder_tests {
    use super::*;
    #[test]
    fn authoritative_roles_override_names_and_preserve_multiple_uses() {
        assert_eq!(
            folder_roles("Trash", Some("/"), ["\\Sent"]),
            vec![FolderRole::Sent]
        );
        assert_eq!(
            folder_roles("Custom", Some("/"), ["\\All", "\\Archive", "\\ALL"]),
            vec![FolderRole::All, FolderRole::Archive]
        );
        assert_eq!(
            folder_roles("INBOX", Some("/"), []),
            vec![FolderRole::Inbox]
        );
        assert_eq!(
            folder_roles("Important", None, ["\\Flagged"]),
            vec![FolderRole::Flagged]
        );
    }
    #[test]
    fn aliases_are_exact_and_do_not_skip_personal_folders() {
        for name in ["Sent Messages", "Sent Items", "INBOX.Sent"] {
            assert_eq!(folder_roles(name, Some("."), []), vec![FolderRole::Sent]);
        }
        assert_eq!(
            folder_roles("[Gmail]/Sent Mail", Some("/"), ["\\Sent"]),
            vec![FolderRole::Sent]
        );
        assert_eq!(
            folder_roles("[GoogleMail]/All Mail", Some("/"), []),
            vec![FolderRole::All]
        );
        assert_eq!(folder_roles("&UXZO1mWHTvZZOQ-", Some("/"), []), vec![]);
        for name in [
            "My Spam Research",
            "Work/Sent",
            "Team/Trash",
            "Deleted Reports",
            "literal/Sent",
        ] {
            assert!(folder_roles(name, Some("/"), []).is_empty());
        }
        assert!(folder_roles("literal/Sent", None, []).is_empty());
    }
    #[test]
    fn cache_migration_keeps_wire_names_and_role_labels_keep_hierarchy() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path().into()).unwrap();
        store.db().unwrap().execute("INSERT INTO remote_folders VALUES('a','INBOX.Sent Items',?1)", [r#"{"accountId":"a","name":"INBOX.Sent Items","displayName":"INBOX.Sent Items","delimiter":".","selectable":true}"#]).unwrap();
        drop(store);
        let reopened = Store::new(dir.path().into()).unwrap();
        let folder = &reopened.remote_folders(None).unwrap()[0];
        assert_eq!(folder.name, "INBOX.Sent Items");
        assert_eq!(folder.display_name, "INBOX.已发送");
        assert_eq!(folder.roles, vec![FolderRole::Sent]);
        let json: String = reopened
            .db()
            .unwrap()
            .query_row("SELECT data FROM remote_folders", [], |r| r.get(0))
            .unwrap();
        assert!(json.contains("\"sent\""));
    }
    #[test]
    fn trash_and_junk_are_excluded_by_role_but_all_mail_is_not_an_archive_target() {
        let mut folder = RemoteFolder {
            account_id: "a".into(),
            detected_roles: None,
            name: "VendorCustom".into(),
            display_name: "VendorCustom".into(),
            delimiter: None,
            selectable: true,
            sync_error: None,
            roles: vec![FolderRole::Trash],
        };
        assert!(excluded_from_auto_sync(&folder));
        folder.roles = vec![FolderRole::Junk];
        assert!(excluded_from_auto_sync(&folder));
        folder.roles = vec![FolderRole::All];
        assert!(!excluded_from_auto_sync(&folder));
        assert!(!folder.roles.contains(&FolderRole::Archive));
    }
}

#[cfg(test)]
mod sync_since_tests {
    use super::*;

    fn account_since(since: &str) -> Account {
        let mut a = crate::tests::account();
        a.sync_since = Some(since.into());
        a
    }

    #[test]
    fn cutoff_accepts_rfc3339_and_date_only() {
        let a = account_since("2026-09-30");
        assert!(sync_cutoff(&a).is_some());
        let a = account_since("2026-09-30T08:00:00+08:00");
        assert_eq!(
            sync_cutoff(&a).unwrap().to_rfc3339(),
            "2026-09-30T00:00:00+00:00"
        );
        let a = account_since("not-a-date");
        assert!(sync_cutoff(&a).is_none());
    }

    #[test]
    fn old_mail_is_skipped_but_unknown_dates_pass() {
        let raw = crate::tests::raw(); // Date: Tue, 29 Sep 2026 10:00:00 +0800
        assert!(sync_since_skips(&account_since("2026-09-30"), &raw, None));
        assert!(!sync_since_skips(&account_since("2026-09-01"), &raw, None));
        let no_date = b"From: a@example.com\r\nSubject: x\r\n\r\nbody".to_vec();
        assert!(!sync_since_skips(
            &account_since("2026-09-30"),
            &no_date,
            None
        ));
    }

    #[test]
    fn server_internal_date_wins_over_header_date() {
        let raw = crate::tests::raw();
        let a = account_since("2026-09-30");
        // 邮件头日期在起点前，但服务器内部日期在起点后：应保留。
        assert!(!sync_since_skips(
            &a,
            &raw,
            Some("01-Oct-2026 10:00:00 +0800")
        ));
        assert!(sync_since_skips(
            &a,
            &raw,
            Some("28-Sep-2026 10:00:00 +0800")
        ));
    }
}
