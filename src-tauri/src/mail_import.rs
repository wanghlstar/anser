use crate::{
    archive, eml_input, mail_formats,
    models::{err, Result},
    store::Store,
};
use chrono::Utc;
use rusqlite::params;
use std::collections::HashSet;

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportProgress {
    pub done: u64,
    pub total: u64,
}
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub imported: u64,
    pub skipped: u64,
    pub errors: Vec<String>,
}

impl Store {
    pub fn import_emls(
        &self,
        account_id: &str,
        paths: &[String],
        folder: Option<&str>,
        progress: &impl Fn(ImportProgress),
    ) -> Result<ImportResult> {
        if paths.is_empty() || paths.len() > 2000 {
            return Err("请选择 1–2000 个邮件文件".into());
        }
        let mut items = Vec::with_capacity(paths.len());
        let mut errors = Vec::new();
        for path in paths {
            let file = std::path::Path::new(path);
            let extension = mail_formats::extension(file);
            let raw = if extension == "emlx" || extension == "msg" {
                eml_input::read(file, None)
                    .and_then(|raw| mail_formats::mime(&raw).map(|mime| mime.into_owned()))
                    .map_err(|error| format!("{path}：{error}"))
            } else if extension == "eml" {
                std::fs::read(file).map_err(|error| format!("{path}：{error}"))
            } else {
                Err(format!("{path}：不支持的文件格式，请选择 EML、EMLX 或 MSG"))
            };
            match raw {
                Ok(raw) => items.push((path.clone(), raw)),
                Err(error) => errors.push(error),
            }
        }
        let folder = folder
            .map(str::trim)
            .filter(|folder| !folder.is_empty())
            .unwrap_or("本地导入");
        let mut result = self.import_raws(account_id, folder, items, progress)?;
        errors.extend(result.errors);
        result.errors = errors;
        Ok(result)
    }

    /// 导入 mbox / mboxrd：拆成单封邮件后按 hash 去重，复用 EML 导入路径。
    pub fn import_mbox(
        &self,
        account_id: &str,
        path: &str,
        folder: Option<&str>,
        progress: &impl Fn(ImportProgress),
    ) -> Result<ImportResult> {
        let data = std::fs::read(path).map_err(|e| format!("{path}：{e}"))?;
        if data.is_empty() {
            return Err("mbox 文件为空".into());
        }
        let folder = folder
            .map(str::trim)
            .filter(|folder| !folder.is_empty())
            .unwrap_or("本地导入")
            .to_string();
        let messages = split_mboxrd(&data);
        if messages.is_empty() {
            return Err("未在 mbox 文件中找到邮件".into());
        }
        let items = messages
            .into_iter()
            .enumerate()
            .map(|(index, raw)| (format!("{path} 第 {} 封", index + 1), raw))
            .collect::<Vec<_>>();
        self.import_raws(account_id, &folder, items, progress)
    }

    fn import_raws(
        &self,
        account_id: &str,
        folder: &str,
        items: Vec<(String, Vec<u8>)>,
        progress: &impl Fn(ImportProgress),
    ) -> Result<ImportResult> {
        let account = self.account(account_id)?;
        let _archive = self.archive_gate.read().map_err(|e| e.to_string())?;
        let import_root = self.import_root()?;
        let mut db = self.db()?;
        let tx = db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(err)?;
        let mut imported = 0u64;
        let mut skipped = 0u64;
        let mut errors = Vec::new();
        let mut seen = HashSet::new();
        let total = items.len() as u64;
        let mut done = 0u64;
        for (label, raw) in items {
            let hash = archive::digest(&raw);
            if !seen.insert(hash.clone()) {
                skipped += 1;
                done += 1;
                progress(ImportProgress { done, total });
                continue;
            }
            let exists: bool = tx
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM messages WHERE account_id=?1 AND hash=?2)",
                    params![account.id, hash],
                    |r| r.get(0),
                )
                .map_err(err)?;
            if exists {
                skipped += 1;
                done += 1;
                progress(ImportProgress { done, total });
                continue;
            }
            let (mut mail, _, _) = match archive::parse(&raw, &account, folder) {
                Ok(parsed) => parsed,
                Err(e) => {
                    errors.push(format!("{label}：{e}"));
                    done += 1;
                    progress(ImportProgress { done, total });
                    continue;
                }
            };
            mail.id = uuid::Uuid::new_v4().to_string();
            mail.account_id = account.id.clone();
            mail.account_email = account.email.clone();
            mail.hash = hash;
            mail.size = raw.len() as u64;
            mail.saved_at = Utc::now().to_rfc3339();
            mail.saved_locally = true;
            mail.source_folder = folder.into();
            mail.is_read = true;
            mail.trashed = false;
            mail.rel_path = match archive::store_raw(
                &import_root,
                &mail.account_id,
                &mail.account_email,
                folder,
                &raw,
            ) {
                Ok(path) => Some(path),
                Err(e) => {
                    errors.push(format!("{label}：{e}"));
                    done += 1;
                    progress(ImportProgress { done, total });
                    continue;
                }
            };
            tx.execute(
                "INSERT INTO messages(id,account_id,hash,data,parser_version) VALUES(?1,?2,?3,?4,?5)",
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
                "INSERT INTO sources(account_id,folder,remote_id,mail_id,active) VALUES(?1,?2,?3,?4,0)",
                params![
                    mail.account_id,
                    folder,
                    format!("local:{}", mail.id),
                    mail.id
                ],
            )
            .map_err(err)?;
            imported += 1;
            done += 1;
            progress(ImportProgress { done, total });
        }
        tx.commit().map_err(err)?;
        if imported > 0 {
            self.log(&format!("导入 {imported} 封邮件到「{folder}」"))?;
        }
        Ok(ImportResult {
            imported,
            skipped,
            errors,
        })
    }
}

