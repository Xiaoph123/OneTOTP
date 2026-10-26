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
    /// 实际数据目录（可能是用户自定义的目录）
    pub app_dir: PathBuf,
    /// 系统默认应用目录：数据目录指针文件固定放在这里
    pub default_dir: PathBuf,
    /// 当前解锁密钥；None 表示未解锁
    pub key: Mutex<Option<[u8; 32]>>,
    /// 已解锁内存中的保险库载荷缓存
    pub payload: Mutex<Option<VaultPayload>>,
    /// 关闭按钮行为缓存（quit | tray），供窗口事件同步读取
    pub close_behavior: Mutex<String>,
    /// TOTP 验证码缓存：key = 账户 id，value = (周期序号, 当前码, 下一个码)。
    /// 同一周期内复用 HMAC 结果，仅在跨周期（或账户变更）时重算。
    pub code_cache: Mutex<std::collections::HashMap<String, (u64, String, Option<String>)>>,

}

impl AppState {
    pub fn new(app_dir: PathBuf, default_dir: PathBuf) -> Self {
        Self {
            app_dir,
            default_dir,
            key: Mutex::new(None),
            payload: Mutex::new(None),
            close_behavior: Mutex::new("quit".to_string()),
            code_cache: Mutex::new(std::collections::HashMap::new()),

        }
    }

    /// 读取当前关闭行为（供窗口事件使用）。
    /// 仅桌面端的关窗事件会调用；移动端没有「关闭按钮」，编译时会变成死代码，
    /// 故在该平台显式放行，避免每次 Android 构建都刷一条告警。
    #[cfg_attr(not(desktop), allow(dead_code))]
    pub fn close_behavior(&self) -> String {
        self.close_behavior
            .lock()
            .map(|v| v.clone())
            .unwrap_or_else(|_| "quit".to_string())
    }

    /// 是否允许导出/导入空密码备份（读自当前设置，未解锁时按「不允许」处理）
    pub fn allow_empty_backup_password(&self) -> bool {
        self.payload
            .lock()
            .ok()
            .and_then(|p| p.as_ref().map(|v| v.settings.allow_empty_backup_password))
            .unwrap_or(false)
    }

    /// 同步关闭行为缓存
    fn sync_close_behavior(&self, payload: &VaultPayload) {
        if let Ok(mut guard) = self.close_behavior.lock() {
            *guard = payload.settings.close_behavior.clone();
        }
    }

    /// 立即锁定：清空内存密钥、载荷与验证码缓存。
    ///
    /// 与 `lock` 命令等价，但可直接从非命令路径调用（例如窗口事件里
    /// 「关闭到托盘」时主动锁定）。可用性不依赖前端事件是否送达。
    ///
    /// `reason` 会写入锁定事件日志，用于排查「为什么没有锁」：
    /// 日志里没有记录 = 前端根本没发起锁定；有记录 = 已锁定、问题在界面同步。
    pub fn lock_now(&self, reason: &str) {
        use zeroize::Zeroize;

        // 主密钥：先按字节覆写，再丢弃引用。
        // 只是 `*guard = None` 的话堆上那 32 字节仍然留在内存里，可能被同用户进程
        // 读到（甚至被换页到磁盘），所以这里显式擦除。
        if let Ok(mut guard) = self.key.lock() {
            if let Some(mut key) = guard.take() {
                key.zeroize();
            }
        }

        // 载荷：擦除每个账户的 Base32 密钥与明文密码提示后再释放
        if let Ok(mut guard) = self.payload.lock() {
            if let Some(mut payload) = guard.take() {
                for account in payload.accounts.iter_mut() {
                    account.secret.zeroize();
                }
                payload.settings.password_hint.zeroize();
            }
        }

        // 验证码缓存：擦除缓存的验证码字符串
        if let Ok(mut cache) = self.code_cache.lock() {
            for (_, code, next) in cache.values_mut() {
                code.zeroize();
                if let Some(n) = next {
                    n.zeroize();
                }
            }
            cache.clear();
        }

        store::append_lock_log(&self.app_dir, reason);
    }

