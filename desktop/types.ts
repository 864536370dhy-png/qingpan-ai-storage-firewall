export type Theme = "dark" | "light";
export type NavId = "applications" | "tools" | "cleanup" | "investigate" | "vault" | "settings";
export type Provider = "gemini" | "deepseek" | "openai";
export type SupportLevel = "basic" | "generic" | "deep";
export type RiskLevel = "safe" | "review" | "protected" | "unknown";
export type ApplicationFilter = "all" | SupportLevel | "system" | "user" | "residual";
export type ApplicationSort = "total" | "app" | "related" | "active" | "name";

export type ApplicationCategory = {
  id: string;
  label: string;
  description: string;
  source_type: string;
  size_bytes: number;
  modified_24h_bytes: number;
  risk_level: RiskLevel;
  reviewable: boolean;
  regenerable: boolean;
  protected: boolean;
  requires_app_quit: boolean;
};

export type InstalledApplication = {
  id: string;
  bundle_id: string | null;
  name: string;
  version: string | null;
  bundle_version: string | null;
  application_path: string | null;
  icon_path: string | null;
  installed: boolean;
  is_system_app: boolean;
  is_running: boolean | null;
  support_level: SupportLevel;
  kind: string;
  glyph: string;
  color: string;
  app_size_bytes: number;
  related_data_size_bytes: number;
  total_size_bytes: number;
  modified_24h_bytes: number;
  reclaimable_bytes: number;
  permission_errors: number;
  categories: ApplicationCategory[];
};

export type ScanResult = {
  scanned_at: string;
  device_name: string;
  os_version: string;
  disk_total_bytes: number;
  disk_available_bytes: number;
  disk_used_bytes: number;
  application_bundles_bytes: number;
  related_data_bytes: number;
  recognized_apps_bytes: number;
  modified_24h_bytes: number;
  reclaimable_bytes: number;
  deep_supported_apps: number;
  apps: InstalledApplication[];
  permission_errors: number;
  duration_ms: number;
};

export type AiResponse = {
  provider: string;
  model: string;
  content: string;
};

export type CleanupCandidate = {
  id: string;
  app_id: string;
  app_name: string;
  category: string;
  display_name: string;
  display_path: string;
  path: string;
  item_type: "file" | "folder";
  file_kind: string;
  size_bytes: number;
  modified_unix: number;
  risk: RiskLevel;
  reason: string;
  selectable: boolean;
};

export type QuarantineItem = {
  id: string;
  app_id: string;
  app_name: string;
  display_name: string;
  original_path: string;
  quarantine_path: string;
  item_type: "file" | "folder";
  size_bytes: number;
  quarantined_unix: number;
  scope: "deep" | "large" | "duplicate" | "cache" | "uninstall";
};

export type CleanupBatch = {
  moved: QuarantineItem[];
  errors: string[];
};

export type TraditionalToolId = "large" | "duplicates" | "uninstall" | "cache";

export type LargeFileItem = {
  id: string;
  name: string;
  display_path: string;
  path: string;
  file_kind: string;
  size_bytes: number;
  modified_unix: number;
  risk: RiskLevel;
};

export type LargeFileScanResult = {
  items: LargeFileItem[];
  total_size_bytes: number;
  scanned_files: number;
  permission_errors: number;
  partial: boolean;
};

export type DuplicateGroup = {
  id: string;
  size_bytes: number;
  reclaimable_bytes: number;
  items: LargeFileItem[];
};

export type DuplicateScanResult = {
  groups: DuplicateGroup[];
  reclaimable_bytes: number;
  hashed_files: number;
  permission_errors: number;
  partial: boolean;
};

export type CacheScanItem = {
  id: string;
  bundle_id: string;
  label: string;
  display_path: string;
  path: string;
  size_bytes: number;
  modified_24h_bytes: number;
  permission_errors: number;
};

export type CacheScanResult = {
  items: CacheScanItem[];
  total_size_bytes: number;
  permission_errors: number;
};

export type ScanState = "idle" | "scanning" | "done" | "error";
export type ScanStage = "discovering" | "metadata" | "related" | "finalizing";
