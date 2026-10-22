mod apple_calendar;
mod archive;
mod archive_deletion;
mod archive_jobs;
mod attachment_preview;
mod auth;
mod calendar;
mod compose_files;
mod conversation;
mod directory_operations;
mod eml_files;
mod folder_health;
mod idle;
mod models;
mod network;
mod notification_open;
mod notifications;
mod operations;
mod paging;
mod productivity;
mod realtime;
mod remote;
mod retention;
mod retention_budget;
mod rule_operations;
mod rule_runs;
mod rules;
mod scheduling;
mod search;
mod sent_uploads;
mod signatures;
mod store;
mod sync_control;
mod update_history;
use calendar::{CalendarEvent, CalendarOccurrence, CalendarSubscription};
use models::*;
use std::{
    path::Path,
    sync::{Arc, Mutex},
};
use store::Store;
use tauri::{Emitter, Manager};
use tauri_plugin_autostart::ManagerExt;
struct AppState {
    store: Store,
    gate: Arc<Mutex<()>>,
    send_gate: Arc<Mutex<()>>,
    realtime: Arc<realtime::RealtimeControl>,
    dock_enabled: Arc<std::sync::atomic::AtomicBool>,
    /// 是否有正在编辑的写信窗口。原生菜单的「关闭窗口」(⌘W) 会被这里拦下来，
    /// 交给前端先关写信窗口，而不是把整个主窗口收进托盘。
    compose_open: Arc<std::sync::atomic::AtomicBool>,
    /// 阅读窗口（独立原生窗口）的 label → `{id, subject}` 载荷。窗口前端启动时按
    /// label 反查自己该显示哪封邮件；主窗口靠它渲染「阅读窗口不在前台」的悬浮条，
    /// 窗口销毁时清掉。
    mail_windows: Arc<Mutex<std::collections::HashMap<String, serde_json::Value>>>,
    mail_window_seq: Arc<std::sync::atomic::AtomicUsize>,
    /// 写信窗口（独立原生窗口）的 label → `{draft, accounts}` 载荷。窗口前端启动时
    /// 按 label 反查自己该编辑哪封草稿；窗口销毁时清掉，并把剩下的草稿 id 报给主窗口
    /// （主窗口靠它判断「还有没有在写信」）。
    compose_windows: Arc<Mutex<std::collections::HashMap<String, serde_json::Value>>>,
    compose_window_seq: Arc<std::sync::atomic::AtomicUsize>,
    /// 当前已注册的全局恢复窗口快捷键；None = 未注册。
    restore_shortcut: Arc<Mutex<Option<tauri_plugin_global_shortcut::Shortcut>>>,
}
/// 托盘右键菜单里需要反向更新勾选状态的菜单项。
struct TrayState {
    do_not_disturb: Option<tauri::menu::CheckMenuItem<tauri::Wry>>,
}
#[tauri::command]
async fn restart_for_update(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<()> {
    let gate = state.gate.clone();
    let send_gate = state.send_gate.clone();
    tauri::async_runtime::spawn_blocking(move || {
        // Wait for an active SMTP operation to persist its result before restarting.
        let _sync = gate.lock().map_err(err)?;
        let _sending = send_gate.lock().map_err(err)?;
        use tauri_plugin_window_state::AppHandleExt;
        app.save_window_state(window_state_flags()).map_err(err)?;
        app.restart();
        #[allow(unreachable_code)]
        Ok(())
    })
    .await
    .map_err(err)?
}
#[tauri::command]
fn mail_signature(
    state: tauri::State<AppState>,
    account_id: String,
) -> Result<signatures::MailSignature> {
    state.store.mail_signature(&account_id)
}
#[tauri::command]
fn save_mail_signature(
    state: tauri::State<AppState>,
    account_id: String,
    signature: signatures::MailSignature,
) -> Result<()> {
    state.store.save_mail_signature(&account_id, &signature)
}
#[tauri::command]
async fn save_inbox_folders(
    state: tauri::State<'_, AppState>,
    account_id: String,
    folders: Option<Vec<String>>,
) -> Result<Account> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || store.save_inbox_folders(&account_id, folders))
        .await
        .map_err(err)?
}
#[tauri::command]
async fn snapshot(state: tauri::State<'_, AppState>, query: Query) -> Result<Snapshot> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || store.snapshot(&query))
        .await
        .map_err(err)?
}
#[tauri::command]
async fn mail_page(
    state: tauri::State<'_, AppState>,
    request: paging::PageRequest,
) -> Result<paging::Page> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || store.mail_page(&request))
        .await
        .map_err(err)?
}
#[tauri::command]
async fn mail_neighbor(
    state: tauri::State<'_, AppState>,
    request: paging::PageRequest,
    id: String,
    direction: String,
) -> Result<paging::Neighbor> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || store.mail_neighbor(&request, &id, &direction))
        .await
        .map_err(err)?
}
#[tauri::command]
async fn mail_metadata(state: tauri::State<'_, AppState>, id: String) -> Result<Mail> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || store.mail_metadata(&id))
        .await
        .map_err(err)?
}
#[tauri::command]
async fn mail_detail(state: tauri::State<'_, AppState>, id: String) -> Result<Detail> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || store.detail(&id))
        .await
        .map_err(err)?
}
#[tauri::command]
async fn mail_conversation(state: tauri::State<'_, AppState>, id: String) -> Result<Vec<Mail>> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || store.conversation(&id))
        .await
        .map_err(err)?
}
#[tauri::command]
async fn update_mail(
    state: tauri::State<'_, AppState>,
    id: String,
    action: String,
    value: String,
) -> Result<()> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || store.change_mail(&id, &action, &value))
        .await
        .map_err(err)?
}
#[tauri::command]
async fn folder_health(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<folder_health::FolderHealth>> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || store.folder_health())
        .await
        .map_err(err)?
}
#[tauri::command]
async fn copy_sources(state: tauri::State<'_, AppState>, id: String) -> Result<Vec<String>> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || store.copy_sources(&id))
        .await
        .map_err(err)?
}
#[tauri::command]
async fn queue_server_copy(
    state: tauri::State<'_, AppState>,
    id: String,
    source: String,
    target: String,
) -> Result<String> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || store.queue_copy(&id, &source, &target))
        .await
        .map_err(err)?
}
#[tauri::command]
async fn queue_server_move(
    state: tauri::State<'_, AppState>,
    id: String,
    source: String,
    target: String,
) -> Result<String> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || store.queue_move(&id, &source, &target))
        .await
        .map_err(err)?
}
#[tauri::command]
async fn directory_operations(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<directory_operations::DirectoryOperation>> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || store.directory_operations())
        .await
        .map_err(err)?
}
#[tauri::command]
async fn directory_operation_action(
    state: tauri::State<'_, AppState>,
    id: String,
    action: String,
) -> Result<()> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || store.directory_action(&id, &action))
        .await
        .map_err(err)?
}
#[tauri::command]
async fn probe_remote_folder(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    account_id: String,
    folder: String,
) -> Result<folder_health::SelectionEvidence> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let result = network::probe_folder(&store, &store.account(&account_id)?, &folder);
        if let Err(e) = &result {
            let _ = store.log(&format!("文件夹「{folder}」独立只读核查失败：{e}"));
        }
        let _ = app.emit("server-operations-updated", ());
        let _ = app.emit("mail-updated", ());
        result
    })
    .await
    .map_err(err)?
}
#[tauri::command]
async fn server_operations(
    state: tauri::State<'_, AppState>,
) -> Result<operations::OperationSnapshot> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || store.server_operations())
        .await
        .map_err(err)?
}
#[tauri::command]
async fn retry_server_operation(state: tauri::State<'_, AppState>, id: String) -> Result<()> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || store.retry_server_operation(&id))
        .await
        .map_err(err)?
}
#[tauri::command]
async fn rule_executions(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<rule_operations::RuleExecution>> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || store.rule_executions())
        .await
        .map_err(err)?
}
#[tauri::command]
async fn rule_runs(state: tauri::State<'_, AppState>) -> Result<Vec<rule_runs::RuleRunView>> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || store.rule_runs())
        .await
        .map_err(err)?
}
#[tauri::command]
async fn rule_run_action(
    state: tauri::State<'_, AppState>,
    id: String,
    action: String,
) -> Result<()> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || store.rule_run_action(&id, &action))
        .await
        .map_err(err)?
}
#[tauri::command]
async fn retry_rule_execution(state: tauri::State<'_, AppState>, id: String) -> Result<()> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || store.retry_rule_execution(&id))
        .await
        .map_err(err)?
}
#[tauri::command]
fn save_rules(state: tauri::State<AppState>, rules: Vec<Rule>) -> Result<()> {
    state.store.save_rules(&rules)
}
/// 读取文本文件内容（规则导入用；限制在用户有权限访问的路径）。
#[tauri::command]
fn read_text_file(path: String) -> Result<String> {
    let p = Path::new(&path);
    if !p.is_absolute() {
        return Err("请选择绝对路径".into());
    }
    std::fs::read_to_string(p).map_err(err)
}
/// 导入规则：校验通过、同名跳过，其余追加。返回新增数量。
#[tauri::command]
fn import_rules(state: tauri::State<AppState>, rules: Vec<Rule>) -> Result<usize> {
    let mut existing = state.store.rules()?;
    let names: Vec<String> = existing.iter().map(|r| r.name.clone()).collect();
    let mut added = 0usize;
    for mut r in rules {
        rules::validate(&r)?;
        if names.contains(&r.name) {
            continue; // 同名跳过，避免重复导入
        }
        if r.id.is_empty() {
            r.id = uuid::Uuid::new_v4().to_string();
        }
        existing.push(r);
        added += 1;
    }
    state.store.save_rules(&existing)?;
    Ok(added)
}
/// 删除本地文件夹：把该文件夹下的邮件移回「全部存档」，文件夹随之消失。
#[tauri::command]
fn clear_local_folder(state: tauri::State<AppState>, name: String) -> Result<usize> {
    state.store.clear_local_folder(&name)
}
/// 本机归档重定：服务器已删（或非 IMAP）邮件仅调整本地归档目录，不动服务器。
#[tauri::command]
fn move_local_archive(state: tauri::State<AppState>, id: String, target: String) -> Result<()> {
    state.store.move_local_archive(&id, &target)
}
/// 写文本文件（规则导出用；由保存对话框给出绝对路径）。
#[tauri::command]
fn write_text_file(path: String, content: String) -> Result<()> {
    let p = Path::new(&path);
    if !p.is_absolute() {
        return Err("请选择绝对路径".into());
    }
    std::fs::write(p, content).map_err(err)
}
/// 导出规则：按账号筛选（空数组 = 全部），保持执行顺序。
/// include_global 控制是否带上全局规则（accountId 为空）。
#[tauri::command]
fn export_rules(
    state: tauri::State<AppState>,
    account_ids: Vec<String>,
    include_global: bool,
) -> Result<Vec<Rule>> {
    state.store.export_rules(&account_ids, include_global)
}
#[tauri::command]
fn preview_rule(state: tauri::State<AppState>, rule: Rule) -> Result<Vec<String>> {
    state.store.preview_rule(&rule)
}
#[tauri::command]
async fn run_rules(state: tauri::State<'_, AppState>) -> Result<u32> {
    let store = state.store.clone();
    let gate = state.gate.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = gate.try_lock().map_err(|_| "正在处理邮件，请稍后重试")?;
        store.run_rules()
    })
    .await
    .map_err(err)?
}
#[tauri::command]
fn cancel_authorization(id: String) -> Result<()> {
    auth::cancel_authorization(&id)
}
#[tauri::command]
async fn connect_account(
    state: tauri::State<'_, AppState>,
    mut account: Account,
    password: String,
    smtp_password: String,
    on_progress: tauri::ipc::Channel<String>,
) -> Result<()> {
    let store = state.store.clone();
    let gate = state.gate.clone();
    let send_gate = state.send_gate.clone();
    let realtime = state.realtime.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let progress = |stage: &str| {
            let _ = on_progress.send(stage.to_string());
        };
        account.validate()?;
        let secret = if account.auth == "oauth" {
            auth::authorize(&account, &progress)?
        } else {
            if password.is_empty() {
                return Err("请输入密码或客户端授权码".into());
            }
            auth::Secret {
                password,
                smtp_password,
                ..Default::default()
            }
        };
        let _guard = gate.try_lock().map_err(|_| "正在处理邮件，请稍后重试")?;
        let _sending = send_gate
            .try_lock()
            .map_err(|_| "正在发送邮件，请稍后修改账号")?;
        network::test_with_progress(&account, &secret, &progress)?;
        progress("saving");
        // Explicit account setup may ask the Keychain once.
        auth::save_interactive(&account.id, &secret)?;
        account.error = None;
        store.save_account(&account)?;
        realtime.restart();
        store.log(&format!("账号 {} 已通过收发连接测试", account.email))
    })
    .await
    .map_err(err)?
}
#[tauri::command]
async fn edit_account(
    state: tauri::State<'_, AppState>,
    account: Account,
    password: String,
    smtp_password: String,
    reauthorize: bool,
    smtp_use_incoming: bool,
    on_progress: tauri::ipc::Channel<String>,
) -> Result<String> {
    let store = state.store.clone();
    let gate = state.gate.clone();
    let send_gate = state.send_gate.clone();
    let realtime = state.realtime.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let progress = |stage: &str| {
            let _ = on_progress.send(stage.to_string());
        };
        let old = store.account(&account.id)?;
        if password.is_empty()
            && smtp_password.is_empty()
            && !reauthorize
            && !smtp_use_incoming
            && old.same_connection(&account)
        {
            store.edit_account_preferences(&account)?;
            store.log(&format!("账号 {} 本地留存与名称设置已保存", account.email))?;
            return Ok("账号设置已保存".into());
        }
        account.validate()?;
        if old.email != account.email {
            return Err("修改邮箱地址请添加新账号".into());
        }
        let secret = if account.auth == "oauth" {
            if reauthorize
                || old.auth != account.auth
                || auth::client_id(&old) != auth::client_id(&account)
            {
                auth::authorize(&account, &progress)?
            } else {
                auth::credentials(&old)?
            }
        } else {
            let mut secret = if old.auth == "password" {
                auth::load(&old.id).or_else(|e| {
                    if password.is_empty() {
                        Err(e)
                    } else {
                        Ok(auth::Secret::default())
                    }
                })?
            } else {
                auth::Secret::default()
            };
            if !password.is_empty() {
                secret.password = password;
            }
            if !smtp_password.is_empty() {
                secret.smtp_password = smtp_password;
            }
            if smtp_use_incoming {
                secret.smtp_password.clear();
            }
            if secret.password.is_empty() {
                return Err("请输入密码或客户端授权码".into());
            }
            secret
        };
        let _guard = gate
            .try_lock()
            .map_err(|_| "正在收取邮件，暂时不能更改服务器连接配置")?;
        let inbox_gate = sync_control::folder_gate(&store.root, &account.id, "INBOX")?;
        let _inbox = inbox_gate
            .try_lock()
            .map_err(|_| "正在收取邮件，暂时不能更改服务器连接配置")?;
        let _sending = send_gate
            .try_lock()
            .map_err(|_| "正在发送邮件，请稍后修改账号")?;
        if !store.account(&account.id)?.same_connection(&old) {
            return Err("等待授权期间账号连接配置已变化，请重新打开设置".into());
        }
        network::test_with_progress(&account, &secret, &progress)?;
        progress("saving");
        auth::save_interactive(&account.id, &secret)?;
        store.edit_account(&account)?;
        realtime.restart();
        store.log(&format!("账号 {} 配置已更新，收发验证通过", account.email))?;
        Ok("账号配置已更新，收发服务器验证通过".into())
    })
    .await
    .map_err(err)?
}
#[tauri::command]
fn list_contacts(state: tauri::State<AppState>) -> Result<Vec<Contact>> {
    state.store.contacts()
}
#[tauri::command]
fn save_contact(state: tauri::State<AppState>, contact: Contact) -> Result<()> {
    state.store.save_contact(&contact)
}
#[tauri::command]
fn delete_contact(state: tauri::State<AppState>, id: String) -> Result<()> {
    state
        .store
        .db()?
        .execute("DELETE FROM contacts WHERE id=?1", [id])
        .map_err(err)?;
    Ok(())
}
#[tauri::command]
async fn contact_suggestions(state: tauri::State<'_, AppState>) -> Result<Vec<Address>> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || store.contact_suggestions())
        .await
        .map_err(err)?
}
#[tauri::command]
fn apple_calendar_status() -> String {
    apple_calendar::status()
}

