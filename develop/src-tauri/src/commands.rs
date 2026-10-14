use crate::crypto;
use crate::models::{Account, AccountInput, AccountView, AppSettings, CodeResult, VaultFile, VaultPayload};
use crate::store;
use crate::totp;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;

/// 运行期状态：解锁后密钥只保存在内存中
pub struct AppState {
    pub app_dir: PathBuf,
    /// 当前解锁密钥；None 表示未解锁
    pub key: Mutex<Option<[u8; 32]>>,
    /// 已解锁内存中的保险库载荷缓存
    pub payload: Mutex<Option<VaultPayload>>,
    /// 关闭按钮行为缓存（quit | tray），供窗口事件同步读取
    pub close_behavior: Mutex<String>,
}

impl AppState {
    pub fn new(app_dir: PathBuf) -> Self {
        Self {
            app_dir,
            key: Mutex::new(None),
            payload: Mutex::new(None),
            close_behavior: Mutex::new("quit".to_string()),
        }
    }

    /// 读取当前关闭行为（供窗口事件使用）
    pub fn close_behavior(&self) -> String {
        self.close_behavior
            .lock()
            .map(|v| v.clone())
            .unwrap_or_else(|_| "quit".to_string())
    }

    /// 同步关闭行为缓存
    fn sync_close_behavior(&self, payload: &VaultPayload) {
        if let Ok(mut guard) = self.close_behavior.lock() {
            *guard = payload.settings.close_behavior.clone();
        }
    }

    pub fn current_key(&self) -> Result<[u8; 32], String> {
        self.key
            .lock()
            .map_err(|_| "状态锁异常".to_string())?
            .ok_or_else(|| "应用未解锁".to_string())
    }

    pub fn with_payload<F, T>(&self, f: F) -> Result<T, String>
    where
        F: FnOnce(&mut VaultPayload) -> Result<T, String>,
    {
        let mut guard = self.payload.lock().map_err(|_| "状态锁异常".to_string())?;
        let payload = guard.as_mut().ok_or_else(|| "应用未解锁".to_string())?;
        f(payload)
    }

    /// 持久化当前内存载荷（加密写回）
    pub fn persist(&self) -> Result<(), String> {
        let key = self.current_key()?;
        let guard = self.payload.lock().map_err(|_| "状态锁异常".to_string())?;
        let payload = guard.as_ref().ok_or_else(|| "应用未解锁".to_string())?;

        let existing = store::read_vault(&self.app_dir).ok();
        let (salt, uses_machine_key) = match existing {
            Some(f) => {
                let salt = crypto::decode_salt(&f)?;
                (salt, f.uses_machine_key)
            }
            None => (crypto::new_salt(), true),
        };

        let file = crypto::encrypt_payload(payload, &key, &salt, uses_machine_key)?;
        store::write_vault(&self.app_dir, &file)?;

        if payload.settings.auto_backup {
            let _ = store::write_backup(&self.app_dir, &file);
            store::prune_backups(&self.app_dir, payload.settings.backup_keep);
        }
        Ok(())
    }
}

#[derive(serde::Serialize)]
pub struct StatusView {
    pub has_vault: bool,
    pub has_lock: bool,
    pub locked: bool,
    pub password_hint: String,
    pub lock_only_on_start: bool,
}

#[tauri::command]
pub fn get_status(state: State<AppState>) -> Result<StatusView, String> {
    let has_vault = store::vault_exists(&state.app_dir);
    let lock = store::read_lock(&state.app_dir);
    let locked = state
        .key
        .lock()
        .map_err(|_| "状态锁异常".to_string())?
        .is_none();
    let settings = state
        .payload
        .lock()
        .ok()
        .and_then(|p| p.as_ref().map(|v| v.settings.clone()))
        .unwrap_or_default();

    Ok(StatusView {
        has_vault,
        has_lock: lock.is_some(),
        locked,
        password_hint: lock.map(|l| l.hint).unwrap_or_default(),
        lock_only_on_start: settings.lock_enabled,
    })
}

/// 首次启动：创建保险库并解锁进入
#[tauri::command]
pub fn initialize_vault(state: State<AppState>) -> Result<(), String> {
    store::ensure_app_dir(&state.app_dir)?;
    let salt = crypto::new_salt();
    let key = crypto::machine_key();

    if !store::vault_exists(&state.app_dir) {
        store::create_empty_vault(&state.app_dir, &key, &salt, true)?;
    }

    let file = store::read_vault(&state.app_dir)?;
    let real_salt = crypto::decode_salt(&file)?;
    let payload = crypto::decrypt_payload(&file, &key)?;

    *state.key.lock().map_err(|_| "状态锁异常".to_string())? = Some(key);
    state.sync_close_behavior(&payload);
    *state.payload.lock().map_err(|_| "状态锁异常".to_string())? = Some(payload);
    let _ = real_salt;
    Ok(())
}

