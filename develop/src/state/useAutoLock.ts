import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useApp } from "../state/AppContext";

/**
 * 自动锁定：
 * - 窗口失去焦点时锁定（lockOnBlur 且已启用锁定）
 * - 无操作超过 autoLockSeconds 后锁定
 * - 复制后自动隐藏窗口由调用方通过 hideWindow 触发
 */
export function useAutoLock() {
  const { settings, hasLock, lockApp, phase } = useApp();

  useEffect(() => {
    if (phase !== "ready" || !hasLock || !settings) return;

    let timer: number | undefined;

    const resetTimer = () => {
      if (timer) window.clearTimeout(timer);
      if (!settings.lockEnabled) return;
      const seconds = settings.autoLockSeconds;
      if (!seconds || seconds >= 999999) return;
      timer = window.setTimeout(() => {
        lockApp();
      }, seconds * 1000);
    };

    resetTimer();

    const activityEvents = ["mousemove", "mousedown", "keydown", "touchstart", "scroll"];
    activityEvents.forEach((ev) => window.addEventListener(ev, resetTimer, { passive: true }));

    let unlistenBlur: (() => void) | undefined;
    getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => {
        if (!focused && settings.lockEnabled && settings.lockOnBlur) {
          lockApp();
        } else if (focused) {
          resetTimer();
        }
      })
      .then((fn) => {
        unlistenBlur = fn;
      })
      .catch(() => {});

    return () => {
      if (timer) window.clearTimeout(timer);
      activityEvents.forEach((ev) => window.removeEventListener(ev, resetTimer));
      unlistenBlur?.();
    };
  }, [phase, hasLock, settings, lockApp]);
}

/** 隐藏当前窗口（复制后自动隐藏使用） */
export async function hideWindow() {
  try {
    await getCurrentWindow().hide();
  } catch {
    // 非 Tauri 环境忽略
  }
}
