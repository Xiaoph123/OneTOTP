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

/// 由密码派生 256 位密钥（Argon2id）
pub fn derive_key(password: &str, salt: &[u8]) -> Result<[u8; KEY_LEN], String> {
    let mut key = [0u8; KEY_LEN];
    Argon2::default()
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
) -> Result<VaultFile, String> {
    encrypt_payload_with_scope(
        payload,
        key,
        salt,
        uses_machine_key,
        crate::models::BackupScope::default(),
    )
}

/// 使用给定密钥加密载荷，并记录备份范围
pub fn encrypt_payload_with_scope(
    payload: &VaultPayload,
    key: &[u8; KEY_LEN],
    salt: &[u8],
    uses_machine_key: bool,
    scope: crate::models::BackupScope,
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

/// 密码强度基础校验
pub fn validate_password(password: &str) -> Result<(), String> {
    if password.chars().count() < 8 {
        return Err("密码长度至少 8 位".to_string());
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
        let key = derive_key("correct horse battery", &salt).unwrap();
        let file = encrypt_payload(&payload(), &key, &salt, false).unwrap();

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
        let key = derive_key("right password", &salt).unwrap();
        let other = derive_key("wrong password", &salt).unwrap();
        let file = encrypt_payload(&payload(), &key, &salt, false).unwrap();
        assert!(decrypt_payload(&file, &other).is_err());
    }

    #[test]
    fn each_encryption_uses_fresh_nonce() {
        let salt = new_salt();
        let key = derive_key("same password", &salt).unwrap();
        let a = encrypt_payload(&payload(), &key, &salt, false).unwrap();
        let b = encrypt_payload(&payload(), &key, &salt, false).unwrap();
        assert_ne!(a.nonce, b.nonce, "每次写入都必须使用新的 nonce");
        assert_ne!(a.ciphertext, b.ciphertext);
    }

    /// 回归测试：校验值不得等于密钥本身。
    /// 旧实现把 base64(key) 直接写进 lock 文件，等于把 AES 密钥明文存盘。
    #[test]
    fn verifier_does_not_reveal_the_key() {
        let salt = new_salt();
        let key = derive_key("hunter2hunter2", &salt).unwrap();
        let verifier = derive_verifier(&key);

        assert_ne!(verifier, legacy_verifier(&key));
        assert_ne!(verifier, B64.encode(key));
        // 也不应能反解出密钥
        assert!(B64.decode(&verifier).map(|v| v != key).unwrap_or(true));
        // 同一密钥必须稳定
        assert_eq!(verifier, derive_verifier(&key));
        // 不同密钥必须不同
        let other = derive_key("hunter2hunter3", &salt).unwrap();
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
        let a = derive_key("passphrase", &salt).unwrap();
        let b = derive_key("passphrase", &salt).unwrap();
        assert_eq!(a, b);
        // 换盐必须换出不同密钥，否则盐就失去意义
        let other_salt = new_salt();
        assert_ne!(a, derive_key("passphrase", &other_salt).unwrap());
    }

    #[test]
    fn password_length_is_enforced() {
        assert!(validate_password("1234567").is_err());
        assert!(validate_password("12345678").is_ok());
        // 按字符数而非字节数计算：4 个汉字也应视为不足 8 位
        assert!(validate_password("密码密码密码").is_err());
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
}
