mod chirp;
#[cfg(target_os = "macos")]
mod macos_microphone;
mod microphone_permission;
mod source_file;
mod switchboard;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .plugin(microphone_permission::init())
        .plugin(source_file::init())
        .invoke_handler(tauri::generate_handler![
            microphone_permission::android_request_microphone_permission,
            microphone_permission::microphone_permission_state,
            chirp::transcribe_with_chirp,
            source_file::android_select_source_file,
            source_file::android_read_source_file,
            source_file::android_write_source_file,
            switchboard::submit_switchboard_intent,
            switchboard::fetch_switchboard_tasks,
        ]);

    #[cfg(desktop)]
    let builder = if option_env!("BRANCH_CONTINUE_ENABLE_DESKTOP_UPDATER") == Some("1") {
        builder.plugin(tauri_plugin_updater::Builder::new().build())
    } else {
        builder
    };

    builder
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Take the microphone grant at the app level so the system prompt lands at
            // launch instead of interrupting the user's first recording. Deferred onto
            // the event loop because setup runs before it starts.
            #[cfg(target_os = "macos")]
            app.handle()
                .run_on_main_thread(macos_microphone::request_access_if_undetermined)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
