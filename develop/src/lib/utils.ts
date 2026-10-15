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
  } catch {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    }
  }
}

/** 清空系统剪贴板（解锁连续失败等安全场景使用） */
export async function clearClipboard(): Promise<void> {
  await copyText("");
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
 * 把 #RRGGBB / #RGB 十六进制色转为 "r, g, b" 三元组，
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
