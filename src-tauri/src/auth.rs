use crate::models::*;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    io::{Read, Write},
    net::TcpListener,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::{Duration, Instant},
};
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Secret {
    #[serde(default)]
    pub password: String,
    #[serde(default)]
    pub smtp_password: String,
    #[serde(default)]
    pub access_token: String,
    #[serde(default)]
    pub refresh_token: String,
    #[serde(default)]
    pub expires_at: i64,
}
fn vault_entry(id: &str) -> Result<crate::credentials::Entry> {
    crate::credentials::entry(id)
}
/// Only used by the explicit/lazy migration path; normal reads and writes go
/// through the encrypted vault.
fn legacy_entry(id: &str) -> Result<keyring::Entry> {
    keyring::Entry::new("dev.maildesk.desktop", id).map_err(err)
}
const WRITE_FAILED: &str = "无法写入系统钥匙串。请确认钥匙串已解锁，并在弹出的窗口中选“始终允许”";
// Keychain interaction is a process-wide setting, so every native read and
// write must hold this gate while it changes or relies on that setting.
fn keychain_gate() -> &'static Mutex<()> {
    static GATE: OnceLock<Mutex<()>> = OnceLock::new();
    GATE.get_or_init(Default::default)
}
#[cfg(target_os = "macos")]
struct Interaction(u8);
#[cfg(target_os = "macos")]
#[link(name = "Security", kind = "framework")]
extern "C" {
    fn SecKeychainGetUserInteractionAllowed(state: *mut u8) -> i32;
    fn SecKeychainSetUserInteractionAllowed(state: u8) -> i32;
}
#[cfg(target_os = "macos")]
impl Interaction {
    fn new(allowed: bool) -> Result<Self> {
        let mut previous = 0;
        unsafe {
            if SecKeychainGetUserInteractionAllowed(&mut previous) != 0 {
                return Err(WRITE_FAILED.into());
            }
            // Never enable interaction when the host process already disabled it.
            if SecKeychainSetUserInteractionAllowed(u8::from(allowed && previous != 0)) != 0 {
                return Err(WRITE_FAILED.into());
            }
        }
        Ok(Self(previous))
    }
}
#[cfg(target_os = "macos")]
impl Drop for Interaction {
    fn drop(&mut self) {
        unsafe {
            SecKeychainSetUserInteractionAllowed(self.0);
        }
    }
}
fn with_keychain<T>(interactive: bool, run: impl FnOnce() -> Result<T>) -> Result<T> {
    let _gate = keychain_gate().lock().map_err(err)?;
    #[cfg(target_os = "macos")]
    let _interaction = Interaction::new(interactive)?;
    #[cfg(not(target_os = "macos"))]
    let _ = interactive;
    run()
}
// A refresh can succeed while the Keychain write is temporarily denied. Keep
// the new token usable for this session and retry the write only when the user
// asks for it; background workers must never raise an authorization prompt.
fn fresh_secrets() -> &'static Mutex<HashMap<String, Secret>> {
    static FRESH: OnceLock<Mutex<HashMap<String, Secret>>> = OnceLock::new();
    FRESH.get_or_init(Default::default)
}
fn pending_writes() -> &'static Mutex<HashSet<String>> {
    static PENDING: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    PENDING.get_or_init(Default::default)
}
fn pending_notices() -> &'static Mutex<HashSet<String>> {
    static NOTICES: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    NOTICES.get_or_init(Default::default)
}
fn forget_session_state(id: &str) {
    if let Ok(mut fresh) = fresh_secrets().lock() {
        fresh.remove(id);
    }
    if let Ok(mut pending) = pending_writes().lock() {
        pending.remove(id);
    }
    if let Ok(mut notices) = pending_notices().lock() {
        notices.remove(id);
    }
}
fn save_with(id: &str, s: &Secret, interactive: bool) -> Result<()> {
    let raw = serde_json::to_string(s).map_err(err)?;
    if interactive {
        vault_entry(id)?.set_password_interactive(&raw)?;
    } else {
        vault_entry(id)?.set_password(&raw)?;
    }
    forget_session_state(id);
    Ok(())
}
/// The first explicit user action after a background write failure retries the
/// Keychain write once with interaction enabled.
pub fn save_interactive(id: &str, s: &Secret) -> Result<()> {
    let gate = credential_gate(id)?;
    let _guard = gate.lock().map_err(err)?;
    save_with(id, s, true)
}
pub fn pending_write(id: &str) -> bool {
    pending_writes()
        .lock()
        .map(|pending| pending.contains(id))
        .unwrap_or(false)
}
/// Returns true only for the first notice in one pending episode, so a
/// minute-by-minute retry cannot repeat the same warning.
pub fn take_pending_notice(id: &str) -> bool {
    if !pending_write(id) {
        return false;
    }
    pending_notices()
        .lock()
        .map(|mut notices| notices.insert(id.to_owned()))
        .unwrap_or(false)
}
pub fn flush_pending(id: &str) -> Result<bool> {
    let gate = credential_gate(id)?;
    let _guard = gate.lock().map_err(err)?;
    let secret = fresh_secrets().lock().map_err(err)?.get(id).cloned();
    let Some(secret) = secret else {
        forget_session_state(id);
        return Ok(false);
    };
    save_with(id, &secret, true)?;
    Ok(true)
}
fn load_with(id: &str, interactive: bool) -> Result<Secret> {
    let entry = vault_entry(id)?;
    let raw = match entry.get_password() {
        Ok(raw) => raw,
        Err(error) if error.contains("未保存该项凭据") => {
            // One-time migration from the old per-account Keychain entry. The
            // original remains untouched so a failed upgrade can be inspected.
            let legacy = with_keychain(interactive, || {
                legacy_entry(id)?
                    .get_password()
                    .map_err(|_| "无法读取旧版钥匙串凭据，请重新连接账号".to_string())
            })?;
            if interactive {
                entry.set_password_interactive(&legacy)?;
            } else {
                entry.set_password(&legacy)?;
            }
            legacy
        }
        Err(error) => return Err(error),
    };
    serde_json::from_str(&raw).map_err(|_| "账号凭据格式无效，原记录已保留，请重新连接账号".into())
}
pub fn load(id: &str) -> Result<Secret> {
    load_with(id, true)
}
/// Import one old Keychain entry into the vault. Returns false when the vault
/// already has a value; never deletes the legacy entry.
pub fn migrate_legacy(id: &str) -> Result<bool> {
    let gate = credential_gate(id)?;
    let _guard = gate.lock().map_err(err)?;
    let entry = vault_entry(id)?;
    if entry.get_password().is_ok() {
        return Ok(false);
    }
    let raw = with_keychain(true, || {
        legacy_entry(id)?
            .get_password()
            .map_err(|_| "无法读取旧版钥匙串凭据，请重新连接账号".to_string())
    })?;
    entry.set_password_interactive(&raw)?;
    forget_session_state(id);
    Ok(true)
}
pub fn remove(id: &str) -> Result<crate::credentials::Previous> {
    let previous = vault_entry(id)?.replace(None)?;
    forget_session_state(id);
    Ok(previous)
}
pub fn restore(id: &str, previous: crate::credentials::Previous) -> Result<()> {
    vault_entry(id)?.restore(previous)?;
    forget_session_state(id);
    Ok(())
}
fn endpoints(a: &Account) -> Result<(&'static str, &'static str, &'static str)> {
    match a.provider.as_str(){"gmail"=>Ok(("https://accounts.google.com/o/oauth2/v2/auth","https://oauth2.googleapis.com/token","https://mail.google.com/")),"outlook"|"microsoft365"=>Ok(("https://login.microsoftonline.com/common/oauth2/v2.0/authorize","https://login.microsoftonline.com/common/oauth2/v2.0/token","offline_access https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/POP.AccessAsUser.All https://outlook.office.com/SMTP.Send")),_=>Err("该服务商请使用密码或授权码认证".into())}
}
pub fn client_id(a: &Account) -> String {
    if !a.oauth_client_id.is_empty() {
        a.oauth_client_id.clone()
    } else {
        match a.provider.as_str() {
            "gmail" => option_env!("MAIL_GOOGLE_CLIENT_ID").unwrap_or("").into(),
            _ => option_env!("MAIL_MICROSOFT_CLIENT_ID").unwrap_or("").into(),
        }
    }
}
fn exchange(a: &Account, mut fields: Vec<(&str, String)>) -> Result<Secret> {
    let (_, endpoint, _) = endpoints(a)?;
    fields.push(("client_id", client_id(a)));
    if a.provider == "gmail" {
        if let Some(secret) = option_env!("MAIL_GOOGLE_CLIENT_SECRET") {
            fields.push(("client_secret", secret.into()));
        }
    }
    let res = reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(err)?
        .post(endpoint)
        .form(&fields)
        .send()
        .map_err(err)?;
    if !res.status().is_success() {
        return Err(format!(
            "授权服务返回 {}，请检查应用注册、重定向地址与授权范围",
            res.status()
        ));
    }
    let v: serde_json::Value = res.json().map_err(err)?;
    let access = v["access_token"]
        .as_str()
        .ok_or("授权未返回访问令牌")?
        .to_owned();
    Ok(Secret {
        access_token: access,
        refresh_token: v["refresh_token"].as_str().unwrap_or_default().into(),
        expires_at: chrono::Utc::now().timestamp() + v["expires_in"].as_i64().unwrap_or(3600),
        ..Default::default()
    })
}
// Sync, SMTP and online reading may refresh the same OAuth token concurrently.
// Hold only a per-account credential lock, never the long-running sync guard.
fn credential_gate(id: &str) -> Result<Arc<Mutex<()>>> {
    static GATES: OnceLock<Mutex<HashMap<String, Arc<Mutex<()>>>>> = OnceLock::new();
    Ok(GATES
        .get_or_init(Default::default)
        .lock()
        .map_err(err)?
        .entry(id.to_owned())
        .or_default()
        .clone())
}
pub fn credentials(a: &Account) -> Result<Secret> {
    let gate = credential_gate(&a.id)?;
    let _guard = gate.lock().map_err(err)?;
    let cached = fresh_secrets().lock().map_err(err)?.get(&a.id).cloned();
    let mut s = match cached {
        Some(secret) => secret,
        None => load_with(&a.id, false).or_else(|_| {
            // A changed code signature or Keychain ACL needs one explicit
            // approval. Background reads cannot raise that prompt on their own.
            load_with(&a.id, true)
        })?,
    };
    if a.auth == "oauth" && s.expires_at < chrono::Utc::now().timestamp() + 60 {
        if s.refresh_token.is_empty() {
            return Err("授权已过期，请重新连接账号".into());
        }
        let mut new = exchange(
            a,
            vec![
                ("grant_type", "refresh_token".into()),
                ("refresh_token", s.refresh_token.clone()),
            ],
        )?;
        if new.refresh_token.is_empty() {
            new.refresh_token = s.refresh_token;
        }
        if save_with(&a.id, &new, false).is_err() {
            // The provider accepted the refresh. Keeping the token in memory
            // lets mail flow continue; the next explicit check retries the
            // Keychain write and may ask the user to allow it.
            if let Ok(mut fresh) = fresh_secrets().lock() {
                fresh.insert(a.id.clone(), new.clone());
            }
            if let Ok(mut pending) = pending_writes().lock() {
                pending.insert(a.id.clone());
            }
        }
        s = new;
    }
    Ok(s)
}
fn pending_authorizations() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    static PENDING: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
    PENDING.get_or_init(Default::default)
}
struct AuthorizationAttempt {
    id: String,
    cancelled: Arc<AtomicBool>,
}
impl AuthorizationAttempt {
    fn start(id: &str) -> Result<Self> {
        let mut pending = pending_authorizations().lock().map_err(err)?;
        if pending.contains_key(id) {
            return Err("此账号已有授权正在进行".into());
        }
        let cancelled = Arc::new(AtomicBool::new(false));
        pending.insert(id.into(), cancelled.clone());
        Ok(Self {
            id: id.into(),
            cancelled,
        })
    }
    fn check(&self) -> Result<()> {
        if self.cancelled.load(Ordering::Acquire) {
            Err("已取消浏览器授权，账号未保存".into())
        } else {
            Ok(())
        }
    }
}
impl Drop for AuthorizationAttempt {
    fn drop(&mut self) {
        if let Ok(mut pending) = pending_authorizations().lock() {
            pending.remove(&self.id);
        }
    }
}
pub fn cancel_authorization(id: &str) -> Result<()> {
    let pending = pending_authorizations().lock().map_err(err)?;
    let cancelled = pending
        .get(id)
        .ok_or("浏览器授权已结束，请等待当前连接结果")?;
    cancelled.store(true, Ordering::Release);
    Ok(())
}
fn redirect_uri(a: &Account, port: u16) -> String {
    let host = if a.provider == "gmail" {
        "127.0.0.1"
    } else {
        "localhost"
    };
    format!("http://{host}:{port}")
}
fn callback_code(path: &str, state: &str) -> Result<Option<String>> {
    let callback = url::Url::parse(&format!("http://127.0.0.1{path}")).map_err(err)?;
    let params = callback.query_pairs().collect::<HashMap<_, _>>();
    if params.get("state").map(|s| s.as_ref()) != Some(state) {
        return Ok(None);
    }
    if params.contains_key("error") {
        return Err("浏览器授权被拒绝或已取消，请重试".into());
    }
    params
        .get("code")
        .filter(|code| !code.is_empty())
        .map(|code| Some(code.to_string()))
        .ok_or("授权回调未返回授权码，请重新连接".into())
}
fn wait_callback(
    listener: &TcpListener,
    state: &str,
    attempt: &AuthorizationAttempt,
    timeout: Duration,
) -> Result<String> {
    let start = Instant::now();
    while start.elapsed() < timeout {
        attempt.check()?;
        match listener.accept() {
            Ok((mut stream, _)) => {
                stream
                    .set_read_timeout(Some(Duration::from_secs(3)))
                    .map_err(err)?;
                stream
                    .set_write_timeout(Some(Duration::from_secs(3)))
                    .map_err(err)?;
                let mut data = [0u8; 8192];
                let n = match stream.read(&mut data) {
                    Ok(n) => n,
                    Err(_) => continue,
                };
                let line = String::from_utf8_lossy(&data[..n]);
                let path = line.split_whitespace().nth(1).unwrap_or("/");
                let result = callback_code(path, state);
                if matches!(result, Ok(None)) {
                    let _ = stream.write_all(b"HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                    continue;
                }
                let body = if result.is_ok() {
                    "Authorization received. You can return to Yanxin."
                } else {
                    "Authorization was not completed. Return to Yanxin to try again."
                };
                let response = format!("HTTP/1.1 200 OK\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body);
                let _ = stream.write_all(response.as_bytes());
                attempt.check()?;
                return result?.ok_or("授权回调无效".into());
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(100))
            }
            Err(e) => return Err(err(e)),
        }
    }
    Err("等待浏览器授权超时（3 分钟）。请重新连接，并在新打开的浏览器页面完成授权".into())
}
pub fn authorize(a: &Account, progress: &impl Fn(&str)) -> Result<Secret> {
    if client_id(a).is_empty() {
        return Err("开发版尚未配置 OAuth Client ID。请在高级配置填写你注册的桌面应用 Client ID，或在构建时配置。".into());
    }
    let (endpoint, _, scope) = endpoints(a)?;
    let attempt = AuthorizationAttempt::start(&a.id)?;
    let listener = TcpListener::bind("127.0.0.1:0").map_err(err)?;
    listener.set_nonblocking(true).map_err(err)?;
    let redirect = redirect_uri(a, listener.local_addr().map_err(err)?.port());
    let state = uuid::Uuid::new_v4().to_string();
    let verifier = format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    );
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let mut url = url::Url::parse(endpoint).map_err(err)?;
    url.query_pairs_mut().extend_pairs([
        ("client_id", client_id(a)),
        ("redirect_uri", redirect.clone()),
        ("response_type", "code".into()),
        ("scope", scope.into()),
        ("state", state.clone()),
        ("code_challenge", challenge),
        ("code_challenge_method", "S256".into()),
        ("access_type", "offline".into()),
        ("prompt", "consent".into()),
        ("login_hint", a.email.clone()),
    ]);
    open::that(url.as_str()).map_err(err)?;
    progress("browser");
    let code = wait_callback(&listener, &state, &attempt, Duration::from_secs(180))?;
    progress("token");
    let secret = exchange(
        a,
        vec![
            ("grant_type", "authorization_code".into()),
            ("code", code),
            ("redirect_uri", redirect),
            ("code_verifier", verifier),
        ],
    )?;
    attempt.check()?;
    Ok(secret)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pending_notice_is_reported_once_per_episode() {
        let id = uuid::Uuid::new_v4().to_string();
        assert!(!pending_write(&id));
        assert!(!take_pending_notice(&id));
        pending_writes().lock().unwrap().insert(id.clone());
        assert!(pending_write(&id));
        assert!(take_pending_notice(&id));
        assert!(!take_pending_notice(&id));
        forget_session_state(&id);
        assert!(!pending_write(&id));
        pending_writes().lock().unwrap().insert(id.clone());
        assert!(take_pending_notice(&id));
        forget_session_state(&id);
    }
    #[test]
    fn deferred_write_without_memory_secret_clears_pending() {
        let id = uuid::Uuid::new_v4().to_string();
        pending_writes().lock().unwrap().insert(id.clone());
        assert!(!flush_pending(&id).unwrap());
        assert!(!pending_write(&id));
    }
    #[test]
    fn callback_requires_matching_state_and_reports_denial_without_sensitive_details() {
        assert_eq!(
            callback_code("/?state=expected&code=synthetic", "expected").unwrap(),
            Some("synthetic".into())
        );
        assert_eq!(
            callback_code("/?state=other&code=synthetic", "expected").unwrap(),
            None
        );
        assert_eq!(callback_code("/favicon.ico", "expected").unwrap(), None);
        let error = callback_code(
            "/?state=expected&error=access_denied&error_description=sensitive",
            "expected",
        )
        .unwrap_err();
        assert!(error.contains("被拒绝"));
        assert!(!error.contains("sensitive"));
        assert!(callback_code("/?state=expected&code=", "expected").is_err());
    }
    #[test]
    fn callback_wait_is_cancellable_and_cleans_up_for_retry() {
        let id = uuid::Uuid::new_v4().to_string();
        let attempt = AuthorizationAttempt::start(&id).unwrap();
        assert!(AuthorizationAttempt::start(&id).is_err());
        cancel_authorization(&id).unwrap();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        assert!(
            wait_callback(&listener, "state", &attempt, Duration::from_secs(1))
                .unwrap_err()
                .contains("取消")
        );
        drop(attempt);
        assert!(cancel_authorization(&id).is_err());
        assert!(AuthorizationAttempt::start(&id).is_ok());
    }
    #[test]
    fn callback_listener_returns_code_and_bounded_timeout() {
        let attempt = AuthorizationAttempt::start(&uuid::Uuid::new_v4().to_string()).unwrap();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let address = listener.local_addr().unwrap();
        let browser = std::thread::spawn(move || {
            let mut socket = std::net::TcpStream::connect(address).unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            socket
                .write_all(b"GET /?state=state&code=synthetic HTTP/1.1\r\nHost: localhost\r\n\r\n")
                .unwrap();
            let mut response = String::new();
            socket.read_to_string(&mut response).unwrap();
            assert!(response.contains("Authorization received"));
            assert!(!response.contains("synthetic"));
        });
        assert_eq!(
            wait_callback(&listener, "state", &attempt, Duration::from_secs(2)).unwrap(),
            "synthetic"
        );
        browser.join().unwrap();
        assert!(wait_callback(&listener, "state", &attempt, Duration::ZERO)
            .unwrap_err()
            .contains("超时"));
    }
    #[test]
    fn google_redirect_matches_ipv4_listener() {
        let mut account: Account = serde_json::from_value(serde_json::json!({
            "id":"synthetic", "name":"test", "email":"test@example.com", "provider":"gmail", "protocol":"imap", "incomingHost":"imap.gmail.com", "incomingPort":993, "incomingTls":"tls", "smtpHost":"smtp.gmail.com", "smtpPort":587, "smtpTls":"starttls", "username":"test@example.com", "smtpUsername":"", "auth":"oauth", "oauthClientId":"", "enabled":true
        })).unwrap();
        assert_eq!(redirect_uri(&account, 12345), "http://127.0.0.1:12345");
        account.provider = "outlook".into();
        assert_eq!(redirect_uri(&account, 12345), "http://localhost:12345");
    }
}
