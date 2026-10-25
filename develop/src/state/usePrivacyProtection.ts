import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isDesktop, isMobile, isTauri } from "../lib/platform";
import { setSecureScreen } from "../lib/screenGuard";
import { api, type AppSettings } from "../lib/api";

/** 远程会话检测间隔：远程连接/断开会话不是高频事件，5 秒足够且开销可忽略 */
const REMOTE_CHECK_MS = 5000;

/**
 * 隐私保护（防「被看见」）。
 *
 * 三种独立模式，可多选：
 * 1. `hideOnScreenshot` —— 让窗口内容从系统捕获中剔除（Windows
 *    `WDA_EXCLUDEFROMCAPTURE` / macOS 内容保护 / Android `FLAG_SECURE`）。
 *    截屏与录屏走的是同一套捕获管线，故这一个开关同时覆盖两者。
 * 2. `hideOnRemote` —— 检测到远程桌面 / 远程协助会话时**直接隐藏窗口**，
 *    避免远端画面里出现验证码。仅桌面端：移动端没有远程会话概念，
 *    投屏场景已由 `FLAG_SECURE` 覆盖。
 * 3. `hideOnUnfocused` —— 窗口失去焦点时把验证码数字模糊掉（不锁定、
 *    不清空，只是视觉遮蔽），防止「人离开座位、屏幕还亮着」时被旁人扫一眼。
 *
 * 三者互相独立：任一项失败都不应影响其他项（尤其不能因为某个平台不支持
 * 就把整个保护关掉）。
 */
export function usePrivacyProtection(settings: AppSettings | null) {
  const screenshot = settings?.hideOnScreenshot ?? true;
  const remote = settings?.hideOnRemote ?? true;
  const unfocused = settings?.hideOnUnfocused ?? true;

  // ── 1. 截屏 / 录屏保护 ──
  useEffect(() => {
    if (!isTauri()) return;
    if (isMobile()) {
      // Android：FLAG_SECURE（JS 桥）
      // iOS：secure text field 图层（screen-guard 插件）
      void setSecureScreen(screenshot);
      return;
    }
    getCurrentWindow()
      .setContentProtected(screenshot)
      .catch(() => {
        // 平台不支持（如 Linux）时忽略
      });
  }, [screenshot]);

  // ── 2. 远程会话时隐藏窗口 ──
  useEffect(() => {
    if (!isDesktop() || !isTauri() || !remote) return;
    let alive = true;
    let hiddenByRemote = false;

    const check = async () => {
      let inRemote = false;
      try {
        inRemote = await api.isRemoteSession();
      } catch {
        return; // 查询失败：保持现状
      }
      if (!alive) return;
      const win = getCurrentWindow();
      if (inRemote && !hiddenByRemote) {
        hiddenByRemote = true;
        // 隐藏而非锁定：用户回来用托盘/快捷键唤起时会走正常锁定流程
        await win.hide().catch(() => {});
      } else if (!inRemote && hiddenByRemote) {
        hiddenByRemote = false;
        await win.show().catch(() => {});
        await win.setFocus().catch(() => {});
      }
    };

    void check();
    const timer = window.setInterval(() => void check(), REMOTE_CHECK_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [remote]);

  // ── 3. 失焦时遮挡验证码 ──
  useEffect(() => {
    if (!unfocused) {
      document.documentElement.removeAttribute("data-privacy-mask");
      return;
    }
    // 移动端没有「窗口失焦」概念，改用页面可见性（切后台即遮挡）
    if (isMobile() || !isTauri()) {
      const apply = () => {
        if (document.visibilityState === "visible") {
          document.documentElement.removeAttribute("data-privacy-mask");
        } else {
          document.documentElement.setAttribute("data-privacy-mask", "on");
        }
      };
      apply();
      document.addEventListener("visibilitychange", apply);
      return () => {
        document.removeEventListener("visibilitychange", apply);
        document.documentElement.removeAttribute("data-privacy-mask");
      };
    }

    const win = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    let disposed = false;
    const apply = (focused: boolean) => {
      if (focused) {
        document.documentElement.removeAttribute("data-privacy-mask");
      } else {
        document.documentElement.setAttribute("data-privacy-mask", "on");
      }
    };
    win
      .onFocusChanged(({ payload }) => apply(payload))
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => {});
    // 初始状态同步一次（避免启动后第一帧泄漏）
    win
      .isFocused()
      .then((focused) => {
        if (!disposed) apply(focused);
      })
      .catch(() => {});

    return () => {
      disposed = true;
      unlisten?.();
      document.documentElement.removeAttribute("data-privacy-mask");
    };
  }, [unfocused]);
}