#[tauri::command]
fn open_apple_calendar_settings() -> Result<()> {
    apple_calendar::open_settings()
}

#[tauri::command]
async fn connect_apple_calendar() -> Result<Vec<apple_calendar::AppleCalendarInfo>> {
    tauri::async_runtime::spawn_blocking(apple_calendar::connect)
        .await
        .map_err(err)?
}

#[tauri::command]
async fn list_apple_calendars() -> Result<Vec<apple_calendar::AppleCalendarInfo>> {
    tauri::async_runtime::spawn_blocking(apple_calendar::list_calendars)
        .await
        .map_err(err)?
}

#[tauri::command]
async fn list_apple_calendar_events(
    from: String,
    to: String,
    calendar_ids: Vec<String>,
) -> Result<Vec<apple_calendar::AppleCalendarEvent>> {
    tauri::async_runtime::spawn_blocking(move || apple_calendar::events(&from, &to, calendar_ids))
        .await
        .map_err(err)?
}

#[tauri::command]
async fn list_calendar_events(
    state: tauri::State<'_, AppState>,
    from: String,
    to: String,
) -> Result<Vec<CalendarOccurrence>> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || store.calendar_events(&from, &to))
        .await
        .map_err(err)?
}
#[tauri::command]
async fn save_calendar_event(
    state: tauri::State<'_, AppState>,
    event: CalendarEvent,
) -> Result<CalendarEvent> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || store.save_calendar_event(&event))
        .await
        .map_err(err)?
}
#[tauri::command]
async fn save_meeting_event(
    state: tauri::State<'_, AppState>,
    event: CalendarEvent,
) -> Result<CalendarEvent> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || store.save_meeting_event(&event))
        .await
        .map_err(err)?
}
#[tauri::command]
async fn delete_calendar_event(state: tauri::State<'_, AppState>, id: String) -> Result<()> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || store.delete_calendar_event(&id))
        .await
        .map_err(err)?
}
#[tauri::command]
async fn skip_calendar_occurrence(
    state: tauri::State<'_, AppState>,
    event_id: String,
    occurrence_start: String,
) -> Result<()> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || {
        store.skip_calendar_occurrence(&event_id, &occurrence_start)
    })
    .await
    .map_err(err)?
}
#[tauri::command]
async fn all_calendar_events(state: tauri::State<'_, AppState>) -> Result<Vec<CalendarEvent>> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || store.all_calendar_events())
        .await
        .map_err(err)?
}
#[tauri::command]
async fn list_calendar_subscriptions(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<CalendarSubscription>> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || store.calendar_subscriptions())
        .await
        .map_err(err)?
}
#[tauri::command]
async fn save_calendar_subscription(
    state: tauri::State<'_, AppState>,
    subscription: CalendarSubscription,
) -> Result<CalendarSubscription> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || store.save_calendar_subscription(&subscription))
        .await
        .map_err(err)?
}
#[tauri::command]
async fn set_calendar_subscription_enabled(
    state: tauri::State<'_, AppState>,
    id: String,
    enabled: bool,
) -> Result<()> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || {
        store.set_calendar_subscription_enabled(&id, enabled)
    })
    .await
    .map_err(err)?
}
#[tauri::command]
async fn delete_calendar_subscription(state: tauri::State<'_, AppState>, id: String) -> Result<()> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || store.delete_calendar_subscription(&id))
        .await
        .map_err(err)?
}
#[tauri::command]
async fn replace_calendar_subscription_events(
    state: tauri::State<'_, AppState>,
    id: String,
    events: Vec<CalendarEvent>,
) -> Result<usize> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || {
        store.replace_calendar_subscription_events(&id, &events)
    })
    .await
    .map_err(err)?
}
#[tauri::command]
async fn mark_calendar_subscription_error(
    state: tauri::State<'_, AppState>,
    id: String,
    message: String,
) -> Result<()> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || {
        store.mark_calendar_subscription_error(&id, &message)
    })
    .await
    .map_err(err)?
}
#[tauri::command]
async fn fetch_calendar_subscription(url: String) -> Result<String> {
    tauri::async_runtime::spawn_blocking(move || {
        let raw = url.trim();
        let target = match raw.strip_prefix("webcal://") {
            Some(rest) => format!("https://{rest}"),
            None => raw.to_string(),
        };
        if !(target.starts_with("https://") || target.starts_with("http://")) {
            return Err("订阅地址需以 http(s):// 或 webcal:// 开头".to_string());
        }
        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(20))
            .user_agent("Anser Calendar/1.0")
            .build()
            .map_err(err)?;
        let response = client
            .get(&target)
            .send()
            .map_err(|e| format!("订阅下载失败：{e}"))?;
        if !response.status().is_success() {
            return Err(format!("订阅下载失败：HTTP {}", response.status()));
        }
        let text = response
            .text()
            .map_err(|e| format!("订阅内容读取失败：{e}"))?;
        let text = text.trim_start_matches('\u{feff}').trim_start().to_string();
        if text.len() > 2_000_000 {
            return Err("订阅文件过大，已拒绝导入".into());
        }
        if !text.starts_with("BEGIN:VCALENDAR") {
            return Err("订阅地址返回的不是 ICS 日历".into());
        }
        Ok(text)
    })
    .await
    .map_err(err)?
}
#[tauri::command]
async fn list_outbox(state: tauri::State<'_, AppState>) -> Result<Vec<OutboxRecord>> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || store.outbox())
        .await
        .map_err(err)?
}
#[tauri::command]
async fn sent_upload_action(
    state: tauri::State<'_, AppState>,
    id: String,
    action: String,
) -> Result<()> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if action == "queue" {
            store.queue_sent_upload(&id)
        } else {
            store.sent_upload_action(&id, &action)
        }
    })
    .await
    .map_err(err)?
}
#[tauri::command]
fn retry_outbox(
    state: tauri::State<AppState>,
    id: String,
    confirm_duplicate: bool,
) -> Result<Compose> {
    state.store.outbox_draft(&id, confirm_duplicate)
}
/// 重新编辑已发送邮件：读取存档原件，生成一份可编辑的新草稿（不发送）。
#[tauri::command]
async fn reedit_sent_mail(state: tauri::State<'_, AppState>, id: String) -> Result<Compose> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || store.reedit_sent_mail(&id))
        .await
        .map_err(err)?
}
#[tauri::command]
async fn archive_outbox(state: tauri::State<'_, AppState>, id: String) -> Result<()> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || store.archive_outbox(&id))
        .await
        .map_err(err)?
}
/// 删除单条发送记录：仅限已终结记录；本地已发送邮件副本不受影响。
#[tauri::command]
async fn delete_outbox(state: tauri::State<'_, AppState>, id: String) -> Result<()> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || store.delete_outbox(&id))
        .await
        .map_err(err)?
}
/// 清空「发送成功」记录；失败/未确认/进行中的记录保留。
#[tauri::command]
async fn clear_sent_outbox(state: tauri::State<'_, AppState>) -> Result<usize> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || store.clear_sent_outbox())
        .await
        .map_err(err)?
}
#[tauri::command]
fn get_preferences(state: tauri::State<AppState>) -> Result<Preferences> {
    state.store.preferences()
}
#[tauri::command]
fn save_preferences(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
    preferences: Preferences,
) -> Result<()> {
    let previous = state.store.preferences()?;
    state.store.save_preferences(&preferences)?;
    if previous.restore_shortcut != preferences.restore_shortcut {
        if let Err(error) =
            apply_restore_shortcut(&app, &state.restore_shortcut, &preferences.restore_shortcut)
        {
            let _ = state.store.save_preferences(&previous);
            return Err(error);
        }
    }
    state.dock_enabled.store(
        preferences.dock_visible,
        std::sync::atomic::Ordering::Relaxed,
    );
    // 偏好开启时始终显示 Dock 图标；关闭时跟随主窗口可见性，隐藏/最小化时自动隐藏。
    let visible = dock_icon_should_show(preferences.dock_visible, main_window_shown(&app), false);
    set_dock_visible(visible);
    // 托盘「免打扰」跟随新邮件通知开关
    if let Some(tray) = app.try_state::<TrayState>() {
        if let Some(item) = tray.do_not_disturb.as_ref() {
            let _ = item.set_checked(!preferences.new_mail_notifications);
        }
    }
    Ok(())
}
/// 单独设置恢复窗口的全局快捷键：即使与当前值相同也重新尝试注册，
/// 便于启动时被其它应用占用后再次录入同一个组合键。
#[tauri::command]
fn set_restore_shortcut(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
    shortcut: String,
) -> Result<()> {
    let previous = state.store.preferences()?;
    apply_restore_shortcut(&app, &state.restore_shortcut, &shortcut)?;
    let mut next = previous.clone();
    next.restore_shortcut = shortcut.trim().to_string();
    if let Err(error) = state.store.save_preferences(&next) {
        let _ = apply_restore_shortcut(&app, &state.restore_shortcut, &previous.restore_shortcut);
        return Err(error);
    }
    Ok(())
}
/// 录制快捷键期间暂时注销全局键，避免按当前组合键时被系统吞掉。
/// 只改注册状态，不改偏好；取消或保存时由 set_restore_shortcut 重新注册。
#[tauri::command]
fn suspend_restore_shortcut(app: tauri::AppHandle, state: tauri::State<AppState>) -> Result<()> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    let mut current = state.restore_shortcut.lock().map_err(|e| e.to_string())?;
    if let Some(shortcut) = current.take() {
        app.global_shortcut().unregister(shortcut).map_err(err)?;
    }
    Ok(())
}
/// 托盘「免打扰」：只切换新邮件通知，不影响菜单栏未读计数与收取。
#[tauri::command]
fn toggle_do_not_disturb(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
    tray: tauri::State<'_, TrayState>,
) -> Result<bool> {
    let mut preferences = state.store.preferences()?;
    preferences.new_mail_notifications = !preferences.new_mail_notifications;
    state.store.save_preferences(&preferences)?;
    let quiet = !preferences.new_mail_notifications;
    if let Some(item) = tray.do_not_disturb.as_ref() {
        let _ = item.set_checked(quiet);
    }
    // 让已打开的设置页同步「新邮件通知」开关
    let _ = app.emit("preferences-updated", ());
    Ok(quiet)
}
/// 托盘操作的结果反馈：窗口隐藏时系统通知可能不显示，退回写到活动日志。
fn toast_quiet(app: &tauri::AppHandle, message: &str) {
    if notifications::show(app, "雁信", message).is_err() {
        let store = app.state::<AppState>();
        let _ = store.store.log(message);
    }
}
fn store_log(app: &tauri::AppHandle, message: &str) -> Result<()> {
    app.state::<AppState>().store.log(message)
}
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopSettings {
    auto_start: bool,
    auto_start_available: bool,
}
#[tauri::command]
fn desktop_settings(app: tauri::AppHandle) -> Result<DesktopSettings> {
    Ok(DesktopSettings {
        auto_start: app.autolaunch().is_enabled().map_err(err)?,
        auto_start_available: !tauri::is_dev(),
    })
}
#[tauri::command]
fn set_auto_start(app: tauri::AppHandle, enabled: bool) -> Result<()> {
    if enabled && tauri::is_dev() {
        return Err("开发预览依赖前端服务，请在正式应用中开启开机自启".into());
    }
    if enabled {
        app.autolaunch().enable().map_err(err)
    } else {
        app.autolaunch().disable().map_err(err)
    }
}
#[tauri::command]
fn test_notification(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
    id: Option<String>,
) -> Result<()> {
    #[cfg(target_os = "macos")]
    if let Some(id) = id.filter(|id| !id.is_empty()) {
        let mail = state.store.mail_metadata(&id)?;
        let token = notification_open::bind(&state.store, &mail)?;
        notification_open::resolve(&state.store, &token)?;
        return notification_open::show(
            "雁信 · 通知测试",
            "点击这条通知，打开刚才阅读的邮件。",
            &token,
        );
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (state, id);
    notifications::show(
        &app,
        "雁信 · 通知测试",
        "系统通知已接入。收到新邮件和发送结果会在这里提示。",
    )
}
#[tauri::command]
async fn archive_health(state: tauri::State<'_, AppState>) -> Result<ArchiveHealth> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || store.archive_health())
        .await
        .map_err(err)?
}
#[tauri::command]
fn account_action(
    state: tauri::State<AppState>,
    id: String,
    remove: bool,
    purge: Option<bool>,
) -> Result<()> {
    let _guard = state
        .gate
        .try_lock()
        .map_err(|_| "正在处理邮件，请稍后重试")?;
    let inbox_gate = sync_control::folder_gate(&state.store.root, &id, "INBOX")?;
    let _inbox = inbox_gate
        .try_lock()
        .map_err(|_| "正在收取该账号邮件，请稍后修改账号")?;
    let _sending = state
        .send_gate
        .try_lock()
        .map_err(|_| "正在发送邮件，请稍后修改账号")?;
    if remove {
        if purge.unwrap_or(false) {
            state.store.purge_account(&id)?;
        } else {
            state.store.remove_account(&id)?;
        }
        auth::remove(&id);
    } else {
        let mut a = state.store.account(&id)?;
        a.enabled = !a.enabled;
        state.store.save_account(&a)?;
    }
    state.realtime.restart();
    Ok(())
}
fn sync_one(store: &Store, app: &tauri::AppHandle, account: Account) -> Result<u32> {
    sync_one_scope(store, app, account, false)
}
fn sync_inbox(store: &Store, app: &tauri::AppHandle, account: Account) -> Result<u32> {
    let result = sync_one_scope(store, app, account.clone(), true);
    // A manual check downloaded INBOX on its own short-lived connection. When
    // the account has a listener, reconnect it so providers route new-mail
    // notifications to the long-lived session again.
    if account.protocol == "imap" {
        if let Some(state) = app.try_state::<AppState>() {
            state.realtime.restart_account(&account.id);
        }
    }
    result
}
fn sync_one_scope(
    store: &Store,
    app: &tauri::AppHandle,
    account: Account,
    inbox_only: bool,
) -> Result<u32> {
    let scope = if inbox_only {
        "收件箱收取"
    } else {
        "全部文件夹收取"
    };
    sync_scope(store, app, account.clone(), scope, |updated| {
        if inbox_only {
            network::sync_folder_with_updates(store, &account, "INBOX", updated)
        } else {
            network::sync_with_updates(store, &account, updated)
        }
    })
}
/// Download the inbox on the connection that already owns it (the IDLE
/// listener). The session stays usable for listening afterwards.
fn sync_watch_inbox(
    store: &Store,
    app: &tauri::AppHandle,
    account: &Account,
    signal: network::WatchSignal,
    session: &mut network::WatchSession,
) -> Result<u32> {
    let current = store.account(&account.id)?;
    if !current.enabled || current.protocol != "imap" || !current.same_connection(account) {
        return Err("账号已暂停或连接配置已修改，停止旧收取任务".into());
    }
    let source = match signal {
        network::WatchSignal::CatchUp => "监听连接后补查",
        network::WatchSignal::MailboxChanged => "服务器实时通知",
        network::WatchSignal::RefreshChanged => "实时目录复核发现变化",
        network::WatchSignal::Poll => "定时补查",
    };
    if let Ok(gate) = crate::sync_control::folder_gate(&store.root, &account.id, "INBOX") {
        // Signal without waiting for the held folder lock.
        gate.notify();
    }
    let at = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let _ = store.log(&format!(
        "{} 收件诊断：{source} {at}；在同一实时连接上开始收件箱收取",
        account.email
    ));
    let started = std::time::Instant::now();
    let result = sync_scope(store, app, current, "收件箱收取", |updated| {
        network::sync_inbox_session(store, account, session, updated)
    });
    let _ = store.log(&format!(
        "{} 收件诊断：{source} {at}；本轮 {} 毫秒；{}",
        account.email,
        started.elapsed().as_millis(),
        if result.is_ok() { "成功" } else { "失败" }
    ));
    result
}
fn sync_scope(
    store: &Store,
    app: &tauri::AppHandle,
    mut account: Account,
    scope: &str,
    run: impl FnOnce(&dyn Fn()) -> Result<u32>,
) -> Result<u32> {
    let _ = app.emit("sync-progress", format!("正在收取 {}", account.email));
    let checkpoint = std::cell::Cell::new(notifications::checkpoint(store));
    let prior = account.clone();
    let last_update = std::cell::Cell::new(None);
    let updated = || {
        let now = std::time::Instant::now();
        if last_update
            .get()
            .is_none_or(|last: std::time::Instant| now.duration_since(last).as_millis() >= 1000)
        {
            last_update.set(Some(now));
            notifications::received(store, app, &prior, checkpoint.get());
            checkpoint.set(notifications::checkpoint(store));
            let _ = app.emit("mail-updated", ());
        }
    };
    let result = run(&updated);
    match &result {
        Ok(count) => {
            account.last_sync = Some(chrono::Utc::now().to_rfc3339());
            account.error = None;
            let _ = store.log(&format!(
                "{} {}本轮结束，新增 {} 封邮件",
                account.email, scope, count
            ));
            // The provider keeps accepting the in-memory token, so mail flow is
            // unaffected; record the denied write once per episode instead of
            // failing every round and showing an account error.
            if auth::pending_write(&account.id) && auth::take_pending_notice(&account.id) {
                let _ = store.log(&format!(
                    "{} 授权已在内存中更新并正常使用；系统尚未允许写入钥匙串，下次手动检查邮件时重试保存",
                    account.email
                ));
            }
        }
        Err(error) => {
            account.error = Some(error.clone());
            let _ = store.log(&format!("{} {}失败：{}", account.email, scope, error));
        }
    }
    store.save_sync_status(&account)?;
    notifications::received(store, app, &prior, checkpoint.get());
    let _ = app.emit("mail-updated", ());
    result
}
fn sync_all(store: &Store, app: &tauri::AppHandle) -> Result<u32> {
    let mut count = 0;
    let mut errors = Vec::new();
    for a in store.accounts()?.into_iter().filter(|a| a.enabled) {
        match sync_one(store, app, a.clone()) {
            Ok(n) => {
                count += n;
            }
            Err(e) => {
                errors.push(format!("{}：{}", a.email, e));
            }
        }
    }
    let _ = app.emit("mail-updated", ());
    if errors.is_empty() {
        Ok(count)
    } else {
        Err(format!("已保存 {count} 封；{}", errors.join("；")))
    }
}
#[tauri::command]
async fn sync_mail(
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
    id: Option<String>,
) -> Result<u32> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || collect_mail(&store, &app, id.as_deref()))
        .await
        .map_err(err)?
}
/// 手动收取：只收各账号收件箱，历史文件夹继续交给后台扫描。
/// 传入 `only` 时只收该账号，供列表头部的账号下拉使用。
fn collect_mail(store: &Store, app: &tauri::AppHandle, only: Option<&str>) -> Result<u32> {
    // Explicit refresh checks inboxes first. Historical folders continue
    // through the background sweep and their individual refresh action.
    let accounts = store
        .accounts()?
        .into_iter()
        .filter(|a| a.enabled)
        .filter(|a| match only {
            Some(id) => a.id == id,
            None => true,
        })
        .collect::<Vec<_>>();
    // This path only runs from a user action (toolbar, tray menu or finishing
    // account setup), so a deferred Keychain write may prompt once here.
    for account in &accounts {
        if !auth::pending_write(&account.id) {
            continue;
        }
        match auth::flush_pending(&account.id) {
            Ok(true) => {
                let _ = store.log(&format!("{} 凭据已重新写入系统钥匙串", account.email));
            }
            Ok(false) => {}
            Err(error) => {
                let _ = store.log(&format!(
                    "{} 凭据仍未能写入钥匙串，本次收取继续使用内存中的授权：{}",
                    account.email, error
                ));
            }
        }
    }
    let (count, errors) = std::thread::scope(|scope| {
        let jobs = accounts
            .into_iter()
            .map(|account| {
                let store = &store;
                let app = &app;
                scope.spawn(move || {
                    let email = account.email.clone();
                    sync_inbox(store, app, account).map_err(|e| format!("{email}：{e}"))
                })
            })
            .collect::<Vec<_>>();
        let mut count = 0;
        let mut errors = Vec::new();
        for job in jobs {
            match job
                .join()
                .unwrap_or_else(|_| Err("收取任务异常结束".into()))
            {
                Ok(n) => count += n,
                Err(e) => errors.push(e),
            }
        }
        (count, errors)
    });
    let _ = app.emit("mail-updated", ());
    if errors.is_empty() {
        Ok(count)
    } else {
        Err(format!("已保存 {count} 封；{}", errors.join("；")))
    }
}
#[tauri::command]
fn save_draft(window: tauri::Window, state: tauri::State<AppState>, draft: Compose) -> Result<()> {
    state.store.save_draft(&draft)?;
    // 原生写信窗口存草稿时同步刷新登记：主窗口「继续写信」悬浮条上的主题要跟着变。
    let label = window.label().to_string();
    if label.starts_with("compose-window-") {
        let value = serde_json::to_value(&draft).map_err(err)?;
        let updated = match state.compose_windows.lock().map_err(err)?.get_mut(&label) {
            Some(payload) => {
                payload["draft"] = value;
                true
            }
            None => false,
        };
        if updated {
            emit_compose_windows(&window.app_handle(), &state);
        }
    }
    Ok(())
}
#[tauri::command]
fn list_drafts(state: tauri::State<AppState>) -> Result<Vec<Compose>> {
    state.store.drafts()
}
#[tauri::command]
fn delete_draft(state: tauri::State<AppState>, id: String) -> Result<()> {
    state.store.delete_compose_draft(&id)
}
#[tauri::command]
fn clear_drafts(
    state: tauri::State<AppState>,
    drafts: Vec<Compose>,
) -> Result<compose_files::ClearDraftsResult> {
    state.store.clear_compose_drafts(&drafts)
}
#[tauri::command]
fn open_compose_session(state: tauri::State<AppState>, id: String) -> Result<String> {
    state.store.open_compose_session(&id)
}
#[tauri::command]
fn close_compose_session(state: tauri::State<AppState>, id: String, token: String) -> Result<()> {
    state.store.close_compose_session(&id, &token)
}
/// 前端在写信窗口开关时上报，供 ⌘W 判定是关写信窗口还是收主窗口。
#[tauri::command]
fn set_compose_open(state: tauri::State<AppState>, open: bool) {
    state
        .compose_open
        .store(open, std::sync::atomic::Ordering::Relaxed);
}
/// 在一扇独立原生窗口里打开这封邮件。同一封邮件只开一扇窗，重复调用聚焦原窗口。
#[tauri::command]
async fn open_mail_window(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    id: String,
    subject: String,
) -> Result<String> {
    let seq = state
        .mail_window_seq
        .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    if let Some(label) = state
        .mail_windows
        .lock()
        .map_err(err)?
        .iter()
        .find(|(_, mail)| mail.pointer("/id").and_then(|value| value.as_str()) == Some(id.as_str()))
        .map(|(label, _)| label.clone())
    {
        if let Some(window) = app.get_webview_window(&label) {
            let _ = window.unminimize();
            let _ = window.set_focus();
            return Ok(label);
        }
    }
    let label = format!("mail-window-{seq}");
    let title = if subject.trim().is_empty() {
        "无主题".to_string()
    } else {
        subject.trim().to_string()
    };
    let mut builder =
        tauri::WebviewWindowBuilder::new(&app, &label, tauri::WebviewUrl::App("index.html".into()))
            .title(title)
            .inner_size(760.0, 640.0)
            .min_inner_size(480.0, 360.0);
    // 从主窗口位置逐层错开，避免连开几封完全叠在一起。
    if let Some(main) = app.get_webview_window("main") {
        if let Ok(position) = main.outer_position() {
            let step = (seq % 6) as f64 * 28.0;
            builder = builder.position(
                position.x as f64 + 40.0 + step,
                position.y as f64 + 40.0 + step,
            );
        }
    }
    builder.build().map_err(err)?;
    state.mail_windows.lock().map_err(err)?.insert(
        label.clone(),
        serde_json::json!({ "id": id, "subject": subject.trim() }),
    );
    emit_mail_windows(&app, &state);
    // 这里刻意不淡入：主窗口那条 fade_in_window 是「从托盘重新显示」时才走，
    // 窗口与 runloop 都已就绪；新建的窗口立刻走 alphaValue=0 + animator 动画，
    // CGWindowList 里会长期停在 alpha=0.0（窗口在屏幕上但看不见）。
    Ok(label)
}
/// 阅读窗口启动时问「我是哪封邮件」：label 由窗口自己上报（getCurrentWindow().label）。
#[tauri::command]
fn mail_window_mail(state: tauri::State<AppState>, label: String) -> Option<String> {
    let windows = state.mail_windows.lock().ok()?;
    Some(windows.get(&label)?.pointer("/id")?.as_str()?.to_string())
}
/// 阅读窗口标签里的序号（`mail-window-3` → 3）：按开启顺序排窗口用。
fn mail_label_seq(label: &str) -> Option<usize> {
    label.strip_prefix("mail-window-")?.parse::<usize>().ok()
}
/// 阅读窗口登记表的对外快照（按开启顺序）：label、邮件主题、是否在前台。
/// 主窗口用它渲染「阅读窗口不在前台」的悬浮条（和写信窗口那套同一思路）。
fn mail_window_infos(
    windows: &std::collections::HashMap<String, serde_json::Value>,
    focused: impl Fn(&str) -> bool,
) -> Vec<serde_json::Value> {
    let mut labels: Vec<&String> = windows.keys().collect();
    labels.sort_by_key(|label| mail_label_seq(label.as_str()));
    labels
        .into_iter()
        .filter_map(|label| {
            let payload = windows.get(label)?;
            // 没有邮件 id 的登记是坏的，别混进悬浮条。
            payload.pointer("/id")?.as_str()?;
            Some(serde_json::json!({
                "label": label,
                "subject": payload.pointer("/subject")?.clone(),
                "focused": focused(label),
            }))
        })
        .collect()
}
/// 阅读窗口开、关、或前后台切换时，把登记快照同步给主窗口。
fn emit_mail_windows(app: &tauri::AppHandle, state: &AppState) {
    let infos = match state.mail_windows.lock() {
        Ok(windows) => mail_window_infos(&windows, |label| {
            app.get_webview_window(label)
                .and_then(|window| window.is_focused().ok())
                .unwrap_or(false)
        }),
        Err(_) => Vec::new(),
    };
    let _ = app.emit_to("main", "mail-windows-changed", infos);
}
/// 主窗口点「查看邮件」：把那扇原生阅读窗口抬回前台（最小化时先还原）。
#[tauri::command]
fn focus_mail_window(app: tauri::AppHandle, label: String) -> Result<()> {
    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.unminimize();
        window.set_focus().map_err(err)?;
    }
    Ok(())
}