/// 按 mboxrd 规则拆分：行首的 `From ` 是消息分隔符，正文里的 `>From `
/// 去掉一个 `>`；保留原始行结束符。
fn split_mboxrd(data: &[u8]) -> Vec<Vec<u8>> {
    let mut messages = Vec::new();
    let mut current: Option<Vec<u8>> = None;
    for line in data.split_inclusive(|byte| *byte == b'\n') {
        let is_separator = line.starts_with(b"From ");
        if is_separator {
            if let Some(message) = current.take() {
                if !message.is_empty() {
                    messages.push(message);
                }
            }
            current = Some(Vec::new());
            continue;
        }
        let Some(message) = current.as_mut() else {
            continue; // 文件开头在第一个分隔符之前的说明文字
        };
        if line.starts_with(b">From ") {
            message.extend_from_slice(&line[1..]);
        } else {
            message.extend_from_slice(line);
        }
    }
    if let Some(message) = current {
        if !message.is_empty() {
            messages.push(message);
        }
    }
    messages
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tests::{account, raw, raw2};

    #[test]
    fn mboxrd_splits_and_unescapes_messages() {
        let first = String::from_utf8(raw()).unwrap();
        let second = String::from_utf8(raw2()).unwrap();
        let mbox = format!(
            "From alice@example.com Mon Sep 28 10:00:00 2026\n{first}\n>From escaped line\nFrom bob@example.com Tue Sep 29 11:00:00 2026\n{second}"
        );
        let messages = split_mboxrd(mbox.as_bytes());
        assert_eq!(messages.len(), 2);
        assert!(messages[0].starts_with(&raw()));
        assert!(messages[0].ends_with(b"From escaped line\n"));
        assert!(
            messages[1].ends_with(b"Another body.\n")
                || messages[1].ends_with(b"Another body.\r\n")
        );
    }

    #[test]
    fn emlx_import_projects_mime_and_keeps_local_import_folder() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path().into()).unwrap();
        let a = account();
        store.save_account(&a).unwrap();
        let message = raw();
        let mut emlx = format!("{}\n", message.len()).into_bytes();
        emlx.extend_from_slice(&message);
        emlx.extend_from_slice(b"\n<plist>flags</plist>");
        let path = dir.path().join("sample.emlx");
        std::fs::write(&path, emlx).unwrap();
        let result = store
            .import_emls(&a.id, &[path.to_string_lossy().into_owned()], None, &|_| {})
            .unwrap();
        assert_eq!(result.imported, 1);
        let mails = store.snapshot(&crate::tests::query()).unwrap().messages;
        assert_eq!(mails.len(), 1);
        assert_eq!(mails[0].source_folder, "本地导入");
        assert!(mails[0].rel_path.as_deref().unwrap().contains("本地导入"));
    }

    #[test]
    fn mbox_import_dedupes_and_writes_local_folder() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path().into()).unwrap();
        let a = account();
        store.save_account(&a).unwrap();
        let path = dir.path().join("mail.mbox");
        let first = String::from_utf8(raw()).unwrap();
        let second = String::from_utf8(raw2()).unwrap();
        std::fs::write(
            &path,
            format!("From a@example.com Mon Sep 28 10:00:00 2026\n{first}\nFrom b@example.com Tue Sep 29 11:00:00 2026\n{second}"),
        )
        .unwrap();
        let result = store
            .import_mbox(&a.id, path.to_str().unwrap(), None, &|_| {})
            .unwrap();
        assert_eq!((result.imported, result.skipped), (2, 0));
        let again = store
            .import_mbox(&a.id, path.to_str().unwrap(), None, &|_| {})
            .unwrap();
        assert_eq!((again.imported, again.skipped), (0, 2));
        let mails = store.snapshot(&crate::tests::query()).unwrap().messages;
        assert_eq!(mails.len(), 2);
        assert!(mails.iter().all(|m| m.source_folder == "本地导入"));
        assert!(mails
            .iter()
            .all(|m| m.rel_path.as_deref().unwrap().contains("本地导入")));
    }
}
