use crate::crypto;
use crate::models::{Account, AppSettings, VaultFile, VaultPayload};
use std::fs;
use std::path::{Path, PathBuf};

pub const VAULT_FILE: &str = "onetotp.vault.json";
pub const LOCK_FILE: &str = "onetotp.lock.json";
pub const BACKUP_DIR: &str = "backups";
pub const LOCK_LOG_FILE: &str = "lock-events.log";
/// 数据目录指针文件：始终存放在系统默认应用目录下，
/// 内容为自定义数据目录的绝对路径。启动时先读它决定真正的 app_dir。
pub const DATA_DIR_POINTER: &str = "onetotp.datadir.json";
/// 机器密钥文件名（与 crypto 模块保持一致）
const MACHINE_KEY_FILE: &str = "onetotp.machine.key";

/// 锁定事件日志保留的最大行数（只保留最近若干次）
const LOCK_LOG_MAX_LINES: usize = 50;

/// 追加一条诊断追踪（仅在 ONETOTP_TRACE=1 时由命令触发）
pub fn append_trace_log(app_dir: &Path, message: &str) {
    let path = app_dir.join("trace.log");
    let stamp = crate::totp::now_millis();
    let line = format!("{stamp}\t{message}\n");
    // 简单追加 + 上限裁剪，避免长期开启时无限增长
    let mut lines: Vec<String> = fs::read_to_string(&path)
        .unwrap_or_default()
        .lines()
        .map(|s| s.to_string())
        .collect();
    lines.push(line.trim_end().to_string());
    if lines.len() > 300 {
        let drop = lines.len() - 300;
        lines.drain(0..drop);
    }
    let mut body = lines.join("\n");
    body.push('\n');
    let _ = fs::write(&path, body);
}

/// 追加一条锁定事件记录。
///
/// 只记录**时间 + 触发来源**，不含任何密钥、口令或验证码，可用于排查
/// 「离开应用后为什么没有锁定」：若无记录，说明锁定请求从未发出。
pub fn append_lock_log(app_dir: &Path, reason: &str) {
    let path = app_dir.join(LOCK_LOG_FILE);
    let stamp = crate::totp::now_millis();
    let line = format!("{stamp}\t{reason}\n");

    // 读取现有内容并裁剪：日志只用于近期排查，不无限增长
    let mut lines: Vec<String> = fs::read_to_string(&path)
        .unwrap_or_default()
        .lines()
        .map(|s| s.to_string())
        .collect();
    lines.push(line.trim_end().to_string());
    if lines.len() > LOCK_LOG_MAX_LINES {
        let drop = lines.len() - LOCK_LOG_MAX_LINES;
        lines.drain(0..drop);
    }
    let mut body = lines.join("\n");
    body.push('\n');
    // 尽力写入：日志失败绝不能影响锁定本身
    let _ = fs::write(&path, body);
}

/// 锁定凭证文件（保存密码校验值与盐，独立于保险库密钥）
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct LockRecord {
    /// 凭证格式版本。
    /// - `0`（字段缺失）：旧格式，`verifier` 就是保险库密钥的 base64，不安全
    /// - `1`：`verifier` 为 HMAC-SHA256(密钥, 固定上下文)，无法反推密钥
    ///
    /// 用 `serde(default)` 兼容旧文件：旧文件没有该字段，读出即为 0，
    /// `unlock` 会按旧规则校验，并在成功后原地升级为新格式。
    #[serde(default)]
    pub version: u32,
    /// 派生该密钥所用的 Argon2id 参数（缺省 = 历史参数）
    #[serde(default)]
    pub kdf: crate::crypto::KdfParams,
    pub salt: String,
    pub verifier: String,
    pub hint: String,
    /// 连续解锁失败次数（**落盘**，重启不清零）。
    ///
    /// 只存在内存里的话，攻击者每次失败后重启应用即可把计数清零，
    /// 「指数退避」形同虚设；写进凭证文件后重启循环不再有收益。
    #[serde(default)]
    pub fail_count: u32,
    /// 最近一次失败的时间（毫秒时间戳），用于跨进程计算退避是否已到期
    #[serde(default)]
    pub last_fail_ms: i64,
}

/// 当前写入的凭证格式版本
pub const LOCK_RECORD_VERSION: u32 = 1;

pub fn vault_path(app_dir: &Path) -> PathBuf {
    app_dir.join(VAULT_FILE)
}

pub fn lock_path(app_dir: &Path) -> PathBuf {
    app_dir.join(LOCK_FILE)
}

pub fn backup_dir(app_dir: &Path) -> PathBuf {
    app_dir.join(BACKUP_DIR)
}

pub fn ensure_app_dir(app_dir: &Path) -> Result<(), String> {
    fs::create_dir_all(app_dir).map_err(|e| format!("创建应用目录失败: {e}"))
}

/// 是否为网络路径（Windows UNC 形如 `\\server\share`）。
///
/// 纯离线应用必须拒绝把数据目录指向网络位置：那样每次写盘都会把**密文与备份
/// 写到远端**，直接违背「数据不出本机」的产品承诺，且远端存储的可信度不受控。
pub fn is_network_path(path: &Path) -> bool {
    #[cfg(windows)]
    {
        use std::path::{Component, Prefix};
        return match path.components().next() {
            Some(Component::Prefix(prefix)) => {
                matches!(prefix.kind(), Prefix::UNC(..) | Prefix::VerbatimUNC(..))
            }
            _ => false,
        };
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        false
    }
}