/// 发给某一扇写信窗口的「请关闭自己」事件。**必须与主窗口收的
/// `compose-close-requested` 用两个名字**：JS 里不带 options 的 `listen`
/// 注册的目标是 `Any`，`emit_to(某个 label)` 的事件照样会进别的窗口的同名监听，
/// 两边同名就会「主窗口收到 → 转给写信窗口 → 主窗口又收到」无限回环（实测 1 分钟
/// 转了 100 万次，把主线程占死、写信窗口连弹确认的机会都没有）。
const COMPOSE_WINDOW_CLOSE: &str = "compose-window-close";

/// 写信窗口标签里的序号（`compose-window-3` → 3）：按开启顺序排窗口用。
fn compose_label_seq(label: &str) -> Option<usize> {
    label.strip_prefix("compose-window-")?.parse::<usize>().ok()
}
/// 写信窗口登记表的对外快照（按开启顺序）：label、正在编辑的草稿、是否在前台。
/// 主窗口用它判断「还有没有在写信」、渲染「继续写信」悬浮条，也用来保护正在编辑的
/// 草稿不被「清空草稿箱」删掉。
fn compose_window_infos(
    windows: &std::collections::HashMap<String, serde_json::Value>,
    focused: impl Fn(&str) -> bool,
    minimized: impl Fn(&str) -> bool,
) -> Vec<serde_json::Value> {
    let mut labels: Vec<&String> = windows.keys().collect();
    labels.sort_by_key(|label| compose_label_seq(label.as_str()));
    labels
        .into_iter()
        .filter_map(|label| {
            Some(serde_json::json!({
                "label": label,
                "draft": windows.get(label)?.pointer("/draft")?.clone(),
                "focused": focused(label),
                "minimized": minimized(label),
            }))
        })
        .collect()
}
/// 写信窗口开、关、或前后台切换时，把登记快照同步给主窗口。
fn emit_compose_windows(app: &tauri::AppHandle, state: &AppState) {
    let infos = match state.compose_windows.lock() {
        Ok(windows) => compose_window_infos(
            &windows,
            |label| {
                app.get_webview_window(label)
                    .and_then(|window| window.is_focused().ok())
                    .unwrap_or(false)
            },
            |label| {
                app.get_webview_window(label)
                    .and_then(|window| window.is_minimized().ok())
                    .unwrap_or(false)
            },
        ),
        Err(_) => Vec::new(),
    };
    let _ = app.emit_to("main", "compose-windows-changed", infos);
}
/// 最后开的那扇写信窗口：主窗口在前台按 ⌘W 时优先关它（和「关最后打开的那封」一致）。
fn latest_compose_label(
    windows: &std::collections::HashMap<String, serde_json::Value>,
) -> Option<String> {
    windows
        .keys()
        .filter_map(|label| compose_label_seq(label).map(|seq| (seq, label.clone())))
        .max_by_key(|(seq, _)| *seq)
        .map(|(_, label)| label)
}
/// 主窗口收到 ⌘W、且当时有写信窗口时，由前端调这里把关闭请求转给写信窗口自己
/// （原生窗口自己弹「保存 / 不保存 / 取消」）。
#[tauri::command]
fn close_latest_compose_window(app: tauri::AppHandle, state: tauri::State<AppState>) -> Result<()> {
    let label = {
        let windows = state.compose_windows.lock().map_err(err)?;
        latest_compose_label(&windows)
    };
    if let Some(label) = label {
        let _ = app.emit_to(label.as_str(), COMPOSE_WINDOW_CLOSE, ());
    }
    Ok(())
}
/// 主窗口点「继续写信」：把那扇原生写信窗口抬回前台（最小化时先还原）。
#[tauri::command]
fn focus_compose_window(app: tauri::AppHandle, label: String) -> Result<()> {
    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.unminimize();
        window.set_focus().map_err(err)?;
    }
    Ok(())
}
/// 在一扇独立原生窗口里写这封信。同一封草稿只开一扇窗，重复调用聚焦原窗口；
/// 草稿本身由主窗口拼好（回复/转发/签名都在那边算好），这里只负责开窗。
#[tauri::command]
async fn open_compose_window(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    draft: serde_json::Value,
    accounts: serde_json::Value,
) -> Result<String> {
    let id = draft
        .pointer("/id")
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .to_string();
    if !id.is_empty() {
        if let Some(label) = state
            .compose_windows
            .lock()
            .map_err(err)?
            .iter()
            .find(|(_, payload)| {
                payload
                    .pointer("/draft/id")
                    .and_then(|value| value.as_str())
                    == Some(id.as_str())
            })
            .map(|(label, _)| label.clone())
        {
            if let Some(window) = app.get_webview_window(&label) {
                let _ = window.unminimize();
                let _ = window.set_focus();
                return Ok(label);
            }
        }
    }
    let seq = state
        .compose_window_seq
        .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let label = format!("compose-window-{seq}");
    let subject = draft
        .pointer("/subject")
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .trim()
        .to_string();
    let title = if subject.is_empty() {
        "撰写邮件".to_string()
    } else {
        subject
    };
    let mut builder =
        tauri::WebviewWindowBuilder::new(&app, &label, tauri::WebviewUrl::App("index.html".into()))
            .title(title)
            .inner_size(980.0, 720.0)
            .min_inner_size(640.0, 420.0);
    // 默认在主窗口内居中；多开时再逐层错开，避免完全叠在一起。
    // outer_position/outer_size 是物理像素，builder.position 要逻辑坐标，Retina 下必须除 scale。
    if let Some(main) = app.get_webview_window("main") {
        if let (Ok(position), Ok(size)) = (main.outer_position(), main.outer_size()) {
            let scale = main.scale_factor().unwrap_or(1.0);
            let step = (seq % 6) as f64 * 28.0;
            let mut x = position.x as f64 / scale
                + (size.width as f64 / scale - 980.0).max(0.0) / 2.0
                + step;
            let mut y = position.y as f64 / scale
                + (size.height as f64 / scale - 720.0).max(0.0) / 2.0
                + step;
            if let Ok(Some(monitor)) = main.current_monitor() {
                let monitor_scale = monitor.scale_factor();
                let left = monitor.position().x as f64 / monitor_scale + 8.0;
                let top = monitor.position().y as f64 / monitor_scale + 8.0;
                let right = (monitor.position().x as f64 + monitor.size().width as f64)
                    / monitor_scale
                    - 980.0
                    - 8.0;
                let bottom = (monitor.position().y as f64 + monitor.size().height as f64)
                    / monitor_scale
                    - 720.0
                    - 8.0;
                x = x.clamp(left, right.max(left));
                y = y.clamp(top, bottom.max(top));
            }
            builder = builder.position(x, y);
        }
    }
    builder.build().map_err(err)?;
    state.compose_windows.lock().map_err(err)?.insert(
        label.clone(),
        serde_json::json!({ "draft": draft, "accounts": accounts }),
    );
    emit_compose_windows(&app, &state);
    Ok(label)
}
/// 写信窗口启动时问「我在编辑哪封草稿、发件人有哪些」：label 由窗口自己上报。
#[tauri::command]
fn compose_window_draft(state: tauri::State<AppState>, label: String) -> Option<serde_json::Value> {
    state.compose_windows.lock().ok()?.get(&label).cloned()
}
/// 写信窗口里保存/发送/舍弃完，请求关掉这扇窗。先把登记摘掉再 close：
/// CloseRequested 要靠「label 还在不在登记里」区分「用户按了 ⌘W」和「前端主动关」，
/// 否则会被自己的拦截逻辑挡下来变成关不掉的窗口。
#[tauri::command]
fn close_compose_window(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
    label: String,
) -> Result<()> {
    {
        let mut windows = state.compose_windows.lock().map_err(err)?;
        windows.remove(&label);
    }
    if let Some(window) = app.get_webview_window(&label) {
        window.close().map_err(err)?;
    }
    Ok(())
}
#[tauri::command]
fn close_mail_window(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
    label: String,
) -> Result<()> {
    {
        let mut windows = state.mail_windows.lock().map_err(err)?;
        windows.remove(&label);
    }
    if let Some(window) = app.get_webview_window(&label) {
        window.close().map_err(err)?;
    }
    emit_mail_windows(&app, &state);
    Ok(())
}
#[tauri::command]
fn prepare_forward_files(
    state: tauri::State<AppState>,
    id: String,
    token: String,
    source: ForwardSource,
) -> Result<Vec<ForwardFile>> {
    state.store.prepare_forward_files(&id, &token, &source)
}
#[tauri::command]
async fn open_forward_file(
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
    id: String,
    token: String,
    file_id: String,
) -> Result<()> {
    let store = state.store.clone();
    let cache = app
        .path()
        .app_cache_dir()
        .map_err(err)?
        .join("forward-previews");
    tauri::async_runtime::spawn_blocking(move || {
        let file = store.forward_file(&id, &token, &file_id)?;
        let path = attachment_preview::prepare_file(&cache, &file.name, &file.mime, &file.bytes)?;
        open::that(path).map_err(|e| format!("无法打开附件，请确认已安装对应应用：{e}"))
    })
    .await
    .map_err(err)?
}
#[tauri::command]
fn read_body_images(
    state: tauri::State<AppState>,
    id: String,
    token: String,
    paths: Vec<String>,
) -> Result<Vec<compose_files::BodyImage>> {
    state.store.read_body_images(&id, &token, &paths)
}
// SMTP work has its own guard. Long IMAP downloads must never occupy it.
fn with_send_gate<T>(gate: &Mutex<()>, send: impl FnOnce() -> Result<T>) -> Result<T> {
    let _guard = gate
        .try_lock()
        .map_err(|_| "已有邮件正在发送，请稍后重试，草稿已保留")?;
    send()
}
#[tauri::command]
async fn send_mail(
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
    draft: Compose,
) -> Result<String> {
    let store = state.store.clone();
    let send_gate = state.send_gate.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let result = with_send_gate(&send_gate, || network::send(&store, &draft));
        notifications::sent(&store, &app, &draft, &result, false);
        let _ = app.emit("mail-updated", ());
        result
    })
    .await
    .map_err(err)?
}
#[tauri::command]
async fn schedule_mail(
    state: tauri::State<'_, AppState>,
    draft: Compose,
    scheduled_at: String,
) -> Result<()> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || network::schedule(&store, &draft, &scheduled_at))
        .await
        .map_err(err)?
}
#[tauri::command]
async fn cancel_schedule(state: tauri::State<'_, AppState>, id: String) -> Result<Compose> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || store.cancel_schedule(&id))
        .await
        .map_err(err)?
}
#[tauri::command]
async fn reschedule_mail(
    state: tauri::State<'_, AppState>,
    id: String,
    scheduled_at: String,
) -> Result<()> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || {
        store.reschedule_mail(&id, &scheduled_at, chrono::Utc::now())
    })
    .await
    .map_err(err)?
}
#[tauri::command]
async fn account_folders(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<Vec<RemoteFolder>> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let a = store.account(&id)?;
        network::folder_list(&store, &a)
    })
    .await
    .map_err(err)?
}
#[tauri::command]
async fn folder_settings(state: tauri::State<'_, AppState>, id: String) -> Result<FolderSettings> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || store.folder_settings(&id))
        .await
        .map_err(err)?
}
#[tauri::command]
async fn retention_settings(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<retention::RetentionSettings> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || store.retention_settings(&id))
        .await
        .map_err(err)?
}
#[tauri::command]
async fn inspect_retention_budget(
    state: tauri::State<'_, AppState>,
    account: Account,
    overrides: Vec<retention::FolderRetention>,
    request_id: String,
) -> Result<retention_budget::RetentionBudget> {
    let store = state.store.clone();
    let lease = retention_budget::begin(&store, &request_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        retention_budget::inspect(&store, &account, &overrides, &lease)
    })
    .await
    .map_err(err)?
}
#[tauri::command]
fn cancel_retention_inspection(
    state: tauri::State<'_, AppState>,
    request_id: String,
) -> Result<()> {
    retention_budget::cancel(&state.store, &request_id)
}
#[tauri::command]
async fn save_retention(
    state: tauri::State<'_, AppState>,
    account: Account,
    overrides: Vec<retention::FolderRetention>,
) -> Result<()> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || {
        store.save_retention_preferences(&account, &overrides)
    })
    .await
    .map_err(err)?
}
#[tauri::command]
async fn queue_archives(
    state: tauri::State<'_, AppState>,
    ids: Vec<String>,
    conversations: bool,
) -> Result<archive_jobs::ArchiveQueueResult> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || store.queue_archives(&ids, conversations))
        .await
        .map_err(err)?
}
#[tauri::command]
async fn archive_jobs(state: tauri::State<'_, AppState>) -> Result<Vec<archive_jobs::ArchiveJob>> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || store.archive_jobs())
        .await
        .map_err(err)?
}
#[tauri::command]
async fn archive_job_action(
    state: tauri::State<'_, AppState>,
    id: String,
    action: String,
) -> Result<()> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || store.archive_job_action(&id, &action))
        .await
        .map_err(err)?
}
#[tauri::command]
async fn save_folder_mappings(
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
    id: String,
    mappings: Vec<FolderMapping>,
) -> Result<()> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || store.save_folder_mappings(&id, &mappings))
        .await
        .map_err(err)??;
    let _ = app.emit("mail-updated", ());
    Ok(())
}
#[tauri::command]
async fn sync_remote_folder(
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
    id: String,
    folder: String,
) -> Result<u32> {
    let store = state.store.clone();
    let gate = state.gate.clone();
    tauri::async_runtime::spawn_blocking(move || {
        // Keep account connection changes/removal mutually exclusive with
        // historical folder work. INBOX uses its independent folder guard.
        let _history = if folder.eq_ignore_ascii_case("INBOX") {
            None
        } else {
            Some(gate.lock().map_err(err)?)
        };
        let a = store.account(&id)?;
        if !a.enabled {
            return Err("账号已暂停，请先启用".into());
        }
        let checkpoint = notifications::checkpoint(&store);
        let result = network::sync_folder(&store, &a, &folder);
        notifications::received(&store, &app, &a, checkpoint);
        let _ = app.emit("mail-updated", ());
        result
    })
    .await
    .map_err(err)?
}
#[tauri::command]
async fn export_mail(state: tauri::State<'_, AppState>, id: String, path: String) -> Result<()> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || {
        archive::atomic_write(Path::new(&path), &store.message_raw(&store.mail(&id)?)?)
    })
    .await
    .map_err(err)?
}
#[tauri::command]
async fn save_attachment(
    state: tauri::State<'_, AppState>,
    id: String,
    index: usize,
    path: String,
) -> Result<()> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || {
        archive::atomic_write(
            Path::new(&path),
            &archive::attachment(&store.message_raw(&store.mail(&id)?)?, index)?,
        )
    })
    .await
    .map_err(err)?
}
#[tauri::command]
async fn preview_attachment(
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
    id: String,
    index: usize,
) -> Result<()> {
    let store = state.store.clone();
    let cache = app
        .path()
        .app_cache_dir()
        .map_err(err)?
        .join("attachment-previews");
    tauri::async_runtime::spawn_blocking(move || {
        let mail = store.mail(&id)?;
        let raw = store.message_raw(&mail)?;
        let path =
            attachment_preview::prepare(&cache, &raw, &store.account_for_mail(&mail), index)?;
        open::that(path).map_err(|e| format!("无法打开附件，请确认已安装对应应用：{e}"))
    })
    .await
    .map_err(err)?
}
#[tauri::command]
async fn backup_archive(state: tauri::State<'_, AppState>, path: String) -> Result<String> {
    let store = state.store.clone();
    let gate = state.gate.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = gate.try_lock().map_err(|_| "正在处理邮件，请稍后重试")?;
        store.backup(Path::new(&path))
    })
    .await
    .map_err(err)?
}
#[tauri::command]
async fn archive_deletion_preview(
    state: tauri::State<'_, AppState>,
    account_id: String,
) -> Result<archive_deletion::DeletionPreview> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || store.archive_deletion_preview(&account_id))
        .await
        .map_err(err)?
}
#[tauri::command]
async fn delete_local_archives(
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
    account_id: String,
    stop_saving: bool,
    expected_count: usize,
    expected_token: String,
) -> Result<archive_deletion::DeletionResult> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let result = store.delete_local_archives(
            &account_id,
            stop_saving,
            expected_count,
            &expected_token,
        )?;
        let _ = app.emit("mail-updated", ());
        Ok(result)
    })
    .await
    .map_err(err)?
}
#[tauri::command]
async fn restore_archive(state: tauri::State<'_, AppState>, path: String) -> Result<usize> {
    let store = state.store.clone();
    let gate = state.gate.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = gate.try_lock().map_err(|_| "正在处理邮件，请稍后重试")?;
        store.restore(Path::new(&path))
    })
    .await
    .map_err(err)?
}
#[tauri::command]
fn open_data_folder(state: tauri::State<AppState>) -> Result<()> {
    open::that(&state.store.root).map_err(err)
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct DataDirInfo {
    path: String,
    source: String, // env | file | default
    config_path: String,
    overridden: bool, // 环境变量覆盖中（界面设置暂不生效）
}

fn data_dir_config_files<M: tauri::Manager<tauri::Wry>>(app: &M) -> Vec<std::path::PathBuf> {
    let mut files = Vec::new();
    if let Ok(home) = app.path().home_dir() {
        files.push(home.join(".config/yanxin/data-dir"));
        files.push(home.join(".yanxin-data-dir"));
    }
    files
}

fn resolve_data_root_info<M: tauri::Manager<tauri::Wry>>(
    app: &M,
) -> std::result::Result<DataDirInfo, tauri::Error> {
    let default = app.path().app_data_dir()?;
    if let Ok(p) = std::env::var("YANXIN_DATA_DIR") {
        let p = p.trim();
        if !p.is_empty() {
            return Ok(DataDirInfo {
                path: expand_tilde(app, p).to_string_lossy().into_owned(),
                source: "env".into(),
                config_path: String::new(),
                overridden: true,
            });
        }
    }
    for f in data_dir_config_files(app) {
        if let Ok(s) = std::fs::read_to_string(&f) {
            let s = s.lines().next().unwrap_or("").trim();
            if !s.is_empty() {
                return Ok(DataDirInfo {
                    path: expand_tilde(app, s).to_string_lossy().into_owned(),
                    source: "file".into(),
                    config_path: f.to_string_lossy().into_owned(),
                    overridden: false,
                });
            }
        }
    }
    Ok(DataDirInfo {
        path: default.to_string_lossy().into_owned(),
        source: "default".into(),
        config_path: String::new(),
        overridden: false,
    })
}

/// 规范化并校验用户在界面上选择的存档目录（纯函数，便于测试）。
pub(crate) fn normalize_data_dir(
    home: &Path,
    current: &Path,
    picked: &str,
) -> std::result::Result<std::path::PathBuf, String> {
    let picked = picked.trim();
    if picked.is_empty() {
        return Err("路径不能为空".into());
    }
    let path = if let Some(rest) = picked.strip_prefix("~/") {
        home.join(rest)
    } else {
        std::path::PathBuf::from(picked)
    };
    if !path.is_absolute() {
        return Err("请选择绝对路径".into());
    }
    if path != current && path.starts_with(current) {
        return Err("不能把存档目录放到当前存档目录内部".into());
    }
    Ok(path)
}

/// 分层设置与预览（前端设置卡用）
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct TierInfo {
    external_dir: String,
    retention_days: u32,
    index_enabled: bool,
    pending: u64,
    pending_bytes: u64,
    external_reachable: bool,
}

#[tauri::command]
fn archive_tier_info(state: tauri::State<AppState>) -> std::result::Result<TierInfo, String> {
    let p = state.store.preferences().map_err(|e| e.to_string())?;
    let (pending, pending_bytes, reachable) =
        state.store.tier_pending().map_err(|e| e.to_string())?;
    Ok(TierInfo {
        external_dir: p.external_archive_dir.unwrap_or_default(),
        retention_days: p.archive_retention_days,
        index_enabled: p.archive_index_enabled,
        pending,
        pending_bytes,
        external_reachable: reachable,
    })
}

#[tauri::command]
fn save_archive_tier_settings(
    state: tauri::State<AppState>,
    external_dir: String,
    retention_days: u32,
    index_enabled: bool,
) -> std::result::Result<TierInfo, String> {
    let mut p = state.store.preferences().map_err(|e| e.to_string())?;
    let dir = external_dir.trim().to_string();
    p.external_archive_dir = if dir.is_empty() { None } else { Some(dir) };
    p.archive_retention_days = retention_days;
    p.archive_index_enabled = index_enabled;
    state
        .store
        .save_preferences(&p)
        .map_err(|e| e.to_string())?;
    state
        .store
        .refresh_archive_roots()
        .map_err(|e| e.to_string())?;
    archive_tier_info(state)
}

#[tauri::command]
fn tier_archives_now(state: tauri::State<AppState>) -> std::result::Result<TierReport, String> {
    state.store.tier_archives().map_err(|e| e.to_string())
}
#[tauri::command]
fn normalize_archive_paths(state: tauri::State<AppState>) -> std::result::Result<u64, String> {
    state
        .store
        .normalize_archive_paths()
        .map_err(|e| e.to_string())
}
#[tauri::command]
fn tier_recall(state: tauri::State<AppState>) -> std::result::Result<u64, String> {
    state.store.tier_recall().map_err(|e| e.to_string())
}
#[tauri::command]
async fn archive_tier_log(
    state: tauri::State<'_, AppState>,
) -> std::result::Result<TierLog, String> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || store.tier_log())
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn create_folder(
    state: tauri::State<'_, AppState>,
    id: String,
    name: String,
) -> Result<Vec<models::RemoteFolder>> {
    let store = state.store.clone();
    let gate = state.gate.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _history = gate.lock().map_err(err)?;
        let a = store.account(&id)?;
        if !a.enabled {
            return Err("账号已暂停，请先恢复".into());
        }
        let folders = network::create_remote_folder(&a, &name)?;
        store.save_remote_folders(&id, &folders)?;
        Ok(folders)
    })
    .await
    .map_err(err)?
}
#[tauri::command]
async fn delete_folder(
    state: tauri::State<'_, AppState>,
    id: String,
    name: String,
) -> Result<Vec<models::RemoteFolder>> {
    let store = state.store.clone();
    let gate = state.gate.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _history = gate.lock().map_err(err)?;
        let a = store.account(&id)?;
        if !a.enabled {
            return Err("账号已暂停，请先恢复".into());
        }
        let folders = network::delete_remote_folder(&a, &name)?;
        store.save_remote_folders(&id, &folders)?;
        Ok(folders)
    })
    .await
    .map_err(err)?
}

