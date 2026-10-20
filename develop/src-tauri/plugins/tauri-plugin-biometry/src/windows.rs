use serde::de::DeserializeOwned;
use tauri::{plugin::PluginApi, AppHandle, Runtime};

use crate::error::{ErrorResponse, PluginInvokeError};
use crate::models::*;

use windows::{
    core::*,
    Security::Credentials::UI::{
        UserConsentVerificationResult, UserConsentVerifier, UserConsentVerifierAvailability,
    },
    Security::Credentials::{
        KeyCredential, KeyCredentialCreationOption, KeyCredentialManager,
        KeyCredentialRetrievalResult, KeyCredentialStatus, PasswordCredential, PasswordVault,
    },
    Security::Cryptography::Core::{
        CryptographicEngine, CryptographicPublicKeyBlobType, HashAlgorithmNames,
        HashAlgorithmProvider, SymmetricAlgorithmNames, SymmetricKeyAlgorithmProvider,
    },
    Security::Cryptography::{BinaryStringEncoding, CryptographicBuffer},
    Storage::Streams::IBuffer,
    Win32::UI::WindowsAndMessaging::{
        BringWindowToTop, FindWindowW, IsIconic, SetForegroundWindow, ShowWindow, SW_RESTORE,
    },
};

pub fn init<R: Runtime, C: DeserializeOwned>(
    app: &AppHandle<R>,
    _api: PluginApi<R, C>,
) -> crate::Result<Biometry<R>> {
    Ok(Biometry(app.clone()))
}

#[inline]
fn to_wide(s: &str) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    std::ffi::OsStr::new(s)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

/// Try to find and foreground the Windows Hello credential dialog.
fn try_focus_hello_dialog_once() -> bool {
    // Common class name for the PIN/Hello dialog host
    let cls = to_wide("Credential Dialog Xaml Host");
    unsafe {
        let hwnd = FindWindowW(
            windows::core::PCWSTR(cls.as_ptr()),
            windows::core::PCWSTR::null(),
        );
        if let Ok(hwnd) = hwnd {
            if IsIconic(hwnd).as_bool() {
                let _ = ShowWindow(hwnd, SW_RESTORE);
            }
            let _ = BringWindowToTop(hwnd);
            let _ = SetForegroundWindow(hwnd);
            return true;
        }
    }
    false
}

/// Focus the Hello dialog by retrying a few times in a helper thread.
fn nudge_hello_dialog_focus_async(retries: u32, delay_ms: u64) {
    std::thread::spawn(move || {
        // 首次尽快尝试，缩短 Hello 弹窗获得焦点的延迟；
        // 后续按 delay_ms 重试，覆盖弹窗尚未创建完成的场景。
        for i in 0..retries {
            if try_focus_hello_dialog_once() {
                break;
            }
            // 首次重试间隔更短，让弹窗一出现就被拉到前台
            let wait = if i == 0 { delay_ms / 2 } else { delay_ms };
            std::thread::sleep(std::time::Duration::from_millis(wait));
        }
    });
}

/// Create or open a Windows Hello credential
fn get_credential(domain: &str, create_if_missing: bool) -> Result<KeyCredentialRetrievalResult> {
    let credential_name = HSTRING::from(domain);

    // Focus the Hello dialog
    nudge_hello_dialog_focus_async(5, 250);

    if create_if_missing {
        KeyCredentialManager::RequestCreateAsync(
            &credential_name,
            KeyCredentialCreationOption::ReplaceExisting,
        )?
        .get()
    } else {
        KeyCredentialManager::OpenAsync(&credential_name)?.get()
    }
}

