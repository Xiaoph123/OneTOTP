mod commands;
mod crypto;
mod models;
mod store;
mod totp;

use commands::AppState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            // 使用应用数据目录持久化本地保险库
            let app_dir = app
                .path()
                .app_data_dir()
                .expect("无法解析应用数据目录");
            store::ensure_app_dir(&app_dir)?;
            app.manage(AppState::new(app_dir));
            Ok(())
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
