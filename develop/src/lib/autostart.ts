import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";

/** 查询当前是否已注册开机自启 */
export async function getAutostart(): Promise<boolean> {
  try {
    return await isEnabled();
  } catch {
    return false;
  }
}

/** 开启或关闭开机自启 */
export async function setAutostart(enabled: boolean): Promise<void> {
  if (enabled) {
    await enable();
  } else {
    await disable();
  }
}