/// 用凭证的**公钥**派生确定性的 AES 密钥材料（SHA-256 哈希）。
///
/// 关键：不能用 `RequestSignAsync` 的签名结果派生密钥。Windows Hello 凭证是
/// RSA-2048，签名算法为 PKCS#1 RSA-PSS(SHA256)，而 PSS 是**随机化签名**——
/// 同一消息每次签名都不同，会导致「写入」与「读取」派生出不同密钥、解密必然失败
/// （表现为「生物识别不可用，请使用密码解锁」）。公钥对同一凭证恒定不变，
/// 是可靠的确定性派生来源。
fn derive_key_hash(credential: &KeyCredential) -> Result<IBuffer> {
    let public_key = credential
        .RetrievePublicKeyWithBlobType(CryptographicPublicKeyBlobType::X509SubjectPublicKeyInfo)?;
    let hash_provider = HashAlgorithmProvider::OpenAlgorithm(&HashAlgorithmNames::Sha256()?)?;
    hash_provider.HashData(&public_key)
}

/// 构造一个带明确错误码的插件错误（供前端按 code 区分取消/锁定/失败）
fn auth_error(code: &str, message: &str) -> crate::Error {
    crate::Error::PluginInvoke(PluginInvokeError::InvokeRejected(ErrorResponse {
        code: Some(code.to_string()),
        message: Some(message.to_string()),
        data: (),
    }))
}

/// 触发一次 Windows Hello 用户验证（PIN / 指纹 / 面容）。
///
/// 必须区分「用户主动取消」与「真正的认证失败/凭据失效」：
/// 前者应静默返回（用户只是不想用，不应清除凭据或禁用入口），
/// 后者才需要前端提示。此前把所有非成功状态一律当作失败，
/// 导致用户在弹窗点「取消」就被判定为凭据不可用、按钮被永久禁用。
fn verify_user(domain: &str, credential: &KeyCredential) -> crate::Result<()> {
    let challenge_buffer = CryptographicBuffer::ConvertStringToBinary(
        &HSTRING::from(domain),
        BinaryStringEncoding::Utf8,
    )
    .map_err(|e| auth_error("internalError", &format!("challenge failed: {e:?}")))?;
    let signature = credential
        .RequestSignAsync(&challenge_buffer)
        .and_then(|op| op.get())
        // get() 失败通常也源于用户取消/超时/窗口关闭；归为 userCancel，
        // 让前端静默处理（不误清除凭据）。真正的凭据失效会在上方
        // OpenAsync/Credential() 阶段以 credentialNotFound 暴露。
        .map_err(|e| auth_error("userCancel", &format!("sign request aborted: {e:?}")))?;
    let status = signature
        .Status()
        .map_err(|e| auth_error("authenticationFailed", &format!("status failed: {e:?}")))?;
    match status {
        KeyCredentialStatus::Success => Ok(()),
        // 用户点了取消 / 关闭了认证弹窗，或选择了改用密码
        KeyCredentialStatus::UserCanceled | KeyCredentialStatus::UserPrefersPassword => {
            Err(auth_error("userCancel", "Authentication was canceled by the user"))
        }
        // 连续失败被系统锁定（非永久，稍后可重试）
        KeyCredentialStatus::SecurityDeviceLocked => {
            Err(auth_error("biometryLockout", "Too many failed attempts"))
        }
        KeyCredentialStatus::NotFound => {
            Err(auth_error("credentialNotFound", "Credential not found"))
        }
        _ => Err(auth_error("authenticationFailed", "Authentication failed")),
    }
}

