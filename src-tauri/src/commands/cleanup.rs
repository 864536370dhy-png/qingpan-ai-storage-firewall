use crate::{
    models::{CleanupBatch, CleanupCandidate, QuarantineItem, RiskLevel},
    rules::{app_rules, AppRule, DataPathRule},
    scanner::path_stats,
};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use walkdir::WalkDir;

fn home_dir() -> Result<PathBuf, String> {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or_else(|| "无法读取当前用户目录".to_string())
}

fn cleanup_rule(app_id: &str) -> Result<AppRule, String> {
    app_rules()
        .into_iter()
        .find(|rule| rule.rule_id == app_id)
        .ok_or_else(|| "当前应用尚未建立文件级安全规则".to_string())
}

fn unix_time(time: SystemTime) -> u64 {
    time.duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn candidate_kind(path: &Path, is_dir: bool) -> String {
    if is_dir {
        return "文件夹".to_string();
    }
    match path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "mp4" | "mov" | "m4v" | "avi" | "mkv" | "webm" => "视频",
        "jpg" | "jpeg" | "png" | "gif" | "webp" | "heic" => "图片",
        "zip" | "rar" | "7z" | "tar" | "gz" => "压缩包",
        "pdf" | "doc" | "docx" | "xls" | "xlsx" | "ppt" | "pptx" => "文档",
        "xcarchive" => "Xcode 归档",
        "db" | "sqlite" | "sqlite3" => "数据库",
        _ => "文件",
    }
    .to_string()
}

fn display_path(path: &Path, home: &Path) -> String {
    path.strip_prefix(home)
        .map(|relative| format!("~/{}", relative.to_string_lossy()))
        .unwrap_or_else(|_| path.to_string_lossy().to_string())
}

fn candidate_risk(data_rule: &DataPathRule, path: &Path, is_dir: bool) -> RiskLevel {
    if data_rule.risk_level != RiskLevel::Protected {
        return data_rule.risk_level;
    }
    if data_rule.source_type == "archive" {
        return RiskLevel::Review;
    }
    if is_dir {
        return RiskLevel::Protected;
    }
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if matches!(
        extension.as_str(),
        "mp4"
            | "mov"
            | "m4v"
            | "avi"
            | "mkv"
            | "webm"
            | "mp3"
            | "m4a"
            | "aac"
            | "wav"
            | "jpg"
            | "jpeg"
            | "png"
            | "gif"
            | "webp"
            | "heic"
            | "zip"
            | "rar"
            | "7z"
            | "tar"
            | "gz"
            | "pdf"
            | "doc"
            | "docx"
            | "xls"
            | "xlsx"
            | "ppt"
            | "pptx"
            | "log"
            | "txt"
    ) {
        RiskLevel::Review
    } else {
        RiskLevel::Protected
    }
}

fn candidate_reason(data_rule: &DataPathRule, risk: RiskLevel, modified_unix: u64) -> String {
    let days = unix_time(SystemTime::now()).saturating_sub(modified_unix) / 86_400;
    match risk {
        RiskLevel::Safe => format!(
            "{}；通常可重新生成，已约 {days} 天未修改。",
            data_rule.description
        ),
        RiskLevel::Review if data_rule.risk_level == RiskLevel::Protected => format!(
            "位于受保护目录中的普通附件或媒体文件；轻盘不读取内容，处理前必须确认，已约 {days} 天未修改。"
        ),
        RiskLevel::Review => format!("{}；处理前必须逐项确认，已约 {days} 天未修改。", data_rule.description),
        RiskLevel::Protected => format!(
            "{}；默认不开放，只能在高级模式中单项授权。",
            data_rule.description
        ),
        RiskLevel::Unknown => format!("{}；规则不足，轻盘不会处理。", data_rule.description),
    }
}