/// 使用锁定密码解锁
#[tauri::command]
pub fn unlock(state: State<AppState>, password: String) -> Result<(), String> {
    let lock = store::read_lock(&state.app_dir).ok_or_else(|| "未设置锁定密码".to_string())?;
    let salt = base64_decode(&lock.salt)?;
    let key = crypto::derive_key(&password, &salt)?;
    let verifier = crypto::hash_password(&password, &salt)?;
    if verifier != lock.verifier {
        return Err("密码错误".to_string());
    }

    let file = store::read_vault(&state.app_dir)?;
    let payload = crypto::decrypt_payload(&file, &key)?;

    *state.key.lock().map_err(|_| "状态锁异常".to_string())? = Some(key);
    state.sync_close_behavior(&payload);
    *state.payload.lock().map_err(|_| "状态锁异常".to_string())? = Some(payload);
    Ok(())
}

/// 锁定：清空内存密钥与载荷
#[tauri::command]
pub fn lock(state: State<AppState>) -> Result<(), String> {
    *state.key.lock().map_err(|_| "状态锁异常".to_string())? = None;
    *state.payload.lock().map_err(|_| "状态锁异常".to_string())? = None;
    Ok(())
}

/// 设置或修改锁定密码
#[tauri::command]
pub fn set_lock_password(
    state: State<AppState>,
    password: String,
    hint: String,
    enable: bool,
) -> Result<(), String> {
    if enable {
        crypto::validate_password(&password)?;
    }

    // 读取当前载荷（应用已解锁）
    let payload = state
        .payload
        .lock()
        .map_err(|_| "状态锁异常".to_string())?
        .clone()
        .ok_or_else(|| "应用未解锁".to_string())?;

    if enable {
        let salt = crypto::new_salt();
        let key = crypto::derive_key(&password, &salt)?;
        let verifier = crypto::hash_password(&password, &salt)?;

        let file = crypto::encrypt_payload(&payload, &key, &salt, false)?;
        store::write_vault(&state.app_dir, &file)?;

        store::write_lock(
            &state.app_dir,
            &store::LockRecord {
                salt: base64_encode(&salt),
                verifier,
                hint: hint.clone(),
            },
        )?;

        *state.key.lock().map_err(|_| "状态锁异常".to_string())? = Some(key);
    } else {
        // 关闭锁定：改回机器密钥
        let salt = crypto::new_salt();
        let key = crypto::machine_key();
        let file = crypto::encrypt_payload(&payload, &key, &salt, true)?;
        store::write_vault(&state.app_dir, &file)?;
        store::remove_lock(&state.app_dir)?;
        *state.key.lock().map_err(|_| "状态锁异常".to_string())? = Some(key);
    }

    // 同步设置
    let mut guard = state.payload.lock().map_err(|_| "状态锁异常".to_string())?;
    if let Some(p) = guard.as_mut() {
        p.settings.lock_enabled = enable;
        p.settings.password_hint = if enable { hint } else { String::new() };
    }
    drop(guard);
    state.persist()?;
    Ok(())
}

/// 更新已有账户的可编辑字段（服务名、账户标识、密钥、算法、位数、周期、分类）
#[tauri::command]
pub fn update_account(
    state: State<AppState>,
    id: String,
    input: AccountInput,
) -> Result<AccountView, String> {
    totp::validate_secret(&input.secret)?;
    if input.issuer.trim().is_empty() {
        return Err("服务名称不能为空".to_string());
    }
    totp::validate_account_input(&input.otp_type, &input.algorithm, input.digits, input.period)?;
    let mut view: Option<AccountView> = None;
    state.with_payload(|p| {
        let acc = p
            .accounts
            .iter_mut()
            .find(|a| a.id == id)
            .ok_or_else(|| "账户不存在".to_string())?;
        acc.issuer = input.issuer.trim().to_string();
        acc.account = input.account.trim().to_string();
        acc.secret = totp::normalize_secret(&input.secret);
        acc.otp_type = normalize_otp_type(&input.otp_type);
        acc.algorithm = totp::normalize_algorithm(&input.algorithm);
        acc.digits = input.digits;
        acc.period = input.period;
        acc.counter = input.counter;
        acc.category = input.category.clone();
        view = Some(AccountView::from(&*acc));
        Ok(())
    })?;
    state.persist()?;
    view.ok_or_else(|| "账户更新失败".to_string())
}

/// 从 otpauth 链接解析单个账户（供扫码后预览确认）
#[tauri::command]
pub fn parse_otpauth(uri: String) -> Result<ParsedAccount, String> {
    let acc = store::parse_otpauth(&uri)?;
    Ok(ParsedAccount {
        issuer: acc.issuer,
        account: acc.account,
        secret: acc.secret,
        otp_type: acc.otp_type,
        algorithm: acc.algorithm,
        digits: acc.digits,
        period: acc.period,
        counter: acc.counter,
    })
}