#[tauri::command]
fn local_archive_tree(
    state: tauri::State<AppState>,
) -> std::result::Result<Vec<models::LocalArchiveGroup>, String> {
    state.store.local_archive_tree().map_err(|e| e.to_string())
}

#[tauri::command]
fn data_dir_info(app: tauri::AppHandle) -> std::result::Result<DataDirInfo, String> {
    resolve_data_root_info(&app).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_data_dir(app: tauri::AppHandle, path: String) -> std::result::Result<DataDirInfo, String> {
    let info = resolve_data_root_info(&app).map_err(|e| e.to_string())?;
    let home = app.path().home_dir().map_err(|e| e.to_string())?;
    let target = normalize_data_dir(&home, Path::new(&info.path), &path)?;
    if target == Path::new(&info.path) {
        return Ok(info); // 无变化
    }
    std::fs::create_dir_all(&target).map_err(|e| format!("无法创建目录：{e}"))?;
    let probe = target.join(".yanxin-write-test");
    std::fs::write(&probe, b"ok").map_err(|e| format!("目录不可写：{e}"))?;
    let _ = std::fs::remove_file(&probe);
    let file = data_dir_config_files(&app)
        .into_iter()
        .next()
        .ok_or("无法确定配置文件位置")?;
    if let Some(parent) = file.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("无法创建配置目录：{e}"))?;
    }
    std::fs::write(&file, format!("{}\n", target.to_string_lossy()))
        .map_err(|e| format!("无法写入配置：{e}"))?;
    resolve_data_root_info(&app).map_err(|e| e.to_string())
}

