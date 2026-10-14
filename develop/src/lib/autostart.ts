import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { isDesktop } from "./platform";

/**
 * 开机自启（仅桌面端）。
 * 移动端无对等概念，直接返回未启用 / 空操作，避免调用不存在的插件。
 */

/** 查询当前是否已注册开机自启 */
export async function getAutostart(): Promise<boolean> {
  if (!isDesktop()) return false;
  try {
    return await isEnabled();
  } catch {
    return false;
  }
}

/** 开启或关闭开机自启 */
export async function setAutostart(enabled: boolean): Promise<void> {
  if (!isDesktop()) return;
  if (enabled) {
    await enable();
  } else {
    await disable();
  }
}
