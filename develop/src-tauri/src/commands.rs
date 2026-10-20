use crate::crypto;
use crate::models::{Account, AccountInput, AccountView, AppSettings, CodeResult, VaultFile, VaultPayload};
use crate::store;
use crate::totp;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;

/// 重复账户错误前缀：格式 `duplicate:{issuer}|{account}`，
/// 供前端识别并给出「该验证码已存在」的明确提示。
pub const DUPLICATE_MARKER: &str = "duplicate:";

/// 运行期状态：解锁后密钥只保存在内存中
pub struct AppState {
    pub app_dir: PathBuf,
    /// 当前解锁密钥；None 表示未解锁
    pub key: Mutex<Option<[u8; 32]>>,
    /// 已解锁内存中的保险库载荷缓存
    pub payload: Mutex<Option<VaultPayload>>,
    /// 关闭按钮行为缓存（quit | tray），供窗口事件同步读取
    pub close_behavior: Mutex<String>,
    /// TOTP 验证码缓存：key = 账户 id，value = (周期序号, 当前码, 下一个码)。
    /// 同一周期内复用 HMAC 结果，仅在跨周期（或账户变更）时重算。
    pub code_cache: Mutex<std::collections::HashMap<String, (u64, String, Option<String>)>>,
    /// 解锁失败次数与最近一次失败时间：用于抵御脚本爆破（指数退避）
    pub unlock_failures: Mutex<(u32, std::time::Instant)>,
}