#[tauri::command]
fn reset_data_dir(app: tauri::AppHandle) -> std::result::Result<DataDirInfo, String> {
    for f in data_dir_config_files(&app) {
        let _ = std::fs::remove_file(f);
    }
    resolve_data_root_info(&app).map_err(|e| e.to_string())
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct DataDirCheck {
    path: String,
    is_current: bool,
    has_data: bool,
    writable: bool,
    error: String,
    migration_files: u64,
    migration_bytes: u64,
}

/// 递归复制目录内容，逐文件校验大小；返回 (文件数, 总字节)。
pub(crate) fn copy_tree(src: &Path, dst: &Path) -> std::result::Result<(u64, u64), String> {
    let mut files = 0u64;
    let mut bytes = 0u64;
    std::fs::create_dir_all(dst).map_err(|e| format!("无法创建目录：{e}"))?;
    let entries = std::fs::read_dir(src).map_err(|e| format!("无法读取目录：{e}"))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("无法读取目录项：{e}"))?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if entry.file_type().map_err(|e| e.to_string())?.is_dir() {
            let (f, b) = copy_tree(&from, &to)?;
            files += f;
            bytes += b;
        } else {
            std::fs::copy(&from, &to).map_err(|e| format!("复制失败 {}：{e}", from.display()))?;
            let size = std::fs::metadata(&from).map_err(|e| e.to_string())?.len();
            let copied = std::fs::metadata(&to).map_err(|e| e.to_string())?.len();
            if size != copied {
                return Err(format!("复制校验失败：{}", from.display()));
            }
            files += 1;
            bytes += size;
        }
    }
    Ok((files, bytes))
}

/// 统计目录的文件数与总字节。
pub(crate) fn tree_stats(path: &Path) -> std::result::Result<(u64, u64), String> {
    let mut files = 0u64;
    let mut bytes = 0u64;
    if !path.exists() {
        return Ok((0, 0));
    }
    let entries = std::fs::read_dir(path).map_err(|e| e.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let p = entry.path();
        if entry.file_type().map_err(|e| e.to_string())?.is_dir() {
            let (f, b) = tree_stats(&p)?;
            files += f;
            bytes += b;
        } else {
            files += 1;
            bytes += std::fs::metadata(&p).map_err(|e| e.to_string())?.len();
        }
    }
    Ok((files, bytes))
}

#[tauri::command]
fn check_data_dir(
    app: tauri::AppHandle,
    path: String,
) -> std::result::Result<DataDirCheck, String> {
    let info = resolve_data_root_info(&app).map_err(|e| e.to_string())?;
    let home = app.path().home_dir().map_err(|e| e.to_string())?;
    let (migration_files, migration_bytes) = tree_stats(Path::new(&info.path)).unwrap_or((0, 0));
    let target = match normalize_data_dir(&home, Path::new(&info.path), &path) {
        Ok(t) => t,
        Err(e) => {
            return Ok(DataDirCheck {
                path: path.trim().to_string(),
                is_current: false,
                has_data: false,
                writable: false,
                error: e,
                migration_files,
                migration_bytes,
            });
        }
    };
    let is_current = target == Path::new(&info.path);
    let has_data = target.join("mail.sqlite3").exists();
    let writable = if is_current {
        true
    } else {
        let created = std::fs::create_dir_all(&target);
        match created {
            Ok(()) => {
                let probe = target.join(".yanxin-write-test");
                let ok = std::fs::write(&probe, b"ok").is_ok();
                let _ = std::fs::remove_file(&probe);
                ok
            }
            Err(_) => false,
        }
    };
    Ok(DataDirCheck {
        path: target.to_string_lossy().into_owned(),
        is_current,
        has_data,
        writable,
        error: String::new(),
        migration_files,
        migration_bytes,
    })
}

/// 迁移：把当前存档整体复制到新目录（数据库用 VACUUM INTO 保证一致快照），
/// 校验通过后按需删除原目录，最后写入配置。调用方需重启生效。
#[tauri::command]
fn migrate_data_dir(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    path: String,
    remove_source: bool,
) -> std::result::Result<DataDirInfo, String> {
    let info = resolve_data_root_info(&app).map_err(|e| e.to_string())?;
    let home = app.path().home_dir().map_err(|e| e.to_string())?;
    let current = Path::new(&info.path).to_path_buf();
    let target = normalize_data_dir(&home, &current, &path)?;
    if target == current {
        return Ok(info);
    }
    if target.join("mail.sqlite3").exists() {
        return Err("目标目录已包含数据；如只需切换请直接更改位置".into());
    }
    // 1. 复制邮件存档（逐文件校验）
    let (files, bytes) = copy_tree(&current.join("archive"), &target.join("archive"))?;
    // 2. 数据库一致快照
    state
        .store
        .vacuum_into(&target.join("mail.sqlite3"))
        .map_err(|e| e.to_string())?;
    // 3. 复核：目标 archive 与源一致
    let (src_files, src_bytes) = tree_stats(&current.join("archive"))?;
    if files != src_files || bytes != src_bytes {
        return Err("迁移后校验不一致，原数据未动，请检查目标目录".into());
    }
    // 4. 按需清理原数据（应用退出后失效；删除后仅存新位置一份）
    if remove_source {
        std::fs::remove_dir_all(&current).map_err(|e| format!("已迁移但删除原数据失败：{e}"))?;
    }
    // 5. 写入配置
    let file = data_dir_config_files(&app)
        .into_iter()
        .next()
        .ok_or("无法确定配置文件位置")?;
    if let Some(parent) = file.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("无法创建配置目录：{e}"))?;
    }
    std::fs::write(
        &file,
        format!(
            "{}
",
            target.to_string_lossy()
        ),
    )
    .map_err(|e| format!("无法写入配置：{e}"))?;
    resolve_data_root_info(&app).map_err(|e| e.to_string())
}