/// Encrypt data using Windows Hello credential。
/// 注：调用方需先完成用户验证（verify_user），此函数只做加密。
fn encrypt_data(
    domain: &str,
    data: &[u8],
    credential_result: &KeyCredentialRetrievalResult,
) -> Result<String> {
    let status = credential_result.Status()?;
    if status != KeyCredentialStatus::Success {
        return Err(Error::from(HRESULT(-1)));
    }

    let credential = credential_result.Credential()?;

    // 用凭证公钥派生确定性密钥（见 derive_key_hash 注释）
    let key_hash = derive_key_hash(&credential)?;

    // Create AES encryption provider
    let aes_provider =
        SymmetricKeyAlgorithmProvider::OpenAlgorithm(&SymmetricAlgorithmNames::AesCbcPkcs7()?)?;

    // Generate IV from domain hash
    let hash_provider = HashAlgorithmProvider::OpenAlgorithm(&HashAlgorithmNames::Sha256()?)?;
    let iv_data = CryptographicBuffer::ConvertStringToBinary(
        &HSTRING::from(format!("IV_{}", domain)),
        BinaryStringEncoding::Utf8,
    )?;
    let iv_hash = hash_provider.HashData(&iv_data)?;

    // Take first 16 bytes of IV hash for AES-128
    let mut iv_bytes: windows::core::Array<u8> = windows::core::Array::new();
    CryptographicBuffer::CopyToByteArray(&iv_hash, &mut iv_bytes)?;
    let iv_slice: Vec<u8> = iv_bytes.as_slice()[..16].to_vec();
    let iv = CryptographicBuffer::CreateFromByteArray(&iv_slice)?;

    // Create symmetric key
    let key = aes_provider.CreateSymmetricKey(&key_hash)?;

    // Encrypt the data
    let data_buffer = CryptographicBuffer::CreateFromByteArray(data)?;
    let encrypted_buffer = CryptographicEngine::Encrypt(&key, &data_buffer, Some(&iv))?;

    // Convert to base64 string
    Ok(CryptographicBuffer::EncodeToBase64String(&encrypted_buffer)?.to_string())
}

/// Decrypt data using Windows Hello credential。
/// 注：调用方需先完成用户验证（verify_user），此函数只做解密。
fn decrypt_data(
    domain: &str,
    encrypted_data: &str,
    credential_result: &KeyCredentialRetrievalResult,
) -> Result<Vec<u8>> {
    let status = credential_result.Status()?;
    if status != KeyCredentialStatus::Success {
        return Err(Error::from(HRESULT(-1)));
    }

    let credential = credential_result.Credential()?;

    // 用凭证公钥派生确定性密钥（与写入时一致）
    let key_hash = derive_key_hash(&credential)?;

    // Create AES decryption provider
    let aes_provider =
        SymmetricKeyAlgorithmProvider::OpenAlgorithm(&SymmetricAlgorithmNames::AesCbcPkcs7()?)?;

    // Generate IV from domain hash (same as encryption)
    let hash_provider = HashAlgorithmProvider::OpenAlgorithm(&HashAlgorithmNames::Sha256()?)?;
    let iv_data = CryptographicBuffer::ConvertStringToBinary(
        &HSTRING::from(format!("IV_{}", domain)),
        BinaryStringEncoding::Utf8,
    )?;
    let iv_hash = hash_provider.HashData(&iv_data)?;

    // Take first 16 bytes of IV hash for AES-128
    let mut iv_bytes: windows::core::Array<u8> = windows::core::Array::new();
    CryptographicBuffer::CopyToByteArray(&iv_hash, &mut iv_bytes)?;
    let iv_slice: Vec<u8> = iv_bytes.as_slice()[..16].to_vec();
    let iv = CryptographicBuffer::CreateFromByteArray(&iv_slice)?;

    // Create symmetric key
    let key = aes_provider.CreateSymmetricKey(&key_hash)?;

    // Decode from base64 and decrypt
    let encrypted_buffer =
        CryptographicBuffer::DecodeFromBase64String(&HSTRING::from(encrypted_data))?;
    let decrypted_buffer = CryptographicEngine::Decrypt(&key, &encrypted_buffer, Some(&iv))?;

    // Convert to bytes
    let mut decrypted_bytes: windows::core::Array<u8> = windows::core::Array::new();
    CryptographicBuffer::CopyToByteArray(&decrypted_buffer, &mut decrypted_bytes)?;

    Ok(decrypted_bytes.to_vec())
}

