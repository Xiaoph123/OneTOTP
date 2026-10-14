import { invoke } from "@tauri-apps/api/core";

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
  category: string;
  favorite: boolean;
  createdAt: number;
  lastUsedAt: number;
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
  category: string;
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
    category: raw.category,
    favorite: raw.favorite,
    createdAt: raw.created_at,
    lastUsedAt: raw.last_used_at,
  };
}

export interface CodeResult {
  id: string;
  code: string;
  otpType: string;
  remaining: number;
  progress: number;
}

interface RawCodeResult {
  id: string;
  code: string;
  otp_type: string;
  remaining: number;
  progress: number;
}

export interface AppSettings {
  lockEnabled: boolean;
  lockOnBlur: boolean;
  autoLockSeconds: number;
  autoHideAfterCopy: boolean;
  codeGrouping: boolean;
  expiryHighlight: boolean;
  clickToCopy: boolean;
  hideCodeUntilHover: boolean;
  autoBackup: boolean;
  backupKeep: number;
  passwordHint: string;
  theme: ThemeMode;
}

export type ThemeMode = "light" | "dark" | "system";

interface RawSettings {
  lock_enabled: boolean;
  lock_on_blur: boolean;
  auto_lock_seconds: number;
  auto_hide_after_copy: boolean;
  code_grouping: boolean;
  expiry_highlight: boolean;
  click_to_copy: boolean;
  hide_code_until_hover: boolean;
  auto_backup: boolean;
  backup_keep: number;
  password_hint: string;
  theme: string;
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
    hideCodeUntilHover: raw.hide_code_until_hover,
    autoBackup: raw.auto_backup,
    backupKeep: raw.backup_keep,
    passwordHint: raw.password_hint,
    theme: (raw.theme as ThemeMode) || "light",
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
    hide_code_until_hover: s.hideCodeUntilHover,
    auto_backup: s.autoBackup,
    backup_keep: s.backupKeep,
    password_hint: s.passwordHint,
    theme: s.theme,
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

export interface AccountInput {
  issuer: string;
  account: string;
  secret: string;
  otpType: string;
  algorithm: string;
  digits: number;
  period: number;
  counter: number;
  category: string;
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
  category: string;
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
    category: input.category,
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
    return mapSettings(await invoke<RawSettings>("get_settings"));
  },

  updateSettings(settings: AppSettings): Promise<void> {
    return invoke("update_settings", { settings: toRawSettings(settings) });
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
};