#[tauri::command]
fn restart_app(app: tauri::AppHandle) -> Result<()> {
    app.restart();
    #[allow(unreachable_code)]
    Ok(())
}
fn web_link(url: &str) -> Result<url::Url> {
    let parsed = url::Url::parse(url).map_err(err)?;
    if !matches!(parsed.scheme(), "https" | "http") || parsed.host_str().is_none() {
        return Err("仅支持打开 http 或 https 网页链接".into());
    }
    Ok(parsed)
}
#[tauri::command]
fn open_mail_link(url: String) -> Result<()> {
    open::that(web_link(&url)?.as_str()).map_err(err)
}
#[cfg(target_os = "macos")]
fn activate_meeting_app(bundle_id: &str) -> bool {
    // `open -b` 走 LaunchServices：已在运行会切到前台，未运行会启动；
    // 根 wxwork:// scheme 对已运行实例不会激活。
    std::process::Command::new("/usr/bin/open")
        .args(["-b", bundle_id])
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

#[tauri::command]
fn open_meeting_app(provider: String) -> Result<()> {
    let (bundle_id, url) = match provider.as_str() {
        "wecom" => ("com.tencent.WeWorkMac", "wxwork://"),
        "tencent" => ("com.tencent.meeting", "wemeet://"),
        _ => return Err("不支持的会议应用".into()),
    };
    #[cfg(target_os = "macos")]
    if activate_meeting_app(bundle_id) {
        return Ok(());
    }
    open::that(url).map_err(|e| format!("无法打开会议应用，请确认已安装：{e}"))
}
fn mail_navigation_target(url: &url::Url) -> Option<String> {
    if url.scheme() != "https"
        || url.host_str() != Some("yanxin-mail-link.invalid")
        || url.path() != "/open"
    {
        return None;
    }
    let target = url.query_pairs().find(|(key, _)| key == "url")?.1;
    let parsed = url::Url::parse(&target).ok()?;
    match parsed.scheme() {
        "http" | "https" if parsed.host_str().is_some() => Some(parsed.to_string()),
        "mailto" => Some(parsed.to_string()),
        _ => None,
    }
}
fn parse_restore_shortcut(value: &str) -> Result<Option<tauri_plugin_global_shortcut::Shortcut>> {
    let value = value.trim();
    if value.is_empty() {
        return Ok(None);
    }
    let shortcut: tauri_plugin_global_shortcut::Shortcut = value
        .parse()
        .map_err(|error| format!("无效的恢复窗口快捷键：{error}"))?;
    if shortcut.mods.is_empty() {
        return Err("恢复窗口快捷键至少需要一个修饰键".into());
    }
    Ok(Some(shortcut))
}
fn apply_restore_shortcut(
    app: &tauri::AppHandle,
    registered: &Mutex<Option<tauri_plugin_global_shortcut::Shortcut>>,
    value: &str,
) -> Result<()> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    let next = parse_restore_shortcut(value)?;
    let mut current = registered.lock().map_err(|error| error.to_string())?;
    if *current == next {
        return Ok(());
    }
    let previous = *current;
    if let Some(shortcut) = previous {
        app.global_shortcut().unregister(shortcut).map_err(err)?;
    }
    if let Some(shortcut) = next {
        if let Err(error) = app.global_shortcut().register(shortcut) {
            if let Some(old) = previous {
                let _ = app.global_shortcut().register(old);
            }
            return Err(format!("无法注册恢复窗口快捷键：{error}"));
        }
    }
    *current = next;
    Ok(())
}
/// macOS 15 会拒绝后台应用通过 AppKit 自激活。200ms 后无条件交给
/// LaunchServices 重新打开当前 bundle（与 `open -a` 相同），只发 reopen
/// 事件，不会新建主窗口；即使 AppKit 已激活，也不会抢走其他窗口。
#[cfg(target_os = "macos")]
fn reopen_bundle_for_activation() {
    let Some(exe) = std::env::current_exe().ok() else {
        return;
    };
    let Some(bundle) = exe
        .parent()
        .and_then(|p| p.parent())
        .and_then(|p| p.parent())
        .filter(|p| p.extension().is_some_and(|ext| ext == "app"))
    else {
        return;
    };
    let _ = std::process::Command::new("open")
        .arg("-a")
        .arg(bundle)
        .spawn();
}

#[cfg(target_os = "macos")]
fn ensure_app_activated(handle: tauri::AppHandle) {
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(200));
        let _ = handle.run_on_main_thread(reopen_bundle_for_activation);
    });
}

#[cfg(target_os = "macos")]
fn activate_app() {
    use objc::runtime::{BOOL, YES};
    use objc::{class, msg_send, sel, sel_impl};
    unsafe {
        let current: *mut objc::runtime::Object =
            msg_send![class!(NSRunningApplication), currentApplication];
        if !current.is_null() {
            let _: BOOL = msg_send![current, activateWithOptions: 3u64];
        }
        let app: *mut objc::runtime::Object = msg_send![class!(NSApplication), sharedApplication];
        if !app.is_null() {
            let _: () = msg_send![app, activateIgnoringOtherApps: YES];
            if msg_send![app, respondsToSelector: sel!(activate)] {
                let _: () = msg_send![app, activate];
            }
        }
    }
}

fn show_main_window(app: &tauri::AppHandle) {
    // 写信/阅读独立窗口在前台时，Dock/托盘/全局快捷键不做任何处理。
    if let Some(state) = app.try_state::<AppState>() {
        let compose_focused = state.compose_windows.lock().ok().is_some_and(|windows| {
            windows.keys().any(|label| {
                app.get_webview_window(label)
                    .and_then(|window| window.is_focused().ok())
                    .unwrap_or(false)
            })
        });
        let mail_focused = state.mail_windows.lock().ok().is_some_and(|windows| {
            windows.keys().any(|label| {
                app.get_webview_window(label)
                    .and_then(|window| window.is_focused().ok())
                    .unwrap_or(false)
            })
        });
        if compose_focused || mail_focused {
            return;
        }
    }
    #[cfg(target_os = "macos")]
    let _ = app.show();
    if let Some(window) = app.get_webview_window("main") {
        let was_visible =
            window.is_visible().unwrap_or(false) && !window.is_minimized().unwrap_or(false);
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        // 从托盘/Dock 重新打开时淡入，避免窗口"一闪"出现。
        if !was_visible {
            fade_in_window(&window);
        }
    }
}
/// macOS 原生淡入：只改 NSWindow 的 alphaValue，不涉及字典/数组/NSString，
/// 避免 ObjC 异常跨 FFI 边界导致进程 abort。约 0.18s。
#[cfg(target_os = "macos")]
fn fade_in_window(window: &tauri::WebviewWindow) {
    use objc::{msg_send, sel, sel_impl};
    unsafe {
        let ns_window = match window.ns_window() {
            Ok(w) => w as *mut objc::runtime::Object,
            Err(_) => return,
        };
        if ns_window.is_null() {
            return;
        }
        let _: () = msg_send![ns_window, setAlphaValue: 0.0f64];
        // animator 代理走 Core Animation，无需自己建动画对象。
        let animator: *mut objc::runtime::Object = msg_send![ns_window, animator];
        if !animator.is_null() {
            let _: () = msg_send![animator, setAlphaValue: 1.0f64];
        } else {
            let _: () = msg_send![ns_window, setAlphaValue: 1.0f64];
        }
    }
}
#[cfg(not(target_os = "macos"))]
fn fade_in_window(_window: &tauri::WebviewWindow) {}
fn window_state_flags() -> tauri_plugin_window_state::StateFlags {
    use tauri_plugin_window_state::StateFlags;
    // Hidden/minimized state must not prevent Dock reopen or normal launch.
    // Fullscreen is a separate macOS Space; preserve zoom/maximized only.
    StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED
}
/// 窗口外框是否（几乎）铺满屏幕可用区域：四边留白都在容差内即算铺满。
/// 容差取每条边的 5%——macOS 的「拖到顶部填充」自带一点窗口间距，
/// 完全相等是等不到的。
fn rect_fills_area(outer: (i32, i32, u32, u32), area: (i32, i32, u32, u32)) -> bool {
    let (x, y, width, height) = outer;
    let (ax, ay, aw, ah) = area;
    let (tol_x, tol_y) = (aw as i32 / 20, ah as i32 / 20);
    (x - ax).abs() <= tol_x
        && (y - ay).abs() <= tol_y
        && (ax + aw as i32 - x - width as i32).abs() <= tol_x
        && (ay + ah as i32 - y - height as i32).abs() <= tol_y
}
/// 主窗口现在算不算「铺满屏幕」。不能只看 is_maximized()：macOS 拖到屏幕顶部
/// （或双击标题栏）的「填充」不置 zoom 位，插件记下来的 maximized 一直是 false。
fn main_window_fills_screen(window: &tauri::WebviewWindow) -> bool {
    if window.is_maximized().unwrap_or(false) {
        return true;
    }
    let (Ok(position), Ok(size), Ok(Some(monitor))) = (
        window.outer_position(),
        window.outer_size(),
        window.current_monitor(),
    ) else {
        return false;
    };
    let area = monitor.work_area();
    rect_fills_area(
        (position.x, position.y, size.width, size.height),
        (
            area.position.x,
            area.position.y,
            area.size.width,
            area.size.height,
        ),
    )
}
/// 把主窗口铺满当前屏幕可用区域（菜单栏与 Dock 之外）。Dock/分辨率变了以后，
/// 插件的旧像素尺寸不会跟着重算，所以启动时按当前屏幕重新铺满一次。
fn fill_main_window(window: &tauri::WebviewWindow) {
    let Ok(Some(monitor)) = window.current_monitor() else {
        return;
    };
    let area = monitor.work_area();
    let _ = window.set_position(tauri::PhysicalPosition::new(
        area.position.x,
        area.position.y,
    ));
    let _ = window.set_size(tauri::PhysicalSize::new(area.size.width, area.size.height));
}
/// 关窗/退出时保存主窗口状态，并记下「上次是不是铺满屏幕」：铺满是个意图，
/// 下次启动要按当前屏幕重算，而不是照搬旧的像素尺寸。只有真的变了才写库；
/// 只在主线程调用（读窗口几何与屏幕要碰 NSWindow/NSScreen）。
fn save_main_window_state(app: &tauri::AppHandle) {
    if let (Some(window), Some(state)) =
        (app.get_webview_window("main"), app.try_state::<AppState>())
    {
        let fills = main_window_fills_screen(&window);
        if let Ok(mut preferences) = state.store.preferences() {
            if preferences.window_fill != fills {
                preferences.window_fill = fills;
                let _ = state.store.save_preferences(&preferences);
            }
        }
    }
    use tauri_plugin_window_state::AppHandleExt;
    let _ = app.save_window_state(window_state_flags());
}
#[tauri::command]
fn take_eml_paths(state: tauri::State<eml_files::EmlFiles>) -> Result<Vec<String>> {
    state.take_pending()
}
#[tauri::command]
fn take_notification_mail(
    state: tauri::State<notification_open::NotificationOpen>,
) -> Result<Option<String>> {
    state.take()
}
#[tauri::command]
async fn notification_mail(state: tauri::State<'_, AppState>, token: String) -> Result<Mail> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || notification_open::resolve(&store, &token))
        .await
        .map_err(err)?
}
/// 阅读器里复制/保存图片：iframe 有 CSP，前端 fetch 外链图会被拦、canvas 会被跨域污染，
/// 所以统一由 Rust 取字节（data: 本地解码，http(s): 直接下载）。
fn fetch_mail_image(url: &str) -> Result<(String, Vec<u8>)> {
    if let Some(rest) = url.strip_prefix("data:") {
        let (meta, payload) = rest.split_once(',').ok_or("图片数据无效")?;
        let mime = meta.split(';').next().unwrap_or("image/png").to_string();
        let bytes = if meta.contains(";base64") {
            use base64::{engine::general_purpose::STANDARD, Engine};
            STANDARD.decode(payload.trim()).map_err(err)?
        } else {
            payload.as_bytes().to_vec()
        };
        return Ok((mime, bytes));
    }
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(err)?;
    let response = client.get(url).send().map_err(err)?;
    if !response.status().is_success() {
        return Err(format!("图片下载失败：HTTP {}", response.status()));
    }
    let mime = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.split(';').next().unwrap_or("").trim().to_string())
        .filter(|value| value.starts_with("image/"))
        .unwrap_or_else(|| "image/png".into());
    let bytes = response.bytes().map_err(err)?.to_vec();
    Ok((mime, bytes))
}

/// 保存图片到指定路径；path 为空时写到临时文件并用系统默认应用打开。
#[tauri::command]
async fn save_mail_image(url: String, path: Option<String>) -> Result<String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (mime, bytes) = fetch_mail_image(&url)?;
        let (target, temporary) = match path {
            Some(value) if !value.trim().is_empty() => (std::path::PathBuf::from(value), false),
            _ => {
                let ext = match mime.as_str() {
                    "image/jpeg" => "jpg",
                    "image/gif" => "gif",
                    "image/webp" => "webp",
                    "image/tiff" => "tiff",
                    other => other.rsplit('/').next().unwrap_or("png"),
                };
                (
                    std::env::temp_dir()
                        .join(format!("yanxin-image-{}.{ext}", uuid::Uuid::new_v4())),
                    true,
                )
            }
        };
        archive::atomic_write(&target, &bytes)?;
        let text = target.to_string_lossy().into_owned();
        if temporary {
            open::that(&target).map_err(|e| format!("无法打开图片，请确认已安装对应应用：{e}"))?;
        }
        Ok(text)
    })
    .await
    .map_err(err)?
}

/// 把正文图片复制到系统剪贴板。WKWebView 里 `navigator.clipboard.write` 会抛
/// NotAllowedError（用户实测），所以写剪贴板必须走原生 NSPasteboard。
#[tauri::command]
async fn copy_mail_image(url: String) -> Result<()> {
    tauri::async_runtime::spawn_blocking(move || {
        let (mime, bytes) = fetch_mail_image(&url)?;
        copy_image_to_pasteboard(&mime, &bytes)
    })
    .await
    .map_err(err)?
}

/// 用系统默认应用打开一个本地附件文件（写信附件条双击/空格）。
#[tauri::command]
async fn open_attachment_path(path: String) -> Result<()> {
    tauri::async_runtime::spawn_blocking(move || {
        let file = std::path::PathBuf::from(&path);
        if !file.is_file() {
            return Err(format!("附件不存在：{path}"));
        }
        open::that(&file).map_err(|e| format!("无法打开附件，请确认已安装对应应用：{e}"))
    })
    .await
    .map_err(err)?
}

/// 把本地文件路径写进系统剪贴板（NSFilenamesPboardType），
/// 可直接粘贴到 Finder 或其它应用；只写文件类型，不混入纯文本路径。
#[tauri::command]
async fn copy_attachment_paths(paths: Vec<String>) -> Result<()> {
    if paths.is_empty() {
        return Ok(());
    }
    tauri::async_runtime::spawn_blocking(move || {
        for path in &paths {
            if !std::path::Path::new(path).is_file() {
                return Err(format!("附件不存在：{path}"));
            }
        }
        copy_files_to_pasteboard(&paths)
    })
    .await
    .map_err(err)?
}

/// 把邮件里的附件复制到剪贴板：附件先落到临时目录，再写 NSFilenamesPboardType。
#[tauri::command]
async fn copy_mail_attachments(
    state: tauri::State<'_, AppState>,
    id: String,
    indexes: Vec<usize>,
) -> Result<()> {
    if indexes.is_empty() {
        return Ok(());
    }
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut paths = Vec::with_capacity(indexes.len());
        for index in indexes {
            let mail = store.mail(&id)?;
            let raw = store.message_raw(&mail)?;
            let bytes = archive::attachment(&raw, index)?;
            let target = std::env::temp_dir().join(format!(
                "yanxin-attachment-{}-{index}",
                uuid::Uuid::new_v4()
            ));
            archive::atomic_write(&target, &bytes)?;
            paths.push(target.to_string_lossy().into_owned());
        }
        copy_files_to_pasteboard(&paths)
    })
    .await
    .map_err(err)?
}

