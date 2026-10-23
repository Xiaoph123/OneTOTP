use crate::models::{VaultFile, VaultPayload};
use aes_gcm::aead::{Aead, KeyInit, OsRng};
use aes_gcm::{AeadCore, Aes256Gcm, Nonce};
use argon2::Argon2;
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use rand::RngCore;

const KEY_LEN: usize = 32;
const SALT_LEN: usize = 16;
const NONCE_LEN: usize = 12;
const VAULT_VERSION: u32 = 1;

/// Argon2id 参数（**随保险库文件一起落盘**）。
///
/// 为什么必须写进文件：派生参数一变，同一口令派生出的密钥就完全不同。
/// 若只把参数固定在代码里，日后调参会让**所有既有保险库永久无法解密**。
/// 记录在文件里之后：读取按文件记录派生，写入用当前常量，二者可独立演进。
///
/// 字段名与 argon2 crate 保持一致，便于对照 RFC 9106 / OWASP 建议。
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct KdfParams {
    /// 内存成本（KiB）
    pub m_cost: u32,
    /// 迭代次数
    pub t_cost: u32,
    /// 并行度
    pub p_cost: u32,
}

impl KdfParams {
    /// 历史默认值：等价于 `Argon2::default()`（argon2 0.5：m=19 MiB, t=2, p=1）。
    ///
    /// 旧版本写出的文件没有 `kdf` 字段，反序列化时回落到这个值，
    /// 因此老保险库仍能正常打开。**不要修改这个常量**，改了旧库就解不开了。
    pub const LEGACY: Self = Self {
        m_cost: 19_456,
        t_cost: 2,
        p_cost: 1,
    };

    /// 当前写入使用：m=64 MiB, t=3, p=1。
    ///
    /// 取值依据：内存成本是抵御 GPU/ASIC 批量破解的主要杠杆，19 MiB 偏低。
    /// 64 MiB 在桌面端约 0.3~0.6 秒、中端手机约 1~2 秒（每次解锁只付一次），
    /// 同时把并行度保持为 1，避免在低核数移动设备上退化。
    /// 若需再次调参：只改这里 + 让用户点一次「重新加密保险库」即可升级。
    pub const CURRENT: Self = Self {
        m_cost: 65_536,
        t_cost: 3,
        p_cost: 1,
    };
}

impl Default for KdfParams {
    /// 缺省即「历史参数」——保证没有 `kdf` 字段的旧文件按旧规则派生。
    fn default() -> Self {
        Self::LEGACY
    }
}

impl std::fmt::Display for KdfParams {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "argon2id m={}KiB t={} p={}", self.m_cost, self.t_cost, self.p_cost)
    }
}

/// 由密码派生 256 位密钥（Argon2id）。参数由调用方给出：
/// - 解密既有保险库：用文件里记录的参数
/// - 加密/重新加密：用 [`KdfParams::CURRENT`]
pub fn derive_key(
    password: &str,
    salt: &[u8],
    params: KdfParams,
) -> Result<[u8; KEY_LEN], String> {
    let argon_params = argon2::Params::new(params.m_cost, params.t_cost, params.p_cost, None)
        .map_err(|e| format!("KDF 参数无效（{params}）: {e}"))?;
    let argon = Argon2::new(argon2::Algorithm::Argon2id, argon2::Version::V0x13, argon_params);
    let mut key = [0u8; KEY_LEN];
    argon
        .hash_password_into(password.as_bytes(), salt, &mut key)
        .map_err(|e| format!("密钥派生失败: {e}"))?;
    Ok(key)
}

pub fn random_bytes(len: usize) -> Vec<u8> {
    let mut buf = vec![0u8; len];
    OsRng.fill_bytes(&mut buf);
    buf
}

pub fn new_salt() -> Vec<u8> {
    random_bytes(SALT_LEN)
}

/// 使用给定密钥加密载荷，返回 VaultFile
pub fn encrypt_payload(
    payload: &VaultPayload,
    key: &[u8; KEY_LEN],
    salt: &[u8],
    uses_machine_key: bool,
    params: KdfParams,
) -> Result<VaultFile, String> {
    encrypt_payload_with_scope(
        payload,
        key,
        salt,
        uses_machine_key,
        crate::models::BackupScope::default(),
        params,
    )
}