/// Access to the biometry APIs.
pub struct Biometry<R: Runtime>(AppHandle<R>);

impl<R: Runtime> Biometry<R> {
    pub fn status(&self) -> crate::Result<Status> {
        let availability = UserConsentVerifier::CheckAvailabilityAsync()
            .and_then(|async_op| async_op.get())
            .map_err(|e| {
                crate::Error::PluginInvoke(PluginInvokeError::InvokeRejected(ErrorResponse {
                    code: Some("internalError".to_string()),
                    message: Some(format!("Failed to check biometry availability: {:?}", e)),
                    data: (),
                }))
            })?;

        let (is_available, biometry_type, error, error_code) = match availability {
            UserConsentVerifierAvailability::Available => (true, BiometryType::Auto, None, None),
            UserConsentVerifierAvailability::DeviceNotPresent => (
                false,
                BiometryType::None,
                Some("No biometric device found".to_string()),
                Some("biometryNotAvailable".to_string()),
            ),
            UserConsentVerifierAvailability::NotConfiguredForUser => (
                false,
                BiometryType::None,
                Some("Biometric authentication not configured".to_string()),
                Some("biometryNotEnrolled".to_string()),
            ),
            UserConsentVerifierAvailability::DisabledByPolicy => (
                false,
                BiometryType::None,
                Some("Biometric authentication disabled by policy".to_string()),
                Some("biometryNotAvailable".to_string()),
            ),
            UserConsentVerifierAvailability::DeviceBusy => (
                false,
                BiometryType::None,
                Some("Biometric device is busy".to_string()),
                Some("systemCancel".to_string()),
            ),
            _ => (
                false,
                BiometryType::None,
                Some("Unknown availability status".to_string()),
                Some("biometryNotAvailable".to_string()),
            ),
        };

        Ok(Status {
            is_available,
            biometry_type,
            error,
            error_code,
        })
    }

    pub fn authenticate(&self, reason: String, _options: AuthOptions) -> crate::Result<()> {
        let result = UserConsentVerifier::RequestVerificationAsync(&HSTRING::from(reason))
            .and_then(|async_op| {
                nudge_hello_dialog_focus_async(5, 250);
                async_op.get()
            })
            .map_err(|e| {
                crate::Error::PluginInvoke(PluginInvokeError::InvokeRejected(ErrorResponse {
                    code: Some("internalError".to_string()),
                    message: Some(format!("Failed to request user verification: {:?}", e)),
                    data: (),
                }))
            })?;

        match result {
            UserConsentVerificationResult::Verified => Ok(()),
            UserConsentVerificationResult::DeviceBusy => Err(crate::Error::PluginInvoke(
                PluginInvokeError::InvokeRejected(ErrorResponse {
                    code: Some("systemCancel".to_string()),
                    message: Some("Device is busy".to_string()),
                    data: (),
                }),
            )),
            UserConsentVerificationResult::DeviceNotPresent => Err(crate::Error::PluginInvoke(
                PluginInvokeError::InvokeRejected(ErrorResponse {
                    code: Some("biometryNotAvailable".to_string()),
                    message: Some("No biometric device found".to_string()),
                    data: (),
                }),
            )),
            UserConsentVerificationResult::DisabledByPolicy => Err(crate::Error::PluginInvoke(
                PluginInvokeError::InvokeRejected(ErrorResponse {
                    code: Some("biometryNotAvailable".to_string()),
                    message: Some("Biometric authentication is disabled by policy".to_string()),
                    data: (),
                }),
            )),
            UserConsentVerificationResult::NotConfiguredForUser => Err(crate::Error::PluginInvoke(
                PluginInvokeError::InvokeRejected(ErrorResponse {
                    code: Some("biometryNotEnrolled".to_string()),
                    message: Some(
                        "Biometric authentication is not configured for the user".to_string(),
                    ),
                    data: (),
                }),
            )),
            UserConsentVerificationResult::Canceled => Err(crate::Error::PluginInvoke(
                PluginInvokeError::InvokeRejected(ErrorResponse {
                    code: Some("userCancel".to_string()),
                    message: Some("Authentication was canceled by the user".to_string()),
                    data: (),
                }),
            )),
            UserConsentVerificationResult::RetriesExhausted => Err(crate::Error::PluginInvoke(
                PluginInvokeError::InvokeRejected(ErrorResponse {
                    code: Some("biometryLockout".to_string()),
                    message: Some("Too many failed authentication attempts".to_string()),
                    data: (),
                }),
            )),
            _ => Err(crate::Error::PluginInvoke(
                PluginInvokeError::InvokeRejected(ErrorResponse {
                    code: Some("authenticationFailed".to_string()),
                    message: Some("Authentication failed".to_string()),
                    data: (),
                }),
            )),
        }
    }

