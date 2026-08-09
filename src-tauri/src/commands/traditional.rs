use crate::{
    models::{
        CacheScanItem, CacheScanResult, CleanupBatch, DuplicateGroup, DuplicateScanResult,
        LargeFileItem, LargeFileScanResult, QuarantineItem, RiskLevel,
    },
    scanner::path_stats,
};
use plist::Value as PlistValue;
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs,
    io::{BufReader, Read},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use walkdir::WalkDir;

fn home_dir() -> Result<PathBuf, String> {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or_else(|| "无法读取当前用户目录".to_string())
}

fn content_roots(home: &Path) -> Vec<PathBuf> {
    [
        "Desktop",
        "Documents",
        "Downloads",
        "Movies",
        "Pictures",
        "Music",
    ]
    .iter()
    .map(|relative| home.join(relative))
    .filter(|path| path.exists())
    .collect()
}

fn unix_time(time: SystemTime) -> u64 {
    time.duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn display_path(path: &Path, home: &Path) -> String {
    path.strip_prefix(home)
        .map(|relative| format!("~/{}", relative.to_string_lossy()))
        .unwrap_or_else(|_| path.to_string_lossy().to_string())
}

fn file_kind(path: &Path) -> String {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "mp4" | "mov" | "m4v" | "avi" | "mkv" | "webm" => "视频",
        "mp3" | "m4a" | "aac" | "wav" | "flac" => "音频",
        "jpg" | "jpeg" | "png" | "gif" | "webp" | "heic" => "图片",
        "zip" | "rar" | "7z" | "tar" | "gz" | "dmg" | "pkg" => "归档/安装包",
        "pdf" | "doc" | "docx" | "xls" | "xlsx" | "ppt" | "pptx" => "文档",
        "db" | "sqlite" | "sqlite3" | "realm" => "数据库",
        _ => "其他文件",
    }
    .to_string()
}

fn traditional_file_risk(path: &Path) -> RiskLevel {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "db" | "sqlite" | "sqlite3" | "realm" | "xcodeproj" | "xcworkspace" => RiskLevel::Protected,
        _ => RiskLevel::Review,
    }
}

fn file_item(path: &Path, home: &Path, size_bytes: u64, modified_unix: u64) -> LargeFileItem {
    LargeFileItem {
        id: path.to_string_lossy().to_string(),
        name: path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("未命名文件")
            .to_string(),
        display_path: display_path(path, home),
        path: path.to_string_lossy().to_string(),
        file_kind: file_kind(path),
        size_bytes,
        modified_unix,
        risk: traditional_file_risk(path),
    }
}

fn collect_files(
    home: &Path,
    minimum_size: u64,
    limit: u64,
) -> (Vec<LargeFileItem>, u64, u64, bool) {
    let mut items = Vec::new();
    let mut scanned_files = 0_u64;
    let mut permission_errors = 0_u64;
    let mut partial = false;
    'roots: for root in content_roots(home) {
        for entry in WalkDir::new(root).follow_links(false) {
            let entry = match entry {
                Ok(entry) => entry,
                Err(_) => {
                    permission_errors = permission_errors.saturating_add(1);
                    continue;
                }
            };
            if entry.file_type().is_symlink() || !entry.file_type().is_file() {
                continue;
            }
            scanned_files = scanned_files.saturating_add(1);
            if scanned_files > limit {
                partial = true;
                break 'roots;
            }
            let metadata = match entry.metadata() {
                Ok(metadata) => metadata,
                Err(_) => {
                    permission_errors = permission_errors.saturating_add(1);
                    continue;
                }
            };
            if metadata.len() >= minimum_size {
                items.push(file_item(
                    entry.path(),
                    home,
                    metadata.len(),
                    metadata.modified().map(unix_time).unwrap_or_default(),
                ));
            }
        }
    }
    (items, scanned_files.min(limit), permission_errors, partial)
}

#[tauri::command]
pub async fn scan_large_files(minimum_size_bytes: u64) -> Result<LargeFileScanResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let home = home_dir()?;
        let minimum = minimum_size_bytes.clamp(10 * 1024 * 1024, 20 * 1024 * 1024 * 1024);
        let (mut items, scanned_files, permission_errors, partial) =
            collect_files(&home, minimum, 250_000);
        items.sort_by(|left, right| right.size_bytes.cmp(&left.size_bytes));
        items.truncate(1000);
        let total_size_bytes = items.iter().map(|item| item.size_bytes).sum();
        Ok(LargeFileScanResult {
            items,
            total_size_bytes,
            scanned_files,
            permission_errors,
            partial,
        })
    })
    .await
    .map_err(|error| format!("大文件扫描异常：{error}"))?
}

