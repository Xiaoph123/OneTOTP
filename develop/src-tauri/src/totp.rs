use crate::models::Account;
use base32::Alphabet;
use hmac::{Hmac, Mac};
use sha1::Sha1;
use sha2::{Sha256, Sha512};
use std::time::{SystemTime, UNIX_EPOCH};

type HmacSha1 = Hmac<Sha1>;
type HmacSha256 = Hmac<Sha256>;
type HmacSha512 = Hmac<Sha512>;

pub fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// 规范化 Base32 密钥：
/// - 去除空白、连字符、等号 padding
/// - 兼容大小写（统一大写）
/// - 兼容 RFC 4648 字母表外的常见误写（0→O、1→I、8→B 不做替换，仅保留标准字符）
pub fn normalize_secret(secret: &str) -> String {
    secret
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '-' && *c != '=')
        .collect::<String>()
        .to_uppercase()
}

/// 无 padding 的 Base32 解码，兼容大写 / 小写
fn decode_secret(secret: &str) -> Result<Vec<u8>, String> {
    let normalized = normalize_secret(secret);
    if normalized.is_empty() {
        return Err("密钥不能为空".to_string());
    }
    base32::decode(Alphabet::Rfc4648 { padding: false }, &normalized)
        .or_else(|| {
            // 少数实现带 padding，去掉后再试一次
            base32::decode(Alphabet::Rfc4648 { padding: true }, &normalized)
        })
        .ok_or_else(|| "密钥不是合法的 Base32 字符串".to_string())
}

/// 规范化算法名，默认 SHA1（兼容小写输入与常见别名）
pub fn normalize_algorithm(algorithm: &str) -> String {
    let upper = algorithm.trim().to_uppercase();
    match upper.as_str() {
        "" => "SHA1".to_string(),
        // SHA1 常见写法
        "SHA1" | "SHA-1" | "SHA_1" => "SHA1".to_string(),
        "SHA256" | "SHA-256" | "SHA_256" => "SHA256".to_string(),
        "SHA512" | "SHA-512" | "SHA_512" => "SHA512".to_string(),
        other => other.to_string(),
    }
}

/// HMAC 摘要计算（按算法选择）
fn hmac_digest(algorithm: &str, key: &[u8], message: &[u8]) -> Result<Vec<u8>, String> {
    match normalize_algorithm(algorithm).as_str() {
        "SHA1" => {
            let mut mac = HmacSha1::new_from_slice(key).map_err(|e| e.to_string())?;
            mac.update(message);
            Ok(mac.finalize().into_bytes().to_vec())
        }
        "SHA256" => {
            let mut mac = HmacSha256::new_from_slice(key).map_err(|e| e.to_string())?;
            mac.update(message);
            Ok(mac.finalize().into_bytes().to_vec())
        }
        "SHA512" => {
            let mut mac = HmacSha512::new_from_slice(key).map_err(|e| e.to_string())?;
            mac.update(message);
            Ok(mac.finalize().into_bytes().to_vec())
        }
        other => Err(format!("不支持的算法: {other}")),
    }
}

/// RFC 4226 动态截断：从 HMAC 摘要截取指定位数的十进制验证码
fn truncate(digest: &[u8], digits: u32) -> Result<String, String> {
    if digest.is_empty() {
        return Err("摘要为空".to_string());
    }
    let offset = (digest[digest.len() - 1] & 0x0f) as usize;
    if offset + 4 > digest.len() {
        return Err("摘要长度异常".to_string());
    }
    let binary = ((digest[offset] as u32 & 0x7f) << 24)
        | ((digest[offset + 1] as u32) << 16)
        | ((digest[offset + 2] as u32) << 8)
        | (digest[offset + 3] as u32);

    let modulo = 10u32.pow(digits);
    Ok(format!("{:0width$}", binary % modulo, width = digits as usize))
}

/// 校验位数，仅允许 6~8
pub fn normalize_digits(digits: u32) -> Result<u32, String> {
    match digits {
        6 | 7 | 8 => Ok(digits),
        _ => Err("验证码位数必须为 6、7 或 8".to_string()),
    }
}

/// HOTP：基于计数器的验证码（RFC 4226）
pub fn hotp_code(secret: &str, counter: u64, algorithm: &str, digits: u32) -> Result<String, String> {
    let digits = normalize_digits(digits)?;
    let key = decode_secret(secret)?;
    let digest = hmac_digest(algorithm, &key, &counter.to_be_bytes())?;
    truncate(&digest, digits)
}

/// 计算当前验证码。
/// 返回 `(code, remaining_secs, progress_percent)`。
/// HOTP 无时间维度，remaining / progress 均返回 0。
pub fn generate_code(
    account: &Account,
    unix_secs: u64,
) -> Result<(String, u32, u32), String> {
    let otp_type = account.otp_type.trim().to_lowercase();
    if otp_type == "hotp" {
        let code = hotp_code(&account.secret, account.counter, &account.algorithm, account.digits)?;
        return Ok((code, 0, 0));
    }

    let period = if account.period == 0 { 30 } else { account.period };
    let digits = normalize_digits(account.digits)?;
    let key = decode_secret(&account.secret)?;

    let counter = unix_secs / period as u64;
    let digest = hmac_digest(&account.algorithm, &key, &counter.to_be_bytes())?;
    let code = truncate(&digest, digits)?;

    let elapsed = (unix_secs % period as u64) as u32;
    let remaining = period - elapsed;
    let progress = ((period - remaining) * 100) / period;

    Ok((code, remaining, progress))
}

/// 校验前端提交的密钥是否可解析
pub fn validate_secret(secret: &str) -> Result<(), String> {
    decode_secret(secret)?;
    Ok(())
}

/// 校验账户配置是否合法（用于新增/更新前的前置校验）
pub fn validate_account_input(
    otp_type: &str,
    algorithm: &str,
    digits: u32,
    period: u32,
) -> Result<(), String> {
    let t = otp_type.trim().to_lowercase();
    if t != "totp" && t != "hotp" {
        return Err("OTP 类型必须为 totp 或 hotp".to_string());
    }
    normalize_digits(digits)?;
    match normalize_algorithm(algorithm).as_str() {
        "SHA1" | "SHA256" | "SHA512" => {}
        other => return Err(format!("不支持的算法: {other}")),
    }
    if t == "totp" && (period == 0 || period > 3600) {
        return Err("周期必须在 1~3600 秒之间".to_string());
    }
    Ok(())
}