/// 使用给定密钥加密载荷，并记录备份范围
pub fn encrypt_payload_with_scope(
    payload: &VaultPayload,
    key: &[u8; KEY_LEN],
    salt: &[u8],
    uses_machine_key: bool,
    scope: crate::models::BackupScope,
    params: KdfParams,
) -> Result<VaultFile, String> {
    let plaintext = serde_json::to_vec(payload).map_err(|e| e.to_string())?;
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| e.to_string())?;
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let ciphertext = cipher
        .encrypt(&nonce, plaintext.as_ref())
        .map_err(|e| format!("加密失败: {e}"))?;
    Ok(VaultFile {
        version: VAULT_VERSION,
        salt: B64.encode(salt),
        nonce: B64.encode(nonce.as_slice()),
        ciphertext: B64.encode(ciphertext),
        uses_machine_key,
        scope,
        // 记录本次派生所用的参数，供日后按同一参数解开
        kdf: params,
    })
}

/// 解密 VaultFile，返回载荷
pub fn decrypt_payload(file: &VaultFile, key: &[u8; KEY_LEN]) -> Result<VaultPayload, String> {
    let nonce_bytes = B64
        .decode(&file.nonce)
        .map_err(|_| "nonce 解码失败".to_string())?;
    if nonce_bytes.len() != NONCE_LEN {
        return Err("nonce 长度异常".to_string());
    }
    let ciphertext = B64
        .decode(&file.ciphertext)
        .map_err(|_| "密文解码失败".to_string())?;
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| e.to_string())?;
    let nonce = Nonce::from_slice(&nonce_bytes);
    let plaintext = cipher
        .decrypt(nonce, ciphertext.as_ref())
        .map_err(|_| "解密失败：密码错误或数据已损坏".to_string())?;
    serde_json::from_slice(&plaintext).map_err(|e| format!("载荷解析失败: {e}"))
}

pub fn decode_salt(file: &VaultFile) -> Result<Vec<u8>, String> {
    B64.decode(&file.salt).map_err(|_| "salt 解码失败".to_string())
}

/// 旧版机器密钥：仅用 OS + ARCH 派生，所有同平台机器相同。
/// **仅用于兼容读取旧保险库**，新数据不再使用。
fn legacy_machine_key() -> [u8; KEY_LEN] {
    let seed = format!(
        "oneTotp-local-vault::{}::{}",
        std::env::consts::OS,
        std::env::consts::ARCH
    );
    let salt = b"onetotp-machine-salt-v1";
    let mut key = [0u8; KEY_LEN];
    let _ = Argon2::default().hash_password_into(seed.as_bytes(), salt, &mut key);
    key
}

/// 口令校验值的派生上下文。
///
/// 旧实现直接把「保险库密钥的 base64」存进 lock 文件当校验值，等于把密钥
/// 明文写在盘上：拿到 onetotp.lock.json 的人无需口令、也无需跑 Argon2，
/// 直接 base64 解码就是 AES-256-GCM 的密钥，可以解开保险库。
/// 现改为对密钥做一次带固定上下文的 HMAC-SHA256：验证方仍需用口令重新
/// 派生密钥才能算出同样的校验值，而校验值本身无法反推出密钥。
const VERIFIER_CONTEXT: &[u8] = b"onetotp.lock.verifier.v1";

/// 由保险库密钥派生口令校验值（单向，不可反推密钥）
pub fn derive_verifier(key: &[u8; KEY_LEN]) -> String {
    use hmac::{Hmac, Mac};
    use sha2::Sha256;

    // Hmac::new_from_slice 接受任意长度密钥，对 32 字节输入不会失败
    let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(key)
        .expect("HMAC 接受任意长度密钥，不应失败");
    mac.update(VERIFIER_CONTEXT);
    B64.encode(mac.finalize().into_bytes())
}

/// 旧格式校验值：直接是保险库密钥的 base64。
/// **仅供兼容读取旧 lock 文件并在解锁成功后迁移**，新数据不再写入。
pub fn legacy_verifier(key: &[u8; KEY_LEN]) -> String {
    B64.encode(key)
}

/// 恒定时间比较，避免按字节提前返回造成的时序泄漏。
pub fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

