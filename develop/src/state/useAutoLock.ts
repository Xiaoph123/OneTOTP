import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useApp } from "../state/AppContext";
import { isDesktop, isTauri } from "../lib/platform";
import {
  clearHiddenByApp,
  isLockSuppressed,
  markHiddenByApp,
  wasHiddenByApp,
} from "../lib/lockGuard";
import {
  onBlurConfirmed,
  onFocusChange,
  onIdleTick,
  resolveIdlePolicy,
} from "../lib/lockDecision";

/**
 * 空闲计时器的采样周期。
 * 用固定间隔比较「距上次活动的时间」而不是链式 setTimeout：
 * 后者每触发一次都要重新排期，抑制期内极易变成「每秒重排一次」的死循环。
 */
const IDLE_TICK_MS = 500;

/** 窗口失焦后延迟确认时长：用于过滤系统弹窗造成的瞬时失焦 */
const BLUR_CONFIRM_MS = 600;

/**
 * 自动锁定：
 * - 桌面端：窗口失去焦点时锁定（lockOnBlur 且已启用锁定）
 * - 移动端：应用切到后台（页面不可见）时锁定
 * - 空闲超过 autoLockSeconds 后锁定（两端通用）
 *
 * 判定逻辑本身在 `lib/lockDecision.ts`（纯函数、有单测）；本文件只负责
 * 把 Tauri / DOM 的事件接上去并执行副作用。
 *
 * `autoLockSeconds` 语义见 `resolveIdlePolicy`：
 * - `<= 0`      → 不做空闲计时，只在失焦 / 切后台时锁定
 * - `>= 999999` → 从不因空闲锁定
 * - 其他正数     → 空闲达到该秒数后锁定
 */
export function useAutoLock() {
  const { settings, hasLock, lockApp, phase, syncLockedState } = useApp();

  useEffect(() => {
    if (phase !== "ready" || !hasLock || !settings) return;

    const policy = resolveIdlePolicy(settings.autoLockSeconds, settings.lockEnabled);
    let lastActivityAt = Date.now();
    const markActivity = () => {
      lastActivityAt = Date.now();
    };

    const tryLock = () => {
      void lockApp();
    };

    // ── 空闲计时 ──
    let idleTimer: number | undefined;
    const activityEvents = ["mousemove", "mousedown", "keydown", "touchstart", "scroll"];
    if (policy.kind === "idle") {
      idleTimer = window.setInterval(() => {
        const action = onIdleTick({
          policy,
          idleMs: Date.now() - lastActivityAt,
          suppressed: isLockSuppressed(),
        });
        if (action === "lock") {
          tryLock();
        } else if (action === "reset") {
          markActivity();
        }
      }, IDLE_TICK_MS);
      activityEvents.forEach((ev) => window.addEventListener(ev, markActivity, { passive: true }));
    }

    let cleanupPlatform: (() => void) | undefined;

    if (isDesktop()) {
      const win = getCurrentWindow();
      let unlistenFocus: (() => void) | undefined;
      let blurCheckTimer: number | undefined;

      /** 上一次已知的焦点状态；null = 尚未确定（isFocused() 未返回） */
      let lastFocused: boolean | null = null;

      const cancelBlurCheck = () => {
        if (blurCheckTimer !== undefined) {
          window.clearTimeout(blurCheckTimer);
          blurCheckTimer = undefined;
        }
      };

      win
        .isFocused()
        .then((focused) => {
          lastFocused = focused;
        })
        .catch(() => {
          // 查询失败：保守地视为有焦点，等待第一次真实事件来校正
          lastFocused = true;
        });

      win
        .onFocusChanged(({ payload: focused }) => {
          const action = onFocusChange({
            wasFocused: lastFocused,
            nowFocused: focused,
            lockEnabled: settings.lockEnabled,
            lockOnBlur: settings.lockOnBlur,
            suppressed: isLockSuppressed(),
          });
          lastFocused = focused;

          if (action === "activity") {
            cancelBlurCheck();
            // 窗口重新获得焦点：上一次「本应用隐藏」的上下文已结束
            clearHiddenByApp();
            markActivity();
            // 窗口重新显示时，后端可能已被原生侧锁定（「关闭到托盘」会直接
            // 锁定契约），这里对齐界面状态，避免停留在明文验证码页。
            void syncLockedState();
            return;
          }
          if (action === "ignore") return;

          // 延迟确认：系统弹窗（Hello、输入法、通知中心等）会造成短暂失焦，
          // 关闭后窗口会重新获得焦点。只有失焦持续存在才视为用户真的离开。
          cancelBlurCheck();
          blurCheckTimer = window.setTimeout(() => {
            blurCheckTimer = undefined;
            win
              .isFocused()
              .then((focusedNow) => {
                const shouldLock = onBlurConfirmed({
                  nowFocused: focusedNow,
                  // 只有「本应用自己隐藏」（复制后自动隐藏）才放过；
                  // 用户最小化 / 关闭到托盘导致的不可见应当锁定。
                  hiddenByApp: wasHiddenByApp(),
                  stillBlurred: lastFocused === false,
                  suppressed: isLockSuppressed(),
                });
                if (shouldLock) tryLock();
              })
              .catch(() => {});
          }, BLUR_CONFIRM_MS);
        })
        .then((fn) => {
          unlistenFocus = fn;
        })
        .catch(() => {});

      cleanupPlatform = () => {
        cancelBlurCheck();
        unlistenFocus?.();
      };
    } else {
      // 移动端：应用切到后台时锁定。
      // BiometricPrompt 以独立 Activity 呈现，弹出时本应用会变为不可见，
      // 故同样需跳过认证窗口与解锁后的抑制期。
      const onVisibility = () => {
        if (document.visibilityState === "hidden") {
          if (!settings.lockEnabled || !settings.lockOnBlur) return;
          if (isLockSuppressed()) return;
          tryLock();
        } else {
          markActivity();
        }
      };
      document.addEventListener("visibilitychange", onVisibility);
      cleanupPlatform = () => document.removeEventListener("visibilitychange", onVisibility);
    }

    return () => {
      if (idleTimer !== undefined) window.clearInterval(idleTimer);
      if (policy.kind === "idle") {
        activityEvents.forEach((ev) => window.removeEventListener(ev, markActivity));
      }
      cleanupPlatform?.();
    };
  }, [phase, hasLock, settings, lockApp, syncLockedState]);
}

/** 隐藏当前窗口（复制后自动隐藏使用，仅桌面端有窗口概念） */
export async function hideWindow() {
  if (!isDesktop() || !isTauri()) return;
  try {
    // 打个标记：这次隐藏是「复制后自动隐藏」的正常流程，
    // 不应被自动锁定当成「用户离开」而立刻弹锁屏。
    markHiddenByApp();
    await getCurrentWindow().hide();
  } catch {
    // 非 Tauri 环境或平台不支持时忽略
  }
}
