use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SupportLevel {
    Basic,
    Generic,
    Deep,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RiskLevel {
    Safe,
    Review,
    Protected,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApplicationCategory {
    pub id: String,
    pub label: String,
    pub description: String,
    pub source_type: String,
    pub size_bytes: u64,
    pub modified_24h_bytes: u64,
    pub risk_level: RiskLevel,
    pub reviewable: bool,
    pub regenerable: bool,
    pub protected: bool,
    pub requires_app_quit: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstalledApplication {
    pub id: String,
    pub bundle_id: Option<String>,
    pub name: String,
    pub version: Option<String>,
    pub bundle_version: Option<String>,
    pub application_path: Option<String>,
    pub icon_path: Option<String>,
    pub installed: bool,
    pub is_system_app: bool,
    pub is_running: Option<bool>,
    pub support_level: SupportLevel,
    pub kind: String,
    pub glyph: String,
    pub color: String,
    pub app_size_bytes: u64,
    pub related_data_size_bytes: u64,
    pub total_size_bytes: u64,
    pub modified_24h_bytes: u64,
    pub reclaimable_bytes: u64,
    pub permission_errors: u64,
    pub categories: Vec<ApplicationCategory>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanResult {
    pub scanned_at: String,
    pub device_name: String,
    pub os_version: String,
    pub disk_total_bytes: u64,
    pub disk_available_bytes: u64,
    pub disk_used_bytes: u64,
    pub application_bundles_bytes: u64,
    pub related_data_bytes: u64,
    pub recognized_apps_bytes: u64,
    pub modified_24h_bytes: u64,
    pub reclaimable_bytes: u64,
    pub deep_supported_apps: usize,
    pub apps: Vec<InstalledApplication>,
    pub permission_errors: u64,
    pub duration_ms: u128,
}

#[derive(Debug, Serialize)]
pub struct AiResponse {
    pub provider: String,
    pub model: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CleanupCandidate {
    pub id: String,
    pub app_id: String,
    pub app_name: String,
    pub category: String,
    pub display_name: String,
    pub display_path: String,
    pub path: String,
    pub item_type: String,
    pub file_kind: String,
    pub size_bytes: u64,
    pub modified_unix: u64,
    pub risk: RiskLevel,
    pub reason: String,
    pub selectable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuarantineItem {
    pub id: String,
    pub app_id: String,
    pub app_name: String,
    pub display_name: String,
    pub original_path: String,
    pub quarantine_path: String,
    pub item_type: String,
    pub size_bytes: u64,
    pub quarantined_unix: u64,
    #[serde(default = "default_quarantine_scope")]
    pub scope: String,
}

fn default_quarantine_scope() -> String {
    "deep".to_string()
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CleanupBatch {
    pub moved: Vec<QuarantineItem>,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LargeFileItem {
    pub id: String,
    pub name: String,
    pub display_path: String,
    pub path: String,
    pub file_kind: String,
    pub size_bytes: u64,
    pub modified_unix: u64,
    pub risk: RiskLevel,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LargeFileScanResult {
    pub items: Vec<LargeFileItem>,
    pub total_size_bytes: u64,
    pub scanned_files: u64,
    pub permission_errors: u64,
    pub partial: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DuplicateGroup {
    pub id: String,
    pub size_bytes: u64,
    pub reclaimable_bytes: u64,
    pub items: Vec<LargeFileItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DuplicateScanResult {
    pub groups: Vec<DuplicateGroup>,
    pub reclaimable_bytes: u64,
    pub hashed_files: u64,
    pub permission_errors: u64,
    pub partial: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CacheScanItem {
    pub id: String,
    pub bundle_id: String,
    pub label: String,
    pub display_path: String,
    pub path: String,
    pub size_bytes: u64,
    pub modified_24h_bytes: u64,
    pub permission_errors: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CacheScanResult {
    pub items: Vec<CacheScanItem>,
    pub total_size_bytes: u64,
    pub permission_errors: u64,
}