fn hash_file(path: &Path) -> Result<String, String> {
    let file = fs::File::open(path).map_err(|error| format!("无法读取候选文件：{error}"))?;
    let mut reader = BufReader::with_capacity(1024 * 1024, file);
    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; 1024 * 1024];
    loop {
        let read = reader
            .read(&mut buffer)
            .map_err(|error| format!("计算文件指纹失败：{error}"))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

#[tauri::command]
pub async fn scan_duplicate_files(minimum_size_bytes: u64) -> Result<DuplicateScanResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let home = home_dir()?;
        let minimum = minimum_size_bytes.clamp(1024 * 1024, 5 * 1024 * 1024 * 1024);
        let (items, _, mut permission_errors, mut partial) = collect_files(&home, minimum, 250_000);
        let mut by_size: HashMap<u64, Vec<LargeFileItem>> = HashMap::new();
        for item in items {
            by_size.entry(item.size_bytes).or_default().push(item);
        }
        let mut hashed_files = 0_u64;
        let mut by_hash: HashMap<(u64, String), Vec<LargeFileItem>> = HashMap::new();
        'groups: for (size, candidates) in by_size.into_iter().filter(|(_, items)| items.len() > 1)
        {
            for item in candidates {
                if hashed_files >= 20_000 {
                    partial = true;
                    break 'groups;
                }
                match hash_file(Path::new(&item.path)) {
                    Ok(hash) => {
                        hashed_files += 1;
                        by_hash.entry((size, hash)).or_default().push(item);
                    }
                    Err(_) => permission_errors = permission_errors.saturating_add(1),
                }
            }
        }
        let mut groups: Vec<DuplicateGroup> = by_hash
            .into_iter()
            .filter(|(_, items)| items.len() > 1)
            .map(|((size, hash), mut items)| {
                items.sort_by(|left, right| left.modified_unix.cmp(&right.modified_unix));
                DuplicateGroup {
                    id: hash,
                    size_bytes: size,
                    reclaimable_bytes: size.saturating_mul(items.len().saturating_sub(1) as u64),
                    items,
                }
            })
            .collect();
        groups.sort_by(|left, right| right.reclaimable_bytes.cmp(&left.reclaimable_bytes));
        groups.truncate(500);
        let reclaimable_bytes = groups.iter().map(|group| group.reclaimable_bytes).sum();
        Ok(DuplicateScanResult {
            groups,
            reclaimable_bytes,
            hashed_files,
            permission_errors,
            partial,
        })
    })
    .await
    .map_err(|error| format!("重复文件扫描异常：{error}"))?
}

#[tauri::command]
pub async fn scan_caches() -> Result<CacheScanResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let home = home_dir()?;
        let root = home.join("Library/Caches");
        let mut items = Vec::new();
        let mut permission_errors = 0_u64;
        for entry in fs::read_dir(&root).map_err(|error| format!("读取缓存目录失败：{error}"))?
        {
            let entry = match entry {
                Ok(entry) => entry,
                Err(_) => {
                    permission_errors += 1;
                    continue;
                }
            };
            let path = entry.path();
            let metadata = match fs::symlink_metadata(&path) {
                Ok(metadata) => metadata,
                Err(_) => {
                    permission_errors += 1;
                    continue;
                }
            };
            if metadata.file_type().is_symlink() {
                continue;
            }
            let stats = path_stats(&path);
            permission_errors = permission_errors.saturating_add(stats.permission_errors);
            if stats.size_bytes == 0 {
                continue;
            }
            let bundle_id = entry.file_name().to_string_lossy().to_string();
            items.push(CacheScanItem {
                id: bundle_id.clone(),
                bundle_id: bundle_id.clone(),
                label: bundle_id,
                display_path: display_path(&path, &home),
                path: path.to_string_lossy().to_string(),
                size_bytes: stats.size_bytes,
                modified_24h_bytes: stats.modified_24h_bytes,
                permission_errors: stats.permission_errors,
            });
        }
        items.sort_by(|left, right| right.size_bytes.cmp(&left.size_bytes));
        let total_size_bytes = items.iter().map(|item| item.size_bytes).sum();
        Ok(CacheScanResult {
            items,
            total_size_bytes,
            permission_errors,
        })
    })
    .await
    .map_err(|error| format!("缓存分析异常：{error}"))?
}

fn quarantine_root(home: &Path) -> PathBuf {
    home.join("Library/Application Support/Qingpan/Quarantine")
}

