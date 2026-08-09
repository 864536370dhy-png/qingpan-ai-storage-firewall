mod scan;

pub use scan::{
    AiResponse, ApplicationCategory, CacheScanItem, CacheScanResult, CleanupBatch,
    CleanupCandidate, DuplicateGroup, DuplicateScanResult, InstalledApplication, LargeFileItem,
    LargeFileScanResult, QuarantineItem, RiskLevel, ScanResult, SupportLevel,
};
