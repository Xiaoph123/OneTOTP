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
/// 返回 `(code, remaining_secs, progress_percent, next_code)`。
/// HOTP 无时间维度，remaining / progress 均返回 0，next_code 为空（无"下一个"概念）。
pub fn generate_code(
    account: &Account,
    unix_secs: u64,
) -> Result<(String, u32, u32, Option<String>), String> {
    let otp_type = account.otp_type.trim().to_lowercase();
    if otp_type == "hotp" {
        let code = hotp_code(&account.secret, account.counter, &account.algorithm, account.digits)?;
        return Ok((code, 0, 0, None));
    }

    let period = if account.period == 0 { 30 } else { account.period };
    let digits = normalize_digits(account.digits)?;
    let key = decode_secret(&account.secret)?;

    let counter = unix_secs / period as u64;
    let digest = hmac_digest(&account.algorithm, &key, &counter.to_be_bytes())?;
    let code = truncate(&digest, digits)?;

    // 下一个周期的验证码（用于卡片预览即将到来的验证码）
    let next_code = hmac_digest(&account.algorithm, &key, &(counter + 1).to_be_bytes())
        .ok()
        .and_then(|d| truncate(&d, digits).ok());

    let elapsed = (unix_secs % period as u64) as u32;
    let remaining = period - elapsed;
    let progress = ((period - remaining) * 100) / period;

    Ok((code, remaining, progress, next_code))
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

#[cfg(test)]
mod tests {
    use super::*;

    /// RFC 4226 / RFC 6238 使用的种子密钥：ASCII "12345678901234567890"
    const RFC_SECRET: &str = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

    fn account(otp_type: &str, algorithm: &str, digits: u32, period: u32) -> Account {
        Account {
            id: "test".to_string(),
            issuer: "Test".to_string(),
            account: "test".to_string(),
            secret: RFC_SECRET.to_string(),
            otp_type: otp_type.to_string(),
            algorithm: algorithm.to_string(),
            digits,
            period,
            counter: 0,
            category_id: String::new(),
            category: String::new(),
            favorite: false,
            created_at: 0,
            last_used_at: 0,
        }
    }

    /// RFC 4226 附录 D 的 HOTP 测试向量（6 位，SHA1）
    #[test]
    fn hotp_matches_rfc4226_vectors() {
        let expected = [
            "755224", "287082", "359152", "969429", "338314", "254676", "287922", "162583",
            "399871", "520489",
        ];
        for (counter, want) in expected.iter().enumerate() {
            let got = hotp_code(RFC_SECRET, counter as u64, "SHA1", 6).unwrap();
            assert_eq!(&got, want, "counter={counter}");
        }
    }

    /// RFC 6238 附录 B 的 TOTP 测试向量（8 位，SHA1，周期 30）
    #[test]
    fn totp_matches_rfc6238_vectors() {
        let vectors: [(u64, &str); 6] = [
            (59, "94287082"),
            (1_111_111_109, "07081804"),
            (1_111_111_111, "14050471"),
            (1_234_567_890, "89005924"),
            (2_000_000_000, "69279037"),
            (20_000_000_000, "65353130"),
        ];
        let acc = account("totp", "SHA1", 8, 30);
        for (time, want) in vectors {
            let (code, remaining, _, next) = generate_code(&acc, time).unwrap();
            assert_eq!(code, want, "unix={time}");
            // 同一时刻再算一次必须稳定（不得依赖调用时机）
            assert_eq!(generate_code(&acc, time).unwrap().0, want);
            assert!(remaining >= 1 && remaining <= 30, "remaining={remaining}");
            assert!(next.is_some(), "TOTP 应提供下一个验证码");
        }
    }

    /// SHA256 / SHA512 与 7 位等组合能正常出码，且长度符合 digits
    #[test]
    fn other_algorithms_and_digits_produce_valid_codes() {
        for alg in ["SHA1", "SHA256", "SHA512", "sha-256"] {
            for digits in [6u32, 7, 8] {
                let acc = account("totp", alg, digits, 30);
                let code = generate_code(&acc, 1_700_000_000).unwrap().0;
                assert_eq!(code.len(), digits as usize, "alg={alg} digits={digits}");
                assert!(code.chars().all(|c| c.is_ascii_digit()));
            }
        }
    }

    /// HOTP 没有时间维度：remaining/progress 必须为 0，且不提供 next_code，
    /// 同时计数器变化必须改变结果（否则「每用一次前进一位」就失去意义）
    #[test]
    fn hotp_has_no_time_semantics_and_advances_with_counter() {
        let mut acc = account("hotp", "SHA1", 6, 30);
        let (first, remaining, progress, next) = generate_code(&acc, 1_700_000_000).unwrap();
        assert_eq!((remaining, progress), (0, 0));
        assert!(next.is_none());
        acc.counter = 1;
        let second = generate_code(&acc, 1_700_000_000).unwrap().0;
        assert_ne!(first, second);
        assert_eq!(second, hotp_code(RFC_SECRET, 1, "SHA1", 6).unwrap());
    }

    #[test]
    fn normalize_secret_strips_noise_and_uppercases() {
        assert_eq!(normalize_secret(" gezd gnbv-gy3t=qojq "), "GEZDGNBVGY3TQOJQ");
        assert!(validate_secret("gezdgnbvgy3tqojq").is_ok());
        assert!(validate_secret("").is_err());
        // '1' 不是 RFC 4648 字母表内字符
        assert!(validate_secret("GEZDGNBVGY3TQOJ1").is_err());
    }

    #[test]
    fn normalize_algorithm_accepts_aliases() {
        assert_eq!(normalize_algorithm("sha-256"), "SHA256");
        assert_eq!(normalize_algorithm(" SHA_512 "), "SHA512");
        assert_eq!(normalize_algorithm("sha1"), "SHA1");
        assert_eq!(normalize_algorithm(""), "SHA1");
        assert_eq!(normalize_algorithm("md5"), "MD5");
    }

    #[test]
    fn normalize_digits_rejects_unsupported_widths() {
        for ok in [6u32, 7, 8] {
            assert_eq!(normalize_digits(ok).unwrap(), ok);
        }
        for bad in [0u32, 5, 9, 10] {
            assert!(normalize_digits(bad).is_err(), "digits={bad}");
        }
    }

    #[test]
    fn validate_account_input_enforces_ranges() {
        assert!(validate_account_input("totp", "SHA1", 6, 30).is_ok());
        assert!(validate_account_input("TOTP", "sha-256", 8, 1).is_ok());
        // HOTP 忽略周期
        assert!(validate_account_input("hotp", "SHA1", 6, 0).is_ok());
        // TOTP 周期越界
        assert!(validate_account_input("totp", "SHA1", 6, 0).is_err());
        assert!(validate_account_input("totp", "SHA1", 6, 3601).is_err());
        // 类型/算法/位数非法
        assert!(validate_account_input("sms", "SHA1", 6, 30).is_err());
        assert!(validate_account_input("totp", "MD5", 6, 30).is_err());
        assert!(validate_account_input("totp", "SHA1", 5, 30).is_err());
    }

    /// 8 位码按 4+4 分组展示由前端负责，这里确认后端不做任何填充/截断
    #[test]
    fn truncate_keeps_leading_zeros() {
        let digest = [0u8; 20];
        // 摘要全零 → 二进制值 0 → 必须补足前导零
        assert_eq!(truncate(&digest, 8).unwrap(), "00000000");
        assert_eq!(truncate(&digest, 6).unwrap(), "000000");
        assert!(truncate(&[], 6).is_err());
    }
}