fn candidate(
    app: &AppRule,
    data_rule: &DataPathRule,
    path: &Path,
    home: &Path,
    is_dir: bool,
    size_bytes: u64,
    modified_unix: u64,
) -> CleanupCandidate {
    let risk = candidate_risk(data_rule, path, is_dir);
    CleanupCandidate {
        id: format!("{}:{}", app.rule_id, path.to_string_lossy()),
        app_id: app.rule_id.to_string(),
        app_name: app.app_name.to_string(),
        category: data_rule.label.to_string(),
        display_name: path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("未命名项目")
            .to_string(),
        display_path: display_path(path, home),
        path: path.to_string_lossy().to_string(),
        item_type: if is_dir { "folder" } else { "file" }.to_string(),
        file_kind: candidate_kind(path, is_dir),
        size_bytes,
        modified_unix,
        risk,
        reason: candidate_reason(data_rule, risk, modified_unix),
        selectable: matches!(risk, RiskLevel::Safe | RiskLevel::Review),
    }
}

fn candidates_for_root(
    app: &AppRule,
    data_rule: &DataPathRule,
    root: &Path,
    home: &Path,
) -> Vec<CleanupCandidate> {
    const MIN_FILE_BYTES: u64 = 5 * 1024 * 1024;
    const MIN_FOLDER_BYTES: u64 = 50 * 1024 * 1024;
    let mut files = Vec::new();
    let mut direct_folders: HashMap<PathBuf, (u64, u64)> = HashMap::new();

    for entry in WalkDir::new(root).follow_links(false) {
        let entry = match entry {
            Ok(entry) if entry.file_type().is_file() && !entry.file_type().is_symlink() => entry,
            _ => continue,
        };
        let metadata = match entry.metadata() {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };
        let path = entry.path();
        let size = metadata.len();
        let modified = metadata.modified().map(unix_time).unwrap_or_default();
        if let Ok(relative) = path.strip_prefix(root) {
            if let Some(first) = relative.components().next() {
                let child = root.join(first.as_os_str());
                if fs::symlink_metadata(&child)
                    .map(|metadata| metadata.is_dir() && !metadata.file_type().is_symlink())
                    .unwrap_or(false)
                {
                    let item = direct_folders.entry(child).or_default();
                    item.0 = item.0.saturating_add(size);
                    item.1 = item.1.max(modified);
                }
            }
        }
        if size >= MIN_FILE_BYTES {
            files.push(candidate(app, data_rule, path, home, false, size, modified));
        }
    }

    let mut folders: Vec<_> = direct_folders
        .into_iter()
        .filter(|(_, (size, _))| *size >= MIN_FOLDER_BYTES)
        .map(|(path, (size, modified))| {
            candidate(app, data_rule, &path, home, true, size, modified)
        })
        .collect();
    files.sort_by(|left, right| right.size_bytes.cmp(&left.size_bytes));
    folders.sort_by(|left, right| right.size_bytes.cmp(&left.size_bytes));
    files.truncate(80);
    folders.truncate(16);
    folders.extend(files);
    folders
}

fn scan_candidates_in_home(home: &Path, app_id: &str) -> Result<Vec<CleanupCandidate>, String> {
    let rule = cleanup_rule(app_id)?;
    let mut candidates = Vec::new();
    for data_rule in rule.data_paths {
        let root = home.join(data_rule.relative_path);
        let metadata = match fs::symlink_metadata(&root) {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };
        if metadata.file_type().is_symlink() {
            continue;
        }
        candidates.extend(candidates_for_root(&rule, data_rule, &root, home));
    }
    candidates.sort_by(|left, right| right.size_bytes.cmp(&left.size_bytes));
    candidates.truncate(120);
    Ok(candidates)
}

#[tauri::command]
pub async fn scan_app_candidates(app_id: String) -> Result<Vec<CleanupCandidate>, String> {
    tauri::async_runtime::spawn_blocking(move || scan_candidates_in_home(&home_dir()?, &app_id))
        .await
        .map_err(|error| format!("文件级扫描异常：{error}"))?
}

fn validated_cleanup_target(
    home: &Path,
    app_id: &str,
    raw_path: &str,
    allow_protected: bool,
) -> Result<(PathBuf, RiskLevel), String> {
    let rule = cleanup_rule(app_id)?;
    let target = PathBuf::from(raw_path)
        .canonicalize()
        .map_err(|_| "文件已不存在或无法访问".to_string())?;
    let data_rule = rule.data_paths.iter().find(|data_rule| {
        home.join(data_rule.relative_path)
            .canonicalize()
            .ok()
            .is_some_and(|root| target.starts_with(&root) && target != root)
    });
    let data_rule = data_rule.ok_or_else(|| "只能处理深度规则目录内的具体项目".to_string())?;
    let risk = candidate_risk(data_rule, &target, target.is_dir());
    if risk == RiskLevel::Unknown {
        return Err("规则未知的内容不能移入隔离区".to_string());
    }
    if risk == RiskLevel::Protected && !allow_protected {
        return Err("受保护内容必须通过高级手动处理逐项授权".to_string());
    }
    let metadata = fs::symlink_metadata(&target).map_err(|_| "无法读取待处理项目".to_string())?;
    if metadata.file_type().is_symlink() {
        return Err("为避免路径跳转，轻盘不会处理符号链接".to_string());
    }
    Ok((target, risk))
}

