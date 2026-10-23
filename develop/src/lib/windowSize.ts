import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import type { WindowSize } from "./api";
import { isDesktop, isTauri } from "./platform";

/**
 * 窗口尺寸档位对应的宽度（高度保持不变）。
 * 仅桌面端窗口可调整；移动端全屏运行，不应用尺寸。
 * - compact  紧凑：最小可用宽度
 * - standard 标准：默认宽度
 * - expanded 扩展：更宽，便于长名称/多列查看
 *
 * 三档间距统一 40px。此前是 320 / 400 / 480，标准档在 1080p 屏幕上
 * 显得过宽（内容区大量留白），整体收窄后更紧凑。
 */
export const WINDOW_WIDTHS: Record<WindowSize, number> = {
  compact: 290,
  standard: 330,
  expanded: 370,
};

/** 默认高度（首次/无法读取当前高度时的回退值） */
export const WINDOW_HEIGHT = 720;

/** 尺寸档位的本机缓存键（与 theme.ts 同一思路：锁定态下也能还原窗口尺寸） */
const WINDOW_SIZE_CACHE_KEY = "onetotp.windowSize";

/**
 * 读取缓存的尺寸档位。
 *
 * 为什么需要缓存：窗口尺寸属于保险库里的设置，**锁定状态下读不到**
 * （解密需要口令），于是锁屏页会一直用默认宽度，用户会觉得
 * 「锁屏页大小不跟随窗口尺寸设置」。尺寸不是敏感信息，镜像到 localStorage
 * 即可在解锁前就应用。
 */
export function readCachedWindowSize(): WindowSize {
  try {
    const v = localStorage.getItem(WINDOW_SIZE_CACHE_KEY);
    if (v === "compact" || v === "standard" || v === "expanded") return v;
  } catch {
    // localStorage 不可用（隐私模式等）时回退默认值
  }
  return "standard";
}

/**
 * 应用尺寸档位：调整主窗口宽度，**保持用户当前高度**。
 * 原实现固定用 WINDOW_HEIGHT，会把用户手动拖高的窗口强制拉回默认值。
 */
export async function applyWindowSize(size: WindowSize): Promise<void> {
  if (!isDesktop() || !isTauri()) return;
  try {
    localStorage.setItem(WINDOW_SIZE_CACHE_KEY, size);
  } catch {
    // 写入失败只影响锁定态下的还原，可忽略
  }
  const width = WINDOW_WIDTHS[size];
  try {
    const win = getCurrentWindow();
    // 读取当前实际高度，只有在读取失败时才回退到默认高度
    let height = WINDOW_HEIGHT;
    try {
      const factor = await win.scaleFactor();
      const inner = await win.innerSize();
      const logical = inner.toLogical(factor);
      if (logical.height > 0) height = Math.round(logical.height);
    } catch {
      // 读取失败：使用默认高度
    }
    await win.setSize(new LogicalSize(width, height));
  } catch {
    // 平台或权限不支持时忽略
  }
}

/** 应用缓存中的尺寸档位（供锁屏页等「设置尚未解密」的场景使用） */
export async function applyCachedWindowSize(): Promise<void> {
  await applyWindowSize(readCachedWindowSize());
}