/// 读取自定义数据目录指针。
///
/// 指针文件固定放在系统默认应用目录（`default_dir`）下，内容为自定义目录的
/// 绝对路径。这样即使数据目录被移到别处，下次启动仍能找到它。
/// 返回 `None` 表示未自定义（使用默认目录）。
///
/// 注意：指针是一个**未受签名保护的信任边界**——任何能写该文件的进程都能改变
/// 数据目录。因此这里只接受「绝对路径 + 本地路径 + 真实存在的目录」，其余一律
/// 忽略并回退默认目录：宁可让用户看到默认数据，也不要静默加载别人的保险库，
/// 或把数据写到网络位置。
pub fn read_data_dir_pointer(default_dir: &Path) -> Option<PathBuf> {
    let path = default_dir.join(DATA_DIR_POINTER);
    let data = fs::read_to_string(path).ok()?;
    let value: serde_json::Value = serde_json::from_str(&data).ok()?;
    let dir = value.get("data_dir")?.as_str()?.trim().to_string();
    if dir.is_empty() {
        return None;
    }
    let path = PathBuf::from(dir);
    if !path.is_absolute() || is_network_path(&path) || !path.is_dir() {
        return None;
    }
    Some(path)
}

/// 数据目录指针不可用的原因**错误码**。
///
/// 为什么用错误码而不是中文句子：文案属于前端（要跟随语言切换），
/// 后端只负责判定事实。前端按 code 查 i18n 文案，附带 `path` 供用户定位。
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DataDirIssueCode {
    /// 指针文件存在但读不出来（权限/占用）
    Unreadable,
    /// 内容不是合法 JSON
    InvalidJson,
    /// 缺少 data_dir 字段
    MissingField,
    /// data_dir 为空字符串
    EmptyPath,
    /// 不是绝对路径
    NotAbsolute,
    /// 指向网络位置（UNC 等），本应用不支持
    NetworkPath,
    /// 目录不存在或不是目录
    NotFound,
}

/// 数据目录指针不可用：错误码 + 相关路径（供界面展示）
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DataDirIssue {
    pub code: DataDirIssueCode,
    /// 涉及的路径：能解析出路径时是目标目录，否则是空串
    pub path: String,
}

/// 指针存在但**不可用**时的原因（供 UI 明确告警）。
///
/// 为什么需要它：`read_data_dir_pointer` 对非法指针静默回退默认目录，
/// 用户会以为「我的数据不见了」。这里把原因回报出去，让界面提示
/// 「数据目录配置异常 + 当前用的是默认目录」，把静默失败变成可见状态。
///
/// 返回 `None` 表示没有指针文件，或指针完全合法。
pub fn data_dir_pointer_issue(default_dir: &Path) -> Option<DataDirIssue> {
    let path = default_dir.join(DATA_DIR_POINTER);
    if !path.exists() {
        return None;
    }
    let issue = |code: DataDirIssueCode, path: &str| {
        Some(DataDirIssue {
            code,
            path: path.to_string(),
        })
    };

    let data = match fs::read_to_string(&path) {
        Ok(v) => v,
        Err(_) => return issue(DataDirIssueCode::Unreadable, ""),
    };
    let value: serde_json::Value = match serde_json::from_str(&data) {
        Ok(v) => v,
        Err(_) => return issue(DataDirIssueCode::InvalidJson, ""),
    };
    let dir = match value.get("data_dir").and_then(|v| v.as_str()) {
        Some(v) => v.trim().to_string(),
        None => return issue(DataDirIssueCode::MissingField, ""),
    };
    if dir.is_empty() {
        return issue(DataDirIssueCode::EmptyPath, "");
    }
    let target = PathBuf::from(&dir);
    if !target.is_absolute() {
        return issue(DataDirIssueCode::NotAbsolute, &dir);
    }
    if is_network_path(&target) {
        return issue(DataDirIssueCode::NetworkPath, &dir);
    }
    if !target.is_dir() {
        return issue(DataDirIssueCode::NotFound, &dir);
    }
    None
}

/// 写入自定义数据目录指针；传 `None` 表示恢复默认（删除指针文件）。
pub fn write_data_dir_pointer(default_dir: &Path, data_dir: Option<&Path>) -> Result<(), String> {
    let path = default_dir.join(DATA_DIR_POINTER);
    match data_dir {
        Some(dir) => {
            let body = serde_json::json!({ "data_dir": dir.to_string_lossy() });
            let text = serde_json::to_string_pretty(&body).map_err(|e| e.to_string())?;
            write_atomic(&path, text.as_bytes())
                .map_err(|e| format!("写入数据目录指针失败: {e}"))
        }
        None => {
            if path.exists() {
                fs::remove_file(&path).map_err(|e| format!("删除数据目录指针失败: {e}"))?;
            }
            Ok(())
        }
    }
}

