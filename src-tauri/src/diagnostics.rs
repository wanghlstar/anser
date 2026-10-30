use crate::{
    archive, auth,
    models::{err, Account, Mail, Result},
    store::Store,
};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticItem {
    pub label: String,
    pub status: String,
    pub detail: String,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticReport {
    pub generated_at: String,
    pub items: Vec<DiagnosticItem>,
}

fn item(items: &mut Vec<DiagnosticItem>, label: &str, status: &str, detail: impl Into<String>) {
    items.push(DiagnosticItem {
        label: label.into(),
        status: status.into(),
        detail: detail.into(),
    });
}

/// 只读诊断：不修改账号、不发送邮件，也不删除任何服务器或本地邮件。
pub fn run(store: &Store, account_id: Option<&str>) -> Result<DiagnosticReport> {
    let mut items = Vec::new();
    let db = store.db()?;
    let integrity: String = db
        .query_row("PRAGMA quick_check", [], |r| r.get(0))
        .map_err(err)?;
    item(
        &mut items,
        "数据库",
        if integrity == "ok" { "pass" } else { "fail" },
        if integrity == "ok" {
            "SQLite quick_check 通过".into()
        } else {
            integrity
        },
    );

    let (messages, indexed): (i64, i64) = db
        .query_row(
            "SELECT (SELECT COUNT(*) FROM messages), (SELECT COUNT(*) FROM search_documents)",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(err)?;
    item(
        &mut items,
        "搜索索引",
        if messages == indexed { "pass" } else { "warn" },
        format!("邮件 {messages} 封，索引 {indexed} 条"),
    );

    let prefs = store.preferences()?;
    item(
        &mut items,
        "存档布局",
        if prefs.archive_layout_version >= 3 {
            "pass"
        } else {
            "warn"
        },
        format!(
            "当前版本 {}；最新为 3（archive/<邮箱>__<短ID>）",
            prefs.archive_layout_version
        ),
    );

    let roots = store
        .archive_roots
        .read()
        .map_err(|e| e.to_string())?
        .clone();
    let external = prefs
        .external_archive_dir
        .as_deref()
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .map(Path::new);
    let external_ready = external.is_some_and(Path::is_dir);
    if let Some(ext) = external {
        item(
            &mut items,
            "外置存档",
            if external_ready { "pass" } else { "warn" },
            if external_ready {
                format!("{} 已连接", ext.display())
            } else {
                format!("{} 未连接；外置邮件暂时不可读", ext.display())
            },
        );
        if prefs.archive_index_enabled && external_ready {
            item(
                &mut items,
                "随盘索引",
                if ext.join("index.html").is_file() {
                    "pass"
                } else {
                    "warn"
                },
                if ext.join("index.html").is_file() {
                    "index.html 已生成"
                } else {
                    "index.html 不存在；执行一次归档后会生成"
                },
            );
        }
    }

    let mut missing = 0u64;
    let mut account_missing = 0u64;
    let mut account_messages = 0u64;
    let mut sources = 0u64;
    let account = match account_id {
        Some(id) => Some(store.account(id)?),
        None => None,
    };
    if let Some(a) = account.as_ref() {
        sources = db
            .query_row(
                "SELECT COUNT(*) FROM sources WHERE account_id=?1",
                [&a.id],
                |r| r.get(0),
            )
            .map_err(err)?;
    }
    let mut stmt = db.prepare("SELECT data FROM messages").map_err(err)?;
    let rows = stmt.query_map([], |r| r.get::<_, String>(0)).map_err(err)?;
    for row in rows {
        let mail: Mail = serde_json::from_str(&row.map_err(err)?).map_err(err)?;
        if !mail.saved_locally {
            continue;
        }
        if account.as_ref().is_some_and(|a| a.id == mail.account_id) {
            account_messages += 1;
        }
        let Some(rel) = mail.rel_path.as_deref() else {
            missing += 1;
            if account.as_ref().is_some_and(|a| a.id == mail.account_id) {
                account_missing += 1;
            }
            continue;
        };
        if roots.iter().any(|root| root.join(rel).exists()) {
            continue;
        }
        missing += 1;
        if account.as_ref().is_some_and(|a| a.id == mail.account_id) {
            account_missing += 1;
        }
    }
    let missing_status = if missing == 0 {
        "pass"
    } else if external.is_some() && !external_ready {
        "warn"
    } else {
        "fail"
    };
    item(
        &mut items,
        "存档文件",
        missing_status,
        if missing == 0 {
            "所有本地邮件都能找到原件".into()
        } else {
            format!("{missing} 封找不到原件；请连接外置盘或从备份恢复")
        },
    );

    let pending: i64 = db
        .query_row("SELECT COUNT(*) FROM archive_migrations", [], |r| r.get(0))
        .map_err(err)?;
    item(
        &mut items,
        "待迁移存档",
        if pending == 0 { "pass" } else { "warn" },
        if pending == 0 {
            "没有待迁移条目".into()
        } else {
            format!("{pending} 条等待外置盘或下次启动重试")
        },
    );

    let operations = store.server_operations()?;
    item(
        &mut items,
        "服务器任务",
        if operations.blocked == 0 {
            "pass"
        } else {
            "warn"
        },
        format!(
            "待同步 {}，需要处理 {}，已同步（本次）{}",
            operations.pending, operations.blocked, operations.session_completed
        ),
    );

    let unhealthy = store
        .folder_health()?
        .into_iter()
        .filter(|f| account.as_ref().is_none_or(|a| a.id == f.account_id))
        .count();
    item(
        &mut items,
        "文件夹健康",
        if unhealthy == 0 { "pass" } else { "warn" },
        if unhealthy == 0 {
            "没有隔离的服务器文件夹".into()
        } else {
            format!("{unhealthy} 个文件夹被隔离，请在后台任务中重新核查")
        },
    );

    if let Some(a) = account {
        if let Some(since) = a.sync_since.as_deref() {
            item(
                &mut items,
                "收信起点",
                if crate::remote::sync_cutoff(&a).is_some() {
                    "pass"
                } else {
                    "fail"
                },
                format!("{since}（若无效请重新设置）"),
            );
        }
        if a.read_only {
            item(
                &mut items,
                "分段状态",
                "info",
                "只读分段；不会收信、发送或提交服务器操作",
            );
        } else if !a.enabled {
            item(&mut items, "分段状态", "warn", "账号已暂停收取");
        }
        if let Some(error) = a.error.as_deref().filter(|e| !e.is_empty()) {
            item(&mut items, "最近错误", "warn", error);
        }
        item(
            &mut items,
            "账号存档",
            if account_missing == 0 { "pass" } else { "fail" },
            format!(
                "{account_messages} 封本地邮件，{sources} 条来源，{}",
                if account_missing == 0 {
                    "原件都存在".to_string()
                } else {
                    format!("{account_missing} 封缺少原件")
                }
            ),
        );
        match auth::load(&a.id) {
            Ok(secret) => {
                item(&mut items, "钥匙串", "pass", "凭据可读取");
                match crate::network::test_with_progress(&a, &secret, &|_| {}) {
                    Ok(()) => item(&mut items, "连接检查", "pass", "IMAP/POP3 与 SMTP 连接通过"),
                    Err(e) => item(&mut items, "连接检查", "fail", e),
                }
            }
            Err(e) => item(&mut items, "钥匙串", "fail", e),
        }
        let folders = store.remote_folders(Some(&a.id))?.len();
        item(
            &mut items,
            "服务器文件夹",
            if folders == 0 { "warn" } else { "pass" },
            if folders == 0 {
                "尚未同步到文件夹；请先收取一次".into()
            } else {
                format!("已缓存 {folders} 个文件夹")
            },
        );
    }

    Ok(DiagnosticReport {
        generated_at: chrono::Utc::now().to_rfc3339(),
        items,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tests::{account, query, raw};

    #[test]
    fn reports_missing_archive_files_without_touching_data() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path().into()).unwrap();
        let a = account();
        store.save_account(&a).unwrap();
        store.ingest(&a, "INBOX", "7:1", &raw(), false).unwrap();
        let mail = store.snapshot(&query()).unwrap().messages[0].clone();
        std::fs::remove_file(
            store.root.join(
                archive::rel_path_for(
                    &mail.account_id,
                    &mail.account_email,
                    &mail.source_folder,
                    &mail.hash,
                )
                .unwrap(),
            ),
        )
        .unwrap();
        let report = run(&store, None).unwrap();
        let item = report
            .items
            .iter()
            .find(|item| item.label == "存档文件")
            .unwrap();
        assert_eq!(item.status, "fail");
        assert!(item.detail.contains("找不到原件"));
        assert_eq!(store.snapshot(&query()).unwrap().messages.len(), 1);
    }
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PerfLogInfo {
    pub enabled: bool,
    pub path: String,
    pub size: u64,
}

fn perf_flag_path(store: &Store) -> PathBuf {
    store.root.join("perf-log.enabled")
}

pub fn perf_log_path(store: &Store) -> PathBuf {
    store.root.join("perf-log.jsonl")
}

pub fn perf_log_status(store: &Store) -> Result<PerfLogInfo> {
    let path = perf_log_path(store);
    Ok(PerfLogInfo {
        enabled: perf_flag_path(store).exists(),
        path: path.to_string_lossy().into_owned(),
        size: fs::metadata(&path).map(|m| m.len()).unwrap_or(0),
    })
}

pub fn set_perf_log(store: &Store, enabled: bool) -> Result<PerfLogInfo> {
    let flag = perf_flag_path(store);
    if enabled {
        let _ = fs::remove_file(perf_log_path(store));
        fs::write(&flag, b"1").map_err(err)?;
    } else {
        let _ = fs::remove_file(&flag);
    }
    perf_log_status(store)
}

pub fn append_perf_log(store: &Store, line: &str) -> Result<()> {
    if !perf_flag_path(store).exists() {
        return Ok(());
    }
    let path = perf_log_path(store);
    if fs::metadata(&path).map(|m| m.len() > 16 * 1024 * 1024).unwrap_or(false) {
        let _ = fs::remove_file(&path);
    }
    let clean = line.replace(['\n', '\r'], " ");
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(err)?;
    writeln!(
        file,
        "{{\"at\":\"{}\",\"entry\":{}}}",
        chrono::Utc::now().to_rfc3339(),
        if clean.starts_with('{') {
            clean
        } else {
            format!(r#"{{"event":"{}"}}"#, clean.replace('"', "'"))
        }
    )
    .map_err(err)
}

pub fn read_perf_log(store: &Store, limit: usize) -> Result<String> {
    let path = perf_log_path(store);
    let text = fs::read_to_string(path).unwrap_or_default();
    let lines: Vec<&str> = text.lines().collect();
    let start = lines.len().saturating_sub(limit.clamp(1, 1000));
    Ok(lines[start..].join("\n"))
}

pub fn clear_perf_log(store: &Store) -> Result<()> {
    let _ = fs::remove_file(perf_log_path(store));
    Ok(())
}

