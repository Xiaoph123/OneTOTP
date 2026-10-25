/**
 * 截屏 / 录屏保护（移动端）。
 *
 * 两端机制不同，但对上层暴露同一个 `setSecureScreen(enabled)`：
 * - Android：`MainActivity` 注入的 `OneTotpNative` 桥，内部调 `FLAG_SECURE`。
 * - iOS：`screen-guard` 插件，用 secure text field 图层让系统捕获管线黑屏。
 *
 * 为什么不统一用插件：Android 的 `FLAG_SECURE` 需要 `Activity` 的
 * `window` 对象，Tauri 插件拿到的是 `WebView`，再取 `Activity` 反而更绕；
 * 现有 JS 桥已经在用且稳定，没必要迁移。
 *
 * 为什么 iOS 不也用 JS 桥：iOS 的 `WKWebView` 没有 `addJavascriptInterface`
 * 等价物（`WKScriptMessageHandler` 需要原生侧持有 handler 并注册消息名，
 * 走插件通道反而更规范，也能被 capabilities 权限约束）。
 */

import { invoke } from "@tauri-apps/api/core";
import { isIOS } from "./platform";

/** Android 原生桥：由 MainActivity 通过 addJavascriptInterface 注入 */
interface AndroidNativeBridge {
  setSecure(enabled: boolean): void;
}

/** iOS 插件命令名 */
const IOS_PLUGIN = "screen-guard";

function androidBridge(): AndroidNativeBridge | null {
  const bridge = (window as unknown as { OneTotpNative?: AndroidNativeBridge }).OneTotpNative;
  return bridge && typeof bridge.setSecure === "function" ? bridge : null;
}

/**
 * 开启 / 关闭截屏保护。
 *
 * 失败不抛出：这是「尽力而为」的保护，调用方（隐私设置 effect）
 * 不应因为它失败而中断其它保护项。
 */
export async function setSecureScreen(enabled: boolean): Promise<void> {
  if (isIOS()) {
    try {
      await invoke(`plugin:${IOS_PLUGIN}|set_secure`, { enabled });
    } catch {
      // 插件不可用（旧包 / 非 Tauri 环境 / 权限未授予）时静默忽略
    }
    return;
  }
  androidBridge()?.setSecure(enabled);
}
