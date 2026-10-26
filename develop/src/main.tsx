import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import { isDesktop, isMobile, isTauri } from "./lib/platform";
import "./styles/tokens.css";
import "./styles/app.css";

// 平台标记：供 CSS 做桌面/移动端差异化布局
document.documentElement.setAttribute("data-platform", isMobile() ? "mobile" : "desktop");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

/**
 * 窗口以 visible:false 创建，避免 WebView 首帧前的原生黑底被看到。
 * 待静态启动画面（index.html 内联）与 React 首帧绘制完成后，再显示窗口，
 * 这样用户看到的第一帧即是主题正确的启动画面，全程无黑屏/白屏跳变。
 */
function revealWindow(): void {
  // 仅桌面端窗口以 visible:false 创建，移动端无此概念
  if (!isTauri() || !isDesktop()) return;
  getCurrentWindow().show().catch(() => {});
}

/**
 * 启动画面最短展示时长。
 *
 * 冷启动时 boot() 往往几十毫秒就完成，启动画面一闪而过，
 * 动画还没播完就被移除，观感上像「闪了一下」。
 * 这里保证至少展示 1.7 秒 = 动画 1.5 秒 + 200ms 缓冲，
 * 让开屏动画完整播完、稍作停留再进入首页，衔接更从容。
 *
 * 用户关闭开屏动画（data-splash="none"）时该时长归零：
 * 没有动画可播，再等 1.7 秒只会让启动显得迟钝。
 */
const SPLASH_MIN_MS = 1700;

/** 当前是否关闭了开屏动画（由 theme-boot.js 在首帧前写入） */
function splashDisabled(): boolean {
  return document.documentElement.getAttribute("data-splash") === "none";
}

/** 启动画面开始展示的时刻（模块加载即视为开始） */
const splashShownAt = performance.now();

/**
 * 移除 index.html 中的静态启动画面，并触发首页入场动画。
 * 由 App 在 boot() 完成后调用（见 App.tsx），确保首帧即为最终界面
 * （锁定页或主界面），避免「先闪主界面、数秒后才跳锁定页」的倒序观感。
 */
function dismissSplash(): void {
  const splash = document.getElementById("app-splash");
  const root = document.getElementById("root");
  if (!splash) {
    // 启动画面已被移除（重复调用）：只补一次入场动画
    root?.classList.add("is-entering");
    return;
  }

  // 关闭动画时没有任何过渡可播：直接移除，不留空画面占位
  if (splashDisabled()) {
    splash.remove();
    return;
  }

  // 启动画面退出与首页入场同时开始，形成交叉过渡
  splash.classList.add("is-hidden");
  root?.classList.add("is-entering");

  splash.addEventListener("transitionend", () => splash.remove(), { once: true });
  // 兜底：若过渡事件未触发（如减少动态效果），延时强制移除
  window.setTimeout(() => splash.remove(), 600);
  // 入场动画结束后移除类，避免影响后续布局（transform 会创建新的包含块）
  window.setTimeout(() => root?.classList.remove("is-entering"), 700);
}

// 暴露给 App：boot 完成后调用，一次性显窗并淡出启动画面
(window as unknown as { __revealApp?: () => void }).__revealApp = () => {
  revealWindow();
  // 双 rAF 等 React 完成锁定页/主界面首帧绘制，再淡出，衔接无闪烁
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      // 关闭动画时不做任何等待，立即进入界面
      if (splashDisabled()) {
        dismissSplash();
        return;
      }
      // 补足最短展示时长：动画播完再进入首页
      const elapsed = performance.now() - splashShownAt;
      const wait = Math.max(0, SPLASH_MIN_MS - elapsed);
      window.setTimeout(dismissSplash, wait);
    });
  });
};
