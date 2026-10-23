import { invoke } from "@tauri-apps/api/core";
import { cacheClearClipboardOnFail } from "./utils";

export interface AccountView {
  id: string;
  issuer: string;
  account: string;
  secret: string;
  otpType: string;
  algorithm: string;
  digits: number;
  period: number;
  counter: number;
  categoryId: string;
  categoryName: string;
  categoryColor: string;
  favorite: boolean;
  createdAt: number;
  lastUsedAt: number;
}

export interface Category {
  id: string;
  name: string;
  color: string;
  order: number;
  createdAt: number;
}

/** Rust 侧使用 snake_case，这里做一层映射 */
interface RawAccount {
  id: string;
  issuer: string;
  account: string;
  secret: string;
  otp_type: string;
  algorithm: string;
  digits: number;
  period: number;
  counter: number;
  category_id: string;
  category_name: string;
  category_color: string;
  favorite: boolean;
  created_at: number;
  last_used_at: number;
}

function mapAccount(raw: RawAccount): AccountView {
  return {
    id: raw.id,
    issuer: raw.issuer,
    account: raw.account,
    secret: raw.secret,
    otpType: raw.otp_type,
    algorithm: raw.algorithm,
    digits: raw.digits,
    period: raw.period,
    counter: raw.counter,
    categoryId: raw.category_id,
    categoryName: raw.category_name,
    categoryColor: raw.category_color,
    favorite: raw.favorite,
    createdAt: raw.created_at,
    lastUsedAt: raw.last_used_at,
  };
}

interface RawCategory {
  id: string;
  name: string;
  color: string;
  order: number;
  created_at: number;
}

function mapCategory(raw: RawCategory): Category {
  return {
    id: raw.id,
    name: raw.name,
    color: raw.color,
    order: raw.order,
    createdAt: raw.created_at,
  };
}

export interface CodeResult {
  id: string;
  code: string;
  otpType: string;
  remaining: number;
  progress: number;
  /** 下一个周期的验证码（仅 TOTP 提供） */
  nextCode?: string;
}

interface RawCodeResult {
  id: string;
  code: string;
  otp_type: string;
  remaining: number;
  progress: number;
  next_code?: string;
}

export type ThemeMode = "light" | "dark" | "system";

/**
 * 开屏动画样式：
 * - `draw`：盾牌轮廓逐笔描出，随后渐变填充与数字淡入
 * - `pop`：盾牌弹性放大，随后高光扫过
 * - `ring`：盾牌呼吸 + 外圈环形进度条走满
 * - `dots`：光点从四周向中心汇聚，随后盾牌弹出（默认）
 */
export type SplashAnimation = "draw" | "pop" | "ring" | "dots";

export type CodeVisibility = "never" | "always" | "hover";

/**
 * 首页分类分组的展开策略：
 * - `expand`：始终自动展开
 * - `collapse`：始终不自动展开（全部收起）
 * - `remember`：按上次的展开状态还原
 */
export type CategoryExpandMode = "expand" | "collapse" | "remember";
export type CardDensity = "compact" | "standard";
export type CardDetail = "minimal" | "standard" | "detailed";
export type CloseBehavior = "quit" | "tray";

export interface AppSettings {
  lockEnabled: boolean;
  lockOnBlur: boolean;
  autoLockSeconds: number;
  autoHideAfterCopy: boolean;
  codeGrouping: boolean;
  expiryHighlight: boolean;
  clickToCopy: boolean;
  codeVisibility: CodeVisibility;
  /** 首页分类分组的展开策略 */
  categoryExpandMode: CategoryExpandMode;
  hideOnScreenshot: boolean;
  /** 远程桌面会话时隐藏窗口 */
  hideOnRemote: boolean;
  /** 窗口失焦时遮挡验证码数字 */
  hideOnUnfocused: boolean;
  autoBackup: boolean;
  backupKeep: number;
  passwordHint: string;
  theme: ThemeMode;
  /** 开屏动画样式 */
  splashAnimation: SplashAnimation;
  cardDensity: CardDensity;
  cardDetail: CardDetail;
  closeBehavior: CloseBehavior;
  shortcutToggle: string;
  language: LangPref;
  windowSize: WindowSize;
  fontScale: FontScale;
  /** 解锁连续失败 5 次后清空剪贴板 */
  clearClipboardOnFail: boolean;
  /** 复制验证码后自动清空剪贴板的秒数，0=不自动清除 */
  clipboardClearSeconds: number;
  /** 允许备份使用空密码（导出/导入都不再强制密码） */
  allowEmptyBackupPassword: boolean;
}