/// 把数据目录从 `from` 迁移到 `to`。
///
/// 只搬运本应用自己的文件（保险库、锁定凭证、机器密钥、备份目录、日志），
/// 不碰目标目录里的其他内容。
///
/// 目标目录若已有同名文件，先**另存一份 `.bak-<时间戳>`** 再覆盖：
/// 直接覆盖是不可逆的（比如目标目录里本来就有另一个 OneTotp 保险库，
/// 一旦覆盖，那份数据就永远找不回来了）。
///
/// 迁移完成后**不删除源目录**：万一新目录不可用，用户还能手动找回。
pub fn migrate_data_dir(from: &Path, to: &Path) -> Result<(), String> {
    if from == to {
        return Ok(());
    }
    fs::create_dir_all(to).map_err(|e| format!("创建目标目录失败: {e}"))?;

    // 逐个文件搬运：任一失败立即返回，已搬运的文件保留在目标目录，
    // 源目录数据不动，用户可重试或手动处理。
    let files = [VAULT_FILE, LOCK_FILE, MACHINE_KEY_FILE, LOCK_LOG_FILE, "trace.log"];
    for name in files {
        let src = from.join(name);
        if !src.is_file() {
            continue;
        }
        let dst = to.join(name);
        // 目标已有同名文件：先备份再覆盖，避免不可逆数据丢失
        if dst.is_file() {
            let stamp = crate::totp::now_millis();
            let backup = to.join(format!("{name}.bak-{stamp}"));
            fs::copy(&dst, &backup)
                .map_err(|e| format!("备份目标目录中的 {name} 失败：{e}（已中止迁移）"))?;
        }
        fs::copy(&src, &dst).map_err(|e| format!("复制 {name} 失败: {e}"))?;
    }

    // 备份快照目录：整体复制（保留文件名，便于按时间排序）
    let src_backups = backup_dir(from);
    if src_backups.is_dir() {
        let dst_backups = backup_dir(to);
        fs::create_dir_all(&dst_backups).map_err(|e| format!("创建备份目录失败: {e}"))?;
        let entries = fs::read_dir(&src_backups).map_err(|e| format!("读取备份目录失败: {e}"))?;
        for entry in entries.filter_map(|e| e.ok()) {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let Some(name) = path.file_name() else { continue };
            fs::copy(&path, dst_backups.join(name))
                .map_err(|e| format!("复制备份快照失败: {e}"))?;
        }
    }
    Ok(())
}

pub fn vault_exists(app_dir: &Path) -> bool {
    vault_path(app_dir).exists()
}

pub fn read_lock(app_dir: &Path) -> Option<LockRecord> {
    let path = lock_path(app_dir);
    let data = fs::read_to_string(path).ok()?;
    serde_json::from_str(&data).ok()
}

pub fn write_lock(app_dir: &Path, record: &LockRecord) -> Result<(), String> {
    let data = serde_json::to_string_pretty(record).map_err(|e| e.to_string())?;
    // 与保险库一致走原子写入：锁定凭证被截断会导致「读不到锁文件 → 误判未设密码」，
    // 而保险库此时已用密码密钥加密，用户将无法解密自己的数据。
    write_atomic(&lock_path(app_dir), data.as_bytes())
        .map_err(|e| format!("写入锁定凭证失败: {e}"))
}

pub fn remove_lock(app_dir: &Path) -> Result<(), String> {
    let path = lock_path(app_dir);
    if path.exists() {
        fs::remove_file(path).map_err(|e| format!("删除锁定凭证失败: {e}"))?;
    }
    Ok(())
}

pub fn read_vault(app_dir: &Path) -> Result<VaultFile, String> {
    let data = fs::read_to_string(vault_path(app_dir))
        .map_err(|e| format!("读取保险库失败: {e}"))?;
    serde_json::from_str(&data).map_err(|e| format!("保险库解析失败: {e}"))
}

/// 原子写入：先写同目录临时文件，再 rename 覆盖目标。
/// 避免写入过程中断电/崩溃留下被截断的损坏文件（JSON 无法解析会导致数据全失）。
fn write_atomic(path: &Path, data: &[u8]) -> Result<(), String> {
    let dir = path.parent().ok_or_else(|| "无效的目标路径".to_string())?;
    fs::create_dir_all(dir).map_err(|e| format!("创建目录失败: {e}"))?;
    let tmp = dir.join(format!(
        ".{}.tmp",
        path.file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "tmp".to_string())
    ));
    fs::write(&tmp, data).map_err(|e| format!("写入临时文件失败: {e}"))?;
    // 同分区 rename 是原子操作；Windows 下目标已存在时 rename 会失败，故先删除
    if path.exists() {
        let _ = fs::remove_file(path);
    }
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("提交文件失败: {e}")
    })
}

pub fn write_vault(app_dir: &Path, file: &VaultFile) -> Result<(), String> {
    let data = serde_json::to_string_pretty(file).map_err(|e| e.to_string())?;
    write_atomic(&vault_path(app_dir), data.as_bytes())
        .map_err(|e| format!("写入保险库失败: {e}"))
}

