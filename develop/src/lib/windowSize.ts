import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import type { WindowSize } from "./api";
import { isDesktop, isTauri } from "./platform";

/**
 * 窗口尺寸档位对应的宽度（高度保持不变）。
 * 仅桌面端窗口可调整；移动端全屏运行，不应用尺寸。
 * - compact  紧凑：最小可用宽度
 * - standard 标准：默认宽度
 * - expanded 扩展：更宽，便于长名称/多列查看
 */
export const WINDOW_WIDTHS: Record<WindowSize, number> = {
  compact: 320,
  standard: 400,
  expanded: 480,
};

/** 默认高度（首次/无法读取当前高度时的回退值） */
export const WINDOW_HEIGHT = 720;

/**
 * 应用尺寸档位：调整主窗口宽度，**保持用户当前高度**。
 * 原实现固定用 WINDOW_HEIGHT，会把用户手动拖高的窗口强制拉回默认值。
 */
export async function applyWindowSize(size: WindowSize): Promise<void> {
  if (!isDesktop() || !isTauri()) return;
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
