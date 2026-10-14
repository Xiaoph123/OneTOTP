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

/** 三档共享的固定高度 */
export const WINDOW_HEIGHT = 720;

/** 应用尺寸档位：调整主窗口宽度（保持高度）。移动端为空操作。 */
export async function applyWindowSize(size: WindowSize): Promise<void> {
  if (!isDesktop() || !isTauri()) return;
  const width = WINDOW_WIDTHS[size];
  try {
    await getCurrentWindow().setSize(new LogicalSize(width, WINDOW_HEIGHT));
  } catch {
    // 平台或权限不支持时忽略
  }
}