/// 写出加密快照，返回备份文件名
pub fn write_backup(app_dir: &Path, file: &VaultFile) -> Result<String, String> {
    let dir = backup_dir(app_dir);
    fs::create_dir_all(&dir).map_err(|e| format!("创建备份目录失败: {e}"))?;
    let name = format!("vault-backup-{}.json", crate::totp::now_millis());
    let data = serde_json::to_string_pretty(file).map_err(|e| e.to_string())?;
    write_atomic(&dir.join(&name), data.as_bytes())
        .map_err(|e| format!("写入备份失败: {e}"))?;
    Ok(name)
}

/// 修剪备份数量，仅保留最近 keep 个
pub fn prune_backups(app_dir: &Path, keep: u32) {
    let dir = backup_dir(app_dir);
    let Ok(entries) = fs::read_dir(&dir) else {
        return;
    };
    let mut files: Vec<PathBuf> = entries
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.extension().map(|x| x == "json").unwrap_or(false))
        .collect();
    if files.len() <= keep as usize {
        return;
    }
    files.sort();
    let remove_count = files.len() - keep as usize;
    for path in files.into_iter().take(remove_count) {
        let _ = fs::remove_file(path);
    }
}

/// 从历史快照中彻底清除某个账户的密钥。
///
/// 为什么需要：快照与主库共用同一把密钥，删除账户后旧快照里仍保留其 Base32
/// 密钥且当前口令可解 —— 等于「删除了但没撤销」。这里在删除账户时一并清理。
///
/// 返回值 `(已清理份数, 无法解密份数)`。
/// 无法解密的快照通常是「重新加密保险库」之前生成的（旧密钥），只能提示用户清理。
pub fn purge_account_from_backups(app_dir: &Path, account_id: &str, key: &[u8; 32]) -> (u32, u32) {
    let dir = backup_dir(app_dir);
    let Ok(entries) = fs::read_dir(&dir) else {
        return (0, 0);
    };
    let mut files: Vec<PathBuf> = entries
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.extension().map(|x| x == "json").unwrap_or(false))
        .collect();
    files.sort();

    let mut purged = 0u32;
    let mut stale = 0u32;
    for path in files {
        let Ok(text) = fs::read_to_string(&path) else {
            continue;
        };
        let Ok(file) = serde_json::from_str::<VaultFile>(&text) else {
            continue;
        };
        let Ok(mut payload) = crate::crypto::decrypt_payload(&file, key) else {
            // 旧密钥加密的快照：本次无法清理，交由调用方提示用户
            stale += 1;
            continue;
        };
        let before = payload.accounts.len();
        payload.accounts.retain(|a| a.id != account_id);
        if payload.accounts.len() == before {
            // 该快照不含此账户，不必重写（避免无谓改动文件时间戳）
            continue;
        }
        let Ok(salt) = crate::crypto::decode_salt(&file) else {
            continue;
        };
        // 沿用快照自身的盐与 KDF 参数重加密，保持它仍可用同一把密钥解开
        let Ok(rewritten) = crate::crypto::encrypt_payload(
            &payload,
            key,
            &salt,
            file.uses_machine_key,
            file.kdf,
        ) else {
            continue;
        };
        let Ok(data) = serde_json::to_string_pretty(&rewritten) else {
            continue;
        };
        if write_atomic(&path, data.as_bytes()).is_ok() {
            purged += 1;
        }
    }
    (purged, stale)
}

/// 统计无法用当前密钥解开的快照数量。
///
/// 「重新加密保险库」换过密钥之后，此前的快照全部作废；它们既解不开、
/// 也无法清理其中的账户，只会占空间并可能误导恢复操作，需要提示用户清理。
pub fn count_undecryptable_backups(app_dir: &Path, key: &[u8; 32]) -> u32 {
    let dir = backup_dir(app_dir);
    let Ok(entries) = fs::read_dir(&dir) else {
        return 0;
    };
    let mut stale = 0u32;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().map(|x| x != "json").unwrap_or(true) {
            continue;
        }
        let Ok(text) = fs::read_to_string(&path) else {
            continue;
        };
        let Ok(file) = serde_json::from_str::<VaultFile>(&text) else {
            continue;
        };
        if crate::crypto::decrypt_payload(&file, key).is_err() {
            stale += 1;
        }
    }
    stale
}

pub fn list_backups(app_dir: &Path) -> Vec<(String, u64)> {    let dir = backup_dir(app_dir);
    let Ok(entries) = fs::read_dir(&dir) else {
        return Vec::new();
    };
    let mut items: Vec<(String, u64)> = entries
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            if !name.ends_with(".json") {
                return None;
            }
            let size = e.metadata().ok().map(|m| m.len()).unwrap_or(0);
            Some((name, size))
        })
        .collect();
    items.sort_by(|a, b| b.0.cmp(&a.0));
    items
}

/// 本地数据占用概览
pub struct StorageUsage {
    /// 应用数据目录总占用字节数
    pub total_bytes: u64,
    /// 备份快照占用字节数
    pub backup_bytes: u64,
    /// 保险库文件占用字节数
    pub vault_bytes: u64,
    /// 备份快照数量
    pub backup_count: u32,
}