#[derive(serde::Serialize)]
pub struct ParsedAccount {
    pub issuer: String,
    pub account: String,
    pub secret: String,
    pub otp_type: String,
    pub algorithm: String,
    pub digits: u32,
    pub period: u32,
    pub counter: u64,
}

/// 规范化 OTP 类型：仅允许 totp / hotp，缺省 totp
fn normalize_otp_type(value: &str) -> String {
    match value.trim().to_ascii_lowercase().as_str() {
        "hotp" => "hotp".to_string(),
        _ => "totp".to_string(),
    }
}

#[tauri::command]
pub fn list_accounts(state: State<AppState>) -> Result<Vec<AccountView>, String> {
    state.with_payload(|p| {
        let mut list: Vec<AccountView> = p.accounts.iter().map(AccountView::from).collect();
        list.sort_by(|a, b| {
            b.favorite
                .cmp(&a.favorite)
                .then(b.last_used_at.cmp(&a.last_used_at))
                .then(a.issuer.cmp(&b.issuer))
        });
        Ok(list)
    })
}

#[tauri::command]
pub fn get_codes(state: State<AppState>) -> Result<Vec<CodeResult>, String> {
    let now = totp::now_secs();
    state.with_payload(|p| {
        let mut results = Vec::new();
        for account in &p.accounts {
            if let Ok((code, remaining, progress)) = totp::generate_code(account, now) {
                results.push(CodeResult {
                    id: account.id.clone(),
                    code,
                    otp_type: account.otp_type.clone(),
                    remaining,
                    progress,
                });
            }
        }
        Ok(results)
    })
}

#[tauri::command]
pub fn get_account_detail(state: State<AppState>, id: String) -> Result<AccountView, String> {
    state.with_payload(|p| {
        p.accounts
            .iter()
            .find(|a| a.id == id)
            .map(AccountView::from)
            .ok_or_else(|| "账户不存在".to_string())
    })
}

#[tauri::command]
pub fn add_account(state: State<AppState>, input: AccountInput) -> Result<AccountView, String> {
    totp::validate_secret(&input.secret)?;
    if input.issuer.trim().is_empty() {
        return Err("服务名称不能为空".to_string());
    }
    totp::validate_account_input(&input.otp_type, &input.algorithm, input.digits, input.period)?;
    let account = Account {
        id: uuid::Uuid::new_v4().to_string(),
        issuer: input.issuer.trim().to_string(),
        account: input.account.trim().to_string(),
        secret: totp::normalize_secret(&input.secret),
        otp_type: normalize_otp_type(&input.otp_type),
        algorithm: totp::normalize_algorithm(&input.algorithm),
        digits: input.digits,
        period: input.period,
        counter: input.counter,
        category: input.category,
        favorite: false,
        created_at: totp::now_millis(),
        last_used_at: 0,
    };
    let view = AccountView::from(&account);
    state.with_payload(|p| {
        p.accounts.push(account);
        Ok(())
    })?;
    state.persist()?;
    Ok(view)
}

/// 追加导入一批 otpauth 链接文本
#[tauri::command]
pub fn import_otpauth_text(state: State<AppState>, text: String) -> Result<u32, String> {
    let mut parsed: Vec<Account> = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if let Ok(mut acc) = store::parse_otpauth(line) {
            acc.secret = totp::normalize_secret(&acc.secret);
            parsed.push(acc);
        }
    }
    if parsed.is_empty() {
        return Err("未解析到有效账户".to_string());
    }
    let count = parsed.len() as u32;
    state.with_payload(|p| {
        p.accounts.extend(parsed);
        Ok(())
    })?;
    state.persist()?;
    Ok(count)
}

#[tauri::command]
pub fn delete_account(state: State<AppState>, id: String) -> Result<(), String> {
    state.with_payload(|p| {
        let before = p.accounts.len();
        p.accounts.retain(|a| a.id != id);
        if p.accounts.len() == before {
            return Err("账户不存在".to_string());
        }
        Ok(())
    })?;
    state.persist()?;
    Ok(())
}

#[tauri::command]
pub fn toggle_favorite(state: State<AppState>, id: String) -> Result<bool, String> {
    let mut value = false;
    state.with_payload(|p| {
        let acc = p
            .accounts
            .iter_mut()
            .find(|a| a.id == id)
            .ok_or_else(|| "账户不存在".to_string())?;
        acc.favorite = !acc.favorite;
        value = acc.favorite;
        Ok(())
    })?;
    state.persist()?;
    Ok(value)
}

