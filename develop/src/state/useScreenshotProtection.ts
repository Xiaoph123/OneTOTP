import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * 截图保护：
 * - 开启时调用系统级内容保护（Windows / macOS 支持），使窗口内容在截屏、录屏中呈黑屏
 * - 关闭时解除保护
 *
 * 说明：这是操作系统提供的防截屏能力，非 Tauri 默认行为；
 * 在 Linux 等不支持的平台上调用会静默失败。
 */
export function useScreenshotProtection(enabled: boolean) {
  useEffect(() => {
    const win = getCurrentWindow();
    win.setContentProtected(enabled).catch(() => {
      // 平台不支持时忽略（如 Linux）
    });
  }, [enabled]);
}
