use crate::crypto;
use crate::models::{Account, AppSettings, VaultFile, VaultPayload};
use std::fs;
use std::path::{Path, PathBuf};

pub const VAULT_FILE: &str = "onetotp.vault.json";
pub const LOCK_FILE: &str = "onetotp.lock.json";
pub const BACKUP_DIR: &str = "backups";

/// 锁定凭证文件（保存密码校验哈希与盐，独立于保险库密钥）
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct LockRecord {
    pub salt: String,
    pub verifier: String,
    pub hint: String,
}

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
    fs::write(lock_path(app_dir), data).map_err(|e| format!("写入锁定凭证失败: {e}"))
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

pub fn write_vault(app_dir: &Path, file: &VaultFile) -> Result<(), String> {
    let data = serde_json::to_string_pretty(file).map_err(|e| e.to_string())?;
    fs::write(vault_path(app_dir), data).map_err(|e| format!("写入保险库失败: {e}"))
}

/// 写出加密快照，返回备份文件名
pub fn write_backup(app_dir: &Path, file: &VaultFile) -> Result<String, String> {
    let dir = backup_dir(app_dir);
    fs::create_dir_all(&dir).map_err(|e| format!("创建备份目录失败: {e}"))?;
    let name = format!("vault-backup-{}.json", crate::totp::now_millis());
    let data = serde_json::to_string_pretty(file).map_err(|e| e.to_string())?;
    fs::write(dir.join(&name), data).map_err(|e| format!("写入备份失败: {e}"))?;
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

pub fn list_backups(app_dir: &Path) -> Vec<(String, u64)> {
    let dir = backup_dir(app_dir);
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

/// 递归统计单个路径的占用字节数
fn dir_size(path: &Path) -> u64 {
    let Ok(meta) = fs::metadata(path) else {
        return 0;
    };
    if meta.is_file() {
        return meta.len();
    }
    let Ok(entries) = fs::read_dir(path) else {
        return 0;
    };
    entries
        .filter_map(|e| e.ok())
        .map(|e| dir_size(&e.path()))
        .sum()
}

/// 统计应用本地数据占用：总量、备份、保险库
pub fn storage_usage(app_dir: &Path) -> StorageUsage {
    let backup_bytes = dir_size(&backup_dir(app_dir));
    let vault_bytes = fs::metadata(vault_path(app_dir)).map(|m| m.len()).unwrap_or(0);
    let total_bytes = dir_size(app_dir);
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
    let file = crypto::encrypt_payload(&payload, key, salt, uses_machine_key)?;
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
