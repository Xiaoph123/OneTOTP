import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isDesktop, isTauri } from "../lib/platform";

/**
 * 截图保护（仅桌面端）：
 * - 开启时调用系统级内容保护（Windows / macOS 支持），使窗口内容在截屏、录屏中呈黑屏
 * - 关闭时解除保护
 *
 * 移动端防截屏需在原生层设置（Android FLAG_SECURE / iOS 无对应公开 API），
 * 当前移动端为空操作。
 */
export function useScreenshotProtection(enabled: boolean) {
  useEffect(() => {
    if (!isDesktop() || !isTauri()) return;
    const win = getCurrentWindow();
    win.setContentProtected(enabled).catch(() => {
      // 平台不支持时忽略（如 Linux）
    });
  }, [enabled]);
}