export type FontScale = "small" | "standard" | "large" | "xlarge";

export type LangPref = "auto" | "zh" | "en";
export type WindowSize = "compact" | "standard" | "expanded";

interface RawSettings {
  lock_enabled: boolean;
  lock_on_blur: boolean;
  auto_lock_seconds: number;
  auto_hide_after_copy: boolean;
  code_grouping: boolean;
  expiry_highlight: boolean;
  click_to_copy: boolean;
  code_visibility: string;
  category_expand_mode: string;
  hide_on_screenshot: boolean;
  hide_on_remote: boolean;
  hide_on_unfocused: boolean;
  auto_backup: boolean;
  backup_keep: number;
  password_hint: string;
  theme: string;
  splash_animation: string;
  card_density: string;
  card_detail: string;
  close_behavior: string;
  shortcut_toggle: string;
  language: string;
  window_size: string;
  font_scale: string;
  clear_clipboard_on_fail: boolean;
  clipboard_clear_seconds: number;
  allow_empty_backup_password: boolean;
}

function mapSettings(raw: RawSettings): AppSettings {
  return {
    lockEnabled: raw.lock_enabled,
    lockOnBlur: raw.lock_on_blur,
    autoLockSeconds: raw.auto_lock_seconds,
    autoHideAfterCopy: raw.auto_hide_after_copy,
    codeGrouping: raw.code_grouping,
    expiryHighlight: raw.expiry_highlight,
    clickToCopy: raw.click_to_copy,
    codeVisibility: (raw.code_visibility as CodeVisibility) || "never",
    categoryExpandMode: (raw.category_expand_mode as CategoryExpandMode) || "expand",
    hideOnScreenshot: raw.hide_on_screenshot ?? true,
    hideOnRemote: raw.hide_on_remote ?? true,
    hideOnUnfocused: raw.hide_on_unfocused ?? true,
    autoBackup: raw.auto_backup,
    backupKeep: raw.backup_keep,
    passwordHint: raw.password_hint,
    theme: (raw.theme as ThemeMode) || "system",
    splashAnimation: (raw.splash_animation as SplashAnimation) || "dots",
    cardDensity: (raw.card_density as CardDensity) || "standard",
    cardDetail: (raw.card_detail as CardDetail) || "detailed",
    closeBehavior: (raw.close_behavior as CloseBehavior) || "quit",
    shortcutToggle: raw.shortcut_toggle || "",
    language: (raw.language as LangPref) || "auto",
    windowSize: (raw.window_size as WindowSize) || "standard",
    fontScale: (raw.font_scale as FontScale) || "standard",
    clearClipboardOnFail: raw.clear_clipboard_on_fail ?? true,
    clipboardClearSeconds: raw.clipboard_clear_seconds ?? 30,
    allowEmptyBackupPassword: raw.allow_empty_backup_password ?? false,
  };
}

function toRawSettings(s: AppSettings): RawSettings {
  return {
    lock_enabled: s.lockEnabled,
    lock_on_blur: s.lockOnBlur,
    auto_lock_seconds: s.autoLockSeconds,
    auto_hide_after_copy: s.autoHideAfterCopy,
    code_grouping: s.codeGrouping,
    expiry_highlight: s.expiryHighlight,
    click_to_copy: s.clickToCopy,
    code_visibility: s.codeVisibility,
    category_expand_mode: s.categoryExpandMode,
    hide_on_screenshot: s.hideOnScreenshot,
    hide_on_remote: s.hideOnRemote,
    hide_on_unfocused: s.hideOnUnfocused,
    auto_backup: s.autoBackup,
    backup_keep: s.backupKeep,
    password_hint: s.passwordHint,
    theme: s.theme,
    splash_animation: s.splashAnimation,
    card_density: s.cardDensity,
    card_detail: s.cardDetail,
    close_behavior: s.closeBehavior,
    shortcut_toggle: s.shortcutToggle,
    language: s.language,
    window_size: s.windowSize,
    font_scale: s.fontScale,
    clear_clipboard_on_fail: s.clearClipboardOnFail,
    clipboard_clear_seconds: s.clipboardClearSeconds,
    allow_empty_backup_password: s.allowEmptyBackupPassword,
  };
}

