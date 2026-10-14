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
 * 移除 index.html 中的静态启动画面。
 * 用双 rAF 等待 React 首帧（含同款 boot-screen）真正绘制后再淡出，
 * 两者视觉一致，因此衔接处不会闪烁。
 */
function dismissSplash(): void {
  const splash = document.getElementById("app-splash");
  if (!splash) return;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      splash.classList.add("is-hidden");
      splash.addEventListener("transitionend", () => splash.remove(), { once: true });
      // 兜底：若过渡事件未触发（如减少动态效果），延时强制移除
      window.setTimeout(() => splash.remove(), 400);
    });
  });
}

// 先等待 React 首帧绘制，再显窗并淡出启动画面，保证第一帧就是正确内容
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    revealWindow();
    dismissSplash();
  });
});