#[tauri::command]
pub fn mark_used(state: State<AppState>, id: String) -> Result<(), String> {
    state.with_payload(|p| {
        if let Some(acc) = p.accounts.iter_mut().find(|a| a.id == id) {
            acc.last_used_at = totp::now_millis();
            // HOTP 每次使用后计数器前进一位，否则会一直生成同一个验证码
            if acc.otp_type.eq_ignore_ascii_case("hotp") {
                acc.counter = acc.counter.saturating_add(1);
            }
        }
        Ok(())
    })?;
    state.persist()?;
    Ok(())
}

#[tauri::command]
pub fn get_settings(state: State<AppState>) -> Result<AppSettings, String> {
    state.with_payload(|p| Ok(p.settings.clone()))
}

#[tauri::command]
pub fn update_settings(state: State<AppState>, settings: AppSettings) -> Result<(), String> {
    state.with_payload(|p| {
        p.settings = settings;
        Ok(())
    })?;
    state.persist()?;
    // 同步关闭行为缓存，供窗口事件即时生效
    if let Ok(guard) = state.payload.lock() {
        if let Some(p) = guard.as_ref() {
            state.sync_close_behavior(p);
        }
    }
    Ok(())
}

/// 导出为加密备份字符串（OneTotp 格式）
/// `include_accounts` / `include_settings` 控制导出内容范围
#[tauri::command]
pub fn export_vault(
    state: State<AppState>,
    password: String,
    include_accounts: bool,
    include_settings: bool,
) -> Result<String, String> {
    crypto::validate_password(&password)?;
    if !include_accounts && !include_settings {
        return Err("请至少选择一项要导出的内容".to_string());
    }
    let full = state
        .payload
        .lock()
        .map_err(|_| "状态锁异常".to_string())?
        .clone()
        .ok_or_else(|| "应用未解锁".to_string())?;

    // 按选择构造导出载荷：未勾选的部分置空
    let export_payload = VaultPayload {
        accounts: if include_accounts {
            full.accounts.clone()
        } else {
            Vec::new()
        },
        settings: if include_settings {
            full.settings.clone()
        } else {
            AppSettings::default()
        },
    };

    let salt = crypto::new_salt();
    let key = crypto::derive_key(&password, &salt)?;
    let scope = crate::models::BackupScope {
        accounts: include_accounts,
        settings: include_settings,
    };
    let file = crypto::encrypt_payload_with_scope(&export_payload, &key, &salt, false, scope)?;
    serde_json::to_string_pretty(&file).map_err(|e| e.to_string())
}

/// 从加密备份导入。按备份范围标记合并：
/// - 含账户：将备份账户合并进现有账户（按 id 去重）
/// - 含配置：覆盖当前应用配置
#[tauri::command]
pub fn import_vault(
    state: State<AppState>,
    content: String,
    password: String,
) -> Result<ImportResult, String> {
    let file: VaultFile =
        serde_json::from_str(&content).map_err(|_| "备份文件格式不正确".to_string())?;
    let salt = crypto::decode_salt(&file)?;
    let key = crypto::derive_key(&password, &salt)?;
    let imported = crypto::decrypt_payload(&file, &key)?;

    let scope = file.scope.clone();
    let mut added_accounts = 0u32;
    let mut applied_settings = false;

    state.with_payload(|p| {
        if scope.accounts {
            let existing: std::collections::HashSet<String> =
                p.accounts.iter().map(|a| a.id.clone()).collect();
            for acc in imported.accounts.iter() {
                if !existing.contains(&acc.id) {
                    p.accounts.push(acc.clone());
                    added_accounts += 1;
                }
            }
        }
        if scope.settings {
            p.settings = imported.settings.clone();
            applied_settings = true;
        }
        Ok(())
    })?;
    state.persist()?;

    Ok(ImportResult {
        added_accounts,
        applied_settings,
        total_accounts_in_backup: imported.accounts.len() as u32,
    })
}

#[derive(serde::Serialize)]
pub struct ImportResult {
    pub added_accounts: u32,
    pub applied_settings: bool,
    pub total_accounts_in_backup: u32,
}

#[tauri::command]
pub fn list_backups(state: State<AppState>) -> Result<Vec<BackupView>, String> {
    Ok(store::list_backups(&state.app_dir)
        .into_iter()
        .map(|(name, size)| BackupView { name, size })
        .collect())
}

#[derive(serde::Serialize)]
pub struct BackupView {
    pub name: String,
    pub size: u64,
}

fn base64_encode(data: &[u8]) -> String {
    use base64::{engine::general_purpose::STANDARD as B64, Engine};
    B64.encode(data)
}

fn base64_decode(data: &str) -> Result<Vec<u8>, String> {
    use base64::{engine::general_purpose::STANDARD as B64, Engine};
    B64.decode(data).map_err(|_| "Base64 解码失败".to_string())
}