#[cfg(target_os = "macos")]
fn copy_files_to_pasteboard(paths: &[String]) -> Result<()> {
    use objc::{class, msg_send, sel, sel_impl};
    use std::ffi::CString;
    let ns_string = |text: &str| -> Result<*mut objc::runtime::Object> {
        let c = CString::new(text).map_err(|_| "路径含有非法字符")?;
        let object: *mut objc::runtime::Object =
            unsafe { msg_send![class!(NSString), stringWithUTF8String: c.as_ptr()] };
        if object.is_null() {
            return Err("无法创建路径字符串".into());
        }
        Ok(object)
    };
    unsafe {
        let pasteboard: *mut objc::runtime::Object =
            msg_send![class!(NSPasteboard), generalPasteboard];
        if pasteboard.is_null() {
            return Err("无法访问系统剪贴板".into());
        }
        // 先清空，避免把用户原有的剪贴板内容搅在一起。
        let _: () = msg_send![pasteboard, clearContents];
        let urls: Vec<*mut objc::runtime::Object> = paths
            .iter()
            .map(|path| {
                let string = ns_string(path)?;
                let url: *mut objc::runtime::Object =
                    msg_send![class!(NSURL), fileURLWithPath: string];
                if url.is_null() {
                    return Err(format!("无法定位附件：{path}"));
                }
                Ok(url)
            })
            .collect::<Result<_>>()?;
        let array: *mut objc::runtime::Object = msg_send![
            class!(NSArray),
            arrayWithObjects: urls.as_ptr()
            count: urls.len()
        ];
        if array.is_null() {
            return Err("无法组装剪贴板内容".into());
        }
        // NSPasteboard 的 -writeObjects: 返回 Bool。
        let written: bool = msg_send![pasteboard, writeObjects: array];
        if !written {
            return Err("写入系统剪贴板失败".into());
        }
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn copy_files_to_pasteboard(_paths: &[String]) -> Result<()> {
    Err("当前系统不支持复制附件到剪贴板".into())
}

/// 把图片字节写进系统剪贴板：同时给出原格式（png/jpeg…）和 TIFF 两种类型，
/// Finder 与只认特定类型的应用都能粘贴。
#[cfg(target_os = "macos")]
fn copy_image_to_pasteboard(mime: &str, bytes: &[u8]) -> Result<()> {
    use objc::{class, msg_send, sel, sel_impl};
    let ns_string = |text: &str| -> Result<*mut objc::runtime::Object> {
        use std::ffi::CString;
        let c = CString::new(text).map_err(|_| "剪贴板类型名含有非法字符")?;
        let object: *mut objc::runtime::Object =
            unsafe { msg_send![class!(NSString), stringWithUTF8String: c.as_ptr()] };
        if object.is_null() {
            return Err("无法创建剪贴板类型".into());
        }
        Ok(object)
    };
    unsafe {
        let pasteboard: *mut objc::runtime::Object =
            msg_send![class!(NSPasteboard), generalPasteboard];
        if pasteboard.is_null() {
            return Err("无法访问系统剪贴板".into());
        }
        let data: *mut objc::runtime::Object = msg_send![
            class!(NSData),
            dataWithBytes: bytes.as_ptr() as *const std::ffi::c_void
            length: bytes.len()
        ];
        if data.is_null() {
            return Err("无法写入图片数据".into());
        }
        // NSImage 只用来校验图片并把任意输入转成 TIFF。
        let allocated: *mut objc::runtime::Object = msg_send![class!(NSImage), alloc];
        let image: *mut objc::runtime::Object = msg_send![allocated, initWithData: data];
        if image.is_null() {
            return Err("无法识别图片格式".into());
        }
        let tiff: *mut objc::runtime::Object = msg_send![image, TIFFRepresentation];
        let item_alloc: *mut objc::runtime::Object = msg_send![class!(NSPasteboardItem), alloc];
        let item: *mut objc::runtime::Object = msg_send![item_alloc, init];
        if !tiff.is_null() {
            let _: () = msg_send![item, setData: tiff forType: ns_string("public.tiff")?];
        }
        if let Some(kind) = image_pasteboard_type(mime) {
            let _: () = msg_send![item, setData: data forType: ns_string(kind)?];
        }
        let array: *mut objc::runtime::Object = msg_send![class!(NSArray), arrayWithObject: item];
        let _: () = msg_send![pasteboard, clearContents];
        let written: bool = msg_send![pasteboard, writeObjects: array];
        let _: () = msg_send![image, release];
        let _: () = msg_send![item, release];
        if !written {
            return Err("写入系统剪贴板失败".into());
        }
    }
    Ok(())
}

/// 把 fetch_mail_image 报出的 mime 映射成 UTI；认不出的只给 TIFF。
#[cfg(target_os = "macos")]
fn image_pasteboard_type(mime: &str) -> Option<&'static str> {
    match mime {
        "image/png" => Some("public.png"),
        "image/jpeg" | "image/jpg" => Some("public.jpeg"),
        "image/gif" => Some("com.compuserve.gif"),
        "image/webp" => Some("org.webmproject.webp"),
        _ => None,
    }
}

#[cfg(not(target_os = "macos"))]
fn copy_image_to_pasteboard(_mime: &str, _bytes: &[u8]) -> Result<()> {
    Err("当前系统不支持复制图片到剪贴板".into())
}

/// 从系统剪贴板读取「复制的文件」路径：Finder ⌘C 的文件只进
/// NSFilenamesPboardType，WKWebView 的 DataTransfer 读不到，需要原生侧取。
#[tauri::command]
fn pasteboard_file_paths() -> Vec<String> {
    read_pasteboard_file_paths()
}

#[cfg(target_os = "macos")]
fn read_pasteboard_file_paths() -> Vec<String> {
    use objc::{class, msg_send, sel, sel_impl};
    unsafe {
        let pasteboard: *mut objc::runtime::Object =
            msg_send![class!(NSPasteboard), generalPasteboard];
        if pasteboard.is_null() {
            return Vec::new();
        }
        let classes: *mut objc::runtime::Object =
            msg_send![class!(NSArray), arrayWithObject: class!(NSURL)];
        let urls: *mut objc::runtime::Object =
            msg_send![pasteboard, readObjectsForClasses: classes options: 0usize];
        if urls.is_null() {
            return Vec::new();
        }
        let count: usize = msg_send![urls, count];
        (0..count)
            .filter_map(|index| {
                let url: *mut objc::runtime::Object = msg_send![urls, objectAtIndex: index];
                if url.is_null() {
                    return None;
                }
                let path: *mut objc::runtime::Object = msg_send![url, path];
                if path.is_null() {
                    return None;
                }
                let bytes: *const std::os::raw::c_char = msg_send![path, UTF8String];
                if bytes.is_null() {
                    return None;
                }
                std::ffi::CStr::from_ptr(bytes)
                    .to_str()
                    .ok()
                    .map(str::to_owned)
            })
            .collect()
    }
}

#[cfg(not(target_os = "macos"))]
fn read_pasteboard_file_paths() -> Vec<String> {
    Vec::new()
}

#[tauri::command]
async fn open_eml_file(
    state: tauri::State<'_, eml_files::EmlFiles>,
    path: String,
) -> Result<eml_files::EmlDocument> {
    let docs = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || docs.open(Path::new(&path)))
        .await
        .map_err(err)?
}
#[tauri::command]
fn close_eml_file(state: tauri::State<eml_files::EmlFiles>, token: String) -> Result<()> {
    state.close(&token)
}
#[tauri::command]
async fn preview_eml_attachment(
    state: tauri::State<'_, eml_files::EmlFiles>,
    app: tauri::AppHandle,
    token: String,
    index: usize,
) -> Result<()> {
    let raw = state.raw(&token)?;
    let cache = app
        .path()
        .app_cache_dir()
        .map_err(err)?
        .join("attachment-previews");
    tauri::async_runtime::spawn_blocking(move || {
        let path = attachment_preview::prepare(&cache, &raw, &eml_files::account(), index)?;
        open::that(path).map_err(|e| format!("无法打开附件，请确认已安装对应应用：{e}"))
    })
    .await
    .map_err(err)?
}
#[tauri::command]
async fn save_eml_attachment(
    state: tauri::State<'_, eml_files::EmlFiles>,
    token: String,
    index: usize,
    path: String,
) -> Result<()> {
    let docs = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        docs.save_attachment(&token, index, Path::new(&path))
    })
    .await
    .map_err(err)?
}

fn queue_eml_arguments(app: &tauri::AppHandle, args: Vec<String>, cwd: &Path) {
    if let Some(docs) = app.try_state::<eml_files::EmlFiles>() {
        docs.queue_args(args, cwd);
        let _ = app.emit("eml-files-available", ());
    }
}

/// 解析本地数据根目录（archive/ 存档与 mail.sqlite3 所在处）。
/// 优先级：环境变量 YANXIN_DATA_DIR > 配置文件（~/.config/yanxin/data-dir 或 ~/.yanxin-data-dir，
/// 取首行）> 默认 App 数据目录。支持 ~ 开头。
/// 指向新目录后首次启动会按账号重新收取完整存档（凭据在系统钥匙串不受影响）；
/// 想保留旧数据，先把旧目录整体复制到新位置再启动。
fn resolve_data_root<M: tauri::Manager<tauri::Wry>>(
    app: &M,
) -> std::result::Result<std::path::PathBuf, tauri::Error> {
    if let Ok(p) = std::env::var("YANXIN_DATA_DIR") {
        let p = p.trim();
        if !p.is_empty() {
            return Ok(expand_tilde(app, p));
        }
    }
    if let Ok(home) = app.path().home_dir() {
        for f in [
            home.join(".config/yanxin/data-dir"),
            home.join(".yanxin-data-dir"),
        ] {
            if let Ok(s) = std::fs::read_to_string(&f) {
                let s = s.lines().next().unwrap_or("").trim();
                if !s.is_empty() {
                    return Ok(expand_tilde(app, s));
                }
            }
        }
    }
    app.path().app_data_dir()
}

fn expand_tilde<M: tauri::Manager<tauri::Wry>>(app: &M, p: &str) -> std::path::PathBuf {
    if let Some(rest) = p.strip_prefix("~/") {
        if let Ok(home) = app.path().home_dir() {
            return home.join(rest);
        }
    }
    std::path::PathBuf::from(p)
}

/// Dock 图标开关：关闭后应用退为 accessory（仅菜单栏/托盘图标可见）。
#[cfg(target_os = "macos")]
fn set_dock_visible(visible: bool) {
    use objc::{class, msg_send, sel, sel_impl};
    unsafe {
        let app: *mut objc::runtime::Object = msg_send![class!(NSApplication), sharedApplication];
        if app.is_null() {
            return;
        }
        // NSApplicationActivationPolicyRegular = 0（显示 Dock），Accessory = 1（隐藏）
        let policy: i64 = if visible { 0 } else { 1 };
        let _: () = msg_send![app, setActivationPolicy: policy];
    }
}
#[cfg(not(target_os = "macos"))]
fn set_dock_visible(_visible: bool) {}

/// 偏好开启时始终显示 Dock 图标；关闭时跟随主窗口可见性（隐藏/最小化则隐藏）。
fn dock_icon_should_show(enabled: bool, window_visible: bool, minimized: bool) -> bool {
    enabled || (window_visible && !minimized)
}

/// 主窗口当前是否处于「可见且未最小化」状态（找不到窗口时按不可见处理）。
fn main_window_shown<M: tauri::Manager<tauri::Wry>>(app: &M) -> bool {
    app.get_webview_window("main")
        .map(|w| w.is_visible().unwrap_or(false) && !w.is_minimized().unwrap_or(false))
        .unwrap_or(false)
}

/// 偏好开启时保持始终显示；关闭时轮询主窗口可见性，动态切换 Dock 图标（250ms 内跟随）。
#[cfg(target_os = "macos")]
fn watch_dock_icon(app: tauri::AppHandle, enabled: Arc<std::sync::atomic::AtomicBool>) {
    std::thread::spawn(move || {
        let mut shown = true;
        loop {
            std::thread::sleep(std::time::Duration::from_millis(250));
            let visible =
                enabled.load(std::sync::atomic::Ordering::Relaxed) || main_window_shown(&app);
            if visible != shown {
                shown = visible;
                set_dock_visible(visible);
            }
        }
    });
}
#[cfg(not(target_os = "macos"))]
fn watch_dock_icon(_app: tauri::AppHandle, _enabled: Arc<std::sync::atomic::AtomicBool>) {}

/// 菜单栏图标右侧显示未读数：口径同「全部收件箱」未读徽标，无未读时不显示。
/// 只读数据库，不依赖通知开关；数字变化时才更新，避免频繁触碰主线程。
fn watch_tray_unread(store: Store, tray: tauri::tray::TrayIcon, app: tauri::AppHandle) {
    std::thread::spawn(move || {
        // 用 Option 区分「尚未写入」与「已写入 0」；0 表示清空标题。
        let mut shown: Option<u64> = None;
        loop {
            std::thread::sleep(std::time::Duration::from_secs(1));
            let unread = store.tray_unread_count().unwrap_or(0);
            if shown == Some(unread) {
                continue;
            }
            shown = Some(unread);
            let title = if unread > 0 {
                Some(unread.to_string())
            } else {
                None
            };
            let _ = tray.set_title(title);
            let _ = tray.set_tooltip(Some(if unread > 0 {
                format!("雁信 · {unread} 封未读")
            } else {
                "雁信 · 点击打开".to_string()
            }));
            #[cfg(target_os = "macos")]
            if let Some(window) = app.get_webview_window("main") {
                let badge = (unread > 0).then(|| unread.min(i64::MAX as u64) as i64);
                let _ = window.set_badge_count(badge);
            }
        }
    });
}

