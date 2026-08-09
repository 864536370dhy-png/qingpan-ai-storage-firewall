mod applications;
mod disk;
mod filesystem;

pub use applications::scan_all_applications;
pub use disk::{disk_space, os_version};
pub(crate) use filesystem::path_stats;

use crate::models::{ScanResult, SupportLevel};
use std::{
    path::Path,
    time::{Instant, SystemTime},
};

pub fn scan_system_blocking() -> Result<ScanResult, String> {
    let started = Instant::now();
    let home = std::env::var_os("HOME")
        .map(std::path::PathBuf::from)
        .ok_or_else(|| "无法读取当前用户目录".to_string())?;
    let (disk_total_bytes, disk_available_bytes) = disk_space(Path::new("/"))?;
    let (mut apps, discovery_permission_errors) = scan_all_applications(&home);
    apps.sort_by(|left, right| {
        right
            .total_size_bytes
            .cmp(&left.total_size_bytes)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });

    let application_bundles_bytes = apps.iter().map(|app| app.app_size_bytes).sum();
    let related_data_bytes = apps.iter().map(|app| app.related_data_size_bytes).sum();
    let recognized_apps_bytes = apps.iter().map(|app| app.total_size_bytes).sum();
    let modified_24h_bytes = apps.iter().map(|app| app.modified_24h_bytes).sum();
    let reclaimable_bytes = apps.iter().map(|app| app.reclaimable_bytes).sum();
    let permission_errors = apps
        .iter()
        .map(|app| app.permission_errors)
        .sum::<u64>()
        .saturating_add(discovery_permission_errors);
    let deep_supported_apps = apps
        .iter()
        .filter(|app| app.support_level == SupportLevel::Deep)
        .count();

    Ok(ScanResult {
        scanned_at: format!("{:?}", SystemTime::now()),
        device_name: hostname::get()
            .ok()
            .and_then(|value| value.into_string().ok())
            .unwrap_or_else(|| "Mac".to_string()),
        os_version: os_version(),
        disk_total_bytes,
        disk_available_bytes,
        disk_used_bytes: disk_total_bytes.saturating_sub(disk_available_bytes),
        application_bundles_bytes,
        related_data_bytes,
        recognized_apps_bytes,
        modified_24h_bytes,
        reclaimable_bytes,
        deep_supported_apps,
        apps,
        permission_errors,
        duration_ms: started.elapsed().as_millis(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "scans the current Mac and is run explicitly during release validation"]
    fn real_machine_scan_returns_disk_and_all_applications() {
        let scan = scan_system_blocking().expect("real machine scan");
        assert!(scan.disk_total_bytes > 0);
        assert!(scan.disk_total_bytes >= scan.disk_available_bytes);
        assert_eq!(
            scan.recognized_apps_bytes,
            scan.application_bundles_bytes + scan.related_data_bytes
        );
        assert!(scan
            .apps
            .windows(2)
            .all(|items| items[0].total_size_bytes >= items[1].total_size_bytes));
    }
}