    pub fn has_data(&self, options: DataOptions) -> crate::Result<bool> {
        let domain = options.domain;
        let name = options.name;

        if domain.is_empty() || name.is_empty() {
            return Ok(false);
        }

        // 只查 PasswordVault，不触碰 Windows Hello 凭据。
        //
        // 原实现会调用 get_credential()（OpenAsync）来判断「是否已绑定」，
        // 而该调用会启动 Hello 窗口聚焦线程并触发 WinRT 冷启动，纯探测却付出
        // 数百毫秒~数秒的代价，直接拖慢了锁定页「是否显示/自动唤起 Hello」的判定。
        // 本插件的写入逻辑保证「凭据 + 加密数据」成对存在，故仅凭 vault 中是否
        // 有对应条目即可可靠判定是否已绑定。
        let vault = PasswordVault::new().map_err(|_| {
            crate::Error::PluginInvoke(PluginInvokeError::InvokeRejected(ErrorResponse {
                code: Some("internalError".to_string()),
                message: Some("Failed to access password vault".to_string()),
                data: (),
            }))
        })?;

        let resource = HSTRING::from(&domain);
        let username = HSTRING::from(&name);

        match vault.Retrieve(&resource, &username) {
            Ok(_) => Ok(true),
            Err(_) => Ok(false),
        }
    }