pub fn run() {
    tauri::Builder::default()
        .manage(eml_files::EmlFiles::default())
        .manage(notification_open::NotificationOpen::default())
        .plugin(
            tauri::plugin::Builder::<tauri::Wry, ()>::new("mail-links")
                .on_navigation(|webview, url| {
                    if url.host_str() == Some("yanxin-mail-link.invalid") {
                        if let Some(target) = mail_navigation_target(url) {
                            let _ = webview.emit("mail-link-open", target);
                        }
                        return false;
                    }
                    true
                })
                .build(),
        )
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            queue_eml_arguments(app, args, Path::new(&cwd));
            show_main_window(app)
        }))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        let handle = app.clone();
                        let app = app.clone();
                        let _ = handle.run_on_main_thread(move || {
                            show_main_window(&app);
                            #[cfg(target_os = "macos")]
                            {
                                set_dock_visible(true);
                                activate_app();
                                ensure_app_activated(app.clone());
                            }
                        });
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(window_state_flags())
                .with_filter(|label| label == "main")
                .build(),
        )
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .app_name("雁信")
                .args(["--autostart"])
                .build(),
        )
        .setup(|app| {
            queue_eml_arguments(
                app.handle(),
                std::env::args().skip(1).collect(),
                &std::env::current_dir()?,
            );
            if std::env::args().any(|arg| arg == "--autostart") {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }
            let store = Store::new(resolve_data_root(&*app)?).map_err(std::io::Error::other)?;
            // 按上次选择恢复 Dock 图标显隐（无该字段的旧偏好默认显示）：
            // 偏好开启时始终显示；关闭时跟随主窗口可见性，隐藏/最小化时自动隐藏。
            let dock_enabled = Arc::new(std::sync::atomic::AtomicBool::new(
                store.preferences().map(|p| p.dock_visible).unwrap_or(true),
            ));
            let dock_show = dock_icon_should_show(
                dock_enabled.load(std::sync::atomic::Ordering::Relaxed),
                main_window_shown(app),
                false,
            );
            set_dock_visible(dock_show);
            // 上次关窗时主窗口是铺满屏幕的：按当前屏幕可用区域重新铺满。
            // 插件的窗口状态只还原旧像素尺寸，Dock/分辨率变了不会跟着重算，
            // 结果就是「Dock 调小之后占不满」。两条判据合起来用：
            //   ① 上次关窗时记下的「铺满」意图（最准，Dock 怎么变都算数）；
            //   ② 还原后的窗口本来就几乎铺满当前屏幕（首次升级后意图还没记过）。
            // 判定要放进主队列异步回调：插件的还原也是异步的，等它落到窗口上再量才准。
            let was_full = store.preferences().map(|p| p.window_fill).unwrap_or(false);
            let handle = app.handle().clone();
            let restored = handle.clone();
            let _ = handle.run_on_main_thread(move || {
                if let Some(window) = restored.get_webview_window("main") {
                    if was_full || main_window_fills_screen(&window) {
                        fill_main_window(&window);
                    }
                }
            });
            let gate = Arc::new(Mutex::new(()));
            let send_gate = Arc::new(Mutex::new(()));
            let realtime = Arc::new(realtime::RealtimeControl::default());
            let compose_open = Arc::new(std::sync::atomic::AtomicBool::new(false));
            let restore_shortcut = Arc::new(Mutex::new(None));
            app.manage(AppState {
                store: store.clone(),
                gate: gate.clone(),
                send_gate: send_gate.clone(),
                realtime: realtime.clone(),
                dock_enabled: dock_enabled.clone(),
                compose_open: compose_open.clone(),
                mail_windows: Arc::new(Mutex::new(std::collections::HashMap::new())),
                mail_window_seq: Arc::new(std::sync::atomic::AtomicUsize::new(0)),
                compose_windows: Arc::new(Mutex::new(std::collections::HashMap::new())),
                compose_window_seq: Arc::new(std::sync::atomic::AtomicUsize::new(0)),
                restore_shortcut: restore_shortcut.clone(),
            });
            let restore_value = store
                .preferences()
                .map(|preferences| preferences.restore_shortcut)
                .unwrap_or_else(|_| default_restore_shortcut());
            if let Err(error) =
                apply_restore_shortcut(app.handle(), &restore_shortcut, &restore_value)
            {
                let _ = store.log(&format!("恢复窗口快捷键未注册：{error}"));
            }
            watch_dock_icon(app.handle().clone(), dock_enabled);
            #[cfg(target_os = "macos")]
            notification_open::setup(app.handle());
            // 分层归档：启动时检查一次，之后每 6 小时（未配置外置根或永久保留时自动跳过）
            let tier_store = store.clone();
            tauri::async_runtime::spawn_blocking(move || loop {
                let _ = tier_store.tier_archives();
                std::thread::sleep(std::time::Duration::from_secs(6 * 3600));
            });
            realtime::start(store.clone(), app.handle().clone(), realtime);
            operations::start(store.clone(), app.handle().clone());
            operations::start_flag_backfill(store.clone(), app.handle().clone());
            directory_operations::start(store.clone(), app.handle().clone());
            sent_uploads::start(store.clone(), app.handle().clone());
            archive_jobs::start(store.clone(), app.handle().clone());
            rule_runs::start(store.clone(), app.handle().clone());
            let menu = tauri::menu::Menu::default(app.handle())?;
            app.set_menu(menu)?;
            // 托盘右键菜单：免打扰、立即收取、退出。设置菜单同时修复
            // tray-icon 在无菜单时右键按下留下按钮高亮不消失的问题。
            let quiet = !store
                .preferences()
                .map(|p| p.new_mail_notifications)
                .unwrap_or(true);
            let do_not_disturb = tauri::menu::CheckMenuItem::with_id(
                app.handle(),
                "tray-do-not-disturb",
                "免打扰",
                true,
                quiet,
                None::<&str>,
            )?;
            let collect = tauri::menu::MenuItem::with_id(
                app.handle(),
                "tray-collect",
                "立即收取",
                true,
                None::<&str>,
            )?;
            let quit = tauri::menu::PredefinedMenuItem::quit(app.handle(), Some("退出雁信"))?;
            let tray_menu =
                tauri::menu::Menu::with_items(app.handle(), &[&do_not_disturb, &collect, &quit])?;
            app.manage(TrayState {
                do_not_disturb: Some(do_not_disturb),
            });
            let tray = tauri::tray::TrayIconBuilder::new()
                .tooltip("雁信 · 点击打开")
                .icon(app.default_window_icon().unwrap().clone())
                .show_menu_on_left_click(false)
                .menu(&tray_menu)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "tray-do-not-disturb" => {
                        let state = app.state::<AppState>();
                        let tray = app.state::<TrayState>();
                        match toggle_do_not_disturb(app.clone(), state, tray) {
                            Ok(true) => toast_quiet(app, "已开启免打扰，新邮件不再弹通知"),
                            Ok(false) => toast_quiet(app, "已关闭免打扰"),
                            Err(e) => {
                                let _ = store_log(app, &format!("切换免打扰失败：{e}"));
                            }
                        }
                    }
                    "tray-collect" => {
                        let state = app.state::<AppState>();
                        let store = state.store.clone();
                        let handle = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let _ = tauri::async_runtime::spawn_blocking(move || {
                                collect_mail(&store, &handle, None)
                            })
                            .await;
                        });
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if matches!(
                        event,
                        tauri::tray::TrayIconEvent::Click {
                            button: tauri::tray::MouseButton::Left,
                            button_state: tauri::tray::MouseButtonState::Up,
                            ..
                        }
                    ) {
                        show_main_window(tray.app_handle());
                    }
                })
                .build(app)?;
            watch_tray_unread(store.clone(), tray, app.handle().clone());
            let calendar_store = store.clone();
            let calendar_handle = app.handle().clone();
            std::thread::spawn(move || loop {
                if let Ok(items) = calendar_store.due_calendar_reminders(chrono::Utc::now(), 60) {
                    for occurrence in items {
                        let body = format!(
                            "{} · {}",
                            occurrence.event.title,
                            calendar::occurrence_label(&occurrence)
                        );
                        let _ = notifications::show(&calendar_handle, "日程提醒", &body);
                    }
                }
                std::thread::sleep(std::time::Duration::from_secs(30));
            });
            let handle = app.handle().clone();
            let scheduled_store = store.clone();
            let scheduled_gate = send_gate.clone();
            let scheduled_handle = handle.clone();
            std::thread::spawn(move || loop {
                if let Ok(_guard) = scheduled_gate.try_lock() {
                    match scheduled_store.claim_scheduled(chrono::Utc::now()) {
                        Ok(Some(mail)) => {
                            let draft = mail.draft.clone();
                            let result = network::send_scheduled(&scheduled_store, mail);
                            notifications::sent(
                                &scheduled_store,
                                &scheduled_handle,
                                &draft,
                                &result,
                                true,
                            );
                            let _ = scheduled_store
                                .log(&format!("定时发送：{}", result.unwrap_or_else(|e| e)));
                            let _ = scheduled_handle.emit("mail-updated", ());
                        }
                        Ok(None) => {}
                        Err(e) => {
                            let _ = scheduled_store.log(&format!("定时发送检查失败：{e}"));
                        }
                    }
                }
                std::thread::sleep(std::time::Duration::from_secs(1));
            });
            std::thread::spawn(move || {
                let mut schedule = productivity::SyncSchedule::default();
                loop {
                    let now = chrono::Utc::now().timestamp();
                    let interval = store
                        .preferences()
                        .unwrap_or_default()
                        .sync_interval_minutes as i64
                        * 60;
                    // A clock gap during sleep triggers an immediate catch-up round.
                    if schedule.due(now, interval) {
                        if let Ok(_guard) = gate.try_lock() {
                            let _ = sync_all(&store, &handle);
                            schedule.completed(chrono::Utc::now().timestamp());
                        }
                    }
                    std::thread::sleep(std::time::Duration::from_secs(10));
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            let label = window.label().to_string();
            // 阅读/写信窗口关掉后清掉各自的登记。
            if let tauri::WindowEvent::Destroyed = event {
                if label.starts_with("mail-window-") {
                    if let Some(state) = window.app_handle().try_state::<AppState>() {
                        if let Ok(mut windows) = state.mail_windows.lock() {
                            windows.remove(&label);
                        }
                        emit_mail_windows(&window.app_handle(), &state);
                    }
                } else if label.starts_with("compose-window-") {
                    if let Some(state) = window.app_handle().try_state::<AppState>() {
                        if let Ok(mut windows) = state.compose_windows.lock() {
                            windows.remove(&label);
                        }
                        emit_compose_windows(&window.app_handle(), &state);
                    }
                }
                return;
            }
            // 阅读窗口被盖住/回到前台：主窗口据此显示或收起「阅读窗口」悬浮条。
            if label.starts_with("mail-window-") {
                if let tauri::WindowEvent::Focused(_) = event {
                    if let Some(state) = window.app_handle().try_state::<AppState>() {
                        emit_mail_windows(&window.app_handle(), &state);
                    }
                }
                return;
            }
            // 写信窗口的 ⌘W / 红灯：先转给窗口自己弹「保存 / 不保存 / 取消」。
            // 前端确认后调 close_compose_window，那条路会先摘掉登记，所以这里只在
            //「还在登记里」时拦下来，不会把窗口变成关不掉的。
            if label.starts_with("compose-window-") {
                match event {
                    tauri::WindowEvent::CloseRequested { api, .. } => {
                        let registered = window
                            .app_handle()
                            .try_state::<AppState>()
                            .map(|state| {
                                state
                                    .compose_windows
                                    .lock()
                                    .map(|windows| windows.contains_key(&label))
                                    .unwrap_or(false)
                            })
                            .unwrap_or(false);
                        if registered {
                            api.prevent_close();
                            let _ = window.emit_to(&label, COMPOSE_WINDOW_CLOSE, ());
                        }
                    }
                    // 写信窗口被盖住/回到前台：主窗口据此显示或收起「继续写信」悬浮条。
                    tauri::WindowEvent::Focused(_) => {
                        if let Some(state) = window.app_handle().try_state::<AppState>() {
                            emit_compose_windows(&window.app_handle(), &state);
                        }
                    }
                    _ => {}
                }
                return;
            }
            if label == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    // 主窗收到关闭请求时，写信窗一定不在前台（否则 ⌘W 会先到写信窗）。
                    // 这里只隐藏主窗；写信窗自然进入「继续写信」状态。
                    let _ = save_main_window_state(window.app_handle());
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            restart_for_update,
            update_history::update_release_history,
            take_eml_paths,
            take_notification_mail,
            notification_mail,
            save_mail_image,
            copy_mail_image,
            open_attachment_path,
            copy_attachment_paths,
            copy_mail_attachments,
            pasteboard_file_paths,
            open_eml_file,
            close_eml_file,
            preview_eml_attachment,
            save_eml_attachment,
            snapshot,
            mail_page,
            mail_neighbor,
            mail_signature,
            save_mail_signature,
            save_inbox_folders,
            account_folders,
            folder_settings,
            retention_settings,
            inspect_retention_budget,
            cancel_retention_inspection,
            save_retention,
            queue_archives,
            archive_jobs,
            archive_job_action,
            save_folder_mappings,
            sync_remote_folder,
            mail_detail,
            mail_metadata,
            mail_conversation,
            update_mail,
            folder_health,
            copy_sources,
            queue_server_copy,
            queue_server_move,
            directory_operations,
            directory_operation_action,
            probe_remote_folder,
            server_operations,
            retry_server_operation,
            save_rules,
            read_text_file,
            import_rules,
            export_rules,
            write_text_file,
            clear_local_folder,
            move_local_archive,
            rule_executions,
            rule_runs,
            rule_run_action,
            retry_rule_execution,
            preview_rule,
            run_rules,
            connect_account,
            cancel_authorization,
            edit_account,
            list_contacts,
            save_contact,
            delete_contact,
            contact_suggestions,
            apple_calendar_status,
            open_apple_calendar_settings,
            connect_apple_calendar,
            list_apple_calendars,
            list_apple_calendar_events,
            list_calendar_events,
            save_calendar_event,
            save_meeting_event,
            delete_calendar_event,
            skip_calendar_occurrence,
            all_calendar_events,
            list_calendar_subscriptions,
            save_calendar_subscription,
            set_calendar_subscription_enabled,
            delete_calendar_subscription,
            replace_calendar_subscription_events,
            mark_calendar_subscription_error,
            fetch_calendar_subscription,
            list_outbox,
            sent_upload_action,
            retry_outbox,
            reedit_sent_mail,
            archive_outbox,
            delete_outbox,
            clear_sent_outbox,
            get_preferences,
            save_preferences,
            set_restore_shortcut,
            suspend_restore_shortcut,
            toggle_do_not_disturb,
            desktop_settings,
            set_auto_start,
            test_notification,
            archive_health,
            account_action,
            sync_mail,
            save_draft,
            list_drafts,
            delete_draft,
            clear_drafts,
            open_compose_session,
            close_compose_session,
            set_compose_open,
            open_mail_window,
            mail_window_mail,
            focus_mail_window,
            open_compose_window,
            compose_window_draft,
            close_compose_window,
            close_mail_window,
            close_latest_compose_window,
            focus_compose_window,
            prepare_forward_files,
            open_forward_file,
            read_body_images,
            send_mail,
            schedule_mail,
            cancel_schedule,
            reschedule_mail,
            export_mail,
            save_attachment,
            preview_attachment,
            backup_archive,
            archive_deletion_preview,
            delete_local_archives,
            restore_archive,
            open_data_folder,
            data_dir_info,
            archive_tier_info,
            save_archive_tier_settings,
            tier_archives_now,
            normalize_archive_paths,
            tier_recall,
            archive_tier_log,
            local_archive_tree,
            create_folder,
            delete_folder,
            set_data_dir,
            reset_data_dir,
            check_data_dir,
            migrate_data_dir,
            restart_app,
            open_mail_link,
            open_meeting_app
        ])
        .build(tauri::generate_context!())
        .expect("failed to build Yanxin")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Ready)
                && !std::env::args().any(|arg| arg == "--autostart")
            {
                show_main_window(app);
                if let Some(state) = app.try_state::<AppState>() {
                    let visible = app
                        .get_webview_window("main")
                        .and_then(|window| window.is_visible().ok())
                        .unwrap_or(false);
                    let _ = state.store.log(&format!(
                        "雁信 {} 启动完成，主窗口{}",
                        app.package_info().version,
                        if visible { "已显示" } else { "尚未显示" }
                    ));
                }
            }
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { ref urls } = event {
                if let Some(docs) = app.try_state::<eml_files::EmlFiles>() {
                    for url in urls {
                        if let Ok(path) = url.to_file_path() {
                            docs.queue(path);
                        }
                    }
                    let _ = app.emit("eml-files-available", ());
                    show_main_window(app);
                }
            }
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                show_main_window(app);
            }
            if let tauri::RunEvent::Exit = event {
                // 插件自己也会在 Exit 存一次窗口状态；这里顺带记下「铺满」意图，
                // 让 ⌘Q 退出和 ⌘W 收进托盘走同一套判定。
                let _ = save_main_window_state(app);
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (app, event);
        });
}
#[cfg(test)]
mod tests;
