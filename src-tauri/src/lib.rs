mod commands;
mod models;
mod rules;
mod scanner;

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::scan::scan_system,
            commands::keyring::save_api_key,
            commands::keyring::api_key_status,
            commands::keyring::delete_api_key,
            commands::ai::analyze_scan,
            commands::ai::analyze_cleanup_candidates,
            commands::cleanup::scan_app_candidates,
            commands::cleanup::quarantine_items,
            commands::cleanup::list_quarantine_items,
            commands::cleanup::restore_quarantine_item,
            commands::cleanup::permanently_delete_quarantine_item,
            commands::traditional::scan_large_files,
            commands::traditional::scan_duplicate_files,
            commands::traditional::scan_caches,
            commands::traditional::quarantine_traditional_items,
            commands::traditional::uninstall_application,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Qingpan desktop");
}