/// 统计单个路径占用；`max_depth` 限制递归层数，避免深层目录（或异常结构）拖慢统计。
fn dir_size_limited(path: &Path, max_depth: u32) -> u64 {
    let Ok(meta) = fs::metadata(path) else {
        return 0;
    };
    if meta.is_file() {
        return meta.len();
    }
    if max_depth == 0 {
        return 0;
    }
    let Ok(entries) = fs::read_dir(path) else {
        return 0;
    };
    entries
        .filter_map(|e| e.ok())
        .map(|e| dir_size_limited(&e.path(), max_depth - 1))
        .sum()
}

/// 统计应用本地数据占用：总量、备份、保险库。
/// 数据目录结构固定（应用目录 / backups），限制深度为 2 层即可完整覆盖，
/// 避免每次打开设置页都做无界递归遍历。
pub fn storage_usage(app_dir: &Path) -> StorageUsage {
    let backup_bytes = dir_size_limited(&backup_dir(app_dir), 2);
    let vault_bytes = fs::metadata(vault_path(app_dir)).map(|m| m.len()).unwrap_or(0);
    let total_bytes = dir_size_limited(app_dir, 3);
    let backup_count = list_backups(app_dir).len() as u32;
    StorageUsage {
        total_bytes,
        backup_bytes,
        vault_bytes,
        backup_count,
    }
}

/// 删除全部备份快照，返回删除的文件数量
pub fn clear_backups(app_dir: &Path) -> Result<u32, String> {
    let dir = backup_dir(app_dir);
    if !dir.exists() {
        return Ok(0);
    }
    let entries = fs::read_dir(&dir).map_err(|e| format!("读取备份目录失败: {e}"))?;
    let mut removed = 0u32;
    for entry in entries.filter_map(|e| e.ok()) {
        let path = entry.path();
        if path.extension().map(|x| x == "json").unwrap_or(false) && fs::remove_file(&path).is_ok() {
            removed += 1;
        }
    }
    Ok(removed)
}

/// 新建空的加密保险库（使用机器密钥或密码）
pub fn create_empty_vault(
    app_dir: &Path,
    key: &[u8; 32],
    salt: &[u8],
    uses_machine_key: bool,
) -> Result<(), String> {
    let payload = VaultPayload {
        accounts: Vec::new(),
        settings: AppSettings::default(),
        categories: Vec::new(),
    };
    // 新库一律用当前 KDF 参数
    let file = crypto::encrypt_payload(
        &payload,
        key,
        salt,
        uses_machine_key,
        crypto::KdfParams::CURRENT,
    )?;
    write_vault(app_dir, &file)
}

