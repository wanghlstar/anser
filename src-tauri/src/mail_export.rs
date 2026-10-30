use crate::{
    archive,
    models::{Mail, Result},
    store::Store,
};
use std::{
    collections::{BTreeSet, HashSet},
    path::{Path, PathBuf},
};

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub exported: u64,
    pub skipped: u64,
    pub errors: Vec<String>,
}

impl Store {
    pub fn export_mails(
        &self,
        ids: &[String],
        conversations: bool,
        folders: bool,
        directory: &str,
    ) -> Result<ExportResult> {
        if ids.is_empty() || ids.len() > 5000 {
            return Err("请选择 1–5000 封邮件".into());
        }
        let directory = Path::new(directory);
        if !directory.is_dir() {
            return Err("请选择有效的导出目录".into());
        }
        let mut chosen = BTreeSet::new();
        for id in ids {
            if conversations {
                for mail in self.conversation(id)? {
                    chosen.insert(mail.id);
                }
            } else {
                chosen.insert(id.clone());
            }
        }
        if chosen.len() > 5000 {
            return Err("一次最多导出 5000 封邮件".into());
        }
        self.export_chosen(chosen, folders, directory)
    }

    pub fn export_all_mails(&self, folders: bool, directory: &str) -> Result<ExportResult> {
        let directory = Path::new(directory);
        if !directory.is_dir() {
            return Err("请选择有效的导出目录".into());
        }
        let db = self.db()?;
        let mut st = db
            .prepare(
                "SELECT id FROM messages WHERE COALESCE(json_extract(data,'$.savedLocally'),1)=1",
            )
            .map_err(|e| e.to_string())?;
        let ids = st
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        if ids.is_empty() {
            return Ok(ExportResult {
                exported: 0,
                skipped: 0,
                errors: Vec::new(),
            });
        }
        if ids.len() > 50_000 {
            return Err("本地存档超过 50000 封，请分批导出".into());
        }
        self.export_chosen(ids.into_iter().collect(), folders, directory)
    }

    fn export_chosen(
        &self,
        chosen: BTreeSet<String>,
        folders: bool,
        directory: &Path,
    ) -> Result<ExportResult> {
        let mut exported = 0u64;
        let mut skipped = 0u64;
        let mut errors = Vec::new();
        let mut seen = HashSet::new();
        for id in chosen {
            let mail = match self.mail(&id) {
                Ok(mail) => mail,
                Err(e) => {
                    errors.push(format!("{id}：{e}"));
                    continue;
                }
            };
            let raw = match self.message_raw(&mail) {
                Ok(raw) => raw,
                Err(e) => {
                    errors.push(format!("{}：{e}", display(&mail)));
                    continue;
                }
            };
            // 同一账号内同一 MIME 只导出一次；不同账号各自保留一份。
            if !seen.insert((mail.account_id.clone(), mail.hash.clone())) {
                skipped += 1;
                continue;
            }
            let target = if folders {
                archive_dir(directory, &mail)
            } else {
                directory.to_path_buf()
            };
            if let Err(e) = std::fs::create_dir_all(&target) {
                errors.push(format!("{}：{e}", display(&mail)));
                continue;
            }
            let name = file_name(&mail);
            let mut path = target.join(&name);
            // 按文件夹导出时，重复导出到同一目录应保持幂等；扁平导出仍按
            // 不同账号各留一份，所以冲突时继续生成 -2 文件名。
            if path.exists() {
                if folders
                    && std::fs::read(&path)
                        .map(|bytes| archive::digest(&bytes) == mail.hash)
                        .unwrap_or(false)
                {
                    skipped += 1;
                    continue;
                }
                path = unique_path(&target, &name, &mail.hash);
            }
            match archive::atomic_write(&path, &raw) {
                Ok(()) => exported += 1,
                Err(e) => errors.push(format!("{}：{e}", display(&mail))),
            }
        }
        Ok(ExportResult {
            exported,
            skipped,
            errors,
        })
    }
}

fn display(mail: &Mail) -> &str {
    if mail.subject.is_empty() {
        "（无主题）"
    } else {
        &mail.subject
    }
}

fn archive_dir(root: &Path, mail: &Mail) -> PathBuf {
    let account = if mail.account_email.is_empty() {
        "unknown"
    } else {
        &mail.account_email
    };
    if let Some(folder) = rel_folder(mail) {
        return root.join(archive::readable_dir(account)).join(folder);
    }
    let folder = if mail.source_folder.is_empty() {
        "未分类".to_string()
    } else {
        archive::decode_utf7_modified(&mail.source_folder)
    };
    root.join(archive::readable_dir(account)).join(folder)
}

/// relPath 形如 archive/<账号 key>/<文件夹…>/<hash>.eml；导出时用邮箱作为
/// 可读目录名，所以只取路径里的文件夹部分。
fn rel_folder(mail: &Mail) -> Option<String> {
    let rest = mail.rel_path.as_deref()?.strip_prefix("archive/")?;
    let (_, tail) = rest.split_once('/')?;
    let (folder, name) = tail.rsplit_once('/')?;
    if folder.is_empty()
        || folder.starts_with('/')
        || folder.split('/').any(|part| part == "..")
        || !name.ends_with(".eml")
    {
        return None;
    }
    Some(folder.to_string())
}

fn file_name(mail: &Mail) -> String {
    let subject = sanitize(&mail.subject);
    if subject.is_empty() {
        format!("邮件-{}.eml", short_hash(&mail.hash))
    } else {
        format!("{subject}.eml")
    }
}

fn short_hash(hash: &str) -> String {
    if hash.is_empty() {
        "mail".into()
    } else {
        hash.chars().take(8).collect()
    }
}

fn sanitize(value: &str) -> String {
    let mut out = String::new();
    for ch in value.chars() {
        if ch.is_control() || matches!(ch, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') {
            out.push('-');
        } else {
            out.push(ch);
        }
    }
    out.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim_matches(|c: char| c == '.' || c == ' ' || c == '-')
        .chars()
        .take(80)
        .collect()
}

fn unique_path(directory: &Path, name: &str, hash: &str) -> PathBuf {
    let path = directory.join(name);
    if !path.exists() {
        return path;
    }
    let stem = name.strip_suffix(".eml").unwrap_or(name);
    for n in 2..1000 {
        let candidate = directory.join(format!("{stem}-{n}.eml"));
        if !candidate.exists() {
            return candidate;
        }
    }
    directory.join(format!("{stem}-{}.eml", short_hash(hash)))
}
