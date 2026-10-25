/**
 * 运行平台判定。
 *
 * 说明：应用同时面向桌面（Windows / macOS / Linux）与移动端（Android / iOS）。
 * Tauri 在移动端的 WebView UserAgent 会包含 "Android" / "iPhone" / "iPad" 等标识，
 * 因此在 WebView 内用 UA 判定即可区分，无需额外插件。
 */

/** 是否运行在移动端（Android / iOS） */
export function isMobile(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent.toLowerCase();
  if (/android|iphone|ipad|ipod/.test(ua)) return true;
  // iPadOS 13+ 桌面模式 UA 与 macOS 相同，用触控点数区分
  return /macintosh/.test(ua) && typeof navigator.maxTouchPoints === "number" && navigator.maxTouchPoints > 1;
}

/** 是否运行在桌面端 */
export function isDesktop(): boolean {
  return !isMobile();
}

/**
 * 是否运行在 iOS / iPadOS。
 *
 * 单独判定的原因：两端移动平台部分能力差异较大
 * （截屏保护机制、切后台是否被允许），需要按平台分支。
 * iPadOS 13+ 的桌面模式 UA 与 macOS 相同，用触控点数区分。
 */
export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  if (/iPhone|iPod/i.test(ua)) return true;
  return /iPad/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
}

/** 是否运行在 Tauri 容器内（含桌面与移动） */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
