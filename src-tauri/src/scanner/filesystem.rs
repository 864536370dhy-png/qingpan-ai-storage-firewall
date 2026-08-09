use std::{
    path::Path,
    time::{Duration, SystemTime},
};
use walkdir::WalkDir;

#[derive(Debug, Default, Clone, Copy)]
pub struct PathStats {
    pub size_bytes: u64,
    pub modified_24h_bytes: u64,
    pub permission_errors: u64,
}

pub fn path_stats(path: &Path) -> PathStats {
    let mut stats = PathStats::default();
    let root_metadata = match std::fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(_) => {
            stats.permission_errors = u64::from(path.exists());
            return stats;
        }
    };
    if root_metadata.file_type().is_symlink() {
        return stats;
    }

    let cutoff = SystemTime::now()
        .checked_sub(Duration::from_secs(24 * 60 * 60))
        .unwrap_or(SystemTime::UNIX_EPOCH);
    for entry in WalkDir::new(path).follow_links(false) {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => {
                stats.permission_errors = stats.permission_errors.saturating_add(1);
                continue;
            }
        };
        if entry.file_type().is_symlink() || !entry.file_type().is_file() {
            continue;
        }
        let metadata = match entry.metadata() {
            Ok(metadata) => metadata,
            Err(_) => {
                stats.permission_errors = stats.permission_errors.saturating_add(1);
                continue;
            }
        };
        let size = metadata.len();
        stats.size_bytes = stats.size_bytes.saturating_add(size);
        if metadata
            .modified()
            .map(|time| time >= cutoff)
            .unwrap_or(false)
        {
            stats.modified_24h_bytes = stats.modified_24h_bytes.saturating_add(size);
        }
    }
    stats
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    fn test_root(label: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "qingpan-{label}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    #[test]
    fn path_stats_counts_files_without_reading_contents() {
        let root = test_root("path-stats");
        fs::create_dir_all(root.join("nested")).unwrap();
        fs::write(root.join("nested/sample.bin"), vec![1_u8; 2048]).unwrap();
        let stats = path_stats(&root);
        assert_eq!(stats.size_bytes, 2048);
        assert_eq!(stats.modified_24h_bytes, 2048);
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn path_stats_does_not_follow_symbolic_links() {
        use std::os::unix::fs::symlink;
        let root = test_root("symlink");
        let outside = test_root("outside");
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("large.bin"), vec![1_u8; 4096]).unwrap();
        symlink(&outside, root.join("linked")).unwrap();
        assert_eq!(path_stats(&root).size_bytes, 0);
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(outside).unwrap();
    }
}