fn ensure_quarantine_root(home: &Path) -> Result<PathBuf, String> {
    let root = quarantine_root(home);
    fs::create_dir_all(&root).map_err(|error| format!("创建隔离区失败：{error}"))?;
    let metadata =
        fs::symlink_metadata(&root).map_err(|error| format!("读取隔离区失败：{error}"))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err("隔离区路径不安全".to_string());
    }
    Ok(root)
}

fn validate_traditional_target(
    home: &Path,
    scope: &str,
    raw_path: &str,
) -> Result<PathBuf, String> {
    let target = PathBuf::from(raw_path)
        .canonicalize()
        .map_err(|_| "项目已不存在或无法访问".to_string())?;
    let metadata = fs::symlink_metadata(&target).map_err(|_| "无法读取待处理项目".to_string())?;
    if metadata.file_type().is_symlink() {
        return Err("不会处理符号链接".to_string());
    }
    match scope {
        "large" | "duplicate" => {
            if !metadata.is_file()
                || !content_roots(home)
                    .iter()
                    .filter_map(|root| root.canonicalize().ok())
                    .any(|root| target.starts_with(root))
            {
                return Err("只能处理用户内容目录中的具体文件".to_string());
            }
            if traditional_file_risk(&target) == RiskLevel::Protected {
                return Err("数据库或工程结构文件不能通过传统清理处理".to_string());
            }
        }
        "cache" => {
            let root = home
                .join("Library/Caches")
                .canonicalize()
                .map_err(|_| "缓存目录不可用".to_string())?;
            if target.parent() != Some(root.as_path()) || target == root {
                return Err("只能处理缓存目录的一级项目".to_string());
            }
        }
        _ => return Err("未知的清理范围".to_string()),
    }
    Ok(target)
}

fn move_to_quarantine(
    home: &Path,
    app_id: &str,
    label: &str,
    scope: &str,
    targets: Vec<PathBuf>,
) -> Result<CleanupBatch, String> {
    let root = ensure_quarantine_root(home)?;
    let mut moved = Vec::new();
    let mut errors = Vec::new();
    for (index, target) in targets.into_iter().enumerate() {
        let display_name = target
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("未命名项目")
            .to_string();
        let size_bytes = path_stats(&target).size_bytes;
        let id = format!(
            "{}-{}-{index}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos(),
            std::process::id()
        );
        let item_dir = root.join(&id);
        let payload = item_dir.join("payload");
        if let Err(error) = fs::create_dir(&item_dir) {
            errors.push(format!("{display_name}：建立隔离位置失败（{error}）"));
            continue;
        }
        if let Err(error) = fs::rename(&target, &payload) {
            let _ = fs::remove_dir(&item_dir);
            errors.push(format!("{display_name}：移动失败（{error}）"));
            continue;
        }
        let item = QuarantineItem {
            id: id.clone(),
            app_id: app_id.to_string(),
            app_name: label.to_string(),
            display_name: display_name.clone(),
            original_path: target.to_string_lossy().to_string(),
            quarantine_path: payload.to_string_lossy().to_string(),
            item_type: if payload.is_dir() { "folder" } else { "file" }.to_string(),
            size_bytes,
            quarantined_unix: unix_time(SystemTime::now()),
            scope: scope.to_string(),
        };
        let manifest = item_dir.join("manifest.json");
        match serde_json::to_string_pretty(&item)
            .map_err(|error| error.to_string())
            .and_then(|value| fs::write(&manifest, value).map_err(|error| error.to_string()))
        {
            Ok(()) => moved.push(item),
            Err(error) => {
                let _ = fs::rename(&payload, &target);
                let _ = fs::remove_dir(&item_dir);
                errors.push(format!("{display_name}：保存恢复记录失败（{error}）"));
            }
        }
    }
    Ok(CleanupBatch { moved, errors })
}

fn bundle_identifier(application: &Path) -> Option<String> {
    let PlistValue::Dictionary(dictionary) =
        PlistValue::from_file(application.join("Contents/Info.plist")).ok()?
    else {
        return None;
    };
    dictionary
        .get("CFBundleIdentifier")
        .and_then(PlistValue::as_string)
        .map(str::trim)
        .filter(|value| !value.is_empty() && !value.contains('/') && !value.contains(".."))
        .map(str::to_string)
}

