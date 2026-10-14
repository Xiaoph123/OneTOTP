use serde::{Deserialize, Serialize};

/// 单个 OTP 账户（持久化时整体被加密，不落明文）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Account {
    pub id: String,
    /// 服务名称（issuer），例如 GitHub
    pub issuer: String,
    /// 账户标识，例如 邮箱
    pub account: String,
    /// Base32 密钥（明文仅存在于内存与加密载荷中）
    pub secret: String,
    /// OTP 类型：totp（默认）| hotp
    #[serde(default = "default_otp_type")]
    pub otp_type: String,
    /// SHA1 | SHA256 | SHA512
    #[serde(default = "default_algorithm")]
    pub algorithm: String,
    /// 6 | 7 | 8
    #[serde(default = "default_digits")]
    pub digits: u32,
    /// TOTP 周期，秒
    #[serde(default = "default_period")]
    pub period: u32,
    /// HOTP 计数器（仅 hotp 类型使用）
    #[serde(default)]
    pub counter: u64,
    /// 分类
    #[serde(default)]
    pub category: String,
    #[serde(default)]
    pub favorite: bool,
    /// 创建时间（毫秒时间戳）
    #[serde(default)]
    pub created_at: i64,
    /// 最近使用时间（毫秒时间戳）
    #[serde(default)]
    pub last_used_at: i64,
}

fn default_otp_type() -> String {
    "totp".to_string()
}
fn default_algorithm() -> String {
    "SHA1".to_string()
}
fn default_digits() -> u32 {
    6
}
fn default_period() -> u32 {
    30
}

/// 应用设置（明文设置，不含敏感信息）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    /// 是否启用应用锁定
    #[serde(default)]
    pub lock_enabled: bool,
    /// 离开后台自动锁定
    #[serde(default = "default_true")]
    pub lock_on_blur: bool,
    /// 自动锁定时长（秒），0 表示从不
    #[serde(default = "default_auto_lock")]
    pub auto_lock_seconds: u32,
    /// 复制后自动隐藏窗口
    #[serde(default)]
    pub auto_hide_after_copy: bool,
    /// 验证码显示分组（3+3）
    #[serde(default = "default_true")]
    pub code_grouping: bool,
    /// 剩余时间不足时高亮
    #[serde(default = "default_true")]
    pub expiry_highlight: bool,
    /// 点击即复制
    #[serde(default = "default_true")]
    pub click_to_copy: bool,
    /// 隐藏验证码直到悬停
    #[serde(default)]
    pub hide_code_until_hover: bool,
    /// 自动备份
    #[serde(default = "default_true")]
    pub auto_backup: bool,
    /// 备份保留数量
    #[serde(default = "default_backup_count")]
    pub backup_keep: u32,
    /// 密码提示（明文，可为空）
    #[serde(default)]
    pub password_hint: String,
    /// 主题：light | dark | system
    #[serde(default = "default_theme")]
    pub theme: String,
}

fn default_theme() -> String {
    "light".to_string()
}

fn default_true() -> bool {
    true
}
fn default_auto_lock() -> u32 {
    60
}
fn default_backup_count() -> u32 {
    10
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            lock_enabled: false,
            lock_on_blur: true,
            auto_lock_seconds: 60,
            auto_hide_after_copy: false,
            code_grouping: true,
            expiry_highlight: true,
            click_to_copy: true,
            hide_code_until_hover: false,
            auto_backup: true,
            backup_keep: 10,
            password_hint: String::new(),
            theme: "light".to_string(),
        }
    }
}

/// 解密后的完整保险库载荷
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct VaultPayload {
    #[serde(default)]
    pub accounts: Vec<Account>,
    #[serde(default)]
    pub settings: AppSettings,
}

/// 磁盘上的加密保险库文件结构
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultFile {
    pub version: u32,
    /// 密钥派生使用的盐（Base64）
    pub salt: String,
    /// AES-GCM 随机数（Base64）
    pub nonce: String,
    /// 密文 + 认证标签（Base64）
    pub ciphertext: String,
    /// 未启用锁定密码时，标记使用本机随机密钥
    pub uses_machine_key: bool,
    /// 备份范围标记（明文，便于导入时判断合并哪些部分）
    #[serde(default)]
    pub scope: BackupScope,
}

/// 备份包含的内容范围
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupScope {
    /// 是否包含账户（验证码）
    #[serde(default = "default_true")]
    pub accounts: bool,
    /// 是否包含应用配置
    #[serde(default = "default_true")]
    pub settings: bool,
}

impl Default for BackupScope {
    fn default() -> Self {
        Self {
            accounts: true,
            settings: true,
        }
    }
}

/// 前端展示用的账户视图
#[derive(Debug, Clone, Serialize)]
pub struct AccountView {
    pub id: String,
    pub issuer: String,
    pub account: String,
    pub secret: String,
    pub otp_type: String,
    pub algorithm: String,
    pub digits: u32,
    pub period: u32,
    pub counter: u64,
    pub category: String,
    pub favorite: bool,
    pub created_at: i64,
    pub last_used_at: i64,
}

impl From<&Account> for AccountView {
    fn from(a: &Account) -> Self {
        Self {
            id: a.id.clone(),
            issuer: a.issuer.clone(),
            account: a.account.clone(),
            secret: a.secret.clone(),
            otp_type: a.otp_type.clone(),
            algorithm: a.algorithm.clone(),
            digits: a.digits,
            period: a.period,
            counter: a.counter,
            category: a.category.clone(),
            favorite: a.favorite,
            created_at: a.created_at,
            last_used_at: a.last_used_at,
        }
    }
}

/// 当前验证码结果
#[derive(Debug, Clone, Serialize)]
pub struct CodeResult {
    pub id: String,
    pub code: String,
    /// OTP 类型：totp | hotp
    pub otp_type: String,
    /// 剩余秒数（HOTP 恒为 0）
    pub remaining: u32,
    /// 当前周期进度百分比 0-100（HOTP 恒为 0）
    pub progress: u32,
}

/// 新增/更新账户入参
#[derive(Debug, Clone, Deserialize)]
pub struct AccountInput {
    pub issuer: String,
    pub account: String,
    pub secret: String,
    #[serde(default = "default_otp_type")]
    pub otp_type: String,
    #[serde(default = "default_algorithm")]
    pub algorithm: String,
    #[serde(default = "default_digits")]
    pub digits: u32,
    #[serde(default = "default_period")]
    pub period: u32,
    #[serde(default)]
    pub counter: u64,
    #[serde(default)]
    pub category: String,
}
