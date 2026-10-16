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

/// 机器本地密钥：纯离线场景下无锁定密码时使用。
/// 由固定的设备指纹派生，不做上传，仅防止明文落盘被直接读取。
pub fn machine_key() -> [u8; KEY_LEN] {
    let seed = format!(
        "oneTotp-local-vault::{}::{}",
        std::env::consts::OS,
        std::env::consts::ARCH
    );
    let salt = b"onetotp-machine-salt-v1";
    let mut key = [0u8; KEY_LEN];
    // 使用 Argon2 做一次确定性派生
    let _ = Argon2::default().hash_password_into(seed.as_bytes(), salt, &mut key);
    key
}

/// 密码强度基础校验
pub fn validate_password(password: &str) -> Result<(), String> {
    if password.chars().count() < 8 {
        return Err("密码长度至少 8 位".to_string());
    }
    Ok(())
}
