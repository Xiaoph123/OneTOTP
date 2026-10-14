/** 按设置把 6~8 位验证码拆分为分组展示 */
export function formatCode(code: string, grouping: boolean): string {
  if (!grouping) return code;
  if (code.length === 6) return `${code.slice(0, 3)} ${code.slice(3)}`;
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

export function formatDateTime(ms: number): string {
  if (!ms) return "—";
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

export function relativeTime(ms: number): string {
  if (!ms) return "从未使用";
  const diff = Date.now() - ms;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour} 小时前`;
  const day = Math.floor(hour / 24);
  if (day < 30) return `${day} 天前`;
  return formatDateTime(ms);
}

/** 生成脱敏的账户标识 */
export function maskAccount(account: string): string {
  if (!account) return "";
  const at = account.indexOf("@");
  if (at <= 1) return account;
  return `${account.slice(0, 1)}***${account.slice(at)}`;
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
