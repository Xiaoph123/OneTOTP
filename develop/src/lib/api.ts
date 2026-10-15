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
export type CodeVisibility = "never" | "always" | "hover";
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
  hideOnScreenshot: boolean;
  autoBackup: boolean;
  backupKeep: number;
  passwordHint: string;
  theme: ThemeMode;
  cardDensity: CardDensity;
  cardDetail: CardDetail;
  closeBehavior: CloseBehavior;
  shortcutToggle: string;
  language: LangPref;
  windowSize: WindowSize;
  fontScale: FontScale;
  /** 解锁连续失败 5 次后清空剪贴板 */
  clearClipboardOnFail: boolean;
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
  hide_on_screenshot: boolean;
  auto_backup: boolean;
  backup_keep: number;
  password_hint: string;
  theme: string;
  card_density: string;
  card_detail: string;
  close_behavior: string;
  shortcut_toggle: string;
  language: string;
  window_size: string;
  font_scale: string;
  clear_clipboard_on_fail: boolean;
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
    hideOnScreenshot: raw.hide_on_screenshot,
    autoBackup: raw.auto_backup,
    backupKeep: raw.backup_keep,
    passwordHint: raw.password_hint,
    theme: (raw.theme as ThemeMode) || "light",
    cardDensity: (raw.card_density as CardDensity) || "standard",
    cardDetail: (raw.card_detail as CardDetail) || "standard",
    closeBehavior: (raw.close_behavior as CloseBehavior) || "quit",
    shortcutToggle: raw.shortcut_toggle || "",
    language: (raw.language as LangPref) || "auto",
    windowSize: (raw.window_size as WindowSize) || "standard",
    fontScale: (raw.font_scale as FontScale) || "standard",
    clearClipboardOnFail: raw.clear_clipboard_on_fail ?? true,
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
    hide_on_screenshot: s.hideOnScreenshot,
    auto_backup: s.autoBackup,
    backup_keep: s.backupKeep,
    password_hint: s.passwordHint,
    theme: s.theme,
    card_density: s.cardDensity,
    card_detail: s.cardDetail,
    close_behavior: s.closeBehavior,
    shortcut_toggle: s.shortcutToggle,
    language: s.language,
    window_size: s.windowSize,
    font_scale: s.fontScale,
    clear_clipboard_on_fail: s.clearClipboardOnFail,
  };
}

export interface StatusView {
  hasVault: boolean;
  hasLock: boolean;
  locked: boolean;
  passwordHint: string;
  lockOnlyOnStart: boolean;
}

interface RawStatus {
  has_vault: boolean;
  has_lock: boolean;
  locked: boolean;
  password_hint: string;
  lock_only_on_start: boolean;
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
}

interface RawImportResult {
  added_accounts: number;
  applied_settings: boolean;
  total_accounts_in_backup: number;
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

  importOtpauthText(text: string): Promise<number> {
    return invoke("import_otpauth_text", { text });
  },

  deleteAccount(id: string): Promise<void> {
    return invoke("delete_account", { id });
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

  async importVault(content: string, password: string): Promise<ImportResult> {
    const raw = await invoke<RawImportResult>("import_vault", { content, password });
    return {
      addedAccounts: raw.added_accounts,
      appliedSettings: raw.applied_settings,
      totalAccountsInBackup: raw.total_accounts_in_backup,
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
};