/// 解析 otpauth:// 链接（Key URI Format）
///
/// 兼容策略：
/// - TYPE（totp / hotp）大小写不敏感，缺省视为 totp
/// - secret 支持无 padding / 带 padding、大小写混写
/// - algorithm 缺省 SHA1，兼容 SHA-1 / SHA_1 等别名写法
/// - digits 缺省 6，支持 6 / 7 / 8
/// - period 缺省 30 秒，范围 1~3600
/// - counter 缺省 0（仅 hotp 使用）
/// - issuer 优先取查询参数，缺省回退到 label 冒号前缀
pub fn parse_otpauth(uri: &str) -> Result<Account, String> {
    let parsed = url::Url::parse(uri).map_err(|_| "不是合法的 otpauth 链接".to_string())?;
    if parsed.scheme() != "otpauth" {
        return Err("链接协议必须为 otpauth".to_string());
    }

    // TYPE：位于 host 部分（otpauth://TYPE/LABEL）
    let otp_type = match parsed.host_str().unwrap_or("").to_ascii_lowercase().as_str() {
        "" | "totp" => "totp".to_string(),
        "hotp" => "hotp".to_string(),
        other => return Err(format!("不支持的 OTP 类型: {other}")),
    };

    // Url::path() 返回的是 percent-encoded 字符串，需先解码再拆分标签
    let raw_label = parsed.path().trim_start_matches('/');
    let label = percent_encoding::percent_decode_str(raw_label)
        .decode_utf8()
        .map_err(|_| "otpauth 标签编码异常".to_string())?
        .to_string();
    let (issuer_from_label, account_from_label) = match label.split_once(':') {
        Some((iss, acc)) => (iss.trim().to_string(), acc.trim().to_string()),
        None => (String::new(), label.trim().to_string()),
    };

    let mut secret = String::new();
    let mut algorithm_raw = String::new();
    let mut digits_raw = String::new();
    let mut period_raw = String::new();
    let mut counter_raw = String::new();
    let mut issuer_param = String::new();

    for (k, v) in parsed.query_pairs() {
        match k.to_ascii_lowercase().as_str() {
            "secret" => secret = v.to_string(),
            "algorithm" => algorithm_raw = v.to_string(),
            "digits" => digits_raw = v.to_string(),
            "period" => period_raw = v.to_string(),
            "counter" => counter_raw = v.to_string(),
            "issuer" => issuer_param = v.to_string(),
            _ => {}
        }
    }

    let secret = crate::totp::normalize_secret(&secret);
    if secret.is_empty() {
        return Err("otpauth 链接缺少 secret 参数".to_string());
    }
    crate::totp::validate_secret(&secret).map_err(|_| "密钥不是合法的 Base32 字符串".to_string())?;

    let algorithm = crate::totp::normalize_algorithm(&algorithm_raw);
    match algorithm.as_str() {
        "SHA1" | "SHA256" | "SHA512" => {}
        other => return Err(format!("不支持的算法: {other}（请在手动模式选择 SHA1/SHA256/SHA512）")),
    }

    let digits = if digits_raw.trim().is_empty() {
        6
    } else {
        digits_raw
            .trim()
            .parse::<u32>()
            .map_err(|_| "digits 参数不是合法数字".to_string())?
    };
    let digits = crate::totp::normalize_digits(digits)
        .map_err(|_| "验证码位数必须为 6、7 或 8（请在手动模式调整）".to_string())?;

    let period = if period_raw.trim().is_empty() {
        30
    } else {
        period_raw
            .trim()
            .parse::<u32>()
            .map_err(|_| "period 参数不是合法数字".to_string())?
    };
    if period == 0 || period > 3600 {
        return Err("周期必须在 1~3600 秒之间".to_string());
    }

    let counter = if counter_raw.trim().is_empty() {
        0
    } else {
        counter_raw
            .trim()
            .parse::<u64>()
            .map_err(|_| "counter 参数不是合法数字".to_string())?
    };

    // issuer 优先取查询参数，其次取标签前缀
    let issuer = if !issuer_param.trim().is_empty() {
        issuer_param.trim().to_string()
    } else {
        issuer_from_label
    };

    Ok(Account {
        id: uuid::Uuid::new_v4().to_string(),
        issuer,
        account: account_from_label,
        secret,
        otp_type,
        algorithm,
        digits,
        period,
        counter,
        category_id: String::new(),
        category: String::new(),
        favorite: false,
        created_at: crate::totp::now_millis(),
        last_used_at: 0,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const SECRET: &str = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

    #[test]
    fn parses_standard_totp_uri() {
        let uri = format!("otpauth://totp/GitHub:alice@example.com?secret={SECRET}&issuer=GitHub");
        let acc = parse_otpauth(&uri).unwrap();
        assert_eq!(acc.otp_type, "totp");
        assert_eq!(acc.issuer, "GitHub");
        assert_eq!(acc.account, "alice@example.com");
        assert_eq!(acc.secret, SECRET);
        assert_eq!(acc.algorithm, "SHA1");
        assert_eq!(acc.digits, 6);
        assert_eq!(acc.period, 30);
        assert_eq!(acc.counter, 0);
        assert!(!acc.id.is_empty());
    }

    #[test]
    fn issuer_falls_back_to_label_prefix() {
        let uri = format!("otpauth://totp/ACME%20Co:bob?secret={SECRET}");
        let acc = parse_otpauth(&uri).unwrap();
        assert_eq!(acc.issuer, "ACME Co", "标签需 percent-decode 后取冒号前缀");
        assert_eq!(acc.account, "bob");
    }

    #[test]
    fn parses_hotp_with_counter_and_algorithm_aliases() {
        let uri = format!(
            "otpauth://hotp/ACME:carol?secret={SECRET}&counter=42&algorithm=sha-256&digits=8&period=60"
        );
        let acc = parse_otpauth(&uri).unwrap();
        assert_eq!(acc.otp_type, "hotp");
        assert_eq!(acc.counter, 42);
        assert_eq!(acc.algorithm, "SHA256");
        assert_eq!(acc.digits, 8);
    }

    #[test]
    fn secret_is_normalized_on_parse() {
        let uri = "otpauth://totp/x?secret=gezd%20gnbv-gy3t-qojq";
        let acc = parse_otpauth(&uri).unwrap();
        assert_eq!(acc.secret, "GEZDGNBVGY3TQOJQ");
    }

    #[test]
    fn rejects_bad_input() {
        // 非 otpauth 协议
        assert!(parse_otpauth("https://totp/x?secret=GEZDGNBV").is_err());
        // 缺 secret
        assert!(parse_otpauth("otpauth://totp/x?issuer=ACME").is_err());
        // 非法 base32
        assert!(parse_otpauth("otpauth://totp/x?secret=!!!").is_err());
        // 未知 OTP 类型
        assert!(parse_otpauth(&format!("otpauth://sms/x?secret={SECRET}")).is_err());
        // 位数越界
        assert!(parse_otpauth(&format!("otpauth://totp/x?secret={SECRET}&digits=9")).is_err());
        // 周期越界
        assert!(parse_otpauth(&format!("otpauth://totp/x?secret={SECRET}&period=0")).is_err());
        // 不支持的算法
        assert!(parse_otpauth(&format!("otpauth://totp/x?secret={SECRET}&algorithm=MD5")).is_err());
        // 完全不是 URL
        assert!(parse_otpauth("not a url").is_err());
    }

    #[test]
    fn lock_record_without_version_is_read_as_legacy() {
        // 旧版 lock.json 没有 version 字段，必须仍能反序列化（version=0）
        let legacy = r#"{"salt":"AAAA","verifier":"BBBB","hint":"提示"}"#;
        let rec: LockRecord = serde_json::from_str(legacy).unwrap();
        assert_eq!(rec.version, 0);
        assert_eq!(rec.hint, "提示");
        assert_eq!(rec.verifier, "BBBB");
    }

    // ── 数据目录指针：不可信输入的边界 ──

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("onetotp-{tag}-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn network_paths_are_recognised() {
        // Windows：UNC 路径必须被识别（用于拒绝把数据写到远端）
        #[cfg(windows)]
        {
            assert!(is_network_path(Path::new(r"\\server\share\data")));
            assert!(is_network_path(Path::new(r"\\?\UNC\server\share")));
            assert!(!is_network_path(Path::new(r"C:\Users\x\data")));
        }
        // 其他平台：至少不能 panic
        #[cfg(not(windows))]
        {
            assert!(!is_network_path(Path::new("/tmp/data")));
        }
    }

    /// 指针内容非法时必须回退默认目录，绝不能静默采用
    #[test]
    fn pointer_ignores_malicious_or_invalid_targets() {
        let default_dir = temp_dir("ptr-default");
        let real_target = temp_dir("ptr-real");

        // 1) 相对路径 → 忽略
        fs::write(
            default_dir.join(DATA_DIR_POINTER),
            r#"{"data_dir":"relative/path"}"#,
        )
        .unwrap();
        assert!(read_data_dir_pointer(&default_dir).is_none());

        // 2) 不存在的目录 → 忽略
        let missing = real_target.join("does-not-exist");
        fs::write(
            default_dir.join(DATA_DIR_POINTER),
            serde_json::json!({ "data_dir": missing.to_string_lossy() }).to_string(),
        )
        .unwrap();
        assert!(read_data_dir_pointer(&default_dir).is_none());

        // 3) 合法绝对路径 → 采用
        fs::write(
            default_dir.join(DATA_DIR_POINTER),
            serde_json::json!({ "data_dir": real_target.to_string_lossy() }).to_string(),
        )
        .unwrap();
        assert_eq!(read_data_dir_pointer(&default_dir), Some(real_target.clone()));

        // 4) 结构损坏 → 忽略
        fs::write(default_dir.join(DATA_DIR_POINTER), "{ not json").unwrap();
        assert!(read_data_dir_pointer(&default_dir).is_none());

        let _ = fs::remove_dir_all(&default_dir);
        let _ = fs::remove_dir_all(&real_target);
    }

    /// 网络路径指针即使 JSON 合法也必须被忽略
    #[test]
    fn pointer_rejects_network_target() {
        #[cfg(windows)]
        {
            let default_dir = temp_dir("ptr-unc");
            fs::write(
                default_dir.join(DATA_DIR_POINTER),
                r#"{"data_dir":"\\\\server\\share\\onetotp"}"#,
            )
            .unwrap();
            assert!(read_data_dir_pointer(&default_dir).is_none());
            let _ = fs::remove_dir_all(&default_dir);
        }
    }

    // ── 迁移：绝不静默覆盖目标目录里的既有数据 ──

    #[test]
    fn migration_backs_up_existing_target_files() {
        let from = temp_dir("mig-from");
        let to = temp_dir("mig-to");

        // 源目录：一个有内容的保险库
        fs::write(from.join(VAULT_FILE), b"SOURCE-VAULT").unwrap();

        // 目标目录：已存在同名文件（模拟用户选了一个已有 OneTotp 数据的目录）
        fs::write(to.join(VAULT_FILE), b"EXISTING-VAULT").unwrap();

        migrate_data_dir(&from, &to).expect("迁移应成功");

        // 目标里现在是源数据
        assert_eq!(fs::read(to.join(VAULT_FILE)).unwrap(), b"SOURCE-VAULT");
        // 原有数据必须被另存，而不是消失
        let backups: Vec<_> = fs::read_dir(&to)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().contains(".bak-"))
            .collect();
        assert_eq!(backups.len(), 1, "目标既有文件应被备份为 .bak-*");
        assert_eq!(fs::read(backups[0].path()).unwrap(), b"EXISTING-VAULT");

        let _ = fs::remove_dir_all(&from);
        let _ = fs::remove_dir_all(&to);
    }

    #[test]
    fn migration_keeps_source_directory_intact() {
        let from = temp_dir("mig-keep-from");
        let to = temp_dir("mig-keep-to");
        fs::write(from.join(VAULT_FILE), b"KEEP-ME").unwrap();

        migrate_data_dir(&from, &to).expect("迁移应成功");

        // 源目录不删除：新目录出问题时用户还能找回
        assert_eq!(fs::read(from.join(VAULT_FILE)).unwrap(), b"KEEP-ME");
        assert_eq!(fs::read(to.join(VAULT_FILE)).unwrap(), b"KEEP-ME");

        let _ = fs::remove_dir_all(&from);
        let _ = fs::remove_dir_all(&to);
    }

    // ── 删除账户：历史快照中的密钥必须一并清除 ──

    /// 构造一份含指定账户的加密快照并写入 backups/
    fn write_test_backup(dir: &Path, key: &[u8; 32], ids: &[&str]) {
        let salt = crate::crypto::new_salt();
        let payload = VaultPayload {
            accounts: ids
                .iter()
                .map(|id| crate::models::Account {
                    id: (*id).to_string(),
                    issuer: format!("issuer-{id}"),
                    account: format!("{id}@example.com"),
                    secret: "GEZDGNBVGY3TQOJQ".to_string(),
                    otp_type: "totp".to_string(),
                    algorithm: "SHA1".to_string(),
                    digits: 6,
                    period: 30,
                    counter: 0,
                    category_id: String::new(),
                    category: String::new(),
                    favorite: false,
                    created_at: 0,
                    last_used_at: 0,
                })
                .collect(),
            settings: crate::models::AppSettings::default(),
            categories: Vec::new(),
        };
        let file = crate::crypto::encrypt_payload(
            &payload,
            key,
            &salt,
            false,
            crate::crypto::KdfParams::CURRENT,
        )
        .unwrap();
        write_backup(dir, &file).unwrap();
    }

    #[test]
    fn purging_account_removes_it_from_every_backup() {
        let dir = temp_dir("purge");
        let key = [9u8; 32];
        write_test_backup(&dir, &key, &["keep", "gone"]);
        write_test_backup(&dir, &key, &["gone"]);
        write_test_backup(&dir, &key, &["keep"]);

        let (purged, stale) = purge_account_from_backups(&dir, "gone", &key);
        assert_eq!(stale, 0, "全部快照都可用当前密钥解开");
        assert_eq!(purged, 2, "两份含该账户的快照应被重写");

        // 逐份确认：任何一份里都不再有该账户
        for (name, _) in list_backups(&dir) {
            let text = fs::read_to_string(backup_dir(&dir).join(&name)).unwrap();
            let file: VaultFile = serde_json::from_str(&text).unwrap();
            let payload = crate::crypto::decrypt_payload(&file, &key).unwrap();
            assert!(
                payload.accounts.iter().all(|a| a.id != "gone"),
                "快照 {name} 中仍残留已删除账户的密钥"
            );
            assert!(
                payload.accounts.iter().all(|a| a.id != "keep" || a.secret == "GEZDGNBVGY3TQOJQ"),
                "其他账户不应被破坏"
            );
        }

        let _ = fs::remove_dir_all(&dir);
    }

    /// 用旧密钥加密的快照无法清理，必须如实回报（供 UI 提示用户清理）
    #[test]
    fn purging_reports_undecryptable_backups() {
        let dir = temp_dir("purge-stale");
        let old_key = [1u8; 32];
        let new_key = [2u8; 32];
        write_test_backup(&dir, &old_key, &["gone"]);
        write_test_backup(&dir, &new_key, &["gone"]);

        let (purged, stale) = purge_account_from_backups(&dir, "gone", &new_key);
        assert_eq!(purged, 1);
        assert_eq!(stale, 1, "旧密钥快照应被计为无法清理");
        let _ = fs::remove_dir_all(&dir);
    }
    // ── 数据目录指针：不可用原因必须可被界面区分 ──

    #[test]
    fn pointer_issue_codes_cover_every_failure_mode() {
        let dir = temp_dir("ptr-issue");
        let pointer = dir.join(DATA_DIR_POINTER);

        // 无指针文件 → 不算异常
        assert!(data_dir_pointer_issue(&dir).is_none());

        // 非法 JSON
        fs::write(&pointer, "{ not json").unwrap();
        assert_eq!(
            data_dir_pointer_issue(&dir).map(|i| i.code),
            Some(DataDirIssueCode::InvalidJson)
        );

        // 缺字段
        fs::write(&pointer, r#"{"other":1}"#).unwrap();
        assert_eq!(
            data_dir_pointer_issue(&dir).map(|i| i.code),
            Some(DataDirIssueCode::MissingField)
        );

        // 空路径
        fs::write(&pointer, r#"{"data_dir":"   "}"#).unwrap();
        assert_eq!(
            data_dir_pointer_issue(&dir).map(|i| i.code),
            Some(DataDirIssueCode::EmptyPath)
        );

        // 相对路径
        fs::write(&pointer, r#"{"data_dir":"relative/dir"}"#).unwrap();
        assert_eq!(
            data_dir_pointer_issue(&dir).map(|i| i.code),
            Some(DataDirIssueCode::NotAbsolute)
        );

        // 网络位置
        fs::write(&pointer, r#"{"data_dir":"\\\\server\\share"}"#).unwrap();
        assert_eq!(
            data_dir_pointer_issue(&dir).map(|i| i.code),
            Some(DataDirIssueCode::NetworkPath)
        );

        // 目录不存在
        let missing = dir.join("nope").to_string_lossy().to_string();
        fs::write(&pointer, serde_json::json!({ "data_dir": missing }).to_string()).unwrap();
        let issue = data_dir_pointer_issue(&dir).expect("应报异常");
        assert_eq!(issue.code, DataDirIssueCode::NotFound);
        assert!(issue.path.ends_with("nope"), "应带上问题路径供用户定位");

        // 合法指针 → 无异常
        fs::write(
            &pointer,
            serde_json::json!({ "data_dir": dir.to_string_lossy() }).to_string(),
        )
        .unwrap();
        assert!(data_dir_pointer_issue(&dir).is_none());

        let _ = fs::remove_dir_all(&dir);
    }}
