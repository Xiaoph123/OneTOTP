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
    /// 所属分类 id；空字符串表示「未分类」
    #[serde(default)]
    pub category_id: String,
    /// 旧版分类名称（用于一次性迁移到 category_id）
    #[serde(default, skip_serializing_if = "String::is_empty")]
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

/// 用户自定义分类（持久化时随载荷一起加密）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Category {
    pub id: String,
    /// 分类名称，例如「工作」
    pub name: String,
    /// 标识色（十六进制，如 #1664FF）
    #[serde(default = "default_category_color")]
    pub color: String,
    /// 排序序号，越小越靠前
    #[serde(default)]
    pub order: i32,
    #[serde(default)]
    pub created_at: i64,
}

fn default_category_color() -> String {
    "#1664FF".to_string()
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
    /// 验证码可见性：never（不隐藏）| always（始终隐藏）| hover（悬停显示）
    #[serde(default = "default_code_visibility")]
    pub code_visibility: String,
    /// 截图时隐藏窗口内容（防截屏）
    #[serde(default)]
    pub hide_on_screenshot: bool,
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
    /// 卡片密度：compact（紧凑）| standard（标准）
    #[serde(default = "default_card_density")]
    pub card_density: String,
    /// 卡片细节程度：minimal（精简）| standard（标准）| detailed（复杂）
    #[serde(default = "default_card_detail")]
    pub card_detail: String,
    /// 关闭按钮行为：quit（直接退出）| tray（最小化到托盘）
    #[serde(default = "default_close_behavior")]
    pub close_behavior: String,
    /// 全局快捷键（唤起/隐藏），空字符串表示未设置
    #[serde(default)]
    pub shortcut_toggle: String,
    /// 界面语言：auto | zh | en，auto 表示跟随系统语言环境
    #[serde(default = "default_language")]
    pub language: String,
    /// 窗口尺寸档位：compact（紧凑）| standard（标准）| expanded（扩展）
    #[serde(default = "default_window_size")]
    pub window_size: String,
    /// 字体大小：small | standard | large | xlarge
    #[serde(default = "default_font_scale")]
    pub font_scale: String,
    /// 解锁连续失败 5 次后自动清空剪贴板（防止暴力尝试期间泄露已复制验证码）
    #[serde(default = "default_true")]
    pub clear_clipboard_on_fail: bool,
}

fn default_font_scale() -> String {
    "standard".to_string()
}

fn default_window_size() -> String {
    "standard".to_string()
}

fn default_language() -> String {
    "auto".to_string()
}

fn default_card_density() -> String {
    "standard".to_string()
}
fn default_card_detail() -> String {
    "standard".to_string()
}
fn default_close_behavior() -> String {
    "quit".to_string()
}
fn default_code_visibility() -> String {
    "never".to_string()
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
    3
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
            code_visibility: "never".to_string(),
            hide_on_screenshot: false,
            auto_backup: true,
            backup_keep: 3,
            password_hint: String::new(),
            theme: "light".to_string(),
            card_density: "standard".to_string(),
            card_detail: "standard".to_string(),
            close_behavior: "quit".to_string(),
            shortcut_toggle: String::new(),
            language: "auto".to_string(),
            window_size: "standard".to_string(),
            font_scale: "standard".to_string(),
            clear_clipboard_on_fail: true,
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
    /// 用户自定义分类
    #[serde(default)]
    pub categories: Vec<Category>,
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
    pub category_id: String,
    /// 分类名称（由后端联表填充，便于前端直接展示）
    pub category_name: String,
    /// 分类颜色（联表填充）
    pub category_color: String,
    pub favorite: bool,
    pub created_at: i64,
    pub last_used_at: i64,
}

impl AccountView {
    /// 从账户与分类列表构造视图，填充分类名称与颜色
    pub fn from_with_categories(account: &Account, categories: &[Category]) -> Self {
        let matched = categories.iter().find(|c| c.id == account.category_id);
        Self {
            id: account.id.clone(),
            issuer: account.issuer.clone(),
            account: account.account.clone(),
            secret: account.secret.clone(),
            otp_type: account.otp_type.clone(),
            algorithm: account.algorithm.clone(),
            digits: account.digits,
            period: account.period,
            counter: account.counter,
            category_id: account.category_id.clone(),
            category_name: matched.map(|c| c.name.clone()).unwrap_or_default(),
            category_color: matched.map(|c| c.color.clone()).unwrap_or_default(),
            favorite: account.favorite,
            created_at: account.created_at,
            last_used_at: account.last_used_at,
        }
    }
}

impl From<&Account> for AccountView {
    /// 无分类信息时的降级视图（分类名/颜色为空）
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
            category_id: a.category_id.clone(),
            category_name: String::new(),
            category_color: String::new(),
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
    /// 下一个周期的验证码（仅 TOTP 提供，HOTP 为 None）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_code: Option<String>,
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
    pub category_id: String,
}

/// 分类新增/更新入参
#[derive(Debug, Clone, Deserialize)]
pub struct CategoryInput {
    pub name: String,
    #[serde(default = "default_category_color")]
    pub color: String,
}