#[tauri::command]
pub async fn quarantine_traditional_items(
    scope: String,
    paths: Vec<String>,
) -> Result<CleanupBatch, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if paths.is_empty() || paths.len() > 200 {
            return Err("请选择1到200个项目".to_string());
        }
        let home = home_dir()?;
        let mut targets = Vec::new();
        for raw_path in paths {
            targets.push(validate_traditional_target(&home, &scope, &raw_path)?);
        }
        move_to_quarantine(&home, &scope, "传统清理", &scope, targets)
    })
    .await
    .map_err(|error| format!("传统清理任务异常：{error}"))?
}

#[tauri::command]
pub async fn uninstall_application(
    application_path: String,
    bundle_id: Option<String>,
    app_name: String,
    include_safe_cache: bool,
) -> Result<CleanupBatch, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let home = home_dir()?;
        let target = PathBuf::from(&application_path)
            .canonicalize()
            .map_err(|_| "应用已经不存在或无法访问".to_string())?;
        let metadata = fs::symlink_metadata(&target).map_err(|_| "无法读取应用包".to_string())?;
        let allowed_parent = [PathBuf::from("/Applications"), home.join("Applications")]
            .iter()
            .filter_map(|root| root.canonicalize().ok())
            .any(|root| target.parent() == Some(root.as_path()));
        if !allowed_parent
            || metadata.file_type().is_symlink()
            || !metadata.is_dir()
            || target.extension().and_then(|value| value.to_str()) != Some("app")
            || target.starts_with("/System/Applications")
        {
            return Err("只能卸载普通用户应用，系统应用和符号链接不允许处理".to_string());
        }
        let verified_bundle_id = bundle_identifier(&target);
        if bundle_id.is_some() && bundle_id.as_deref() != verified_bundle_id.as_deref() {
            return Err("应用标识与应用包内容不一致，请重新扫描后再试".to_string());
        }
        let mut targets = vec![target];
        if include_safe_cache {
            if let Some(bundle_id) = verified_bundle_id.as_deref() {
                let cache = home.join("Library/Caches").join(bundle_id);
                if fs::symlink_metadata(&cache)
                    .map(|metadata| !metadata.file_type().is_symlink())
                    .unwrap_or(false)
                {
                    targets.push(cache);
                }
            }
        }
        move_to_quarantine(
            &home,
            verified_bundle_id.as_deref().unwrap_or("application"),
            &app_name,
            "uninstall",
            targets,
        )
    })
    .await
    .map_err(|error| format!("应用卸载任务异常：{error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_home(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "qingpan-traditional-{label}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    #[test]
    fn large_file_scan_and_duplicate_hashing_work_on_local_fixtures() {
        let home = test_home("files");
        let downloads = home.join("Downloads");
        fs::create_dir_all(&downloads).unwrap();
        fs::write(downloads.join("one.bin"), vec![7_u8; 1024 * 1024]).unwrap();
        fs::write(downloads.join("two.bin"), vec![7_u8; 1024 * 1024]).unwrap();
        let (items, _, errors, partial) = collect_files(&home, 512 * 1024, 100);
        assert_eq!(items.len(), 2);
        assert_eq!(errors, 0);
        assert!(!partial);
        assert_eq!(
            hash_file(&downloads.join("one.bin")).unwrap(),
            hash_file(&downloads.join("two.bin")).unwrap()
        );
        fs::remove_dir_all(home).unwrap();
    }

    #[test]
    fn traditional_validation_rejects_databases_and_paths_outside_scope() {
        let home = test_home("validation");
        let downloads = home.join("Downloads");
        let documents = home.join("Documents");
        fs::create_dir_all(&downloads).unwrap();
        fs::create_dir_all(&documents).unwrap();
        let database = downloads.join("data.sqlite");
        let outside = home.join("outside.bin");
        fs::write(&database, b"db").unwrap();
        fs::write(&outside, b"outside").unwrap();
        assert!(validate_traditional_target(&home, "large", database.to_str().unwrap()).is_err());
        assert!(validate_traditional_target(&home, "large", outside.to_str().unwrap()).is_err());
        fs::remove_dir_all(home).unwrap();
    }

    #[test]
    fn bundle_identifier_is_read_from_the_application_not_trusted_input() {
        let home = test_home("bundle-id");
        let application = home.join("Applications/Example.app");
        fs::create_dir_all(application.join("Contents")).unwrap();
        let mut dictionary = plist::Dictionary::new();
        dictionary.insert(
            "CFBundleIdentifier".to_string(),
            PlistValue::String("com.example.safe".to_string()),
        );
        PlistValue::Dictionary(dictionary)
            .to_file_xml(application.join("Contents/Info.plist"))
            .unwrap();
        assert_eq!(
            bundle_identifier(&application).as_deref(),
            Some("com.example.safe")
        );
        fs::remove_dir_all(home).unwrap();
    }
}
