export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

/** 缓存解析后主题的键名，供 index.html 启动脚本提前读取，避免首屏白闪/主题跳变 */
const THEME_CACHE_KEY = "onetotp.theme";

/** 解析实际生效主题：system 跟随操作系统 */
export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  if (mode === "system") {
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return mode;
}

/**
 * 将主题写入 <html data-theme>，驱动 CSS 变量切换。
 * 同时把「设置项本身」（light/dark/system）镜像到 localStorage，
 * 让 index.html 的启动脚本在 React 加载前就能还原用户选择的主题。
 */
export function applyTheme(mode: ThemeMode): ResolvedTheme {
  const resolved = resolveTheme(mode);
  document.documentElement.setAttribute("data-theme", resolved);
  try {
    localStorage.setItem(THEME_CACHE_KEY, mode);
  } catch {
    // 隐私模式等场景下写入失败可忽略，仅影响启动瞬间的主题还原
  }
  return resolved;
}