fn quarantine_root(home: &Path) -> PathBuf {
    home.join("Library/Application Support/Qingpan/Quarantine")
}

fn existing_quarantine_root(home: &Path) -> Result<Option<PathBuf>, String> {
    let root = quarantine_root(home);
    if !root.exists() {
        return Ok(None);
    }
    let metadata =
        fs::symlink_metadata(&root).map_err(|error| format!("读取隔离区失败：{error}"))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err("隔离区路径不安全，请检查轻盘数据目录".to_string());
    }
    Ok(Some(root))
}

fn ensure_quarantine_root(home: &Path) -> Result<PathBuf, String> {
    let root = quarantine_root(home);
    fs::create_dir_all(&root).map_err(|error| format!("创建隔离区失败：{error}"))?;
    existing_quarantine_root(home)?.ok_or_else(|| "无法建立隔离区".to_string())
}

fn unique_quarantine_id(index: usize) -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("{nanos}-{}-{index}", std::process::id())
}

fn valid_quarantine_id(id: &str) -> bool {
    !id.is_empty()
        && id
            .chars()
            .all(|value| value.is_ascii_digit() || value == '-')
}

fn read_quarantine_manifest(path: &Path) -> Result<QuarantineItem, String> {
    let value = fs::read_to_string(path).map_err(|error| format!("读取隔离记录失败：{error}"))?;
    serde_json::from_str(&value).map_err(|error| format!("隔离记录已损坏：{error}"))
}

fn quarantine_items_in_home(
    home: &Path,
    app_id: &str,
    paths: Vec<String>,
    advanced_protected_paths: Vec<String>,
) -> Result<CleanupBatch, String> {
    if paths.is_empty() {
        return Err("请至少选择一个文件或文件夹".to_string());
    }
    if paths.len() > 100 {
        return Err("单次最多处理100个项目".to_string());
    }
    let rule = cleanup_rule(app_id)?;
    let advanced_paths: HashSet<String> = advanced_protected_paths.into_iter().collect();
    let mut targets = Vec::new();
    let mut seen = HashSet::new();
    for raw_path in paths {
        let (target, risk) =
            validated_cleanup_target(home, app_id, &raw_path, advanced_paths.contains(&raw_path))?;
        if seen.insert(target.clone()) {
            targets.push((target, risk));
        }
    }
    targets.sort_by_key(|(path, _)| path.components().count());
    let mut deduplicated: Vec<(PathBuf, RiskLevel)> = Vec::new();
    for (target, risk) in targets {
        if !deduplicated
            .iter()
            .any(|(parent, _)| target.starts_with(parent))
        {
            deduplicated.push((target, risk));
        }
    }
    let protected_count = deduplicated
        .iter()
        .filter(|(_, risk)| *risk == RiskLevel::Protected)
        .count();
    if protected_count > 0 && deduplicated.len() != 1 {
        return Err("受保护内容只能单项处理，不能与其他项目批量操作".to_string());
    }

    let root = ensure_quarantine_root(home)?;
    let mut moved = Vec::new();
    let mut errors = Vec::new();
    for (index, (target, _)) in deduplicated.into_iter().enumerate() {
        let display_name = target
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("未命名项目")
            .to_string();
        let is_dir = target.is_dir();
        let size_bytes = path_stats(&target).size_bytes;
        let id = unique_quarantine_id(index);
        let item_dir = root.join(&id);
        let payload = item_dir.join("payload");
        if let Err(error) = fs::create_dir(&item_dir) {
            errors.push(format!("{display_name}：无法建立隔离位置（{error}）"));
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
            app_name: rule.app_name.to_string(),
            display_name: display_name.clone(),
            original_path: target.to_string_lossy().to_string(),
            quarantine_path: payload.to_string_lossy().to_string(),
            item_type: if is_dir { "folder" } else { "file" }.to_string(),
            size_bytes,
            quarantined_unix: unix_time(SystemTime::now()),
            scope: "deep".to_string(),
        };
        let manifest = item_dir.join("manifest.json");
        let serialized = serde_json::to_string_pretty(&item)
            .map_err(|error| format!("生成隔离记录失败：{error}"))?;
        if let Err(error) = fs::write(&manifest, serialized) {
            let _ = fs::rename(&payload, &target);
            let _ = fs::remove_dir(&item_dir);
            errors.push(format!("{display_name}：无法保存恢复记录（{error}）"));
            continue;
        }
        moved.push(item);
    }
    Ok(CleanupBatch { moved, errors })
}