/** 数据目录指针不可用的原因（与后端 store::DataDirIssueCode 一一对应） */
export type DataDirIssueCode =
  | "unreadable"
  | "invalid_json"
  | "missing_field"
  | "empty_path"
  | "not_absolute"
  | "network_path"
  | "not_found";

export interface DataDirIssue {
  code: DataDirIssueCode;
  /** 涉及的路径：能解析出目标目录时为其路径，否则为空串 */
  path: string;
}
export interface StatusView {
  hasVault: boolean;
  hasLock: boolean;
  locked: boolean;
  passwordHint: string;
  lockOnlyOnStart: boolean;
  /** 保险库仍使用较弱的旧 KDF 参数（建议执行一次「重新加密保险库」） */
  kdfLegacy: boolean;
  /** 当前实际使用的数据目录 */
  dataDir: string;
  /** 是否来自自定义目录指针 */
  dataDirFromPointer: boolean;
  /** 指针存在但不可用时的原因（此时正使用默认目录）；文案由前端按 code 本地化 */
  dataDirIssue: DataDirIssue | null;
}

interface RawStatus {
  has_vault: boolean;
  has_lock: boolean;
  locked: boolean;
  password_hint: string;
  lock_only_on_start: boolean;
  kdf_legacy: boolean;
  data_dir: string;
  data_dir_from_pointer: boolean;
  data_dir_issue: { code: string; path: string } | null;
}

export interface BackupView {
  name: string;
  size: number;
}

export interface StorageUsage {
  totalBytes: number;
  backupBytes: number;
  vaultBytes: number;
  backupCount: number;
}

interface RawStorageUsage {
  total_bytes: number;
  backup_bytes: number;
  vault_bytes: number;
  backup_count: number;
}

/** 数据目录信息 */
export interface DataDirInfo {
  /** 当前实际使用的数据目录 */
  current: string;
  /** 系统默认目录 */
  defaultDir: string;
  /** 是否已自定义 */
  custom: boolean;
}

interface RawDataDir {
  current: string;
  default_dir: string;
  custom: boolean;
}

export interface AccountInput {
  issuer: string;
  account: string;
  secret: string;
  otpType: string;
  algorithm: string;
  digits: number;
  period: number;
  counter: number;
  categoryId: string;
}

/** Rust 侧 AccountInput 使用 snake_case */
interface RawAccountInput {
  issuer: string;
  account: string;
  secret: string;
  otp_type: string;
  algorithm: string;
  digits: number;
  period: number;
  counter: number;
  category_id: string;
}

function toRawAccountInput(input: AccountInput): RawAccountInput {
  return {
    issuer: input.issuer,
    account: input.account,
    secret: input.secret,
    otp_type: input.otpType,
    algorithm: input.algorithm,
    digits: input.digits,
    period: input.period,
    counter: input.counter,
    category_id: input.categoryId,
  };
}

export interface ParsedAccount {
  issuer: string;
  account: string;
  secret: string;
  otpType: string;
  algorithm: string;
  digits: number;
  period: number;
  counter: number;
}

interface RawParsedAccount {
  issuer: string;
  account: string;
  secret: string;
  otp_type: string;
  algorithm: string;
  digits: number;
  period: number;
  counter: number;
}

export interface ImportResult {
  addedAccounts: number;
  appliedSettings: boolean;
  totalAccountsInBackup: number;
  /** 因字段非法被跳过的账户数 */
  skippedInvalid: number;
  /** 因密钥与现有账户重复被跳过的账户数 */
  skippedDuplicate: number;
}

interface RawImportResult {
  added_accounts: number;
  applied_settings: boolean;
  total_accounts_in_backup: number;
  skipped_invalid: number;
  skipped_duplicate: number;
}