/// 机器本地密钥文件：把随机生成的 32 字节密钥落盘到应用数据目录。
///
/// 旧实现只按 OS+ARCH 派生，导致同平台所有设备密钥相同——拿到保险库文件即可解密。
/// 现改为首次使用时生成随机密钥并保存，与设备绑定。
/// 返回 `(当前密钥, 是否为旧版派生的密钥)`：旧保险库需用旧密钥才能解开。
pub fn load_or_create_machine_key(app_dir: &std::path::Path) -> Result<[u8; KEY_LEN], String> {
    let path = app_dir.join("onetotp.machine.key");
    if let Ok(raw) = std::fs::read(&path) {
        if raw.len() == KEY_LEN {
            let mut key = [0u8; KEY_LEN];
            key.copy_from_slice(&raw);
            return Ok(key);
        }
    }
    // 首次使用：生成随机密钥并持久化。
    // 必须原子写入（临时文件 + rename）：若写入中途崩溃留下被截断的文件，
    // 下次启动会因长度不符而重新生成密钥，导致既有保险库永久无法解密。
    std::fs::create_dir_all(app_dir).map_err(|e| format!("创建应用目录失败: {e}"))?;
    let mut key = [0u8; KEY_LEN];
    OsRng.fill_bytes(&mut key);
    let tmp = app_dir.join(".onetotp.machine.key.tmp");
    std::fs::write(&tmp, key).map_err(|e| format!("写入机器密钥失败: {e}"))?;
    if path.exists() {
        let _ = std::fs::remove_file(&path);
    }
    std::fs::rename(&tmp, &path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("提交机器密钥失败: {e}")
    })?;
    Ok(key)
}

/// 兼容用：旧版机器密钥（仅供迁移旧数据时尝试解密）
pub fn legacy_machine_key_compat() -> [u8; KEY_LEN] {
    legacy_machine_key()
}

/// 常见弱口令黑名单（全小写比较）。
///
/// 覆盖面刻意保持在「字典攻击列表前几千条」这个层级：目的是挡住
/// `password`、`12345678`、`qwerty` 这类**没有任何额外成本**的猜测，
/// 而不是做完整强度评估（那需要 zxcvbn 级别的语料）。
///
/// 设计取舍（依据 NIST SP 800-63B）：
/// - **不要求大小写/数字/符号组合**：组合规则会把人推向 `Password1!` 这类
///   高度可预测的模式，熵增益很小，还增加记忆负担。
/// - 长度门槛 + 黑名单 + 前端强度提示，是现代建议的做法。
const WEAK_PASSWORDS: &[&str] = &[
    "12345678", "123456789", "1234567890", "87654321", "11111111", "00000000",
    "password", "password1", "password12", "password123", "passw0rd", "p@ssw0rd",
    "qwerty", "qwerty123", "qwertyuiop", "asdfghjkl", "zxcvbnm", "1qaz2wsx",
    "abc12345", "abcd1234", "a1234567", "1a2b3c4d", "iloveyou",
    // 下面这些「核心词」配合 strip_common_suffixes 覆盖 admin2024 / letmein2025! 等变体
    "admin", "letmein", "welcome", "monkey", "dragon", "master", "shadow",
    "sunshine", "princess", "football", "baseball", "superman", "trustno",
    "密码密码密码", "woaini1314", "aa123456", "123qweasd",
];

/// 与产品本身相关的词：即使加了数字后缀、出现在密码中段，也应当拒绝。
/// 攻击者知道你在用什么软件，这类词会最先被尝试。
const PRODUCT_TOKENS: &[&str] = &["onetotp", "one-totp", "totp", "authenticator", "otpauth"];

/// 去掉尾部常见附加物后返回切片，用于识别 `password123`、`qwerty!`、
/// `admin2024`、`letmein2025!` 这类「弱词 + 后缀」写法——
/// 它们在字典攻击里和裸词是同一条目。
fn strip_common_suffixes(value: &str) -> &str {
    let mut end = value.len();
    let bytes = value.as_bytes();
    while end > 0 && bytes[end - 1].is_ascii_digit() {
        end -= 1;
    }
    while end > 0 {
        let c = bytes[end - 1];
        if matches!(c, b'!' | b'@' | b'#' | b'$' | b'.' | b'_' | b'-' | b'*') {
            end -= 1;
        } else {
            break;
        }
    }
    &value[..end]
}