#[tauri::command]
pub async fn quarantine_items(
    app_id: String,
    paths: Vec<String>,
    advanced_protected_paths: Vec<String>,
) -> Result<CleanupBatch, String> {
    tauri::async_runtime::spawn_blocking(move || {
        quarantine_items_in_home(&home_dir()?, &app_id, paths, advanced_protected_paths)
    })
    .await
    .map_err(|error| format!("安全清理任务异常：{error}"))?
}

fn list_quarantine_items_in_home(home: &Path) -> Result<Vec<QuarantineItem>, String> {
    let Some(root) = existing_quarantine_root(home)? else {
        return Ok(Vec::new());
    };
    let mut items = Vec::new();
    for entry in fs::read_dir(root)
        .map_err(|error| format!("读取隔离区失败：{error}"))?
        .flatten()
    {
        let manifest = entry.path().join("manifest.json");
        if let Ok(item) = read_quarantine_manifest(&manifest) {
            items.push(item);
        }
    }
    items.sort_by(|left, right| right.quarantined_unix.cmp(&left.quarantined_unix));
    Ok(items)
}

#[tauri::command]
pub fn list_quarantine_items() -> Result<Vec<QuarantineItem>, String> {
    list_quarantine_items_in_home(&home_dir()?)
}

fn checked_quarantine_item(
    home: &Path,
    id: &str,
) -> Result<(PathBuf, PathBuf, QuarantineItem), String> {
    if !valid_quarantine_id(id) {
        return Err("隔离记录编号无效".to_string());
    }
    let root = existing_quarantine_root(home)?.ok_or_else(|| "隔离项目不存在".to_string())?;
    let item_dir = root.join(id);
    let item_dir_metadata =
        fs::symlink_metadata(&item_dir).map_err(|_| "隔离项目不存在".to_string())?;
    if item_dir_metadata.file_type().is_symlink() || !item_dir_metadata.is_dir() {
        return Err("隔离项目路径不安全".to_string());
    }
    let manifest = item_dir.join("manifest.json");
    let manifest_metadata =
        fs::symlink_metadata(&manifest).map_err(|_| "隔离记录不存在".to_string())?;
    if manifest_metadata.file_type().is_symlink() || !manifest_metadata.is_file() {
        return Err("隔离记录路径不安全".to_string());
    }
    let item = read_quarantine_manifest(&manifest)?;
    let payload = item_dir.join("payload");
    if item.id != id || PathBuf::from(&item.quarantine_path) != payload {
        return Err("隔离记录与实际位置不一致".to_string());
    }
    let metadata = fs::symlink_metadata(&payload).map_err(|_| "隔离内容不存在".to_string())?;
    if metadata.file_type().is_symlink() {
        return Err("隔离内容不能是符号链接".to_string());
    }
    Ok((item_dir, payload, item))
}

