import type { FontScale } from "./api";
import { isMobile } from "./platform";

/**
 * 全局字号档位（相对系数）。
 * 通过给 <html> 设置 --font-scale 变量缩放所有字号 token，
 * 让用户可整体调节文字大小而不破坏比例。
 */
export const FONT_SCALES: Record<FontScale, number> = {
  small: 0.9375, // 小
  standard: 1, // 标准
  large: 1.125, // 大
  xlarge: 1.25, // 特大
};

/** 移动端基础放大系数：手机上"标准"档也比桌面更大，符合触屏阅读习惯 */
const MOBILE_BASE = 1.15;

/** 字号档位的本机缓存键（锁定态下设置尚未解密，需要靠它还原） */
const FONT_SCALE_CACHE_KEY = "onetotp.fontScale";

/** 应用字号档位：写入根元素 --font-scale，驱动 CSS 变量缩放 */
export function applyFontScale(scale: FontScale): void {
  const factor = FONT_SCALES[scale] ?? 1;
  const base = isMobile() ? MOBILE_BASE : 1;
  document.documentElement.style.setProperty("--font-scale", String(factor * base));
  document.documentElement.setAttribute("data-font-scale", scale);
  try {
    localStorage.setItem(FONT_SCALE_CACHE_KEY, scale);
  } catch {
    // 写入失败只影响锁定态下的还原
  }
}

/** 应用缓存中的字号档位（供锁屏页等「设置尚未解密」的场景使用） */
export function applyCachedFontScale(): void {
  let cached: FontScale = "standard";
  try {
    const v = localStorage.getItem(FONT_SCALE_CACHE_KEY);
    if (v === "small" || v === "standard" || v === "large" || v === "xlarge") cached = v;
  } catch {
    // 忽略：使用默认档位
  }
  applyFontScale(cached);
}