/// 是否为「全同一字符」或「连续递增/递减」序列
fn is_trivial_pattern(value: &str) -> bool {
    let chars: Vec<char> = value.chars().collect();
    if chars.len() < 4 {
        return false;
    }
    if chars.iter().all(|c| *c == chars[0]) {
        return true;
    }
    let is_step = |step: i32| {
        chars
            .windows(2)
            .all(|w| (w[1] as i32) - (w[0] as i32) == step)
    };
    is_step(1) || is_step(-1)
}

/// 密码强度校验。
///
/// 规则只有三条（**不要求字符组合**）：
/// 1. 长度 ≥ 8
/// 2. 不在常见弱口令黑名单里（含「弱词 + 数字/符号后缀」变体与产品相关词）
/// 3. 不是全同字符或连续序列
pub fn validate_password(password: &str) -> Result<(), String> {
    if password.chars().count() < 8 {
        return Err("密码长度至少 8 位".to_string());
    }

    let lower = password.to_lowercase();

    let stripped = strip_common_suffixes(&lower);
    if WEAK_PASSWORDS.contains(&lower.as_str())
        || WEAK_PASSWORDS.contains(&stripped)
        || WEAK_PASSWORDS
            .iter()
            .any(|w| w.chars().count() >= 6 && lower.starts_with(w))
    {
        return Err("这个密码太常见，容易被猜中，请换一个".to_string());
    }

    if PRODUCT_TOKENS.iter().any(|t| lower.contains(t)) {
        return Err("密码里不要包含软件名称或 totp 之类的词".to_string());
    }

    if is_trivial_pattern(password) {
        return Err("不要用全同一字符或连续数字/字母，换个更随机的".to_string());
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{AppSettings, VaultPayload};

    fn payload() -> VaultPayload {
        VaultPayload {
            accounts: Vec::new(),
            settings: AppSettings::default(),
            categories: Vec::new(),
        }
    }

    #[test]
    fn encrypt_decrypt_roundtrip() {
        let salt = new_salt();
        let key = derive_key("correct horse battery", &salt, KdfParams::CURRENT).unwrap();
        let file = encrypt_payload(&payload(), &key, &salt, false, KdfParams::CURRENT).unwrap();

        // 落盘结构不包含明文密钥
        assert_ne!(file.ciphertext, "");
        assert_eq!(file.salt, B64.encode(&salt));
        assert_eq!(file.version, VAULT_VERSION);

        let restored = decrypt_payload(&file, &key).unwrap();
        assert!(restored.accounts.is_empty());
        assert_eq!(restored.settings.auto_lock_seconds, 60);
    }

    #[test]
    fn decrypt_fails_with_wrong_key() {
        let salt = new_salt();
        let key = derive_key("right password", &salt, KdfParams::CURRENT).unwrap();
        let other = derive_key("wrong password", &salt, KdfParams::CURRENT).unwrap();
        let file = encrypt_payload(&payload(), &key, &salt, false, KdfParams::CURRENT).unwrap();
        assert!(decrypt_payload(&file, &other).is_err());
    }

    #[test]
    fn each_encryption_uses_fresh_nonce() {
        let salt = new_salt();
        let key = derive_key("same password", &salt, KdfParams::CURRENT).unwrap();
        let a = encrypt_payload(&payload(), &key, &salt, false, KdfParams::CURRENT).unwrap();
        let b = encrypt_payload(&payload(), &key, &salt, false, KdfParams::CURRENT).unwrap();
        assert_ne!(a.nonce, b.nonce, "每次写入都必须使用新的 nonce");
        assert_ne!(a.ciphertext, b.ciphertext);
    }

    /// 回归测试：校验值不得等于密钥本身。
    /// 旧实现把 base64(key) 直接写进 lock 文件，等于把 AES 密钥明文存盘。
    #[test]
    fn verifier_does_not_reveal_the_key() {
        let salt = new_salt();
        let key = derive_key("hunter2hunter2", &salt, KdfParams::CURRENT).unwrap();
        let verifier = derive_verifier(&key);

        assert_ne!(verifier, legacy_verifier(&key));
        assert_ne!(verifier, B64.encode(key));
        // 也不应能反解出密钥
        assert!(B64.decode(&verifier).map(|v| v != key).unwrap_or(true));
        // 同一密钥必须稳定
        assert_eq!(verifier, derive_verifier(&key));
        // 不同密钥必须不同
        let other = derive_key("hunter2hunter3", &salt, KdfParams::CURRENT).unwrap();
        assert_ne!(verifier, derive_verifier(&other));
    }

    #[test]
    fn constant_time_eq_behaves_like_equality() {
        assert!(constant_time_eq(b"abc", b"abc"));
        assert!(!constant_time_eq(b"abc", b"abd"));
        assert!(!constant_time_eq(b"abc", b"ab"));
        assert!(constant_time_eq(b"", b""));
    }

    #[test]
    fn derive_key_is_deterministic_per_salt() {
        let salt = new_salt();
        let a = derive_key("passphrase", &salt, KdfParams::CURRENT).unwrap();
        let b = derive_key("passphrase", &salt, KdfParams::CURRENT).unwrap();
        assert_eq!(a, b);
        // 换盐必须换出不同密钥，否则盐就失去意义
        let other_salt = new_salt();
        assert_ne!(a, derive_key("passphrase", &other_salt, KdfParams::CURRENT).unwrap());
    }

    #[test]
    fn password_length_is_enforced() {
        assert!(validate_password("1234567").is_err());
        // 按字符数而非字节数计算：4 个汉字也应视为不足 8 位
        assert!(validate_password("密码密码密码").is_err());
        assert!(validate_password("kR7$mQp2").is_ok());
    }

    /// 口令策略：长度 + 黑名单 + 平凡模式，**不要求字符组合**
    #[test]
    fn password_blocklist_rejects_common_choices() {
        // 经典弱口令
        for weak in [
            "password", "PASSWORD", "12345678", "qwertyui", "admin123", "iloveyou",
            "aaaaaaaa", "00000000", "123456789",
        ] {
            assert!(validate_password(weak).is_err(), "应拒绝：{weak}");
        }
        // 弱词 + 数字/符号后缀（字典攻击里与裸词等价）
        for weak in ["password123", "qwerty!", "admin2024", "letmein2025!", "passw0rd1"] {
            assert!(validate_password(weak).is_err(), "应拒绝：{weak}");
        }
        // 产品相关词
        assert!(validate_password("myonetotp123").is_err());
        assert!(validate_password("TOTP-secret-1").is_err());
        // 平凡序列
        assert!(validate_password("abcdefgh").is_err());
        assert!(validate_password("87654321").is_err());
    }

    /// 明确不做组合要求：纯小写、纯中文、带空格的长口令都应通过
    #[test]
    fn password_policy_does_not_require_character_classes() {
        for ok in [
            "correcthorsebatterystaple", // 纯小写长口令
            "kR7$mQp2xL",                // 混合
            "我很喜欢在雨天的图书馆里看书",       // 纯中文
            "two words with spaces",     // 含空格
        ] {
            assert!(validate_password(ok).is_ok(), "应通过：{ok}");
        }
    }

    #[test]
    fn suffix_stripping_matches_expected_core() {
        assert_eq!(strip_common_suffixes("password123"), "password");
        assert_eq!(strip_common_suffixes("qwerty!!"), "qwerty");
        assert_eq!(strip_common_suffixes("admin2024"), "admin");
        // 尾部是字母时不剥离（只在结尾剥离数字与标点）
        assert_eq!(strip_common_suffixes("normal-word"), "normal-word");
        assert_eq!(strip_common_suffixes("normal-word-"), "normal-word");
    }

    #[test]
    fn trivial_pattern_detection() {
        assert!(is_trivial_pattern("aaaaaaaa"));
        assert!(is_trivial_pattern("12345678"));
        assert!(is_trivial_pattern("abcdefgh"));
        assert!(is_trivial_pattern("87654321"));
        assert!(!is_trivial_pattern("a1b2c3d4"));
        assert!(!is_trivial_pattern("abc"));
    }

    /// 机器密钥必须落盘且可重复读取；文件长度不符时要重新生成
    /// （重新生成会让旧保险库无法解密，因此写入必须是原子的）
    #[test]
    fn machine_key_persists_across_reads() {
        let dir = std::env::temp_dir().join(format!("onetotp-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();

        let first = load_or_create_machine_key(&dir).unwrap();
        let second = load_or_create_machine_key(&dir).unwrap();
        assert_eq!(first, second, "同一目录必须读回同一把机器密钥");
        assert!(dir.join("onetotp.machine.key").exists());

        let _ = std::fs::remove_dir_all(&dir);
    }

    // ── KDF 参数落盘：向后兼容是这里的生命线 ──

    /// LEGACY 必须始终等于「当初 argon2 crate 的默认参数」。
    ///
    /// 这条测试的作用是**报警**：如果依赖升级改了默认值，这里会失败，提醒我们
    /// 「默认」已不再等价于历史行为——此时**绝不能**改 `KdfParams::LEGACY`
    /// 去迎合新默认（那会让所有老保险库解不开），而应更新本测试的期望值。
    #[test]
    fn legacy_params_match_argon2_defaults() {
        let d = argon2::Params::default();
        assert_eq!(KdfParams::LEGACY.m_cost, d.m_cost(), "历史内存成本发生变化");
        assert_eq!(KdfParams::LEGACY.t_cost, d.t_cost(), "历史迭代次数发生变化");
        assert_eq!(KdfParams::LEGACY.p_cost, d.p_cost(), "历史并行度发生变化");
    }

    #[test]
    fn kdf_default_is_legacy_for_old_files() {
        assert_eq!(KdfParams::default(), KdfParams::LEGACY);
        let json =
            r#"{"version":1,"salt":"AAAA","nonce":"","ciphertext":"","uses_machine_key":false}"#;
        let file: crate::models::VaultFile = serde_json::from_str(json).unwrap();
        assert_eq!(file.kdf, KdfParams::LEGACY);
    }

    /// 硬性回归：旧版本写出的文件（无 kdf 字段）必须仍能用同一口令打开
    #[test]
    fn legacy_file_without_kdf_field_still_opens() {
        let salt = new_salt();
        let key = derive_key("old password", &salt, KdfParams::LEGACY).unwrap();
        let file = encrypt_payload(&payload(), &key, &salt, false, KdfParams::LEGACY).unwrap();

        // 模拟旧版本产物：删掉 kdf 字段
        let mut json = serde_json::to_value(&file).unwrap();
        json.as_object_mut().unwrap().remove("kdf");
        let old: crate::models::VaultFile = serde_json::from_value(json).unwrap();
        assert_eq!(old.kdf, KdfParams::LEGACY);

        // 按文件记录（回落后的历史参数）重新派生 → 密钥一致 → 能解密
        let reopened = derive_key("old password", &salt, old.kdf).unwrap();
        assert_eq!(reopened, key);
        let restored = decrypt_payload(&old, &reopened).unwrap();
        assert!(restored.accounts.is_empty());
    }

    /// 参数确实参与派生：换了参数就不该能解开（否则「记录参数」毫无意义）
    #[test]
    fn wrong_kdf_params_cannot_decrypt() {
        let salt = new_salt();
        let key = derive_key("same password", &salt, KdfParams::CURRENT).unwrap();
        let file = encrypt_payload(&payload(), &key, &salt, false, KdfParams::CURRENT).unwrap();
        assert_eq!(file.kdf, KdfParams::CURRENT, "写入时必须记录当前参数");

        let legacy_key = derive_key("same password", &salt, KdfParams::LEGACY).unwrap();
        assert_ne!(legacy_key, key);
        assert!(decrypt_payload(&file, &legacy_key).is_err());
    }

    /// 当前参数必须强于历史参数（防止日后误把 CURRENT 调弱）
    #[test]
    fn current_params_are_stronger_than_legacy() {
        let cur = KdfParams::CURRENT;
        let leg = KdfParams::LEGACY;
        let cur_work = u64::from(cur.m_cost) * u64::from(cur.t_cost);
        let leg_work = u64::from(leg.m_cost) * u64::from(leg.t_cost);
        assert!(cur_work > leg_work, "CURRENT({cur}) 不应弱于 LEGACY({leg})");
        assert!(cur.m_cost >= leg.m_cost);
    }
}