fn restore_quarantine_item_in_home(home: &Path, id: &str) -> Result<(), String> {
    let (item_dir, payload, item) = checked_quarantine_item(home, id)?;
    let original = PathBuf::from(&item.original_path);
    if original.exists() {
        return Err("原位置已经存在同名文件，请先改名或移走后再恢复".to_string());
    }
    let parent = original
        .parent()
        .ok_or_else(|| "原始路径无效".to_string())?;
    let canonical_parent = parent
        .canonicalize()
        .map_err(|_| "原目录已不存在，无法安全恢复".to_string())?;
    let allowed = match item.scope.as_str() {
        "deep" => cleanup_rule(&item.app_id)?
            .data_paths
            .iter()
            .any(|data_rule| {
                home.join(data_rule.relative_path)
                    .canonicalize()
                    .ok()
                    .is_some_and(|root| canonical_parent.starts_with(root))
            }),
        "large" | "duplicate" => [
            "Desktop",
            "Documents",
            "Downloads",
            "Movies",
            "Pictures",
            "Music",
        ]
        .iter()
        .any(|relative| {
            home.join(relative)
                .canonicalize()
                .ok()
                .is_some_and(|root| canonical_parent.starts_with(root))
        }),
        "cache" => home
            .join("Library/Caches")
            .canonicalize()
            .ok()
            .is_some_and(|root| canonical_parent.starts_with(root)),
        "uninstall" => {
            let application_parent = [PathBuf::from("/Applications"), home.join("Applications")]
                .iter()
                .any(|root| {
                    root.canonicalize()
                        .ok()
                        .is_some_and(|root| canonical_parent == root)
                });
            let cache_parent = home
                .join("Library/Caches")
                .canonicalize()
                .ok()
                .is_some_and(|root| canonical_parent == root);
            application_parent || cache_parent
        }
        _ => false,
    };
    if !allowed {
        return Err("原始路径已经不在应用安全规则范围内".to_string());
    }
    fs::rename(&payload, &original).map_err(|error| format!("恢复失败：{error}"))?;
    fs::remove_file(item_dir.join("manifest.json"))
        .map_err(|error| format!("清理恢复记录失败：{error}"))?;
    fs::remove_dir(&item_dir).map_err(|error| format!("清理隔离目录失败：{error}"))
}

#[tauri::command]
pub fn restore_quarantine_item(id: String) -> Result<(), String> {
    restore_quarantine_item_in_home(&home_dir()?, &id)
}

fn permanently_delete_in_home(home: &Path, id: &str) -> Result<(), String> {
    let (item_dir, _, _) = checked_quarantine_item(home, id)?;
    fs::remove_dir_all(item_dir).map_err(|error| format!("永久删除失败：{error}"))
}