    pub fn get_data(&self, options: GetDataOptions) -> crate::Result<DataResponse> {
        let domain = options.domain.clone();
        let name = options.name.clone();

        if domain.is_empty() || name.is_empty() {
            return Err(crate::Error::PluginInvoke(
                PluginInvokeError::InvokeRejected(ErrorResponse {
                    code: Some("invalidInput".to_string()),
                    message: Some("Domain and name must not be empty".to_string()),
                    data: (),
                }),
            ));
        }

        // Try to open the credential (without creating)
        let credential_result = get_credential(&domain, false).map_err(|e| {
            crate::Error::PluginInvoke(PluginInvokeError::InvokeRejected(ErrorResponse {
                code: Some("credentialNotFound".to_string()),
                message: Some(format!("Failed to open credential: {:?}", e)),
                data: (),
            }))
        })?;

        let status = credential_result.Status().map_err(|e| {
            crate::Error::PluginInvoke(PluginInvokeError::InvokeRejected(ErrorResponse {
                code: Some("internalError".to_string()),
                message: Some(format!("Failed to check credential status: {:?}", e)),
                data: (),
            }))
        })?;

        if status != KeyCredentialStatus::Success {
            return Err(crate::Error::PluginInvoke(
                PluginInvokeError::InvokeRejected(ErrorResponse {
                    code: Some("credentialNotFound".to_string()),
                    message: Some("Credential not available".to_string()),
                    data: (),
                }),
            ));
        }

        // Access the PasswordVault
        let vault = PasswordVault::new().map_err(|e| {
            crate::Error::PluginInvoke(PluginInvokeError::InvokeRejected(ErrorResponse {
                code: Some("internalError".to_string()),
                message: Some(format!("Failed to access password vault: {:?}", e)),
                data: (),
            }))
        })?;

        let resource = HSTRING::from(&domain);
        let username = HSTRING::from(&name);

        // Retrieve the credential with password
        let credential = vault.Retrieve(&resource, &username).map_err(|e| {
            crate::Error::PluginInvoke(PluginInvokeError::InvokeRejected(ErrorResponse {
                code: Some("dataNotFound".to_string()),
                message: Some(format!("Failed to retrieve data: {:?}", e)),
                data: (),
            }))
        })?;

        // Get the password (encrypted data)
        credential.RetrievePassword().map_err(|e| {
            crate::Error::PluginInvoke(PluginInvokeError::InvokeRejected(ErrorResponse {
                code: Some("internalError".to_string()),
                message: Some(format!("Failed to retrieve password: {:?}", e)),
                data: (),
            }))
        })?;

        let encrypted_data = credential.Password().map_err(|e| {
            crate::Error::PluginInvoke(PluginInvokeError::InvokeRejected(ErrorResponse {
                code: Some("internalError".to_string()),
                message: Some(format!("Failed to get password: {:?}", e)),
                data: (),
            }))
        })?;

        // 先完成一次 Windows Hello 用户验证（PIN / 指纹 / 面容）。
        // 此处在返回 crate::Result 的主流程中调用，错误码可原样透传：
        // 用户取消返回 userCancel（前端静默处理，不清除凭据、不禁用入口），
        // 只有真正的凭据失效才提示重新绑定。
        let credential_obj = credential_result.Credential().map_err(|e| {
            crate::Error::PluginInvoke(PluginInvokeError::InvokeRejected(ErrorResponse {
                code: Some("credentialNotFound".to_string()),
                message: Some(format!("Failed to get credential: {:?}", e)),
                data: (),
            }))
        })?;
        verify_user(&domain, &credential_obj)?;

        // Decrypt the data（仅做解密，验证已在上方完成）
        let decrypted_data = decrypt_data(&domain, &encrypted_data.to_string(), &credential_result)
            .map_err(|e| {
                crate::Error::PluginInvoke(PluginInvokeError::InvokeRejected(ErrorResponse {
                    code: Some("decryptionFailed".to_string()),
                    message: Some(format!("Failed to decrypt data: {:?}", e)),
                    data: (),
                }))
            })?;

        // Convert decrypted bytes to string
        let data_string = String::from_utf8(decrypted_data).map_err(|e| {
            crate::Error::PluginInvoke(PluginInvokeError::InvokeRejected(ErrorResponse {
                code: Some("internalError".to_string()),
                message: Some(format!("Failed to convert data to string: {:?}", e)),
                data: (),
            }))
        })?;

        Ok(DataResponse {
            domain,
            name,
            data: data_string,
        })
    }

