import {
  register,
  unregister,
} from "@tauri-apps/plugin-global-shortcut";
import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * 注册全局快捷键用于唤起/隐藏主窗口。
 * - shortcut 为空表示清除快捷键
 * - 注册前先注销旧快捷键，避免冲突
 * - 返回实际生效的快捷键字符串（失败时为空）
 */
export async function applyToggleShortcut(shortcut: string): Promise<string> {
  const prev = getRegisteredToggleShortcut();
  if (prev) {
    try {
      await unregister(prev);
    } catch {
      // 忽略注销失败
    }
    setRegisteredToggleShortcut("");
  }
  if (!shortcut) return "";

  try {
    await register(shortcut, async (event) => {
      if (event.state !== "Pressed") return;
      const win = getCurrentWindow();
      if (await win.isVisible()) {
        await win.hide();
      } else {
        await win.show();
        await win.setFocus();
      }
    });
    setRegisteredToggleShortcut(shortcut);
    return shortcut;
  } catch {
    return "";
  }
}

/** 当前进程已注册的快捷键（内存记录，用于切换时注销） */
let currentShortcut = "";
export function getRegisteredToggleShortcut(): string {
  return currentShortcut;
}
export function setRegisteredToggleShortcut(value: string) {
  currentShortcut = value;
}

/**
 * 在应用启动时应用已保存的快捷键
 */
export async function initToggleShortcut(shortcut: string): Promise<void> {
  const applied = await applyToggleShortcut(shortcut);
  setRegisteredToggleShortcut(applied);
}
