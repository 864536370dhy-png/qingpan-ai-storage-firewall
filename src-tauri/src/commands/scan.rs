use crate::{models::ScanResult, scanner::scan_system_blocking};

#[tauri::command]
pub async fn scan_system() -> Result<ScanResult, String> {
    tauri::async_runtime::spawn_blocking(scan_system_blocking)
        .await
        .map_err(|error| format!("扫描任务异常：{error}"))?
}