    /// 处理窗口的「关闭请求」：返回 `true` 表示应当隐藏窗口（关闭到托盘）。
    ///
    /// 关闭到托盘时必须**同时锁定**：窗口是被原生侧隐藏的，`hide()` 不会产生
    /// 前端的 focus 事件，前端「失焦自动锁定」那条链路根本不会触发，
    /// 否则从托盘恢复时会直接看到明文验证码。
    pub fn prepare_close(&self) -> bool {
        let to_tray = self.close_behavior() == "tray";
        if to_tray {
            self.lock_now("close-to-tray");
        }
        to_tray
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
        // 重写时必须沿用**原文件记录的** KDF 参数与盐：
        // 密钥已由解锁流程按该参数派生，换参数会让本次写出的数据再也解不开。
        let (salt, uses_machine_key, kdf) = match existing {
            Some(f) => {
                let salt = crypto::decode_salt(&f)?;
                (salt, f.uses_machine_key, f.kdf)
            }
            None => (crypto::new_salt(), true, crypto::KdfParams::CURRENT),
        };

        let file = crypto::encrypt_payload(payload, &key, &salt, uses_machine_key, kdf)?;
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
    /// 保险库是否仍在使用较弱的旧 KDF 参数（提示用户执行一次「重新加密」升级）
    pub kdf_legacy: bool,
    /// 当前实际使用的数据目录
    pub data_dir: String,
    /// 是否来自自定义目录指针（而非默认目录）
    pub data_dir_from_pointer: bool,
    /// 指针存在但不可用时的原因（此时正使用默认目录）
    pub data_dir_issue: Option<store::DataDirIssue>,
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

    // 以锁定凭证记录的参数为准（它派生出的就是保险库密钥）；无凭证时看保险库文件。
    //
    // 必须排除「机器密钥」模式：该模式不做口令派生（密钥是随机落盘的 32 字节），
    // Argon2 参数完全不参与运算，此时提示「参数强度较低」是误报。
    let kdf_legacy = match store::read_vault(&state.app_dir) {
        Ok(file) => {
            if file.uses_machine_key {
                false
            } else {
                let params = lock.as_ref().map(|l| l.kdf).unwrap_or(file.kdf);
                let cur = crypto::KdfParams::CURRENT;
                params.m_cost < cur.m_cost || params.t_cost < cur.t_cost
            }
        }
        Err(_) => false,
    };

    Ok(StatusView {
        has_vault,
        has_lock: lock.is_some(),
        locked,
        password_hint: lock.map(|l| l.hint).unwrap_or_default(),
        lock_only_on_start: settings.lock_enabled,
        kdf_legacy,
        data_dir: state.app_dir.to_string_lossy().to_string(),
        data_dir_from_pointer: state.app_dir != state.default_dir,
        data_dir_issue: store::data_dir_pointer_issue(&state.default_dir),
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

    // 尝试用当前机器密钥解密；失败则回退到旧版派生密钥（兼容历史数据），
    // 成功迁移后立即用新密钥重写，确保往后只依赖设备本地随机密钥。
    let (mut payload, needs_rekey) = match crypto::decrypt_payload(&file, &key) {
        Ok(p) => (p, false),
        Err(_) => {
            let legacy = crypto::legacy_machine_key_compat();
            let p = crypto::decrypt_payload(&file, &legacy).map_err(|_| {
                "无法解密保险库：本机缺少与之匹配的机器密钥或解锁口令。\
                 若曾设置解锁口令，请确认 onetotp.lock.json 未被删除；\
                 数据可用加密备份在其他设备恢复。"
                    .to_string()
            })?;
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
    Ok(())
}

/// 连续失败次数对应的退避时长（毫秒）。纯函数，便于测试。
///
/// 指数增长：200ms × 2^(n-1)，封顶 3 秒。
/// 计数为 0 表示没有失败历史，不退避。
pub fn unlock_backoff_ms(fail_count: u32) -> u64 {
    if fail_count == 0 {
        return 0;
    }
    200u64
        .saturating_mul(1u64 << (fail_count.min(5) - 1))
        .min(3_000)
}

/// 记录一次解锁失败：**写入凭证文件**，使计数跨重启生效。
///
/// 只改 fail_count / last_fail_ms，其余字段（salt / verifier / kdf / hint / version）
/// 原样保留——这些字段决定能否解密，写错就等于毁掉用户数据。
fn note_failed_unlock(app_dir: &std::path::Path, lock: &mut store::LockRecord) {
    lock.fail_count = lock.fail_count.saturating_add(1);
    lock.last_fail_ms = totp::now_millis();
    // 写盘失败不应阻断解锁流程（它只影响退避的跨重启效果）
    let _ = store::write_lock(app_dir, lock);
}

/// 解锁成功后清零失败计数（仅在确有计数时写盘，避免每次解锁都无谓写文件）
fn clear_failed_unlocks(app_dir: &std::path::Path, lock: &mut store::LockRecord) {
    if lock.fail_count == 0 && lock.last_fail_ms == 0 {
        return;
    }
    lock.fail_count = 0;
    lock.last_fail_ms = 0;
    let _ = store::write_lock(app_dir, lock);
}

/// 使用锁定密码解锁
#[tauri::command]
pub fn unlock(state: State<AppState>, password: String) -> Result<(), String> {
    let mut lock = store::read_lock(&state.app_dir).ok_or_else(|| "未设置锁定密码".to_string())?;

    // 失败退避：**按凭证文件里持久化的失败次数**计算，重启不清零。
    // 正确口令也受冷却期约束（避免「绕过退避再试一次」），但计数为 0 时零延迟。
    let backoff = unlock_backoff_ms(lock.fail_count);
    if backoff > 0 {
        let elapsed = (totp::now_millis() - lock.last_fail_ms).max(0) as u64;
        if elapsed < backoff {
            std::thread::sleep(std::time::Duration::from_millis(backoff - elapsed));
        }
    }

    let (key, needs_upgrade) = match verify_lock_password(&lock, &password) {
        Ok(v) => v,
        Err(e) => {
            note_failed_unlock(&state.app_dir, &mut lock);
            return Err(e);
        }
    };

    // 旧格式升级：口令已证实正确，原地把 verifier 换成单向校验值。
    // salt 与保险库密钥都不变，故这一步不影响解密，失败也只是下次再试。
    if needs_upgrade {
        upgrade_lock_record_if_needed(&state.app_dir, &lock, &key);
    }

    // 解锁成功：重置失败计数（落盘）
    clear_failed_unlocks(&state.app_dir, &mut lock);

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
    state.lock_now("frontend");
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
        // 同 unlock：Argon2id 只派生一次，verifier 为带固定上下文的 HMAC
        // （不可反推密钥；早期版本直接存密钥 base64，见 crypto::legacy_verifier）
        //
        // 这里用**当前**参数：设置/修改口令本来就是重新派生密钥的时机，
        // 顺手把 KDF 强度升到最新（凭证与保险库同时改写，二者参数必然一致）。
        let kdf = crypto::KdfParams::CURRENT;
        let key = crypto::derive_key(&password, &salt, kdf)?;
        let verifier = crypto::derive_verifier(&key);

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
                version: store::LOCK_RECORD_VERSION,
                kdf,
                salt: base64_encode(&salt),
                verifier,
                hint: hint.clone(),
                // 新口令：此前的失败计数不再适用
                fail_count: 0,
                last_fail_ms: 0,
            },
        )?;

        let file = crypto::encrypt_payload(&payload, &key, &salt, false, kdf)?;
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
        // 机器密钥模式不使用口令派生，但文件仍记录一组有效参数（便于将来开启口令时统一）
        let file = crypto::encrypt_payload(&payload, &key, &salt, true, crypto::KdfParams::CURRENT)?;
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

/// 用口令校验锁定凭证，返回派生出的保险库密钥。
///
/// 返回值第二项表示该凭证是否为旧格式（v0，`verifier` 就是密钥本身），
/// 调用方应在其后将其升级为 v1。
///
/// 两种版本的校验方式不同，且都必须恒定时间比较：
/// - v1：`HMAC-SHA256(密钥, 固定上下文)`，校验值不泄露密钥
/// - v0：密钥的 base64，仅为了让老用户还能打开自己的保险库
fn verify_lock_password(
    record: &store::LockRecord,
    password: &str,
) -> Result<([u8; 32], bool), String> {
    let salt = base64_decode(&record.salt)?;
    // 按**该凭证记录的** KDF 参数派生（旧文件没有 kdf 字段 → 历史参数）
    let key = crypto::derive_key(password, &salt, record.kdf)?;
    let matched = if record.version >= store::LOCK_RECORD_VERSION {
        crypto::constant_time_eq(
            crypto::derive_verifier(&key).as_bytes(),
            record.verifier.as_bytes(),
        )
    } else {
        crypto::constant_time_eq(
            crypto::legacy_verifier(&key).as_bytes(),
            record.verifier.as_bytes(),
        )
    };
    if !matched {
        return Err("密码错误".to_string());
    }
    let needs_upgrade = record.version < store::LOCK_RECORD_VERSION;
    Ok((key, needs_upgrade))
}

/// 缺失锁定凭证、或凭证为旧格式时，把凭证写成当前版本（salt / 密钥不变）。
fn upgrade_lock_record_if_needed(
    app_dir: &std::path::Path,
    record: &store::LockRecord,
    key: &[u8; 32],
) {
    if record.version >= store::LOCK_RECORD_VERSION {
        return;
    }
    let upgraded = store::LockRecord {
        version: store::LOCK_RECORD_VERSION,
        // 升级 verifier 格式不改变密钥，因此必须沿用原 KDF 参数
        kdf: record.kdf,
        salt: record.salt.clone(),
        verifier: crypto::derive_verifier(key),
        hint: record.hint.clone(),
        fail_count: record.fail_count,
        last_fail_ms: record.last_fail_ms,
    };
    let _ = store::write_lock(app_dir, &upgraded);
}

/// 重新加密的结果：附带失效快照数量
#[derive(serde::Serialize)]
pub struct RotateResult {
    /// 使用旧密钥、现已无法解密的快照数量（建议清理）
    pub stale_backups: u32,
}

/// 重新加密保险库：用同一口令，但**全新的 salt** 重新派生密钥并重写数据。
///
/// 用途：旧版本把保险库密钥本身以 base64 明文写进 `onetotp.lock.json`
/// （见 `crypto::legacy_verifier`），任何读到过该文件的人都能直接解密保险库。
/// 口令不必变——只要更换 salt，派生出的密钥就完全不同，旧密钥立即作废。
///
/// 口令必须正确：否则用户以为换过密钥，实际仍是用旧密钥加密。
#[tauri::command]
pub fn rotate_vault_key(state: State<AppState>, password: String) -> Result<RotateResult, String> {
    let mut lock = store::read_lock(&state.app_dir).ok_or_else(|| "未启用锁定密码".to_string())?;
    let payload = state
        .payload
        .lock()
        .map_err(|_| "状态锁异常".to_string())?
        .clone()
        .ok_or_else(|| "应用未解锁".to_string())?;

    // 校验当前口令（兼容 v0 / v1 两种校验值）。
    // 这里只需要「口令是否正确」，新密钥会由新 salt 重新派生。
    if let Err(e) = verify_lock_password(&lock, &password) {
        note_failed_unlock(&state.app_dir, &mut lock);
        return Err(e);
    }

    let new_salt = crypto::new_salt();
    // 「重新加密」正是升级 KDF 参数的最佳时机：新旧凭证与保险库同时改写，
    // 不存在「文件记旧参数、数据用新密钥」的不一致风险。
    let new_kdf = crypto::KdfParams::CURRENT;
    let new_key = crypto::derive_key(&password, &new_salt, new_kdf)?;

    // 顺序与 set_lock_password 一致：先提交凭证（含新 salt），再写保险库。
    // 若反过来，一旦「保险库已用新密钥加密、凭证仍是旧盐」就会永久无法解密。
    let previous = lock.clone();
    store::write_lock(
        &state.app_dir,
        &store::LockRecord {
            version: store::LOCK_RECORD_VERSION,
            kdf: new_kdf,
            salt: base64_encode(&new_salt),
            verifier: crypto::derive_verifier(&new_key),
            hint: lock.hint.clone(),
            // 口令刚被证实正确：失败计数清零
            fail_count: 0,
            last_fail_ms: 0,
        },
    )?;

    let file = crypto::encrypt_payload(&payload, &new_key, &new_salt, false, new_kdf)?;
    if let Err(e) = store::write_vault(&state.app_dir, &file) {
        // 回滚凭证：保险库仍是旧密钥加密的，旧凭证才能解开它
        let _ = store::write_lock(&state.app_dir, &previous);
        return Err(e);
    }

    // 快照留存新密文，便于事后恢复
    if payload.settings.auto_backup {
        let _ = store::write_backup(&state.app_dir, &file);
        store::prune_backups(&state.app_dir, payload.settings.backup_keep);
    }

    // 内存密钥必须同步，否则后续 persist 会用旧密钥覆盖刚写好的数据
    *state.key.lock().map_err(|_| "状态锁异常".to_string())? = Some(new_key);

    // 换了密钥：此前的快照全部解不开，如实回报数量供界面提示清理
    let stale_backups = store::count_undecryptable_backups(&state.app_dir, &new_key);
    Ok(RotateResult { stale_backups })
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

/// 账户排序键：`sort_order` 升序，未设置序号（0）视为排在最后。
///
/// 返回元组供 `sort_by` 直接比较：
/// - 第一项：序号（0 → i32::MAX，即「未排序的排最后」）
/// - 第二项：收藏（Reverse，收藏在前）
/// - 第三项：创建时间（Reverse，新的在前）
/// - 第四项：服务名（稳定兜底，避免同键时顺序随机）
fn account_sort_key(
    sort_order: i32,
    favorite: bool,
    created_at: i64,
    issuer: &str,
) -> (i32, std::cmp::Reverse<bool>, std::cmp::Reverse<i64>, &str) {
    let order = if sort_order > 0 { sort_order } else { i32::MAX };
    (
        order,
        std::cmp::Reverse(favorite),
        std::cmp::Reverse(created_at),
        issuer,
    )
}

/// 在列表最前面预留 `count` 个位置，返回第一个可用序号。
///
/// 新账户必须排在最前面（用户明确要求）：手动排序生效后，
/// 把现有账户的序号整体后移 `count` 位，新账户占用 `1..=count`。
/// 从未手动排序时返回 0——默认顺序本身就是「最新在前」，
/// 新账户天然在第一位，无需改动任何序号。
fn reserve_top_slots(accounts: &mut [Account], count: i32) -> i32 {
    if count <= 0 {
        return 0;
    }
    let manual = accounts.iter().any(|a| a.sort_order > 0);
    if !manual {
        return 0;
    }
    for acc in accounts.iter_mut() {
        if acc.sort_order > 0 {
            acc.sort_order = acc.sort_order.saturating_add(count);
        }
    }
    1
}

/// 账户列表排序（唯一排序入口，桌面端与移动端共用）。
///
/// 规则：`sort_order` 升序；未设置序号（0）的账户一律视为「排在最后」。
///
/// 为什么用「0 → i32::MAX」而不是先判断「有没有人手动排过序」：
/// 后者需要一个全局开关，一旦开关判断失误（例如某条写入路径漏了序号），
/// 整个列表就会退回默认顺序，新账户又跑到最前面。这里让每个账户
/// 自己决定位置，不存在「开关状态」这种可失效的中间态：
/// - 全部为 0（从未手动排序）→ 全部并列在末尾 → 由收藏、创建时间决定，
///   即默认的「收藏优先 + 最新在前」，与旧版本完全一致；
/// - 手动排序后（1..N）→ 严格按序号。
fn sort_accounts(list: &mut [AccountView]) {
    list.sort_by(|a, b| {
        account_sort_key(a.sort_order, a.favorite, a.created_at, &a.issuer).cmp(
            &account_sort_key(b.sort_order, b.favorite, b.created_at, &b.issuer),
        )
    });
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
        // 刻意不按 last_used_at 排序——每次复制验证码都会更新该字段，
        // 若参与列表排序，被点击的卡片会立刻跳到顶部，从手指底下「跑掉」。
        // 「最近」筛选页由前端按 last_used_at 自行排序。
        sort_accounts(&mut list);
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
    let mut view: Option<AccountView> = None;
    state.with_payload(|p| {
        if let Some(existing) = p.accounts.iter().find(|a| a.secret == secret) {
            return Err(format!(
                "{}|{}|{}",
                DUPLICATE_MARKER,
                existing.issuer,
                existing.account
            ));
        }
        // 新账户必须排在最前面：手动排序生效时把现有序号整体后移一位，
        // 新账户占用第 1 位；未手动排序时序号为 0，靠「最新在前」天然居首。
        let sort_order = reserve_top_slots(&mut p.accounts, 1);
        let account = Account {
            id: uuid::Uuid::new_v4().to_string(),
            issuer: issuer.clone(),
            account: account_name.clone(),
            secret: secret.clone(),
            otp_type: normalize_otp_type(&input.otp_type),
            algorithm: totp::normalize_algorithm(&input.algorithm),
            digits: input.digits,
            period: input.period,
            counter: input.counter,
            category_id: input.category_id.clone(),
            category: String::new(),
            favorite: false,
            sort_order,
            created_at: totp::now_millis(),
            last_used_at: 0,
        };
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
        // 先筛出真正要新增的账户（去重 + 补全服务名），再统一分配序号：
        // 序号需要按「本批新增数量」整体后移现有账户，边遍历边分配会算错。
        let mut fresh: Vec<Account> = Vec::new();
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
            if p.accounts.iter().any(|a| a.secret == acc.secret)
                || fresh.iter().any(|a| a.secret == acc.secret)
            {
                skipped += 1;
                continue;
            }
            fresh.push(acc);
        }
        if fresh.is_empty() {
            return Ok(());
        }
        // 与 add_account 一致：新账户排在最前面。
        // 手动排序生效时现有账户整体后移，本批账户占用 1..=n（保持粘贴顺序）。
        let count = fresh.len() as i32;
        let base = reserve_top_slots(&mut p.accounts, count);
        for (idx, mut acc) in fresh.into_iter().enumerate() {
            acc.sort_order = if base > 0 { base + idx as i32 } else { 0 };
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

/// 删除账户的结果：附带历史快照清理统计
#[derive(serde::Serialize)]
pub struct DeleteAccountResult {
    /// 已从多少份历史快照中清除了该账户的密钥
    pub purged_backups: u32,
    /// 有多少份快照无法解密（由旧密钥加密），本次未能清理
    pub stale_backups: u32,
}

#[tauri::command]
pub fn delete_account(
    state: State<AppState>,
    id: String,
    purge_backups: bool,
) -> Result<DeleteAccountResult, String> {
    state.with_payload(|p| {
        let before = p.accounts.len();
        p.accounts.retain(|a| a.id != id);
        if p.accounts.len() == before {
            return Err("账户不存在".to_string());
        }
        Ok(())
    })?;
    state.persist()?;

    // 快照与主库共用密钥：若不清理，被删账户的密钥仍能从历史快照里解出
    // （等于「删除了但没撤销」）。此处的密钥已在手，无需再次派生。
    let mut purged_backups = 0u32;
    let mut stale_backups = 0u32;
    if purge_backups {
        if let Ok(key) = state.current_key() {
            let (purged, stale) = store::purge_account_from_backups(&state.app_dir, &id, &key);
            purged_backups = purged;
            stale_backups = stale;
        }
    }

    Ok(DeleteAccountResult {
        purged_backups,
        stale_backups,
    })
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
        let mut next = sanitize_settings(settings);
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

/// 导出为加密备份字符串（OneTOTP 格式）
/// `include_accounts` / `include_settings` 控制导出内容范围
///
/// 密码为空时，仅在设置中开启了「允许空密码备份」的前提下放行。
#[tauri::command]
pub fn export_vault(
    state: State<AppState>,
    password: String,
    include_accounts: bool,
    include_settings: bool,
) -> Result<String, String> {
    if password.is_empty() {
        if !state.allow_empty_backup_password() {
            return Err("导出密码长度至少 8 位".to_string());
        }
    } else {
        crypto::validate_password(&password)?;
    }
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
    // 导出统一用当前参数，并在文件里记录，跨设备/跨版本都能按同一参数解开
    let kdf = crypto::KdfParams::CURRENT;
    let key = crypto::derive_key(&password, &salt, kdf)?;
    let scope = crate::models::BackupScope {
        accounts: include_accounts,
        settings: include_settings,
    };
    let file = crypto::encrypt_payload_with_scope(&export_payload, &key, &salt, false, scope, kdf)?;
    serde_json::to_string_pretty(&file).map_err(|e| e.to_string())
}

/// 把导出的备份内容写入用户指定的文件路径。
///
/// 桌面端传入绝对路径；Android 的系统文档选择器返回 `content://` URI，
/// 必须经 ContentResolver 打开（`std::fs` 无法处理），故统一走 fs 插件。
///
/// 只允许写入 `.json` / `.txt` 后缀，避免被当成任意文件写入通道（安全边界）。
/// 内容由 `export_vault` 生成，调用方不得传入任意来源的数据。
#[tauri::command]
pub fn write_backup_file(
    app: tauri::AppHandle,
    path: String,
    content: String,
) -> Result<(), String> {
    const MAX_EXPORT_BYTES: usize = 10 * 1024 * 1024;
    if content.len() > MAX_EXPORT_BYTES {
        return Err("导出内容过大，无法写入文件".to_string());
    }

    // Android 文档选择器返回的 URI：后缀由用户在系统界面里决定，
    // 这里无法也不应再校验扩展名（URI 本身不带扩展名）。
    if path.starts_with("content://") {
        return write_content_uri(&app, &path, content.as_bytes());
    }

    let p = std::path::Path::new(&path);
    if !p.is_absolute() {
        return Err("导出的目标路径必须是绝对路径".to_string());
    }
    let ext = p
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();
    if ext != "json" && ext != "txt" {
        return Err("导出文件必须是 .json 或 .txt".to_string());
    }
    if let Some(dir) = p.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("创建目录失败: {e}"))?;
    }
    std::fs::write(p, content.as_bytes()).map_err(|e| format!("写入文件失败: {e}"))
}

/// 读取用户选中的备份文件内容。
///
/// 桌面端为绝对路径，Android 为 `content://` URI；两者都限制 10MB，
/// 与 `import_vault` 的体积上限保持一致，避免超大文件占满内存。
#[tauri::command]
pub fn read_backup_file(app: tauri::AppHandle, path: String) -> Result<String, String> {
    const MAX_IMPORT_BYTES: u64 = 10 * 1024 * 1024;

    if path.starts_with("content://") {
        let file = open_content_uri(&app, &path, false)?;
        let mut buf = String::new();
        use std::io::Read;
        file.take(MAX_IMPORT_BYTES + 1)
            .read_to_string(&mut buf)
            .map_err(|e| format!("读取文件失败: {e}"))?;
        if buf.len() as u64 > MAX_IMPORT_BYTES {
            return Err("备份文件过大（超过 10MB），请确认文件是否正确".to_string());
        }
        return Ok(buf);
    }

    let p = std::path::Path::new(&path);
    if !p.is_absolute() {
        return Err("备份文件路径必须是绝对路径".to_string());
    }
    let meta = std::fs::metadata(p).map_err(|e| format!("读取文件失败: {e}"))?;
    if meta.len() > MAX_IMPORT_BYTES {
        return Err("备份文件过大（超过 10MB），请确认文件是否正确".to_string());
    }
    std::fs::read_to_string(p).map_err(|e| format!("读取文件失败: {e}"))
}

/// 通过 fs 插件打开 Android `content://` URI。
///
/// `write = true` 时以「写 + 截断」模式打开（覆盖已有文件），
/// 否则只读。URI 由系统文档选择器产生，不接受前端任意构造的地址。
#[cfg(target_os = "android")]
fn open_content_uri(
    app: &tauri::AppHandle,
    uri: &str,
    write: bool,
) -> Result<std::fs::File, String> {
    use tauri_plugin_fs::{FsExt, OpenOptions};
    let url = url::Url::parse(uri).map_err(|_| "无效的文件地址".to_string())?;
    let mut opts = OpenOptions::new();
    if write {
        opts.write(true).truncate(true).create(true);
    } else {
        opts.read(true);
    }
    app.fs()
        .open(url, opts)
        .map_err(|e| format!("打开文件失败: {e}"))
}

#[cfg(not(target_os = "android"))]
fn open_content_uri(
    _app: &tauri::AppHandle,
    _uri: &str,
    _write: bool,
) -> Result<std::fs::File, String> {
    Err("当前平台不支持 content:// 文件地址".to_string())
}

fn write_content_uri(app: &tauri::AppHandle, uri: &str, bytes: &[u8]) -> Result<(), String> {
    use std::io::Write;
    let mut file = open_content_uri(app, uri, true)?;
    file.write_all(bytes)
        .map_err(|e| format!("写入文件失败: {e}"))?;
    file.flush().map_err(|e| format!("写入文件失败: {e}"))
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
    // 按备份文件里记录的参数派生：旧导出没有 kdf 字段 → 历史参数，仍可导入
    let key = crypto::derive_key(&password, &salt, file.kdf)?;
    let imported = crypto::decrypt_payload(&file, &key)?;

    let scope = file.scope.clone();
    let mut added_accounts = 0u32;
    let mut applied_settings = false;
    // 因数据非法而被跳过的账户数：向前端如实反馈，避免用户以为「账户丢失」
    let mut skipped_invalid = 0u32;
    // 因密钥与现有账户重复而被跳过的数量（去重口径与 add_account 一致）
    let mut skipped_duplicate = 0u32;

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
            //
            // 去重口径必须与 add_account / update_account 一致：**密钥相同即视为
            // 同一个验证码**（验证码由密钥唯一决定）。旧实现只按 id 去重，同一
            // 密钥从备份重复导入后会在列表里出现多张生成同样数字的卡片。
            let existing_ids: std::collections::HashSet<String> =
                p.accounts.iter().map(|a| a.id.clone()).collect();
            let mut existing_secrets: std::collections::HashSet<String> =
                p.accounts.iter().map(|a| a.secret.clone()).collect();
            // 本机是否已有账户：决定导入的排序序号怎么落地。
            // - 空库（换机恢复的典型场景）：完整沿用备份里的顺序，
            //   用户在新机器上看到的排列与旧机器完全一致，无感切换。
            // - 非空库（合并导入）：备份序号与本机序号会冲突（都从 1 开始），
            //   因此把备份账户整体追加到本机现有顺序之后，保持备份内部的相对顺序。
            let local_empty = p.accounts.is_empty();
            let local_max = p.accounts.iter().map(|a| a.sort_order).max().unwrap_or(0);
            let mut appended = 0i32;
            for acc in imported.accounts.iter() {
                if existing_ids.contains(&acc.id) {
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
                if existing_secrets.contains(&acc.secret) {
                    skipped_duplicate += 1;
                    continue;
                }
                existing_secrets.insert(acc.secret.clone());
                let mut acc = acc.clone();
                if local_empty {
                    // 空库：原样保留备份里的序号，换机后顺序完全一致。
                    // 备份来自旧版本（序号全为 0）时也保持 0，走默认顺序。
                } else if local_max > 0 {
                    // 本机已手动排序：备份账户整体追加到末尾，保持备份内部相对顺序。
                    // 备份序号可能从 1 开始，直接沿用会插到本机账户中间。
                    appended += 1;
                    acc.sort_order = local_max.saturating_add(appended);
                } else {
                    // 本机未手动排序：归零，与本机账户一起走默认顺序。
                    acc.sort_order = 0;
                }
                p.accounts.push(acc);
                added_accounts += 1;
            }
        }
        if scope.settings {
            // 备份不含锁定凭证文件，故 lock_enabled 不能随备份覆盖，
            // 始终以本机实际锁文件为准，避免导入后出现状态不一致。
            // 其余字段同样过一遍白名单：备份是外部数据，不应直接信任。
            let has_lock = store::read_lock(&state.app_dir).is_some();
            let mut next = sanitize_settings(imported.settings.clone());
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
        skipped_duplicate,
    })
}

#[derive(serde::Serialize)]
pub struct ImportResult {
    pub added_accounts: u32,
    pub applied_settings: bool,
    pub total_accounts_in_backup: u32,
    /// 因字段非法（密钥/位数/周期/算法）被跳过的账户数
    pub skipped_invalid: u32,
    /// 因密钥与现有账户重复被跳过的账户数
    pub skipped_duplicate: u32,
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

/// 调整账户顺序（传入按目标顺序排列的账户 id 列表）。
///
/// 只接受已存在的 id，未知 id 直接忽略；未出现在列表中的账户保持原有相对位置
/// （追加到末尾），避免前端只传部分 id 时把其余账户的序号清成 0。
#[tauri::command]
pub fn reorder_accounts(state: State<AppState>, ids: Vec<String>) -> Result<(), String> {
    // 上限校验：账户数量本身有限，这里只防御异常超长入参
    if ids.len() > 10_000 {
        return Err("排序参数过多".to_string());
    }
    state.with_payload(|p| {
        let mut next = 1i32;
        let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
        for id in ids.iter() {
            if !seen.insert(id.clone()) {
                continue;
            }
            if let Some(acc) = p.accounts.iter_mut().find(|a| &a.id == id) {
                acc.sort_order = next;
                next += 1;
            }
        }
        // 未在列表中的账户：排在已排序账户之后，保持彼此原有顺序
        for acc in p.accounts.iter_mut() {
            if !seen.contains(&acc.id) {
                acc.sort_order = next;
                next += 1;
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

/// 规范化设置：枚举字段只接受白名单取值，数值字段夹到合法区间。
///
/// 前端虽然也有 `|| "system"` 之类的兜底，但设置会经「加密备份导入」这条
/// 外部数据通道写入，后端不能假设客户端一定自洽——非法值一旦落盘，
/// 会让下一次启动的渲染逻辑走到未定义分支。
fn sanitize_settings(mut s: AppSettings) -> AppSettings {
    fn one_of(value: &str, allowed: &[&str], fallback: &str) -> String {
        if allowed.contains(&value) {
            value.to_string()
        } else {
            fallback.to_string()
        }
    }
    s.theme = one_of(&s.theme, &["light", "dark", "system"], "system");
    s.splash_animation =
        one_of(&s.splash_animation, &["draw", "pop", "ring", "dots", "none"], "dots");
    s.code_visibility = one_of(&s.code_visibility, &["never", "always", "hover"], "never");
    s.category_expand_mode =
        one_of(&s.category_expand_mode, &["expand", "collapse", "remember"], "expand");
    s.card_density = one_of(&s.card_density, &["compact", "standard"], "standard");
    s.card_detail = one_of(&s.card_detail, &["minimal", "standard", "detailed"], "detailed");
    s.close_behavior = one_of(&s.close_behavior, &["quit", "tray"], "quit");
    s.language = one_of(&s.language, &["auto", "zh", "en"], "auto");
    s.window_size = one_of(&s.window_size, &["compact", "standard", "expanded"], "standard");
    s.font_scale = one_of(&s.font_scale, &["small", "standard", "large", "xlarge"], "standard");
    // 0 =「离开时锁定」（不做空闲计时），999999 =「从不」，超出范围回退默认 30 秒
    if s.auto_lock_seconds > 999_999 {
        s.auto_lock_seconds = 30;
    }
    // 备份保留份数：至少留 1 份，最多 10 份（与界面选项一致）
    s.backup_keep = s.backup_keep.clamp(1, 10);
    // 密码提示为明文展示，限制长度避免撑破界面
    if s.password_hint.chars().count() > 100 {
        s.password_hint = s.password_hint.chars().take(100).collect();
    }
    s
}

/// 当前是否处于远程桌面 / 远程协助会话。
///
/// 用 `SESSIONNAME` 环境变量判断（`RDP-Tcp#…` / `RDP-…` 均为远程会话）：
/// 不引入额外 Win32 依赖，且对普通本地会话返回 false。
/// 前端据此在「隐私保护 → 远程时隐藏窗口」开启时隐藏窗口，
/// 避免远程画面把验证码一起传出去。
/// 诊断追踪：把前端的关键判定写入 trace.log。
///
/// 仅在环境变量 `ONETOTP_TRACE=1` 时生效（默认完全静默），用于排查
/// 「锁屏/自动认证为什么没触发」这类只能靠时序观察的问题。
/// 只记录判定结果与原因码，**不写任何密钥、口令或验证码**。
#[tauri::command]
pub fn trace_event(state: State<AppState>, message: String) {
    if std::env::var("ONETOTP_TRACE").ok().as_deref() != Some("1") {
        return;
    }
    store::append_trace_log(&state.app_dir, &message);
}

#[tauri::command]
pub fn is_remote_session() -> bool {
    match std::env::var("SESSIONNAME") {
        Ok(name) => {
            let upper = name.to_uppercase();
            upper.starts_with("RDP-") || upper.starts_with("RDP#")
        }
        Err(_) => false,
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

/// 数据目录信息：当前实际目录 + 系统默认目录
#[derive(serde::Serialize)]
pub struct DataDirView {
    /// 当前实际使用的数据目录
    pub current: String,
    /// 系统默认目录（未自定义时与 current 相同）
    pub default_dir: String,
    /// 是否已自定义
    pub custom: bool,
}

/// 读取当前数据目录
#[tauri::command]
pub fn get_data_dir(state: State<AppState>) -> DataDirView {
    let current = state.app_dir.to_string_lossy().to_string();
    let default_dir = state.default_dir.to_string_lossy().to_string();
    DataDirView {
        custom: state.app_dir != state.default_dir,
        current,
        default_dir,
    }
}

/// 切换数据目录：把现有数据迁移到新目录，写入指针，然后重启应用。
///
/// 必须重启：`AppState.app_dir` 在启动时确定，运行期改它会让已打开的
/// 文件句柄、缓存与磁盘状态不一致。重启是最简单可靠的做法。
///
/// 安全约束：
/// - 目标必须是绝对路径，且不能是当前目录本身
/// - 目标不能位于当前数据目录内部（否则复制会自我递归）
/// - 迁移只复制、不删除源目录，失败时用户数据仍在原处
#[tauri::command]
pub fn set_data_dir(app: tauri::AppHandle, state: State<AppState>, dir: String) -> Result<(), String> {
    let raw = dir.trim();
    if raw.is_empty() {
        return Err("目录不能为空".to_string());
    }
    let target = std::path::PathBuf::from(raw);
    if !target.is_absolute() {
        return Err("请提供绝对路径".to_string());
    }
    // 规范化后再比较，避免 `..` 或末尾斜杠造成误判
    let target = target
        .canonicalize()
        .map_err(|_| "目标目录不存在或无法访问".to_string())?;
    let current = state
        .app_dir
        .canonicalize()
        .unwrap_or_else(|_| state.app_dir.clone());
    if target == current {
        return Err("目标目录与当前数据目录相同".to_string());
    }
    // 目标在当前目录内部：复制时会把自己复制进去，必须拒绝
    if target.starts_with(&current) {
        return Err("目标目录不能位于当前数据目录内部".to_string());
    }
    if !target.is_dir() {
        return Err("目标路径不是目录".to_string());
    }
    // 纯离线前提：数据目录不能是网络位置，否则密文与备份会被写到远端
    if store::is_network_path(&target) {
        return Err("不能使用网络路径作为数据目录：数据会被写到远端".to_string());
    }

    store::migrate_data_dir(&current, &target)?;
    store::write_data_dir_pointer(&state.default_dir, Some(&target))?;

    // 迁移完成：重启应用让新的 app_dir 生效
    app.restart();
}

/// 恢复默认数据目录：把数据迁回系统默认目录并重启
#[tauri::command]
pub fn reset_data_dir(app: tauri::AppHandle, state: State<AppState>) -> Result<(), String> {
    let current = state
        .app_dir
        .canonicalize()
        .unwrap_or_else(|_| state.app_dir.clone());
    let default_dir = state
        .default_dir
        .canonicalize()
        .unwrap_or_else(|_| state.default_dir.clone());
    if current == default_dir {
        return Err("当前已是默认数据目录".to_string());
    }
    store::migrate_data_dir(&current, &default_dir)?;
    store::write_data_dir_pointer(&state.default_dir, None)?;
    app.restart();
}

fn base64_encode(data: &[u8]) -> String {
    use base64::{engine::general_purpose::STANDARD as B64, Engine};
    B64.encode(data)
}

fn base64_decode(data: &str) -> Result<Vec<u8>, String> {
    use base64::{engine::general_purpose::STANDARD as B64, Engine};
    B64.decode(data).map_err(|_| "Base64 解码失败".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::Category;

    fn account_with_legacy_category(name: &str) -> Account {
        Account {
            id: uuid::Uuid::new_v4().to_string(),
            issuer: "Issuer".to_string(),
            account: "acc".to_string(),
            secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ".to_string(),
            otp_type: "totp".to_string(),
            algorithm: "SHA1".to_string(),
            digits: 6,
            period: 30,
            counter: 0,
            category_id: String::new(),
            category: name.to_string(),
            favorite: false,
            sort_order: 0,
            created_at: 0,
            last_used_at: 0,
        }
    }

    // ── 账户排序：手动排序后新账户必须落在末尾 ──

    fn view(id: &str, sort_order: i32, created_at: i64, favorite: bool) -> AccountView {
        AccountView {
            id: id.to_string(),
            issuer: id.to_string(),
            account: String::new(),
            secret: String::new(),
            otp_type: "totp".to_string(),
            algorithm: "SHA1".to_string(),
            digits: 6,
            period: 30,
            counter: 0,
            category_id: String::new(),
            category_name: String::new(),
            category_color: String::new(),
            favorite,
            sort_order,
            created_at,
            last_used_at: 0,
        }
    }

    /// 从未手动排序（全部为 0）：保持默认的「收藏优先 + 最新在前」
    #[test]
    fn sort_accounts_defaults_to_favorite_then_newest() {
        let mut list = vec![
            view("old", 0, 100, false),
            view("new", 0, 300, false),
            view("fav", 0, 200, true),
        ];
        sort_accounts(&mut list);
        let ids: Vec<&str> = list.iter().map(|a| a.id.as_str()).collect();
        assert_eq!(ids, vec!["fav", "new", "old"]);
    }

    /// 手动排序后：严格按序号，新账户（序号 0）排在末尾而不是最前
    #[test]
    fn sort_accounts_puts_new_account_last_after_manual_sort() {
        let mut list = vec![
            view("second", 2, 100, false),
            view("brand-new", 0, 999, false),
            view("first", 1, 100, false),
        ];
        sort_accounts(&mut list);
        let ids: Vec<&str> = list.iter().map(|a| a.id.as_str()).collect();
        assert_eq!(ids, vec!["first", "second", "brand-new"]);
    }

    /// 手动排序后收藏不改变位置：序号优先于收藏标记
    #[test]
    fn sort_accounts_manual_order_beats_favorite() {
        let mut list = vec![
            view("a", 1, 100, false),
            view("b", 2, 100, true),
        ];
        sort_accounts(&mut list);
        let ids: Vec<&str> = list.iter().map(|a| a.id.as_str()).collect();
        assert_eq!(ids, vec!["a", "b"]);
    }

    /// 新账户必须排在最前面：手动排序生效时现有账户整体后移
    #[test]
    fn reserve_top_slots_moves_existing_down() {
        let mut accounts = vec![
            account_with_legacy_category("a"),
            account_with_legacy_category("b"),
        ];
        accounts[0].sort_order = 1;
        accounts[1].sort_order = 2;

        let base = reserve_top_slots(&mut accounts, 1);
        assert_eq!(base, 1, "新账户应占用第 1 位");
        assert_eq!(accounts[0].sort_order, 2);
        assert_eq!(accounts[1].sort_order, 3);
    }

    /// 从未手动排序时不改动任何序号：默认顺序本身就是「最新在前」
    #[test]
    fn reserve_top_slots_noop_without_manual_order() {
        let mut accounts = vec![account_with_legacy_category("a")];
        let base = reserve_top_slots(&mut accounts, 1);
        assert_eq!(base, 0);
        assert_eq!(accounts[0].sort_order, 0);
    }

    /// 批量预留：多个新账户占用 1..=n，现有账户整体后移 n 位
    #[test]
    fn reserve_top_slots_handles_batch() {
        let mut accounts = vec![account_with_legacy_category("a")];
        accounts[0].sort_order = 5;

        let base = reserve_top_slots(&mut accounts, 3);
        assert_eq!(base, 1);
        assert_eq!(accounts[0].sort_order, 8);
    }

    // ── 关闭窗口：关闭到托盘必须同时锁定 ──

    /// 构造一个「已解锁」的 AppState
    fn unlocked_state() -> AppState {
        let dir = std::env::temp_dir();
        let state = AppState::new(dir.clone(), dir);
        *state.key.lock().unwrap() = Some([7u8; 32]);
        *state.payload.lock().unwrap() = Some(VaultPayload {
            accounts: vec![account_with_legacy_category("工作")],
            settings: AppSettings::default(),
            categories: Vec::new(),
        });
        state.code_cache.lock().unwrap().insert(
            "a".to_string(),
            (1, "123456".to_string(), None),
        );
        state
    }

    /// 关闭到托盘：必须隐藏窗口并立即锁定内存密钥/载荷/验证码缓存。
    /// 回归点：旧实现只 hide() 不锁定，从托盘恢复后会直接看到明文验证码。
    #[test]
    fn close_to_tray_locks_the_vault() {
        let state = unlocked_state();
        *state.close_behavior.lock().unwrap() = "tray".to_string();

        assert!(state.prepare_close(), "关闭到托盘应要求隐藏窗口");

        assert!(state.key.lock().unwrap().is_none(), "内存密钥必须清空");
        assert!(state.payload.lock().unwrap().is_none(), "内存载荷必须清空");
        assert!(state.code_cache.lock().unwrap().is_empty(), "验证码缓存必须清空");
        assert!(state.current_key().is_err(), "锁定后取密钥必须失败");
    }

    /// 关闭即退出：不隐藏，也不需要在 Rust 侧锁定（进程即将结束）
    #[test]
    fn close_to_quit_does_not_hide_or_lock() {
        let state = unlocked_state();
        *state.close_behavior.lock().unwrap() = "quit".to_string();

        assert!(!state.prepare_close(), "退出行为不应阻止关闭");
        assert!(state.key.lock().unwrap().is_some(), "退出路径不必清空密钥");
        assert!(state.payload.lock().unwrap().is_some());
    }

    #[test]
    fn sanitize_settings_keeps_whitelisted_values() {        let s = AppSettings {
            theme: "dark".to_string(),
            code_visibility: "always".to_string(),
            card_density: "compact".to_string(),
            card_detail: "detailed".to_string(),
            close_behavior: "tray".to_string(),
            language: "en".to_string(),
            window_size: "expanded".to_string(),
            font_scale: "xlarge".to_string(),
            auto_lock_seconds: 300,
            backup_keep: 5,
            ..AppSettings::default()
        };
        let out = sanitize_settings(s);
        assert_eq!(out.theme, "dark");
        assert_eq!(out.code_visibility, "always");
        assert_eq!(out.card_density, "compact");
        assert_eq!(out.card_detail, "detailed");
        assert_eq!(out.close_behavior, "tray");
        assert_eq!(out.language, "en");
        assert_eq!(out.window_size, "expanded");
        assert_eq!(out.font_scale, "xlarge");
        assert_eq!(out.auto_lock_seconds, 300);
        assert_eq!(out.backup_keep, 5);
    }

    #[test]
    fn sanitize_settings_replaces_out_of_range_values() {
        let s = AppSettings {
            theme: "neon".to_string(),
            code_visibility: "maybe".to_string(),
            card_density: "huge".to_string(),
            card_detail: "insane".to_string(),
            close_behavior: "explode".to_string(),
            language: "fr".to_string(),
            window_size: "gigantic".to_string(),
            font_scale: "huge".to_string(),
            // 超出「从不」上限
            auto_lock_seconds: 1_000_000,
            // 0 份会让 prune_backups 删掉全部快照，10 份是界面上限
            backup_keep: 0,
            password_hint: "x".repeat(200),
            ..AppSettings::default()
        };
        let out = sanitize_settings(s);
        assert_eq!(out.theme, "system");
        assert_eq!(out.code_visibility, "never");
        assert_eq!(out.card_density, "standard");
        assert_eq!(out.card_detail, "detailed");
        assert_eq!(out.close_behavior, "quit");
        assert_eq!(out.language, "auto");
        assert_eq!(out.window_size, "standard");
        assert_eq!(out.font_scale, "standard");
        assert_eq!(out.auto_lock_seconds, 30);
        assert_eq!(out.backup_keep, 1);
        assert_eq!(out.password_hint.chars().count(), 100);
    }

    /// 「立即」(0) 与「从不」(999999) 都是合法取值，不能被夹掉
    #[test]
    fn sanitize_settings_preserves_zero_and_never_sentinel() {
        let zero = sanitize_settings(AppSettings {
            auto_lock_seconds: 0,
            ..AppSettings::default()
        });
        assert_eq!(zero.auto_lock_seconds, 0);

        let never = sanitize_settings(AppSettings {
            auto_lock_seconds: 999_999,
            ..AppSettings::default()
        });
        assert_eq!(never.auto_lock_seconds, 999_999);
    }

    #[test]
    fn normalize_hex_color_only_accepts_full_hex() {
        assert_eq!(normalize_hex_color("#1664ff"), "#1664FF");
        assert_eq!(normalize_hex_color("  #ABCDEF "), "#ABCDEF");
        // 以下都应回退到源力蓝
        assert_eq!(normalize_hex_color("#FFF"), "#1664FF");
        assert_eq!(normalize_hex_color("1664FF"), "#1664FF");
        assert_eq!(normalize_hex_color("#GGGGGG"), "#1664FF");
        // 越界注入尝试
        assert_eq!(normalize_hex_color("#1664FF;background:url(x)"), "#1664FF");
    }

    #[test]
    fn migrate_categories_converts_legacy_names_once() {
        let mut payload = VaultPayload {
            accounts: vec![
                account_with_legacy_category("工作"),
                account_with_legacy_category("工作"),
                account_with_legacy_category("生活"),
            ],
            settings: AppSettings::default(),
            categories: Vec::new(),
        };

        assert!(migrate_categories(&mut payload), "存在旧分类名时应报告有改动");
        // 两个同名旧分类只生成一个分类实体
        assert_eq!(payload.categories.len(), 2);
        let work = payload
            .categories
            .iter()
            .find(|c| c.name == "工作")
            .expect("应生成「工作」分类");
        assert!(work.color.starts_with('#'));
        for acc in &payload.accounts {
            assert!(!acc.category_id.is_empty(), "category_id 必须被回填");
            assert!(acc.category.is_empty(), "旧字段必须被清空");
        }
        // 再次执行应无改动（幂等）
        assert!(!migrate_categories(&mut payload));
    }

    #[test]
    fn migrate_categories_reuses_existing_entity() {        let existing = Category {
            id: "cat-1".to_string(),
            name: "工作".to_string(),
            color: "#123456".to_string(),
            order: 0,
            created_at: 0,
        };
        let mut payload = VaultPayload {
            accounts: vec![account_with_legacy_category("工作")],
            settings: AppSettings::default(),
            categories: vec![existing],
        };
        assert!(migrate_categories(&mut payload));
        assert_eq!(payload.categories.len(), 1, "不应重复创建同名分类");
        assert_eq!(payload.accounts[0].category_id, "cat-1");
    }

    // ── 锁定凭证校验：v0（旧 / 不安全格式）与 v1（HMAC 校验值） ──

    const PASSWORD: &str = "correct horse battery";

    /// 构造一份 v0 旧格式凭证：verifier 就是保险库密钥的 base64。
    /// 同时使用**历史 KDF 参数**，模拟真实的老文件。
    fn legacy_record(password: &str) -> (store::LockRecord, [u8; 32]) {
        let salt = crate::crypto::new_salt();
        let kdf = crate::crypto::KdfParams::LEGACY;
        let key = crate::crypto::derive_key(password, &salt, kdf).unwrap();
        let record = store::LockRecord {
            version: 0,
            kdf,
            salt: base64_encode(&salt),
            verifier: crate::crypto::legacy_verifier(&key),
            hint: String::new(),
            fail_count: 0,
            last_fail_ms: 0,
        };
        (record, key)
    }

    /// 构造一份 v1 当前格式凭证（当前 KDF 参数）
    fn current_record(password: &str) -> (store::LockRecord, [u8; 32]) {
        let salt = crate::crypto::new_salt();
        let kdf = crate::crypto::KdfParams::CURRENT;
        let key = crate::crypto::derive_key(password, &salt, kdf).unwrap();
        let record = store::LockRecord {
            version: store::LOCK_RECORD_VERSION,
            kdf,
            salt: base64_encode(&salt),
            verifier: crate::crypto::derive_verifier(&key),
            hint: String::new(),
            fail_count: 0,
            last_fail_ms: 0,
        };
        (record, key)
    }

    #[test]
    fn verifies_v1_record_and_reports_no_upgrade() {
        let (record, key) = current_record(PASSWORD);
        let (derived, needs_upgrade) = verify_lock_password(&record, PASSWORD).unwrap();
        assert_eq!(derived, key);
        assert!(!needs_upgrade, "v1 不应再被判定为需要升级");
    }

    /// 旧格式必须能继续打开：否则升级后老用户会被锁在门外
    #[test]
    fn verifies_legacy_record_and_reports_upgrade() {
        let (record, key) = legacy_record(PASSWORD);
        let (derived, needs_upgrade) = verify_lock_password(&record, PASSWORD).unwrap();
        assert_eq!(derived, key);
        assert!(needs_upgrade, "v0 应标记为需升级");
    }

    #[test]
    fn rejects_wrong_password_in_both_formats() {
        let (v1, _) = current_record(PASSWORD);
        assert!(verify_lock_password(&v1, "wrong password").is_err());

        let (v0, _) = legacy_record(PASSWORD);
        assert!(verify_lock_password(&v0, "wrong password").is_err());
    }

    /// 两种格式的校验值不可互换：把 v1 的 HMAC 值塞进 v0 凭证必须失败，
    /// 反之亦然。否则版本字段一旦被误改，就等于绕过口令校验。
    #[test]
    fn verifier_formats_are_not_interchangeable() {
        let salt = crate::crypto::new_salt();
        let kdf = crate::crypto::KdfParams::CURRENT;
        let key = crate::crypto::derive_key(PASSWORD, &salt, kdf).unwrap();
        let salt_b64 = base64_encode(&salt);

        let v0_with_hmac = store::LockRecord {
            version: 0,
            kdf,
            salt: salt_b64.clone(),
            verifier: crate::crypto::derive_verifier(&key),
            hint: String::new(),
            fail_count: 0,
            last_fail_ms: 0,
        };
        assert!(verify_lock_password(&v0_with_hmac, PASSWORD).is_err());

        let v1_with_key = store::LockRecord {
            version: store::LOCK_RECORD_VERSION,
            kdf,
            salt: salt_b64,
            verifier: crate::crypto::legacy_verifier(&key),
            hint: String::new(),
            fail_count: 0,
            last_fail_ms: 0,
        };
        assert!(verify_lock_password(&v1_with_key, PASSWORD).is_err());
    }

    /// 升级后同一口令仍可解锁，且保险库密钥不变（升级只改 verifier）
    #[test]
    fn upgrade_keeps_password_and_key_working() {
        let dir = std::env::temp_dir().join(format!("onetotp-lock-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();

        let (record, key) = legacy_record(PASSWORD);
        store::write_lock(&dir, &record).unwrap();

        let (derived, needs_upgrade) = verify_lock_password(&record, PASSWORD).unwrap();
        assert!(needs_upgrade);
        upgrade_lock_record_if_needed(&dir, &record, &derived);

        let upgraded = store::read_lock(&dir).expect("升级后必须仍能读出凭证");
        assert_eq!(upgraded.version, store::LOCK_RECORD_VERSION);
        assert_eq!(upgraded.salt, record.salt, "salt 不得改变，否则密钥会变");
        // 升级后的凭证：同一口令仍通过，且不再需要升级
        let (again, needs_upgrade_again) = verify_lock_password(&upgraded, PASSWORD).unwrap();
        assert_eq!(again, key, "密钥必须保持不变，否则既有保险库解不开");
        assert!(!needs_upgrade_again);
        // 升级后 verifier 里不再包含密钥本身
        assert_ne!(crate::crypto::legacy_verifier(&key), upgraded.verifier);

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 幂等：已是 v1 的凭证重复调用升级不应改写
    #[test]
    fn upgrade_is_idempotent() {
        let dir = std::env::temp_dir().join(format!("onetotp-lock2-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let (record, key) = current_record(PASSWORD);
        store::write_lock(&dir, &record).unwrap();
        upgrade_lock_record_if_needed(&dir, &record, &key);
        let after = store::read_lock(&dir).unwrap();
        assert_eq!(after.verifier, record.verifier);
        let _ = std::fs::remove_dir_all(&dir);
    }

    // ── 解锁退避：计数必须跨重启生效 ──

    #[test]
    fn backoff_grows_exponentially_and_is_capped() {
        assert_eq!(unlock_backoff_ms(0), 0, "没有失败历史不应有任何延迟");
        assert_eq!(unlock_backoff_ms(1), 200);
        assert_eq!(unlock_backoff_ms(2), 400);
        assert_eq!(unlock_backoff_ms(3), 800);
        assert_eq!(unlock_backoff_ms(4), 1_600);
        // 封顶 3 秒，避免退避本身变成可用性问题
        assert_eq!(unlock_backoff_ms(5), 3_000);
        assert_eq!(unlock_backoff_ms(50), 3_000);
        assert_eq!(unlock_backoff_ms(u32::MAX), 3_000, "极端值不得溢出");
    }

    /// 核心回归：失败计数写入凭证文件，重启后仍然存在
    #[test]
    fn failed_unlock_count_survives_restart() {
        let dir = std::env::temp_dir().join(format!("onetotp-backoff-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let (mut record, _key) = current_record(PASSWORD);
        store::write_lock(&dir, &record).unwrap();
        let original_verifier = record.verifier.clone();
        let original_salt = record.salt.clone();

        // 两次失败
        note_failed_unlock(&dir, &mut record);
        note_failed_unlock(&dir, &mut record);

        // 模拟「重启」：直接重新从磁盘读取
        let reloaded = store::read_lock(&dir).expect("凭证应仍可读");
        assert_eq!(reloaded.fail_count, 2, "失败计数必须落盘，重启不清零");
        assert!(reloaded.last_fail_ms > 0);
        // 改写计数不能碰任何决定解密结果的字段
        assert_eq!(reloaded.salt, original_salt, "salt 不得变化");
        assert_eq!(reloaded.verifier, original_verifier, "verifier 不得变化");
        assert_eq!(reloaded.kdf, record.kdf, "KDF 参数不得变化");
        assert_eq!(reloaded.version, record.version);

        // 解锁成功后清零，并再次落盘
        clear_failed_unlocks(&dir, &mut record);
        let cleared = store::read_lock(&dir).unwrap();
        assert_eq!(cleared.fail_count, 0);
        assert_eq!(cleared.last_fail_ms, 0);
        assert_eq!(cleared.salt, original_salt);

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 退避时长按持久化计数计算（不再依赖内存里的瞬时状态）
    #[test]
    fn backoff_uses_persisted_count_after_restart() {
        let dir = std::env::temp_dir().join(format!("onetotp-backoff2-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let (mut record, _key) = current_record(PASSWORD);
        for _ in 0..3 {
            note_failed_unlock(&dir, &mut record);
        }
        let reloaded = store::read_lock(&dir).unwrap();
        assert_eq!(unlock_backoff_ms(reloaded.fail_count), 800);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
