mod commands;
mod crypto;
mod models;
mod store;
mod totp;

use commands::AppState;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};
use tauri_plugin_autostart::MacosLauncher;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            // 使用应用数据目录持久化本地保险库
            let app_dir = app
                .path()
                .app_data_dir()
                .expect("无法解析应用数据目录");
            store::ensure_app_dir(&app_dir)?;
            app.manage(AppState::new(app_dir));

            // 系统托盘：显示主窗口 / 退出
            let show_item = MenuItem::with_id(app, "show", "显示 OneTotp", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;
            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("OneTotp")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    // 左键点击托盘图标：切换主窗口显隐
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(w) = app.get_webview_window("main") {
                            if w.is_visible().unwrap_or(false) {
                                let _ = w.hide();
                            } else {
                                let _ = w.show();
                                let _ = w.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // 关闭按钮行为：读取运行时设置决定退出还是隐藏到托盘
            if let WindowEvent::CloseRequested { api, .. } = event {
                let state = window.state::<AppState>();
                let behavior = state.close_behavior();
                if behavior == "tray" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_status,
            commands::initialize_vault,
            commands::unlock,
            commands::lock,
            commands::set_lock_password,
            commands::list_accounts,
            commands::get_codes,
            commands::get_account_detail,
            commands::add_account,
            commands::update_account,
            commands::parse_otpauth,
            commands::import_otpauth_text,
            commands::delete_account,
            commands::toggle_favorite,
            commands::mark_used,
            commands::get_settings,
            commands::update_settings,
            commands::export_vault,
            commands::import_vault,
            commands::list_backups,
        ])
        .run(tauri::generate_context!())
        .expect("运行 Tauri 应用失败");
}
