import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useApp } from "../state/AppContext";
import { isDesktop, isTauri } from "../lib/platform";

/**
 * 自动锁定：
 * - 桌面端：窗口失去焦点时锁定（lockOnBlur 且已启用锁定）
 * - 移动端：应用切到后台（页面不可见）时锁定
 * - 无操作超过 autoLockSeconds 后锁定（两端通用）
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

    let cleanupPlatform: (() => void) | undefined;

    if (isDesktop()) {
      // 桌面端：窗口失焦锁定
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
      cleanupPlatform = () => unlistenBlur?.();
    } else {
      // 移动端：应用切到后台时锁定
      const onVisibility = () => {
        if (document.visibilityState === "hidden" && settings.lockEnabled && settings.lockOnBlur) {
          lockApp();
        } else if (document.visibilityState === "visible") {
          resetTimer();
        }
      };
      document.addEventListener("visibilitychange", onVisibility);
      cleanupPlatform = () => document.removeEventListener("visibilitychange", onVisibility);
    }

    return () => {
      if (timer) window.clearTimeout(timer);
      activityEvents.forEach((ev) => window.removeEventListener(ev, resetTimer));
      cleanupPlatform?.();
    };
  }, [phase, hasLock, settings, lockApp]);
}

/** 隐藏当前窗口（复制后自动隐藏使用，仅桌面端有窗口概念） */
export async function hideWindow() {
  if (!isDesktop() || !isTauri()) return;
  try {
    await getCurrentWindow().hide();
  } catch {
    // 非 Tauri 环境或平台不支持时忽略
  }
}