#[tauri::command]
pub fn permanently_delete_quarantine_item(id: String) -> Result<(), String> {
    permanently_delete_in_home(&home_dir()?, &id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_home(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "qingpan-cleanup-{label}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    #[test]
    fn only_safe_and_review_rules_are_selectable() {
        let home = test_home("risk");
        let safe = home.join("Library/Caches/com.lemon.lvpro/cache.bin");
        let review_media = home.join("Movies/JianyingPro/export.mov");
        let protected = home.join("Movies/JianyingPro/project.sqlite");
        fs::create_dir_all(safe.parent().unwrap()).unwrap();
        fs::create_dir_all(review_media.parent().unwrap()).unwrap();
        fs::write(&safe, vec![0_u8; 5 * 1024 * 1024]).unwrap();
        fs::write(&review_media, vec![0_u8; 5 * 1024 * 1024]).unwrap();
        fs::write(&protected, vec![0_u8; 5 * 1024 * 1024]).unwrap();
        let candidates = scan_candidates_in_home(&home, "capcut").unwrap();
        assert!(candidates
            .iter()
            .any(|item| item.risk == RiskLevel::Safe && item.selectable));
        assert!(candidates
            .iter()
            .any(|item| item.risk == RiskLevel::Protected && !item.selectable));
        assert!(candidates
            .iter()
            .any(|item| item.risk == RiskLevel::Review && item.selectable));
        let (_, risk) =
            validated_cleanup_target(&home, "capcut", review_media.to_str().unwrap(), false)
                .unwrap();
        assert_eq!(risk, RiskLevel::Review);
        fs::remove_dir_all(home).unwrap();
    }

    #[test]
    fn rejects_targets_outside_deep_rule_roots_and_symlinks() {
        let home = test_home("validation");
        let outside = home.join("Documents/outside.bin");
        fs::create_dir_all(outside.parent().unwrap()).unwrap();
        fs::write(&outside, b"keep").unwrap();
        assert!(
            validated_cleanup_target(&home, "capcut", outside.to_str().unwrap(), false).is_err()
        );
        fs::remove_dir_all(home).unwrap();
    }

    #[test]
    fn quarantine_restore_and_permanent_delete_stay_inside_test_home() {
        let home = test_home("roundtrip");
        let cache_root = home.join("Library/Caches/com.lemon.lvpro");
        let target = cache_root.join("preview.bin");
        fs::create_dir_all(&cache_root).unwrap();
        fs::write(&target, b"preview cache").unwrap();

        let batch = quarantine_items_in_home(
            &home,
            "capcut",
            vec![target.to_string_lossy().to_string()],
            Vec::new(),
        )
        .unwrap();
        assert_eq!(batch.moved.len(), 1);
        assert!(!target.exists());
        let id = batch.moved[0].id.clone();
        restore_quarantine_item_in_home(&home, &id).unwrap();
        assert!(target.exists());

        let batch = quarantine_items_in_home(
            &home,
            "capcut",
            vec![target.to_string_lossy().to_string()],
            Vec::new(),
        )
        .unwrap();
        let id = batch.moved[0].id.clone();
        permanently_delete_in_home(&home, &id).unwrap();
        assert!(!target.exists());
        assert!(list_quarantine_items_in_home(&home).unwrap().is_empty());
        fs::remove_dir_all(home).unwrap();
    }

    #[test]
    fn traditional_and_uninstall_scopes_restore_only_to_expected_roots() {
        let home = test_home("traditional-restore");
        let quarantine = ensure_quarantine_root(&home).unwrap();
        let cases = [
            ("100-1-0", "large", home.join("Downloads/movie.mov"), false),
            (
                "100-1-1",
                "uninstall",
                home.join("Library/Caches/com.example.app"),
                true,
            ),
        ];
        for (id, scope, original, is_dir) in cases {
            fs::create_dir_all(original.parent().unwrap()).unwrap();
            let item_dir = quarantine.join(id);
            let payload = item_dir.join("payload");
            fs::create_dir_all(&item_dir).unwrap();
            if is_dir {
                fs::create_dir(&payload).unwrap();
                fs::write(payload.join("cache.bin"), b"cache").unwrap();
            } else {
                fs::write(&payload, b"movie").unwrap();
            }
            let item = QuarantineItem {
                id: id.to_string(),
                app_id: "traditional".to_string(),
                app_name: "传统清理".to_string(),
                display_name: original.file_name().unwrap().to_string_lossy().to_string(),
                original_path: original.to_string_lossy().to_string(),
                quarantine_path: payload.to_string_lossy().to_string(),
                item_type: if is_dir { "folder" } else { "file" }.to_string(),
                size_bytes: 5,
                quarantined_unix: 1,
                scope: scope.to_string(),
            };
            fs::write(
                item_dir.join("manifest.json"),
                serde_json::to_string_pretty(&item).unwrap(),
            )
            .unwrap();
            restore_quarantine_item_in_home(&home, id).unwrap();
            assert!(original.exists());
        }
        fs::remove_dir_all(home).unwrap();
    }

    #[test]
    fn protected_items_require_explicit_single_item_authorization() {
        let home = test_home("protected-advanced");
        let protected = home.join("Movies/JianyingPro/project.sqlite");
        let safe = home.join("Library/Caches/com.lemon.lvpro/cache.bin");
        fs::create_dir_all(protected.parent().unwrap()).unwrap();
        fs::create_dir_all(safe.parent().unwrap()).unwrap();
        fs::write(&protected, b"project").unwrap();
        fs::write(&safe, b"cache").unwrap();
        let protected_path = protected.to_string_lossy().to_string();
        let safe_path = safe.to_string_lossy().to_string();

        assert!(quarantine_items_in_home(
            &home,
            "capcut",
            vec![protected_path.clone()],
            Vec::new(),
        )
        .is_err());
        assert!(quarantine_items_in_home(
            &home,
            "capcut",
            vec![protected_path.clone(), safe_path],
            vec![protected_path.clone()],
        )
        .is_err());
        let batch = quarantine_items_in_home(
            &home,
            "capcut",
            vec![protected_path.clone()],
            vec![protected_path],
        )
        .unwrap();
        assert_eq!(batch.moved.len(), 1);
        restore_quarantine_item_in_home(&home, &batch.moved[0].id).unwrap();
        assert!(protected.exists());
        fs::remove_dir_all(home).unwrap();
    }
}
