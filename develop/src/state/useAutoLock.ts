import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useApp } from "../state/AppContext";
import { isDesktop, isTauri } from "../lib/platform";
import { isBiometricInFlight } from "../lib/biometric";

/**
 * 自动锁定：
 * - 桌面端：窗口失去焦点时锁定（lockOnBlur 且已启用锁定）
 * - 移动端：应用切到后台（页面不可见）时锁定
 * - 无操作超过 autoLockSeconds 后锁定（两端通用）
 * - 复制后自动隐藏窗口由调用方通过 hideWindow 触发
 *
 * 关键：系统生物识别对话框（Windows Hello / Touch ID）会抢占前台、
 * 使应用主窗口失焦。若不屏蔽，会在弹认证框的同时触发失焦锁定，形成
 * 「一解锁就重锁、反复弹框」的死循环。因此在认证进行中（及结束后极短的
 * 迟滞窗口内）跳过锁定判定。
 */
export function useAutoLock() {
  const { settings, hasLock, lockApp, phase } = useApp();

  useEffect(() => {
    if (phase !== "ready" || !hasLock || !settings) return;

    let timer: number | undefined;
    // 最近一次生物识别结束的时间戳：用于覆盖认证框关闭后残留的迟到失焦事件
    let bioEndedAt = 0;
    const BIO_COOLDOWN_MS = 1500;

    const resetTimer = () => {
      if (timer) window.clearTimeout(timer);
      if (!settings.lockEnabled) return;
      const seconds = settings.autoLockSeconds;
      // 999999 及以上表示「从不」：不设定时器
      if (seconds >= 999999) return;
      // 0 表示「立即」：用极短延时（1 秒）实现，既保留「几乎无等待」的语义，
      // 又避免每次鼠标移动/按键都同步触发锁定导致的不可用与抖动。
      const delayMs = seconds > 0 ? seconds * 1000 : 1000;
      timer = window.setTimeout(() => {
        lockApp();
      }, delayMs);
    };

    /** 系统认证进行中、或刚结束的迟滞期内，视为「非用户主动离开」 */
    const isSystemAuthOverlay = () => {
      if (isBiometricInFlight()) {
        bioEndedAt = Date.now();
        return true;
      }
      return Date.now() - bioEndedAt < BIO_COOLDOWN_MS;
    };

    resetTimer();

    const activityEvents = ["mousemove", "mousedown", "keydown", "touchstart", "scroll"];
    activityEvents.forEach((ev) => window.addEventListener(ev, resetTimer, { passive: true }));

    let cleanupPlatform: (() => void) | undefined;

    if (isDesktop()) {
      // 桌面端：窗口失焦锁定
      const win = getCurrentWindow();
      let unlistenBlur: (() => void) | undefined;
      win
        .onFocusChanged(({ payload: focused }) => {
          if (!focused && settings.lockEnabled && settings.lockOnBlur) {
            // 认证框导致的失焦不算「用户离开」，跳过
            if (isSystemAuthOverlay()) return;
            // 窗口被隐藏（最小化到托盘 / 复制后隐藏）时也会失焦，
            // 此时应用已不在用户眼前，不应锁定并弹出认证框。
            win
              .isVisible()
              .then((visible) => {
                if (visible) lockApp();
              })
              .catch(() => {
                lockApp();
              });
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
          if (isSystemAuthOverlay()) return;
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