export const api = {
  async getStatus(): Promise<StatusView> {
    const raw = await invoke<RawStatus>("get_status");
    return {
      hasVault: raw.has_vault,
      hasLock: raw.has_lock,
      locked: raw.locked,
      passwordHint: raw.password_hint,
      lockOnlyOnStart: raw.lock_only_on_start,
      kdfLegacy: raw.kdf_legacy ?? false,
      dataDir: raw.data_dir ?? "",
      dataDirFromPointer: raw.data_dir_from_pointer ?? false,
      dataDirIssue: raw.data_dir_issue
        ? { code: raw.data_dir_issue.code as DataDirIssueCode, path: raw.data_dir_issue.path ?? "" }
        : null,
    };
  },

  initializeVault(): Promise<void> {
    return invoke("initialize_vault");
  },

  unlock(password: string): Promise<void> {
    return invoke("unlock", { password });
  },

  lock(): Promise<void> {
    return invoke("lock");
  },

  setLockPassword(password: string, hint: string, enable: boolean): Promise<void> {
    return invoke("set_lock_password", { password, hint, enable });
  },

  /**
   * 重新加密保险库：同一口令 + 全新 salt，重新派生密钥并重写本地数据。
   * 用于让曾经以明文写在锁定凭证文件里的旧密钥彻底作废。
   *
   * 返回 `staleBackups`：换密钥后，此前的快照已无法解密，建议提示用户清理。
   */
  async rotateVaultKey(password: string): Promise<{ staleBackups: number }> {
    const raw = await invoke<{ stale_backups: number }>("rotate_vault_key", { password });
    return { staleBackups: raw.stale_backups };
  },

  async listAccounts(): Promise<AccountView[]> {
    const raw = await invoke<RawAccount[]>("list_accounts");
    return raw.map(mapAccount);
  },

  async getCodes(): Promise<CodeResult[]> {
    const raw = await invoke<RawCodeResult[]>("get_codes");
    return raw.map((r) => ({
      id: r.id,
      code: r.code,
      otpType: r.otp_type,
      remaining: r.remaining,
      progress: r.progress,
      nextCode: r.next_code,
    }));
  },

  async getAccountDetail(id: string): Promise<AccountView> {
    return mapAccount(await invoke<RawAccount>("get_account_detail", { id }));
  },

  async addAccount(input: AccountInput): Promise<AccountView> {
    return mapAccount(await invoke<RawAccount>("add_account", { input: toRawAccountInput(input) }));
  },

  async updateAccount(id: string, input: AccountInput): Promise<AccountView> {
    return mapAccount(
      await invoke<RawAccount>("update_account", { id, input: toRawAccountInput(input) }),
    );
  },

  async listCategories(): Promise<Category[]> {
    const raw = await invoke<RawCategory[]>("list_categories");
    return raw.map(mapCategory);
  },

  async addCategory(name: string, color: string): Promise<Category> {
    const raw = await invoke<RawCategory>("add_category", { input: { name, color } });
    return mapCategory(raw);
  },

  async updateCategory(id: string, name: string, color: string): Promise<Category> {
    const raw = await invoke<RawCategory>("update_category", { id, input: { name, color } });
    return mapCategory(raw);
  },

  /** 删除分类；deleteAccounts 为 true 时一并删除其中账户，否则移到未分类 */
  deleteCategory(id: string, deleteAccounts: boolean): Promise<number> {
    return invoke("delete_category", { id, deleteAccounts });
  },

  reorderCategories(ids: string[]): Promise<void> {
    return invoke("reorder_categories", { ids });
  },

  async setAccountCategory(accountId: string, categoryId: string): Promise<AccountView> {
    return mapAccount(
      await invoke<RawAccount>("set_account_category", { accountId, categoryId }),
    );
  },

  async parseOtpauth(uri: string): Promise<ParsedAccount> {
    const raw = await invoke<RawParsedAccount>("parse_otpauth", { uri });
    return {
      issuer: raw.issuer,
      account: raw.account,
      secret: raw.secret,
      otpType: raw.otp_type,
      algorithm: raw.algorithm,
      digits: raw.digits,
      period: raw.period,
      counter: raw.counter,
    };
  },

  async importOtpauthText(text: string): Promise<{ added: number; skipped: number }> {
    const [added, skipped] = await invoke<[number, number]>("import_otpauth_text", { text });
    return { added, skipped };
  },

  /**
   * 删除账户。
   *
   * `purgeBackups` 默认 true：历史快照与主库共用同一把密钥，若不清理，
   * 被删账户的密钥仍能从快照里解出（等于「删除了但没撤销」）。
   */
  async deleteAccount(
    id: string,
    purgeBackups = true,
  ): Promise<{ purgedBackups: number; staleBackups: number }> {
    const raw = await invoke<{ purged_backups: number; stale_backups: number }>(
      "delete_account",
      { id, purgeBackups },
    );
    return { purgedBackups: raw.purged_backups, staleBackups: raw.stale_backups };
  },

  toggleFavorite(id: string): Promise<boolean> {
    return invoke("toggle_favorite", { id });
  },

  markUsed(id: string): Promise<void> {
    return invoke("mark_used", { id });
  },

  async getSettings(): Promise<AppSettings> {
    const s = mapSettings(await invoke<RawSettings>("get_settings"));
    // 同步本地镜像，供锁定状态下的解锁页读取
    cacheClearClipboardOnFail(s.clearClipboardOnFail);
    return s;
  },

  async updateSettings(settings: AppSettings): Promise<void> {
    await invoke("update_settings", { settings: toRawSettings(settings) });
    cacheClearClipboardOnFail(settings.clearClipboardOnFail);
  },

  exportVault(password: string, includeAccounts: boolean, includeSettings: boolean): Promise<string> {
    return invoke("export_vault", {
      password,
      includeAccounts,
      includeSettings,
    });
  },

  /** 把导出的备份内容写入用户指定路径（桌面端为绝对路径，Android 为 content:// URI） */
  writeBackupFile(path: string, content: string): Promise<void> {
    return invoke("write_backup_file", { path, content });
  },

  /** 读取用户选中的备份文件内容（桌面端为绝对路径，Android 为 content:// URI） */
  readBackupFile(path: string): Promise<string> {
    return invoke("read_backup_file", { path });
  },

  async importVault(content: string, password: string): Promise<ImportResult> {
    const raw = await invoke<RawImportResult>("import_vault", { content, password });
    return {
      addedAccounts: raw.added_accounts,
      appliedSettings: raw.applied_settings,
      totalAccountsInBackup: raw.total_accounts_in_backup,
      skippedInvalid: raw.skipped_invalid,
      skippedDuplicate: raw.skipped_duplicate,
    };
  },

  listBackups(): Promise<BackupView[]> {
    return invoke("list_backups");
  },

  async getStorageUsage(): Promise<StorageUsage> {
    const raw = await invoke<RawStorageUsage>("get_storage_usage");
    return {
      totalBytes: raw.total_bytes,
      backupBytes: raw.backup_bytes,
      vaultBytes: raw.vault_bytes,
      backupCount: raw.backup_count,
    };
  },

  /** 清理全部本地备份快照，返回删除数量 */
  clearBackups(): Promise<number> {
    return invoke("clear_backups");
  },

  /** 读取当前数据目录（含系统默认目录与是否已自定义） */
  async getDataDir(): Promise<DataDirInfo> {
    const raw = await invoke<RawDataDir>("get_data_dir");
    return {
      current: raw.current,
      defaultDir: raw.default_dir,
      custom: raw.custom,
    };
  },

  /** 切换数据目录：迁移现有数据后应用会自动重启 */
  setDataDir(dir: string): Promise<void> {
    return invoke("set_data_dir", { dir });
  },

  /** 恢复默认数据目录：迁移数据后应用会自动重启 */
  resetDataDir(): Promise<void> {
    return invoke("reset_data_dir");
  },

  /** 当前是否处于远程桌面 / 远程协助会话 */
  isRemoteSession(): Promise<boolean> {
    return invoke("is_remote_session");
  },

  /**
   * 诊断追踪：写入 trace.log。仅当后端启动时带有 `ONETOTP_TRACE=1` 才落盘，
   * 默认完全静默；失败也不影响业务（诊断用）。
   */
  async traceEvent(message: string): Promise<void> {
    try {
      await invoke("trace_event", { message });
    } catch {
      // 忽略：诊断失败不影响功能
    }
  },
};