    pub fn set_data(&self, options: SetDataOptions) -> crate::Result<()> {
        let domain = options.domain;
        let name = options.name;
        let data = options.data;

        if domain.is_empty() || name.is_empty() {
            return Err(crate::Error::PluginInvoke(
                PluginInvokeError::InvokeRejected(ErrorResponse {
                    code: Some("invalidInput".to_string()),
                    message: Some("Domain and name must not be empty".to_string()),
                    data: (),
                }),
            ));
        }

        // Create or replace the credential
        let credential_result = get_credential(&domain, true).map_err(|e| {
            crate::Error::PluginInvoke(PluginInvokeError::InvokeRejected(ErrorResponse {
                code: Some("credentialCreationFailed".to_string()),
                message: Some(format!("Failed to create credential: {:?}", e)),
                data: (),
            }))
        })?;

        let status = credential_result.Status().map_err(|e| {
            crate::Error::PluginInvoke(PluginInvokeError::InvokeRejected(ErrorResponse {
                code: Some("internalError".to_string()),
                message: Some(format!("Failed to check credential status: {:?}", e)),
                data: (),
            }))
        })?;

        if status != KeyCredentialStatus::Success {
            return Err(crate::Error::PluginInvoke(
                PluginInvokeError::InvokeRejected(ErrorResponse {
                    code: Some("credentialCreationFailed".to_string()),
                    message: Some("Failed to create credential".to_string()),
                    data: (),
                }),
            ));
        }

        // 首次创建凭证（RequestCreateAsync）自身即包含一次 Windows Hello
        // 用户确认，故此处不再额外 verify，避免「启用」时连弹两次认证框。
        // Encrypt the data（仅做加密）
        let encrypted_data =
            encrypt_data(&domain, data.as_bytes(), &credential_result).map_err(|e| {
                crate::Error::PluginInvoke(PluginInvokeError::InvokeRejected(ErrorResponse {
                    code: Some("encryptionFailed".to_string()),
                    message: Some(format!("Failed to encrypt data: {:?}", e)),
                    data: (),
                }))
            })?;

        // Access the PasswordVault
        let vault = PasswordVault::new().map_err(|e| {
            crate::Error::PluginInvoke(PluginInvokeError::InvokeRejected(ErrorResponse {
                code: Some("internalError".to_string()),
                message: Some(format!("Failed to access password vault: {:?}", e)),
                data: (),
            }))
        })?;

        let resource = HSTRING::from(&domain);
        let username = HSTRING::from(&name);
        let password = HSTRING::from(&encrypted_data);

        // Try to remove existing credential if it exists
        if let Ok(existing) = vault.Retrieve(&resource, &username) {
            let _ = vault.Remove(&existing);
        }

        // Create new credential
        let credential = PasswordCredential::CreatePasswordCredential(
            &resource, &username, &password,
        )
        .map_err(|e| {
            crate::Error::PluginInvoke(PluginInvokeError::InvokeRejected(ErrorResponse {
                code: Some("internalError".to_string()),
                message: Some(format!("Failed to create password credential: {:?}", e)),
                data: (),
            }))
        })?;

        // Add to vault
        vault.Add(&credential).map_err(|e| {
            crate::Error::PluginInvoke(PluginInvokeError::InvokeRejected(ErrorResponse {
                code: Some("internalError".to_string()),
                message: Some(format!("Failed to store credential: {:?}", e)),
                data: (),
            }))
        })?;

        Ok(())
    }

    pub fn remove_data(&self, options: RemoveDataOptions) -> crate::Result<()> {
        let domain = options.domain;
        let name = options.name;

        if domain.is_empty() || name.is_empty() {
            return Err(crate::Error::PluginInvoke(
                PluginInvokeError::InvokeRejected(ErrorResponse {
                    code: Some("invalidInput".to_string()),
                    message: Some("Domain and name must not be empty".to_string()),
                    data: (),
                }),
            ));
        }

        // Access the PasswordVault
        let vault = PasswordVault::new().map_err(|e| {
            crate::Error::PluginInvoke(PluginInvokeError::InvokeRejected(ErrorResponse {
                code: Some("internalError".to_string()),
                message: Some(format!("Failed to access password vault: {:?}", e)),
                data: (),
            }))
        })?;

        let resource = HSTRING::from(&domain);
        let username = HSTRING::from(&name);

        // Try to retrieve and remove the credential
        match vault.Retrieve(&resource, &username) {
            Ok(credential) => {
                vault.Remove(&credential).map_err(|e| {
                    crate::Error::PluginInvoke(PluginInvokeError::InvokeRejected(ErrorResponse {
                        code: Some("internalError".to_string()),
                        message: Some(format!("Failed to remove credential: {:?}", e)),
                        data: (),
                    }))
                })?;
                Ok(())
            }
            Err(_) => {
                // Credential doesn't exist, which is fine for remove
                Ok(())
            }
        }
    }
}
