mod commands;
mod crypto;
mod models;
mod store;
mod totp;

use commands::AppState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_clipboard_manager::init());

    // 桌面专属插件：单实例、开机自启、全局快捷键
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            use tauri::Emitter;
            // 检测到重复启动：唤起已有窗口并提示（同时校正锁定界面）
            show_main_window(app);
            let _ = app.emit("single-instance", ());
        }))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build());

    // 生物识别解锁插件：Windows Hello / macOS Touch ID。
    // 移动端（Android / iOS）同样支持，Linux 无统一生物识别接口故不注册。
    #[cfg(any(target_os = "windows", target_os = "macos", target_os = "android", target_os = "ios"))]
    let builder = builder.plugin(tauri_plugin_biometry::init());

    // 原生扫码插件（仅移动端）：用系统原生相机解码，绕开 WebView 的
    // getUserMedia 视频管线（部分 Android 设备该管线出帧帧率极低导致卡顿）。
    // Android 为 vendored fork（CameraX + ZXing，零 GMS 依赖，完全离线），
    // 包名与官方一致以复用既有权限标识与前端 JS 绑定。
    #[cfg(any(target_os = "android", target_os = "ios"))]
    let builder = builder.plugin(tauri_plugin_barcode_scanner::init());

    // iOS 截屏 / 录屏保护：系统没有 Android FLAG_SECURE 的等价 API，
    // 用 secure text field 图层让截屏 / 录屏 / 投屏 / 多任务快照全部黑屏。
    #[cfg(target_os = "ios")]
    let builder = builder.plugin(tauri_plugin_screen_guard::init());

    builder
        .setup(|app| {
            // 系统默认应用目录：数据目录指针文件固定放在这里
            let default_dir = app
                .path()
                .app_data_dir()
                .expect("无法解析应用数据目录");
            store::ensure_app_dir(&default_dir)?;
            // 若用户自定义过数据目录，则实际读写都指向该目录
            let app_dir = store::read_data_dir_pointer(&default_dir).unwrap_or_else(|| default_dir.clone());
            store::ensure_app_dir(&app_dir)?;
            app.manage(AppState::new(app_dir, default_dir));

            #[cfg(desktop)]
            setup_tray(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            // 关闭按钮行为：读取运行时设置决定退出还是隐藏到托盘
            #[cfg(desktop)]
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                use tauri::Emitter;
                let state = window.state::<AppState>();
                // 关闭到托盘时同步锁定内存中的密钥与载荷（详见 prepare_close）。
                if state.prepare_close() {
                    api.prevent_close();
                    let _ = window.hide();
                    // 主动通知前端切到锁定页。
                    // 不能只靠前端的「失焦」或「取码失败」去推断：窗口是原生侧
                    // 隐藏的，隐藏期间 WebView 可能被降频，恢复时事件顺序不可靠。
                    // 事件会排队，窗口再次显示时送达。
                    let _ = window.app_handle().emit("onetotp://locked", ());
                }
            }
            #[cfg(not(desktop))]
            let _ = (window, event);
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_status,
            commands::initialize_vault,
            commands::unlock,
            commands::lock,
            commands::set_lock_password,
            commands::rotate_vault_key,
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
            commands::list_categories,
            commands::add_category,
            commands::update_category,
            commands::delete_category,
            commands::reorder_categories,
            commands::set_account_category,
            commands::get_settings,
            commands::update_settings,
            commands::export_vault,
            commands::write_backup_file,
            commands::read_backup_file,
            commands::import_vault,
            commands::list_backups,
            commands::is_remote_session,
            commands::trace_event,
            commands::get_storage_usage,
            commands::clear_backups,
            commands::get_data_dir,
            commands::set_data_dir,
            commands::reset_data_dir,
        ])
        .run(tauri::generate_context!())
        .expect("运行 Tauri 应用失败");
}

/// 显示主窗口，并通知前端按后端实际锁定状态校正界面。
///
/// 窗口被 `hide()` 隐藏后再 `show()` **不会产生前端的焦点变化事件**（Tauri 视角里
/// 它从未失去焦点），所以前端无法据此发现自己应该回到锁屏页。
/// 这里统一在「显示窗口」的每条入口上补发一次通知。
#[cfg(desktop)]
fn show_main_window(app: &tauri::AppHandle) {
    use tauri::Emitter;
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
        // 前端收到后调用 get_status()，未锁定时不做任何事
        let _ = app.emit("onetotp://locked", ());
    }
}

/// 桌面端系统托盘：显示主窗口 / 退出
#[cfg(desktop)]
fn setup_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::{
        menu::{Menu, MenuItem},
        tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
        Emitter,
    };

    let show_item = MenuItem::with_id(app, "show", "显示 OneTOTP", true, None::<&str>)?;
    let settings_item = MenuItem::with_id(app, "settings", "设置", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_item, &settings_item, &quit_item])?;
    TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("OneTOTP")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main_window(app),
            "settings" => {
                // 先显示窗口，再通知前端跳转到设置页。
                // 顺序不能反：窗口隐藏时前端可能被降频，事件会排队，
                // 但先 show 能保证用户立刻看到窗口，不会以为点击无效。
                show_main_window(app);
                let _ = app.emit("onetotp://navigate", "settings");
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
                        show_main_window(app);
                    }
                }
            }
        })
        .build(app)?;
    Ok(())
}
