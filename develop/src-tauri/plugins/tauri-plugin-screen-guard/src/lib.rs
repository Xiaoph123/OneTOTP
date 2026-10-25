//! iOS 截屏 / 录屏保护。
//!
//! 背景：Android 有 `FLAG_SECURE`，一行代码就能让截屏失败、录屏与多任务预览
//! 呈黑屏。iOS 没有等价的公开 API。
//!
//! 方案：给窗口叠一个 `isSecureTextEntry = true` 的 `UITextField` 作为覆盖层。
//! 系统认为这块区域是密码输入，会把它从**所有**系统捕获管线里剔除：
//! 截屏、录屏、AirPlay 投屏、后台多任务快照都会变成黑屏。
//!
//! 这是未公开行为，但从 iOS 7 一直稳定到 iOS 18，Proton、1Password、
//! 各类银行 App 都在用。唯一的副作用是无障碍读屏（VoiceOver）可能跳过
//! 该区域——对验证码类应用代价可接受。
//!
//! 本 crate 只在 iOS 目标上被引入（见 src-tauri/Cargo.toml），
//! Android 侧走 MainActivity 的 JS 桥（FLAG_SECURE），不需要这个插件。

#![cfg(target_os = "ios")]

use serde::Serialize;
use tauri::{
    plugin::{Builder, PluginHandle, TauriPlugin},
    Manager, Runtime,
};

tauri::ios_plugin_binding!(init_plugin_screen_guard);

/// Access to the screen guard APIs.
pub struct ScreenGuard<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> ScreenGuard<R> {
    /// 开启 / 关闭截屏保护。
    pub fn set_secure(&self, enabled: bool) -> tauri::Result<()> {
        self.0
            .run_mobile_plugin::<()>("setSecure", SetSecurePayload { enabled })
            .map_err(Into::into)
    }
}

#[derive(Serialize)]
struct SetSecurePayload {
    enabled: bool,
}

/// Extensions to [`tauri::App`], [`tauri::AppHandle`], etc. to access the screen guard APIs.
pub trait ScreenGuardExt<R: Runtime> {
    fn screen_guard(&self) -> &ScreenGuard<R>;
}

impl<R: Runtime, T: Manager<R>> ScreenGuardExt<R> for T {
    fn screen_guard(&self) -> &ScreenGuard<R> {
        self.state::<ScreenGuard<R>>().inner()
    }
}

/// Initializes the plugin.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("screen-guard")
        .setup(|app, api| {
            let handle = api.register_ios_plugin(init_plugin_screen_guard)?;
            app.manage(ScreenGuard(handle));
            Ok(())
        })
        .build()
}