impl AppState {
    pub fn new(app_dir: PathBuf) -> Self {
        Self {
            app_dir,
            key: Mutex::new(None),
            payload: Mutex::new(None),
            close_behavior: Mutex::new("quit".to_string()),
            code_cache: Mutex::new(std::collections::HashMap::new()),
            unlock_failures: Mutex::new((0, std::time::Instant::now())),
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
        self.persist_inner(true, true)
    }

    /// 仅落盘主库、不产生备份快照，且不动验证码缓存。
    /// 用于高频且不影响验证码结果的数据变更（如「最近使用」时间戳）：
    /// 若走完整 persist，每次复制验证码都会生成一份备份，很快把真正的
    /// 数据变更快照挤出保留窗口；同时清缓存会让所有账户白白重算一次 HMAC。
    pub fn persist_quiet(&self) -> Result<(), String> {
        self.persist_inner(false, false)
    }

    fn persist_inner(&self, with_backup: bool, clear_cache: bool) -> Result<(), String> {
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

        // 数据已变更：清空验证码缓存，确保下次取码按最新账户/密钥重算
        if clear_cache {
            if let Ok(mut cache) = self.code_cache.lock() {
                cache.clear();
            }
        }

        if with_backup && payload.settings.auto_backup {
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
    let key = crypto::load_or_create_machine_key(&state.app_dir)?;

    if !store::vault_exists(&state.app_dir) {
        store::create_empty_vault(&state.app_dir, &key, &salt, true)?;
    }

    let file = store::read_vault(&state.app_dir)?;
    let real_salt = crypto::decode_salt(&file)?;

    // 尝试用当前机器密钥解密；失败则回退到旧版派生密钥（兼容历史数据），
    // 成功迁移后立即用新密钥重写，确保往后只依赖设备本地随机密钥。
    let (mut payload, needs_rekey) = match crypto::decrypt_payload(&file, &key) {
        Ok(p) => (p, false),
        Err(_) => {
            let legacy = crypto::legacy_machine_key_compat();
            let p = crypto::decrypt_payload(&file, &legacy)
                .map_err(|e| format!("无法解密保险库：{e}"))?;
            (p, true)
        }
    };
    let migrated = migrate_categories(&mut payload);

    *state.key.lock().map_err(|_| "状态锁异常".to_string())? = Some(key);
    state.sync_close_behavior(&payload);
    *state.payload.lock().map_err(|_| "状态锁异常".to_string())? = Some(payload);
    if migrated || needs_rekey {
        state.persist()?;
    }
    let _ = real_salt;
    Ok(())
}

/// 使用锁定密码解锁
#[tauri::command]
pub fn unlock(state: State<AppState>, password: String) -> Result<(), String> {
    // 失败退避：连续失败越多，延迟越长（上限 3 秒），抵御脚本暴力尝试。
    // 成功输入密码时不受影响（仅在上次失败后的冷却期内施加延迟）。
    {
        let guard = state
            .unlock_failures
            .lock()
            .map_err(|_| "状态锁异常".to_string())?;
        let (count, last) = *guard;
        if count > 0 {
            // 指数退避：200ms * 2^(n-1)，封顶 3s
            let backoff = std::time::Duration::from_millis(
                (200u64.saturating_mul(1u64 << (count.min(5) - 1))).min(3000),
            );
            let elapsed = last.elapsed();
            if elapsed < backoff {
                std::thread::sleep(backoff - elapsed);
            }
        }
    }

    let lock = store::read_lock(&state.app_dir).ok_or_else(|| "未设置锁定密码".to_string())?;
    let salt = base64_decode(&lock.salt)?;
    // 只派生一次 Argon2id：derive_key 与 hash_password 等价（后者就是前者再 base64），
    // 原先调用两次会把最耗时的密钥派生做两遍，明显拖慢解锁。
    let key = crypto::derive_key(&password, &salt)?;
    let verifier = base64_encode(&key);
    if verifier != lock.verifier {
        if let Ok(mut guard) = state.unlock_failures.lock() {
            guard.0 = guard.0.saturating_add(1);
            guard.1 = std::time::Instant::now();
        }
        return Err("密码错误".to_string());
    }

    // 解锁成功：重置失败计数
    if let Ok(mut guard) = state.unlock_failures.lock() {
        *guard = (0, std::time::Instant::now());
    }

    let file = store::read_vault(&state.app_dir)?;
    let mut payload = crypto::decrypt_payload(&file, &key)?;
    let migrated = migrate_categories(&mut payload);

    *state.key.lock().map_err(|_| "状态锁异常".to_string())? = Some(key);
    state.sync_close_behavior(&payload);
    *state.payload.lock().map_err(|_| "状态锁异常".to_string())? = Some(payload);
    if migrated {
        state.persist()?;
    }
    Ok(())
}

/// 锁定：清空内存密钥与载荷
#[tauri::command]
pub fn lock(state: State<AppState>) -> Result<(), String> {
    *state.key.lock().map_err(|_| "状态锁异常".to_string())? = None;
    *state.payload.lock().map_err(|_| "状态锁异常".to_string())? = None;
    // 锁定后不应在内存中残留任何有效验证码
    if let Ok(mut cache) = state.code_cache.lock() {
        cache.clear();
    }
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
        // 同 unlock：Argon2id 只派生一次，verifier 即该密钥的 base64
        let key = crypto::derive_key(&password, &salt)?;
        let verifier = base64_encode(&key);

        // 顺序很关键：先写锁定凭证（含派生所需的 salt + verifier），再写保险库。
        // 若反过来，一旦「保险库已用新密码密钥加密、凭证却未落盘」，
        // salt 丢失将导致数据永久无法解密。
        //
        // 回滚必须恢复「原来的凭证」而不是直接删除：本命令同时用于
        // 「首次启用锁定」与「修改密码」。修改密码时保险库此刻仍是旧密码密钥
        // 加密的，若把旧凭证删掉，用户就再也无法解密自己的数据。
        let previous_lock = store::read_lock(&state.app_dir);
        store::write_lock(
            &state.app_dir,
            &store::LockRecord {
                salt: base64_encode(&salt),
                verifier,
                hint: hint.clone(),
            },
        )?;

        let file = crypto::encrypt_payload(&payload, &key, &salt, false)?;
        if let Err(e) = store::write_vault(&state.app_dir, &file) {
            match previous_lock {
                Some(prev) => {
                    // 恢复旧凭证，使旧密码仍可解开当前保险库
                    let _ = store::write_lock(&state.app_dir, &prev);
                }
                None => {
                    // 首次启用：原本没有锁，删除凭证即回到「未启用锁定」
                    let _ = store::remove_lock(&state.app_dir);
                }
            }
            return Err(e);
        }

        *state.key.lock().map_err(|_| "状态锁异常".to_string())? = Some(key);
    } else {
        // 关闭锁定：改回设备本地机器密钥
        let salt = crypto::new_salt();
        let key = crypto::load_or_create_machine_key(&state.app_dir)?;
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
    let secret = totp::normalize_secret(&input.secret);
    let mut view: Option<AccountView> = None;
    state.with_payload(|p| {
        // 重复校验：改后的密钥若与其他账户（排除自身）相同，则视为重复
        if let Some(dup) = p
            .accounts
            .iter()
            .find(|a| a.id != id && a.secret == secret)
        {
            return Err(format!(
                "{}|{}|{}",
                DUPLICATE_MARKER,
                dup.issuer,
                dup.account
            ));
        }
        let categories = p.categories.clone();
        let acc = p
            .accounts
            .iter_mut()
            .find(|a| a.id == id)
            .ok_or_else(|| "账户不存在".to_string())?;
        acc.issuer = input.issuer.trim().to_string();
        acc.account = input.account.trim().to_string();
        acc.secret = secret;
        acc.otp_type = normalize_otp_type(&input.otp_type);
        acc.algorithm = totp::normalize_algorithm(&input.algorithm);
        acc.digits = input.digits;
        acc.period = input.period;
        acc.counter = input.counter;
        acc.category_id = input.category_id.clone();
        // 编辑时按新分类归属，清理旧版分类名残留
        acc.category = String::new();
        view = Some(AccountView::from_with_categories(acc, &categories));
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
        let categories = p.categories.clone();
        let mut list: Vec<AccountView> = p
            .accounts
            .iter()
            .map(|a| AccountView::from_with_categories(a, &categories))
            .collect();
        // 排序：收藏优先，其余按创建时间倒序（新账户在最前，顺序稳定）。
        // 刻意不按 last_used_at 排序——每次复制验证码都会更新该字段，
        // 若参与列表排序，被点击的卡片会立刻跳到顶部，从手指底下「跑掉」。
        // 「最近」筛选页由前端按 last_used_at 自行排序。
        list.sort_by(|a, b| {
            b.favorite
                .cmp(&a.favorite)
                .then(b.created_at.cmp(&a.created_at))
                .then(a.issuer.cmp(&b.issuer))
        });
        Ok(list)
    })
}

#[tauri::command]
pub fn get_codes(state: State<AppState>) -> Result<Vec<CodeResult>, String> {
    let now = totp::now_secs();

    // 同一 TOTP 周期内复用上一次的 HMAC 结果，避免每秒为所有账户重复计算。
    // remaining / progress 依赖实时秒数，仍按当前时间现算（开销极小）。
    //
    // 注意：加锁顺序必须与 persist() 一致（先 payload，后 code_cache），
    // 否则并发时可能形成锁顺序反转导致死锁。
    let mut payload_guard = state
        .payload
        .lock()
        .map_err(|_| "状态锁异常".to_string())?;
    let p = payload_guard
        .as_mut()
        .ok_or_else(|| "应用未解锁".to_string())?;
    let mut cache = state
        .code_cache
        .lock()
        .map_err(|_| "状态锁异常".to_string())?;

    let mut results = Vec::new();
    for account in &p.accounts {
        let otp_type = account.otp_type.trim().to_lowercase();
        if otp_type == "hotp" {
            // HOTP 依赖计数器，随使用变化，不走周期缓存
            if let Ok((code, _, _, _)) = totp::generate_code(account, now) {
                results.push(CodeResult {
                    id: account.id.clone(),
                    code,
                    otp_type: account.otp_type.clone(),
                    remaining: 0,
                    progress: 0,
                    next_code: None,
                });
            }
            continue;
        }

        let period = if account.period == 0 { 30 } else { account.period };
        let counter = now / period as u64;
        let elapsed = (now % period as u64) as u32;
        let remaining = period - elapsed;
        let progress = ((period - remaining) * 100) / period;

        let cached = cache.get(&account.id).filter(|(c, _, _)| *c == counter);
        let (code, next_code) = match cached {
            Some((_, code, next)) => (code.clone(), next.clone()),
            None => match totp::generate_code(account, now) {
                Ok((code, _, _, next)) => {
                    cache.insert(account.id.clone(), (counter, code.clone(), next.clone()));
                    (code, next)
                }
                Err(_) => continue,
            },
        };

        results.push(CodeResult {
            id: account.id.clone(),
            code,
            otp_type: account.otp_type.clone(),
            remaining,
            progress,
            next_code,
        });
    }

    // 清理已删除账户的缓存条目，避免无界增长
    let live: std::collections::HashSet<&str> =
        p.accounts.iter().map(|a| a.id.as_str()).collect();
    cache.retain(|id, _| live.contains(id.as_str()));

    Ok(results)
}

#[tauri::command]
pub fn get_account_detail(state: State<AppState>, id: String) -> Result<AccountView, String> {
    state.with_payload(|p| {
        p.accounts
            .iter()
            .find(|a| a.id == id)
            .map(|a| AccountView::from_with_categories(a, &p.categories))
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
    let secret = totp::normalize_secret(&input.secret);
    let issuer = input.issuer.trim().to_string();
    let account_name = input.account.trim().to_string();

    // 重复校验：密钥相同即视为同一个验证码（密钥决定生成的动态码）。
    // 错误信息带固定前缀，供前端识别并给出明确提示。
    // 校验与写入必须在同一次锁内完成，否则并发添加相同密钥会绕过去重。
    let account = Account {
        id: uuid::Uuid::new_v4().to_string(),
        issuer,
        account: account_name,
        secret,
        otp_type: normalize_otp_type(&input.otp_type),
        algorithm: totp::normalize_algorithm(&input.algorithm),
        digits: input.digits,
        period: input.period,
        counter: input.counter,
        category_id: input.category_id,
        category: String::new(),
        favorite: false,
        created_at: totp::now_millis(),
        last_used_at: 0,
    };
    let mut view: Option<AccountView> = None;
    state.with_payload(|p| {
        if let Some(existing) = p.accounts.iter().find(|a| a.secret == account.secret) {
            return Err(format!(
                "{}|{}|{}",
                DUPLICATE_MARKER,
                existing.issuer,
                existing.account
            ));
        }
        view = Some(AccountView::from_with_categories(&account, &p.categories));
        p.accounts.push(account);
        Ok(())
    })?;
    state.persist()?;
    view.ok_or_else(|| "账户创建失败".to_string())
}

/// 追加导入一批 otpauth 链接文本。
/// 返回 (新增数, 跳过数)：密钥已存在的账户会被跳过，避免重复添加。
#[tauri::command]
pub fn import_otpauth_text(state: State<AppState>, text: String) -> Result<(u32, u32), String> {
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
    let mut added = 0u32;
    let mut skipped = 0u32;
    state.with_payload(|p| {
        for mut acc in parsed {
            // 与 add_account 保持一致的服务端校验：
            // 批量导入若跳过这些校验，会写入 get_codes 无法渲染的账户
            if acc.issuer.trim().is_empty() {
                // 无服务名时用账户标识兜底，避免导入后卡片标题为空
                acc.issuer = if acc.account.trim().is_empty() {
                    "OTP".to_string()
                } else {
                    acc.account.trim().to_string()
                };
            }
            // 密钥相同即视为重复，跳过而不入库
            if p.accounts.iter().any(|a| a.secret == acc.secret) {
                skipped += 1;
                continue;
            }
            p.accounts.push(acc);
            added += 1;
        }
        Ok(())
    })?;
    if added > 0 {
        state.persist()?;
    }
    Ok((added, skipped))
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
    // 「最近使用」与 HOTP 计数属于高频动作，走静默落盘（不生成备份快照），
    // 避免用户每次复制验证码都产出一份备份，把真正的数据变更快照挤掉。
    state.persist_quiet()?;
    Ok(())
}

#[tauri::command]
pub fn get_settings(state: State<AppState>) -> Result<AppSettings, String> {
    // 锁定状态以「锁定凭证文件」为唯一事实源。
    // 若文件不存在（例如导入备份仅恢复了 lock_enabled 字段、或历史数据残留），
    // 则强制报告为未启用，并回写修正，避免出现「开关显示已开启、实际未设置密码」，
    // 导致用户点关闭/修改密码时收到「未设置锁定密码」的错误。
    let has_lock = store::read_lock(&state.app_dir).is_some();
    let mut corrected = false;
    let settings = state.with_payload(|p| {
        if p.settings.lock_enabled && !has_lock {
            p.settings.lock_enabled = false;
            corrected = true;
        }
        Ok(p.settings.clone())
    })?;
    if corrected {
        // 尽力回写；失败不影响本次返回（下次读取仍会再校正）
        let _ = state.persist();
    }
    Ok(settings)
}

#[tauri::command]
pub fn update_settings(state: State<AppState>, settings: AppSettings) -> Result<(), String> {
    // lock_enabled 只能由 set_lock_password 变更（它同时写/删锁定凭证文件），
    // 此处强制与凭证文件保持一致，防止经通用设置写入造成状态不一致。
    let has_lock = store::read_lock(&state.app_dir).is_some();
    state.with_payload(|p| {
        let mut next = settings;
        next.lock_enabled = has_lock;
        p.settings = next;
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
        // 分类随账户一起导出（未导出账户时无需携带）
        categories: if include_accounts {
            full.categories.clone()
        } else {
            Vec::new()
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
    // 后端同样限制体积：前端的选择文件校验可被绕过（如粘贴超长文本），
    // 超大 JSON 会占用大量内存甚至导致界面失去响应。
    const MAX_IMPORT_BYTES: usize = 10 * 1024 * 1024;
    if content.len() > MAX_IMPORT_BYTES {
        return Err("备份内容过大（超过 10MB），请确认文件是否正确".to_string());
    }
    let file: VaultFile =
        serde_json::from_str(&content).map_err(|_| "备份文件格式不正确".to_string())?;
    let salt = crypto::decode_salt(&file)?;
    let key = crypto::derive_key(&password, &salt)?;
    let imported = crypto::decrypt_payload(&file, &key)?;

    let scope = file.scope.clone();
    let mut added_accounts = 0u32;
    let mut applied_settings = false;
    // 因数据非法而被跳过的账户数：向前端如实反馈，避免用户以为「账户丢失」
    let mut skipped_invalid = 0u32;

    state.with_payload(|p| {
        if scope.accounts {
            // 先合并分类：按 id 去重，保留现有分类
            let existing_cats: std::collections::HashSet<String> =
                p.categories.iter().map(|c| c.id.clone()).collect();
            for cat in imported.categories.iter() {
                if !existing_cats.contains(&cat.id) {
                    p.categories.push(cat.clone());
                }
            }
            // 再合并账户：先校验字段合法性，避免损坏/恶意备份注入非法数据
            // （非法账户会让 get_codes 静默跳过，看起来像「账户消失」）
            let existing: std::collections::HashSet<String> =
                p.accounts.iter().map(|a| a.id.clone()).collect();
            for acc in imported.accounts.iter() {
                if existing.contains(&acc.id) {
                    continue;
                }
                let valid = !acc.id.trim().is_empty()
                    && !acc.issuer.trim().is_empty()
                    && totp::validate_secret(&acc.secret).is_ok()
                    && totp::validate_account_input(
                        &acc.otp_type,
                        &acc.algorithm,
                        acc.digits,
                        acc.period,
                    )
                    .is_ok();
                if !valid {
                    skipped_invalid += 1;
                    continue;
                }
                p.accounts.push(acc.clone());
                added_accounts += 1;
            }
        }
        if scope.settings {
            // 备份不含锁定凭证文件，故 lock_enabled 不能随备份覆盖，
            // 始终以本机实际锁文件为准，避免导入后出现状态不一致。
            let has_lock = store::read_lock(&state.app_dir).is_some();
            let mut next = imported.settings.clone();
            next.lock_enabled = has_lock;
            p.settings = next;
            applied_settings = true;
        }
        Ok(())
    })?;
    state.persist()?;

    // 导入可能覆盖了「关闭按钮行为」：同步运行时缓存，
    // 否则新设置要等下次启动才生效（窗口事件读的是这个缓存）。
    if applied_settings {
        if let Ok(guard) = state.payload.lock() {
            if let Some(p) = guard.as_ref() {
                state.sync_close_behavior(p);
            }
        }
    }

    Ok(ImportResult {
        added_accounts,
        applied_settings,
        total_accounts_in_backup: imported.accounts.len() as u32,
        skipped_invalid,
    })
}

#[derive(serde::Serialize)]
pub struct ImportResult {
    pub added_accounts: u32,
    pub applied_settings: bool,
    pub total_accounts_in_backup: u32,
    /// 因字段非法（密钥/位数/周期/算法）被跳过的账户数
    pub skipped_invalid: u32,
}

/// 分类重命名/改色的入参已在 models::CategoryInput 定义

/// 列出全部分类（按 order 排序）
#[tauri::command]
pub fn list_categories(state: State<AppState>) -> Result<Vec<crate::models::Category>, String> {
    state.with_payload(|p| {
        let mut list = p.categories.clone();
        list.sort_by(|a, b| a.order.cmp(&b.order).then(a.created_at.cmp(&b.created_at)));
        Ok(list)
    })
}

/// 新建分类
#[tauri::command]
pub fn add_category(
    state: State<AppState>,
    input: crate::models::CategoryInput,
) -> Result<crate::models::Category, String> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err("分类名称不能为空".to_string());
    }
    if name.chars().count() > 20 {
        return Err("分类名称最多 20 个字符".to_string());
    }
    let color = normalize_hex_color(&input.color);
    let mut created: Option<crate::models::Category> = None;
    state.with_payload(|p| {
        if p.categories.iter().any(|c| c.name == name) {
            return Err("已存在同名分类".to_string());
        }
        let order = p.categories.iter().map(|c| c.order).max().unwrap_or(0) + 1;
        let cat = crate::models::Category {
            id: uuid::Uuid::new_v4().to_string(),
            name: name.to_string(),
            color,
            order,
            created_at: totp::now_millis(),
        };
        created = Some(cat.clone());
        p.categories.push(cat);
        Ok(())
    })?;
    state.persist()?;
    created.ok_or_else(|| "分类创建失败".to_string())
}

/// 更新分类名称与颜色
#[tauri::command]
pub fn update_category(
    state: State<AppState>,
    id: String,
    input: crate::models::CategoryInput,
) -> Result<crate::models::Category, String> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err("分类名称不能为空".to_string());
    }
    if name.chars().count() > 20 {
        return Err("分类名称最多 20 个字符".to_string());
    }
    let color = normalize_hex_color(&input.color);
    let mut updated: Option<crate::models::Category> = None;
    state.with_payload(|p| {
        if p.categories.iter().any(|c| c.id != id && c.name == name) {
            return Err("已存在同名分类".to_string());
        }
        let cat = p
            .categories
            .iter_mut()
            .find(|c| c.id == id)
            .ok_or_else(|| "分类不存在".to_string())?;
        cat.name = name.to_string();
        cat.color = color;
        updated = Some(cat.clone());
        Ok(())
    })?;
    state.persist()?;
    updated.ok_or_else(|| "分类更新失败".to_string())
}

/// 删除分类。
/// `delete_accounts` 为 true 时一并删除该分类下的账户，否则将其移到「未分类」。
#[tauri::command]
pub fn delete_category(
    state: State<AppState>,
    id: String,
    delete_accounts: bool,
) -> Result<u32, String> {
    let mut affected = 0u32;
    state.with_payload(|p| {
        if !p.categories.iter().any(|c| c.id == id) {
            return Err("分类不存在".to_string());
        }
        p.categories.retain(|c| c.id != id);
        if delete_accounts {
            let before = p.accounts.len();
            p.accounts.retain(|a| a.category_id != id);
            affected = (before - p.accounts.len()) as u32;
        } else {
            for a in p.accounts.iter_mut() {
                if a.category_id == id {
                    a.category_id = String::new();
                    affected += 1;
                }
            }
        }
        Ok(())
    })?;
    state.persist()?;
    Ok(affected)
}

/// 调整分类顺序（传入按目标顺序排列的分类 id 列表）
#[tauri::command]
pub fn reorder_categories(state: State<AppState>, ids: Vec<String>) -> Result<(), String> {
    state.with_payload(|p| {
        for (idx, id) in ids.iter().enumerate() {
            if let Some(cat) = p.categories.iter_mut().find(|c| &c.id == id) {
                cat.order = idx as i32;
            }
        }
        Ok(())
    })?;
    state.persist()?;
    Ok(())
}

/// 将账户移动到指定分类（空 id 表示未分类）
#[tauri::command]
pub fn set_account_category(
    state: State<AppState>,
    account_id: String,
    category_id: String,
) -> Result<AccountView, String> {
    let mut view: Option<AccountView> = None;
    state.with_payload(|p| {
        let categories = p.categories.clone();
        if !category_id.is_empty() && !categories.iter().any(|c| c.id == category_id) {
            return Err("目标分类不存在".to_string());
        }
        let acc = p
            .accounts
            .iter_mut()
            .find(|a| a.id == account_id)
            .ok_or_else(|| "账户不存在".to_string())?;
        acc.category_id = category_id;
        acc.category = String::new();
        view = Some(AccountView::from_with_categories(acc, &categories));
        Ok(())
    })?;
    state.persist()?;
    view.ok_or_else(|| "分类移动失败".to_string())
}

/// 一次性迁移：把旧版 `category` 名称转换为分类实体并回填 category_id。
/// 返回是否有改动（有则需持久化）。
pub fn migrate_categories(payload: &mut VaultPayload) -> bool {
    let mut changed = false;
    for acc in payload.accounts.iter_mut() {
        if acc.category_id.is_empty() && !acc.category.is_empty() {
            let name = acc.category.trim().to_string();
            if let Some(existing) = payload.categories.iter().find(|c| c.name == name) {
                acc.category_id = existing.id.clone();
            } else {
                let order = payload.categories.iter().map(|c| c.order).max().unwrap_or(0) + 1;
                let cat = crate::models::Category {
                    id: uuid::Uuid::new_v4().to_string(),
                    name,
                    color: default_category_color_for_migrate(order),
                    order,
                    created_at: totp::now_millis(),
                };
                acc.category_id = cat.id.clone();
                payload.categories.push(cat);
            }
            acc.category = String::new();
            changed = true;
        }
    }
    changed
}

/// 迁移时为分类分配源力色板中的颜色
fn default_category_color_for_migrate(order: i32) -> String {
    const PALETTE: [&str; 5] = ["#1664FF", "#2A814B", "#BD7E00", "#D7312A", "#6E4C9F"];
    PALETTE[(order.rem_euclid(5)) as usize].to_string()
}

/// 规范化十六进制颜色，非法值回退到源力蓝
fn normalize_hex_color(color: &str) -> String {
    let c = color.trim();
    if c.len() == 7 && c.starts_with('#') && c[1..].chars().all(|x| x.is_ascii_hexdigit()) {
        c.to_uppercase()
    } else {
        "#1664FF".to_string()
    }
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

#[derive(serde::Serialize)]
pub struct StorageUsageView {
    pub total_bytes: u64,
    pub backup_bytes: u64,
    pub vault_bytes: u64,
    pub backup_count: u32,
}

/// 统计本地数据占用
#[tauri::command]
pub fn get_storage_usage(state: State<AppState>) -> StorageUsageView {
    let usage = store::storage_usage(&state.app_dir);
    StorageUsageView {
        total_bytes: usage.total_bytes,
        backup_bytes: usage.backup_bytes,
        vault_bytes: usage.vault_bytes,
        backup_count: usage.backup_count,
    }
}

/// 清理全部本地备份快照，返回删除数量
#[tauri::command]
pub fn clear_backups(state: State<AppState>) -> Result<u32, String> {
    store::clear_backups(&state.app_dir)
}

fn base64_encode(data: &[u8]) -> String {
    use base64::{engine::general_purpose::STANDARD as B64, Engine};
    B64.encode(data)
}

fn base64_decode(data: &str) -> Result<Vec<u8>, String> {
    use base64::{engine::general_purpose::STANDARD as B64, Engine};
    B64.decode(data).map_err(|_| "Base64 解码失败".to_string())
}
