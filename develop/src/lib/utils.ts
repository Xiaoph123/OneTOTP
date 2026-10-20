/** 按设置把 6~8 位验证码拆分为分组展示：6 位为 3+3，8 位为 4+4 */
export function formatCode(code: string, grouping: boolean): string {
  if (!grouping) return code;
  if (code.length === 6) return `${code.slice(0, 3)} ${code.slice(3)}`;
  if (code.length === 8) return `${code.slice(0, 4)} ${code.slice(4)}`;
  return code;
}

/** 支持 Tauri 环境使用系统剪贴板，回退到浏览器剪贴板 */
export async function copyText(text: string): Promise<void> {
  try {
    const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
    await writeText(text);
    return;
  } catch {
    // Tauri 插件不可用时回退到浏览器剪贴板
  }
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  // 两种方式都不可用：抛出错误，由调用方提示失败（不能静默成功）
  throw new Error("剪贴板不可用");
}

/** 清空系统剪贴板（解锁连续失败等安全场景使用） */
export async function clearClipboard(): Promise<void> {
  try {
    await copyText("");
  } catch {
    // 清理失败不应阻断解锁失败流程
  }
}

/**
 * 解析「重复账户」错误。
 * 后端在检测到密钥已存在时，返回 `duplicate:{issuer}|{account}` 格式的错误串。
 * 命中则返回已存在的账户信息，供 UI 给出明确提示；否则返回 null。
 */
export function parseDuplicateError(e: unknown): { issuer: string; account: string } | null {
  const raw = typeof e === "string" ? e : e instanceof Error ? e.message : String(e ?? "");
  const marker = "duplicate:";
  const idx = raw.indexOf(marker);
  if (idx < 0) return null;
  const payload = raw.slice(idx + marker.length);
  const sep = payload.indexOf("|");
  if (sep < 0) return { issuer: payload.trim(), account: "" };
  return { issuer: payload.slice(0, sep).trim(), account: payload.slice(sep + 1).trim() };
}

/**
 * 「失败清除剪贴板」开关的本地镜像：
 * 锁定状态下保险库未解密、读不到设置，解锁页只能依赖此镜像判断是否执行清空。
 */
const CLEAR_ON_FAIL_KEY = "onetotp.clearClipboardOnFail";

export function cacheClearClipboardOnFail(value: boolean): void {
  try {
    localStorage.setItem(CLEAR_ON_FAIL_KEY, value ? "1" : "0");
  } catch {
    // 本地存储不可用时忽略，仅在解锁页降级为默认开启
  }
}

export function readClearClipboardOnFail(): boolean {
  try {
    return localStorage.getItem(CLEAR_ON_FAIL_KEY) !== "0";
  } catch {
    return true;
  }
}

export function formatDateTime(ms: number): string {
  if (!ms) return "—";
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

type Translate = (key: string, params?: Record<string, string | number>) => string;

export function relativeTime(ms: number, t: Translate): string {
  if (!ms) return t("从未使用");
  const diff = Date.now() - ms;
  const min = Math.floor(diff / 60000);
  if (min < 1) return t("刚刚");
  if (min < 60) return t("{n} 分钟前", { n: min });
  const hour = Math.floor(min / 60);
  if (hour < 24) return t("{n} 小时前", { n: hour });
  const day = Math.floor(hour / 24);
  if (day < 30) return t("{n} 天前", { n: day });
  return formatDateTime(ms);
}

/** 生成脱敏的账户标识 */
export function maskAccount(account: string): string {
  if (!account) return "";
  const at = account.indexOf("@");
  if (at <= 1) return account;
  return `${account.slice(0, 1)}***${account.slice(at)}`;
}

/**
 * 由服务名生成稳定的头像文字与配色档位。
 * 返回 `tone`（0~5）而非具体颜色，由 CSS 的 `.avatar-tone-N` 类着色，
 * 避免在 JSX 里写内联样式（便于 CSP 收紧）。
 */
export function avatarOf(issuer: string): { text: string; tone: number } {
  const name = issuer.trim();
  // 中文等宽字符取 1 个字更协调；拉丁字母取 2 个更易识别
  const isWide = /[\u3400-\u9FFF\uF900-\uFAFF]/.test(name.slice(0, 1));
  const text = name ? (isWide ? name.slice(0, 1) : name.slice(0, 2).toUpperCase()) : "OT";
  let hash = 0;
  for (let i = 0; i < issuer.length; i += 1) hash = (hash * 31 + issuer.charCodeAt(i)) >>> 0;
  return { text, tone: hash % 6 };
}

/** 把 #RRGGBB / #RGB 十六进制色转为 "r, g, b" 三元组，
 * 便于在 CSS 中用 rgba(var(--x), 0.1) 拼出低透明度色。
 * 非法输入返回 null，由调用方决定回退。
 */
export function hexToRgbTriplet(hex: string): string | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = Number.parseInt(h, 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
