use rayon::prelude::*;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use walkdir::WalkDir;

const KEYRING_SERVICE: &str = "com.qingpan.desktop.ai";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanCategory {
    label: String,
    size_bytes: u64,
    modified_24h_bytes: u64,
    safe_to_review: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppUsage {
    id: String,
    name: String,
    kind: String,
    glyph: String,
    color: String,
    installed: bool,
    size_bytes: u64,
    modified_24h_bytes: u64,
    reclaimable_bytes: u64,
    hourly_growth_bytes: Vec<u64>,
    categories: Vec<ScanCategory>,
    permission_errors: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanResult {
    scanned_at: String,
    device_name: String,
    os_version: String,
    disk_total_bytes: u64,
    disk_available_bytes: u64,
    disk_used_bytes: u64,
    recognized_apps_bytes: u64,
    modified_24h_bytes: u64,
    reclaimable_bytes: u64,
    apps: Vec<AppUsage>,
    permission_errors: u64,
    duration_ms: u128,
}

#[derive(Debug, Serialize)]
pub struct AiResponse {
    provider: String,
    model: String,
    content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CleanupCandidate {
    id: String,
    app_id: String,
    app_name: String,
    category: String,
    display_name: String,
    display_path: String,
    path: String,
    item_type: String,
    file_kind: String,
    size_bytes: u64,
    modified_unix: u64,
    risk: String,
    reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuarantineItem {
    id: String,
    app_id: String,
    app_name: String,
    display_name: String,
    original_path: String,
    quarantine_path: String,
    item_type: String,
    size_bytes: u64,
    quarantined_unix: u64,
}

#[derive(Debug, Serialize)]
pub struct CleanupBatch {
    moved: Vec<QuarantineItem>,
    errors: Vec<String>,
}

#[derive(Clone)]
struct AppDefinition {
    id: &'static str,
    name: &'static str,
    kind: &'static str,
    glyph: &'static str,
    color: &'static str,
    bundle_names: &'static [&'static str],
    data_paths: &'static [(&'static str, &'static str, bool)],
}

#[derive(Default)]
struct PathStats {
    size_bytes: u64,
    modified_24h_bytes: u64,
    hourly_growth_bytes: Vec<u64>,
    permission_errors: u64,
}

fn app_definitions() -> Vec<AppDefinition> {
    vec![
        AppDefinition {
            id: "capcut",
            name: "剪映",
            kind: "视频创作",
            glyph: "剪",
            color: "#6d8dff",
            bundle_names: &["JianyingPro.app", "CapCut.app"],
            data_paths: &[
                ("Library/Application Support/JianyingPro", "应用数据", false),
                ("Library/Caches/com.lemon.lvpro", "预览与临时缓存", true),
                ("Movies/JianyingPro", "工程与素材", false),
            ],
        },
        AppDefinition {
            id: "wechat",
            name: "微信",
            kind: "沟通协作",
            glyph: "微",
            color: "#34c985",
            bundle_names: &["WeChat.app", "微信.app"],
            data_paths: &[
                (
                    "Library/Containers/com.tencent.xinWeChat",
                    "聊天与应用数据",
                    false,
                ),
                ("Library/Caches/com.tencent.xinWeChat", "临时缓存", true),
                (
                    "Library/Group Containers/5A4RE8SF68.com.tencent.xinWeChat",
                    "共享数据",
                    false,
                ),
            ],
        },
        AppDefinition {
            id: "xcode",
            name: "Xcode",
            kind: "开发工具",
            glyph: "X",
            color: "#2fa8ff",
            bundle_names: &["Xcode.app"],
            data_paths: &[
                (
                    "Library/Developer/Xcode/DerivedData",
                    "DerivedData 构建缓存",
                    true,
                ),
                ("Library/Developer/CoreSimulator", "模拟器", true),
                ("Library/Developer/Xcode/Archives", "发布归档", false),
                (
                    "Library/Developer/Xcode/iOS DeviceSupport",
                    "设备支持文件",
                    true,
                ),
            ],
        },
        AppDefinition {
            id: "lark",
            name: "飞书",
            kind: "办公协作",
            glyph: "飞",
            color: "#5877ff",
            bundle_names: &["Lark.app", "Feishu.app", "飞书.app"],
            data_paths: &[
                ("Library/Application Support/LarkShell", "应用数据", false),
                ("Library/Caches/com.bytedance.lark", "临时缓存", true),
                (
                    "Library/Containers/com.bytedance.ee.lark.mac",
                    "沙盒数据",
                    false,
                ),
            ],
        },
    ]
}

fn home_dir() -> Result<PathBuf, String> {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or_else(|| "无法读取当前用户目录".to_string())
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

fn candidate_reason(category: &str, safe: bool, is_dir: bool, modified_unix: u64) -> String {
    let days = unix_time(SystemTime::now()).saturating_sub(modified_unix) / 86_400;
    if safe {
        format!("属于{category}，删除后通常可由软件重新生成；已约 {days} 天未修改。")
    } else if is_dir {
        format!(
            "这是{category}中的完整文件夹，可能包含原始资料；已约 {days} 天未修改，需确认内容后处理。"
        )
    } else {
        format!("这是{category}中的具体文件，可能仍有使用价值；已约 {days} 天未修改，需逐项确认。")
    }
}

fn display_path(path: &Path, home: &Path) -> String {
    path.strip_prefix(home)
        .map(|relative| format!("~/{}", relative.to_string_lossy()))
        .unwrap_or_else(|_| path.to_string_lossy().to_string())
}

fn cleanup_candidates_for_root(
    app: &AppDefinition,
    root: &Path,
    home: &Path,
    category: &str,
    safe: bool,
) -> Vec<CleanupCandidate> {
    const MIN_FILE_BYTES: u64 = 5 * 1024 * 1024;
    const MIN_FOLDER_BYTES: u64 = 50 * 1024 * 1024;
    let mut files = Vec::new();
    let mut direct_folders: HashMap<PathBuf, (u64, u64)> = HashMap::new();

    for entry in WalkDir::new(root).follow_links(false).into_iter().flatten() {
        if !entry.file_type().is_file() {
            continue;
        }
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
                if child.is_dir() {
                    let item = direct_folders.entry(child).or_default();
                    item.0 = item.0.saturating_add(size);
                    item.1 = item.1.max(modified);
                }
            }
        }

        if size < MIN_FILE_BYTES {
            continue;
        }
        let name = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("未命名文件")
            .to_string();
        files.push(CleanupCandidate {
            id: format!("{}:{}", app.id, path.to_string_lossy()),
            app_id: app.id.to_string(),
            app_name: app.name.to_string(),
            category: category.to_string(),
            display_name: name,
            display_path: display_path(path, home),
            path: path.to_string_lossy().to_string(),
            item_type: "file".to_string(),
            file_kind: candidate_kind(path, false),
            size_bytes: size,
            modified_unix: modified,
            risk: if safe { "safe" } else { "confirm" }.to_string(),
            reason: candidate_reason(category, safe, false, modified),
        });
    }

    let mut folders: Vec<CleanupCandidate> = direct_folders
        .into_iter()
        .filter(|(_, (size, _))| *size >= MIN_FOLDER_BYTES)
        .map(|(path, (size, modified))| CleanupCandidate {
            id: format!("{}:{}", app.id, path.to_string_lossy()),
            app_id: app.id.to_string(),
            app_name: app.name.to_string(),
            category: category.to_string(),
            display_name: path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("未命名文件夹")
                .to_string(),
            display_path: display_path(&path, home),
            path: path.to_string_lossy().to_string(),
            item_type: "folder".to_string(),
            file_kind: candidate_kind(&path, true),
            size_bytes: size,
            modified_unix: modified,
            risk: if safe { "safe" } else { "confirm" }.to_string(),
            reason: candidate_reason(category, safe, true, modified),
        })
        .collect();

    files.sort_by(|left, right| right.size_bytes.cmp(&left.size_bytes));
    folders.sort_by(|left, right| right.size_bytes.cmp(&left.size_bytes));
    files.truncate(80);
    folders.truncate(16);
    folders.extend(files);
    folders
}

#[tauri::command]
async fn scan_app_candidates(app_id: String) -> Result<Vec<CleanupCandidate>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let home = home_dir()?;
        let definition = app_definitions()
            .into_iter()
            .find(|item| item.id == app_id)
            .ok_or_else(|| "当前软件暂不支持文件级清理".to_string())?;
        let mut candidates = Vec::new();
        for (relative, category, safe) in definition.data_paths {
            let root = home.join(relative);
            if root.exists() {
                candidates.extend(cleanup_candidates_for_root(
                    &definition,
                    &root,
                    &home,
                    category,
                    *safe,
                ));
            }
        }
        candidates.sort_by(|left, right| right.size_bytes.cmp(&left.size_bytes));
        candidates.truncate(120);
        Ok(candidates)
    })
    .await
    .map_err(|error| format!("文件级扫描异常：{error}"))?
}

fn path_stats(path: &Path) -> PathStats {
    let mut stats = PathStats {
        hourly_growth_bytes: vec![0; 24],
        ..PathStats::default()
    };
    if !path.exists() {
        return stats;
    }
    let now = SystemTime::now();
    let day_ago = now
        .checked_sub(Duration::from_secs(24 * 60 * 60))
        .unwrap_or(now);
    for entry in WalkDir::new(path).follow_links(false).into_iter() {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => {
                stats.permission_errors += 1;
                continue;
            }
        };
        if !entry.file_type().is_file() {
            continue;
        }
        let metadata = match entry.metadata() {
            Ok(metadata) => metadata,
            Err(_) => {
                stats.permission_errors += 1;
                continue;
            }
        };
        let len = metadata.len();
        stats.size_bytes = stats.size_bytes.saturating_add(len);
        if let Ok(modified) = metadata.modified() {
            if modified >= day_ago {
                stats.modified_24h_bytes = stats.modified_24h_bytes.saturating_add(len);
                if let Ok(age) = now.duration_since(modified) {
                    let hours_ago = (age.as_secs() / 3600).min(23) as usize;
                    let bucket = 23usize.saturating_sub(hours_ago);
                    stats.hourly_growth_bytes[bucket] =
                        stats.hourly_growth_bytes[bucket].saturating_add(len);
                }
            }
        }
    }
    stats
}

fn application_bundles(home: &Path) -> Vec<PathBuf> {
    let mut bundles = Vec::new();
    for root in [PathBuf::from("/Applications"), home.join("Applications")] {
        let entries = match fs::read_dir(root) {
            Ok(entries) => entries,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|value| value.to_str()) == Some("app") {
                bundles.push(path);
            }
        }
    }
    bundles
}

fn scan_known_app(definition: &AppDefinition, home: &Path, bundles: &[PathBuf]) -> AppUsage {
    let mut categories = Vec::new();
    let mut total = 0u64;
    let mut modified = 0u64;
    let mut reclaimable = 0u64;
    let mut errors = 0u64;
    let mut hourly = vec![0u64; 24];
    let bundle = bundles.iter().find(|path| {
        path.file_name()
            .and_then(|value| value.to_str())
            .is_some_and(|name| definition.bundle_names.contains(&name))
    });

    if let Some(bundle_path) = bundle {
        let stats = path_stats(bundle_path);
        total = total.saturating_add(stats.size_bytes);
        modified = modified.saturating_add(stats.modified_24h_bytes);
        errors = errors.saturating_add(stats.permission_errors);
        merge_hourly(&mut hourly, &stats.hourly_growth_bytes);
        categories.push(ScanCategory {
            label: "应用程序".to_string(),
            size_bytes: stats.size_bytes,
            modified_24h_bytes: stats.modified_24h_bytes,
            safe_to_review: false,
        });
    }

    for (relative, label, safe) in definition.data_paths {
        let path = home.join(relative);
        if !path.exists() {
            continue;
        }
        let stats = path_stats(&path);
        total = total.saturating_add(stats.size_bytes);
        modified = modified.saturating_add(stats.modified_24h_bytes);
        errors = errors.saturating_add(stats.permission_errors);
        if *safe {
            reclaimable = reclaimable.saturating_add(stats.size_bytes);
        }
        merge_hourly(&mut hourly, &stats.hourly_growth_bytes);
        categories.push(ScanCategory {
            label: (*label).to_string(),
            size_bytes: stats.size_bytes,
            modified_24h_bytes: stats.modified_24h_bytes,
            safe_to_review: *safe,
        });
    }

    AppUsage {
        id: definition.id.to_string(),
        name: definition.name.to_string(),
        kind: definition.kind.to_string(),
        glyph: definition.glyph.to_string(),
        color: definition.color.to_string(),
        installed: bundle.is_some(),
        size_bytes: total,
        modified_24h_bytes: modified,
        reclaimable_bytes: reclaimable,
        hourly_growth_bytes: hourly,
        categories,
        permission_errors: errors,
    }
}

fn scan_generic_app(path: &Path) -> AppUsage {
    let name = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("应用")
        .to_string();
    let stats = path_stats(path);
    let glyph = name.chars().next().unwrap_or('A').to_string();
    AppUsage {
        id: format!("app-{}", name.to_lowercase().replace(' ', "-")),
        name,
        kind: "本机应用".to_string(),
        glyph,
        color: "#718eff".to_string(),
        installed: true,
        size_bytes: stats.size_bytes,
        modified_24h_bytes: stats.modified_24h_bytes,
        reclaimable_bytes: 0,
        hourly_growth_bytes: stats.hourly_growth_bytes,
        categories: vec![ScanCategory {
            label: "应用程序".to_string(),
            size_bytes: stats.size_bytes,
            modified_24h_bytes: stats.modified_24h_bytes,
            safe_to_review: false,
        }],
        permission_errors: stats.permission_errors,
    }
}

fn merge_hourly(target: &mut [u64], source: &[u64]) {
    for (target_value, source_value) in target.iter_mut().zip(source.iter()) {
        *target_value = target_value.saturating_add(*source_value);
    }
}

fn disk_space(path: &Path) -> Result<(u64, u64), String> {
    let c_path = std::ffi::CString::new(path.to_string_lossy().as_bytes())
        .map_err(|_| "磁盘路径无效".to_string())?;
    let mut stats = std::mem::MaybeUninit::<libc::statvfs>::uninit();
    let result = unsafe { libc::statvfs(c_path.as_ptr(), stats.as_mut_ptr()) };
    if result != 0 {
        return Err("无法读取磁盘容量".to_string());
    }
    let stats = unsafe { stats.assume_init() };
    let block_size = stats.f_frsize as u64;
    let total = (stats.f_blocks as u64).saturating_mul(block_size);
    let available = (stats.f_bavail as u64).saturating_mul(block_size);
    Ok((total, available))
}

fn os_version() -> String {
    std::process::Command::new("sw_vers")
        .arg("-productVersion")
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
        .filter(|value| !value.is_empty())
        .map(|value| format!("macOS {value}"))
        .unwrap_or_else(|| "macOS".to_string())
}

#[tauri::command]
async fn scan_system() -> Result<ScanResult, String> {
    tauri::async_runtime::spawn_blocking(scan_system_blocking)
        .await
        .map_err(|error| format!("扫描任务异常：{error}"))?
}

fn scan_system_blocking() -> Result<ScanResult, String> {
    let started = Instant::now();
    let home = home_dir()?;
    let bundles = application_bundles(&home);
    let definitions = app_definitions();

    let mut apps: Vec<AppUsage> = definitions
        .par_iter()
        .map(|definition| scan_known_app(definition, &home, &bundles))
        .filter(|app| app.installed || app.size_bytes > 0)
        .collect();

    let known_bundle_names: HashSet<&str> = definitions
        .iter()
        .flat_map(|definition| definition.bundle_names.iter().copied())
        .collect();

    let mut generic_apps: Vec<AppUsage> = bundles
        .par_iter()
        .filter(|path| {
            path.file_name()
                .and_then(|value| value.to_str())
                .is_some_and(|name| !known_bundle_names.contains(name))
        })
        .map(|path| scan_generic_app(path))
        .collect();
    generic_apps.sort_by(|left, right| right.size_bytes.cmp(&left.size_bytes));
    generic_apps.truncate(12);
    apps.extend(generic_apps);
    apps.sort_by(|left, right| right.size_bytes.cmp(&left.size_bytes));

    let recognized_apps_bytes = apps.iter().map(|app| app.size_bytes).sum();
    let modified_24h_bytes = apps.iter().map(|app| app.modified_24h_bytes).sum();
    let reclaimable_bytes = apps.iter().map(|app| app.reclaimable_bytes).sum();
    let permission_errors = apps.iter().map(|app| app.permission_errors).sum();
    let (disk_total_bytes, disk_available_bytes) = disk_space(Path::new("/"))?;

    Ok(ScanResult {
        scanned_at: format!("{:?}", SystemTime::now()),
        device_name: hostname::get()
            .ok()
            .and_then(|value| value.into_string().ok())
            .unwrap_or_else(|| "这台Mac".to_string()),
        os_version: os_version(),
        disk_total_bytes,
        disk_available_bytes,
        disk_used_bytes: disk_total_bytes.saturating_sub(disk_available_bytes),
        recognized_apps_bytes,
        modified_24h_bytes,
        reclaimable_bytes,
        apps,
        permission_errors,
        duration_ms: started.elapsed().as_millis(),
    })
}

fn quarantine_root(home: &Path) -> PathBuf {
    home.join("Library/Application Support/Qingpan/Quarantine")
}

fn validated_cleanup_target(app_id: &str, raw_path: &str) -> Result<PathBuf, String> {
    let home = home_dir()?;
    let definition = app_definitions()
        .into_iter()
        .find(|item| item.id == app_id)
        .ok_or_else(|| "当前软件不在安全清理白名单中".to_string())?;
    let target = PathBuf::from(raw_path)
        .canonicalize()
        .map_err(|_| "文件已不存在或无法访问".to_string())?;

    let allowed = definition.data_paths.iter().any(|(relative, _, _)| {
        home.join(relative)
            .canonicalize()
            .ok()
            .is_some_and(|root| target.starts_with(&root) && target != root)
    });
    if !allowed {
        return Err("出于安全考虑，只能处理已识别软件数据目录内的具体项目".to_string());
    }
    let metadata = fs::symlink_metadata(&target).map_err(|_| "无法读取待处理项目".to_string())?;
    if metadata.file_type().is_symlink() {
        return Err("为避免路径跳转，轻盘不会处理符号链接".to_string());
    }
    Ok(target)
}

fn unique_quarantine_id(index: usize) -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("{nanos}-{}-{index}", std::process::id())
}

fn read_quarantine_manifest(path: &Path) -> Result<QuarantineItem, String> {
    let value = fs::read_to_string(path).map_err(|error| format!("读取隔离记录失败：{error}"))?;
    serde_json::from_str(&value).map_err(|error| format!("隔离记录已损坏：{error}"))
}

fn valid_quarantine_id(id: &str) -> bool {
    !id.is_empty()
        && id
            .chars()
            .all(|value| value.is_ascii_digit() || value == '-')
}

#[tauri::command]
async fn quarantine_items(app_id: String, paths: Vec<String>) -> Result<CleanupBatch, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if paths.is_empty() {
            return Err("请至少选择一个文件或文件夹".to_string());
        }
        if paths.len() > 100 {
            return Err("单次最多处理100个项目".to_string());
        }
        let definition = app_definitions()
            .into_iter()
            .find(|item| item.id == app_id)
            .ok_or_else(|| "当前软件暂不支持安全清理".to_string())?;
        let mut targets = Vec::new();
        let mut seen = HashSet::new();
        for raw_path in paths {
            let target = validated_cleanup_target(&app_id, &raw_path)?;
            if seen.insert(target.clone()) {
                targets.push(target);
            }
        }
        targets.sort_by_key(|path| path.components().count());
        let mut deduplicated: Vec<PathBuf> = Vec::new();
        for target in targets {
            if !deduplicated.iter().any(|parent| target.starts_with(parent)) {
                deduplicated.push(target);
            }
        }

        let home = home_dir()?;
        let root = quarantine_root(&home);
        fs::create_dir_all(&root).map_err(|error| format!("创建隔离区失败：{error}"))?;
        let mut moved = Vec::new();
        let mut errors = Vec::new();

        for (index, target) in deduplicated.into_iter().enumerate() {
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
                app_id: app_id.clone(),
                app_name: definition.name.to_string(),
                display_name: display_name.clone(),
                original_path: target.to_string_lossy().to_string(),
                quarantine_path: payload.to_string_lossy().to_string(),
                item_type: if is_dir { "folder" } else { "file" }.to_string(),
                size_bytes,
                quarantined_unix: unix_time(SystemTime::now()),
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
    })
    .await
    .map_err(|error| format!("安全清理任务异常：{error}"))?
}

#[tauri::command]
fn list_quarantine_items() -> Result<Vec<QuarantineItem>, String> {
    let home = home_dir()?;
    let root = quarantine_root(&home);
    if !root.exists() {
        return Ok(Vec::new());
    }
    let mut items = Vec::new();
    for entry in fs::read_dir(root)
        .map_err(|error| format!("读取隔离区失败：{error}"))?
        .flatten()
    {
        let manifest = entry.path().join("manifest.json");
        if manifest.exists() {
            if let Ok(item) = read_quarantine_manifest(&manifest) {
                items.push(item);
            }
        }
    }
    items.sort_by(|left, right| right.quarantined_unix.cmp(&left.quarantined_unix));
    Ok(items)
}

#[tauri::command]
fn restore_quarantine_item(id: String) -> Result<(), String> {
    if !valid_quarantine_id(&id) {
        return Err("隔离记录编号无效".to_string());
    }
    let home = home_dir()?;
    let item_dir = quarantine_root(&home).join(&id);
    let manifest_path = item_dir.join("manifest.json");
    let item = read_quarantine_manifest(&manifest_path)?;
    let payload = item_dir.join("payload");
    let original = PathBuf::from(&item.original_path);
    if original.exists() {
        return Err("原位置已经存在同名文件，请先改名或移走后再恢复".to_string());
    }
    if let Some(parent) = original.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("重建原目录失败：{error}"))?;
    }
    fs::rename(&payload, &original).map_err(|error| format!("恢复失败：{error}"))?;
    fs::remove_file(&manifest_path).map_err(|error| format!("清理恢复记录失败：{error}"))?;
    fs::remove_dir(&item_dir).map_err(|error| format!("清理隔离目录失败：{error}"))?;
    Ok(())
}

#[tauri::command]
fn permanently_delete_quarantine_item(id: String) -> Result<(), String> {
    if !valid_quarantine_id(&id) {
        return Err("隔离记录编号无效".to_string());
    }
    let home = home_dir()?;
    let item_dir = quarantine_root(&home).join(&id);
    if !item_dir.starts_with(quarantine_root(&home)) || !item_dir.exists() {
        return Err("隔离项目不存在".to_string());
    }
    let _ = read_quarantine_manifest(&item_dir.join("manifest.json"))?;
    fs::remove_dir_all(&item_dir).map_err(|error| format!("永久删除失败：{error}"))
}

fn keyring_entry(provider: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, provider)
        .map_err(|error| format!("无法访问系统钥匙串：{error}"))
}

#[tauri::command]
fn save_api_key(provider: String, api_key: String) -> Result<(), String> {
    if api_key.trim().is_empty() {
        return Err("API Key不能为空".to_string());
    }
    keyring_entry(&provider)?
        .set_password(api_key.trim())
        .map_err(|error| format!("保存API Key失败：{error}"))
}

#[tauri::command]
fn api_key_status(provider: String) -> Result<bool, String> {
    match keyring_entry(&provider)?.get_password() {
        Ok(value) => Ok(!value.trim().is_empty()),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(error) => Err(format!("读取钥匙串状态失败：{error}")),
    }
}

#[tauri::command]
fn delete_api_key(provider: String) -> Result<(), String> {
    match keyring_entry(&provider)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(format!("移除API Key失败：{error}")),
    }
}

fn ai_summary(scan: &ScanResult) -> Value {
    json!({
        "disk": {
            "total_gb": scan.disk_total_bytes as f64 / 1_073_741_824.0,
            "available_gb": scan.disk_available_bytes as f64 / 1_073_741_824.0,
            "recognized_apps_gb": scan.recognized_apps_bytes as f64 / 1_073_741_824.0,
            "modified_24h_gb": scan.modified_24h_bytes as f64 / 1_073_741_824.0,
            "review_candidates_gb": scan.reclaimable_bytes as f64 / 1_073_741_824.0
        },
        "apps": scan.apps.iter().map(|app| json!({
            "name": app.name,
            "kind": app.kind,
            "installed": app.installed,
            "size_gb": app.size_bytes as f64 / 1_073_741_824.0,
            "modified_24h_gb": app.modified_24h_bytes as f64 / 1_073_741_824.0,
            "review_candidates_gb": app.reclaimable_bytes as f64 / 1_073_741_824.0,
            "categories": app.categories.iter().map(|category| json!({
                "label": category.label,
                "size_gb": category.size_bytes as f64 / 1_073_741_824.0,
                "safe_to_review": category.safe_to_review
            })).collect::<Vec<_>>()
        })).collect::<Vec<_>>(),
        "permission_errors": scan.permission_errors
    })
}

fn build_prompt(question: &str, scan: &ScanResult) -> String {
    format!(
        "你是轻盘AI空间分析助手。请只根据给出的匿名化磁盘汇总进行分析。\
        不要声称已经删除、移动或验证任何文件；不要建议删除原始项目、聊天记录、照片或文档。\
        请用简体中文输出：1.一句话结论；2.占用最大的三个来源；3.建议优先检查的内容；\
        4.风险提示；5.下一步操作。明确区分“应用占用”“过去24小时修改的文件体积”和“可检查候选”，\
        它们都不等于可以直接删除的空间。\n\n用户问题：{}\n\n扫描汇总：{}",
        question,
        ai_summary(scan)
    )
}

#[tauri::command]
async fn analyze_scan(
    provider: String,
    model: String,
    question: String,
    scan: ScanResult,
) -> Result<AiResponse, String> {
    let api_key = keyring_entry(&provider)?
        .get_password()
        .map_err(|_| format!("尚未配置{} API Key", provider.to_uppercase()))?;
    let prompt = build_prompt(&question, &scan);
    let client = Client::builder()
        .timeout(Duration::from_secs(90))
        .build()
        .map_err(|error| format!("创建AI请求失败：{error}"))?;

    let content = match provider.as_str() {
        "gemini" => call_gemini(&client, &api_key, &model, &prompt).await?,
        "deepseek" => {
            call_openai_compatible(
                &client,
                "https://api.deepseek.com/chat/completions",
                &api_key,
                &model,
                &prompt,
            )
            .await?
        }
        "openai" => call_openai(&client, &api_key, &model, &prompt).await?,
        _ => return Err("暂不支持该AI服务商".to_string()),
    };

    Ok(AiResponse {
        provider,
        model,
        content,
    })
}

#[tauri::command]
async fn analyze_cleanup_candidates(
    provider: String,
    model: String,
    question: String,
    candidates: Vec<CleanupCandidate>,
) -> Result<AiResponse, String> {
    if candidates.is_empty() {
        return Err("没有可供AI复核的文件".to_string());
    }
    let api_key = keyring_entry(&provider)?
        .get_password()
        .map_err(|_| format!("尚未配置{} API Key", provider.to_uppercase()))?;
    let now = unix_time(SystemTime::now());
    let anonymous_items: Vec<Value> = candidates
        .iter()
        .take(30)
        .enumerate()
        .map(|(index, item)| {
            json!({
                "item": index + 1,
                "app": item.app_name,
                "category": item.category,
                "kind": item.file_kind,
                "item_type": item.item_type,
                "size_mb": item.size_bytes as f64 / 1_048_576.0,
                "days_since_modified": now.saturating_sub(item.modified_unix) / 86_400,
                "local_risk": item.risk
            })
        })
        .collect();
    let prompt = format!(
        "你是轻盘的文件清理复核助手。你只收到匿名化元数据，没有文件正文、文件名或完整路径。\
        请根据可重建性、修改时间、类型和本地风险，为每一项给出：建议保留、可移入隔离区、或必须人工确认。\
        不得声称你已查看内容，不得直接执行删除。先给一句话结论，再按项目编号解释，最后给出最安全的处理顺序。\n\n\
        用户问题：{}\n\n匿名项目：{}",
        question,
        Value::Array(anonymous_items)
    );
    let client = Client::builder()
        .timeout(Duration::from_secs(90))
        .build()
        .map_err(|error| format!("创建AI请求失败：{error}"))?;
    let content = match provider.as_str() {
        "gemini" => call_gemini(&client, &api_key, &model, &prompt).await?,
        "deepseek" => {
            call_openai_compatible(
                &client,
                "https://api.deepseek.com/chat/completions",
                &api_key,
                &model,
                &prompt,
            )
            .await?
        }
        "openai" => call_openai(&client, &api_key, &model, &prompt).await?,
        _ => return Err("暂不支持该AI服务商".to_string()),
    };
    Ok(AiResponse {
        provider,
        model,
        content,
    })
}

async fn call_gemini(
    client: &Client,
    api_key: &str,
    model: &str,
    prompt: &str,
) -> Result<String, String> {
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent",
        model
    );
    let response = client
        .post(url)
        .header("x-goog-api-key", api_key)
        .json(&json!({
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"temperature": 0.2, "maxOutputTokens": 1400}
        }))
        .send()
        .await
        .map_err(|error| format!("Gemini请求失败：{error}"))?;
    let status = response.status();
    let body: Value = response
        .json()
        .await
        .map_err(|error| format!("Gemini返回解析失败：{error}"))?;
    if !status.is_success() {
        return Err(format!(
            "Gemini返回错误 {status}：{}",
            provider_error(&body)
        ));
    }
    body.pointer("/candidates/0/content/parts/0/text")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| "Gemini没有返回可显示的分析结果".to_string())
}

async fn call_openai_compatible(
    client: &Client,
    url: &str,
    api_key: &str,
    model: &str,
    prompt: &str,
) -> Result<String, String> {
    let response = client
        .post(url)
        .bearer_auth(api_key)
        .json(&json!({
            "model": model,
            "messages": [
                {"role": "system", "content": "你是谨慎的本地存储分析助手。"},
                {"role": "user", "content": prompt}
            ],
            "temperature": 0.2,
            "max_tokens": 1400
        }))
        .send()
        .await
        .map_err(|error| format!("AI请求失败：{error}"))?;
    let status = response.status();
    let body: Value = response
        .json()
        .await
        .map_err(|error| format!("AI返回解析失败：{error}"))?;
    if !status.is_success() {
        return Err(format!("AI返回错误 {status}：{}", provider_error(&body)));
    }
    body.pointer("/choices/0/message/content")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| "AI没有返回可显示的分析结果".to_string())
}

async fn call_openai(
    client: &Client,
    api_key: &str,
    model: &str,
    prompt: &str,
) -> Result<String, String> {
    let response = client
        .post("https://api.openai.com/v1/responses")
        .bearer_auth(api_key)
        .json(&json!({
            "model": model,
            "input": prompt,
            "max_output_tokens": 1400,
            "store": false
        }))
        .send()
        .await
        .map_err(|error| format!("OpenAI请求失败：{error}"))?;
    let status = response.status();
    let body: Value = response
        .json()
        .await
        .map_err(|error| format!("OpenAI返回解析失败：{error}"))?;
    if !status.is_success() {
        return Err(format!(
            "OpenAI返回错误 {status}：{}",
            provider_error(&body)
        ));
    }
    if let Some(text) = body.get("output_text").and_then(Value::as_str) {
        return Ok(text.to_string());
    }
    body.pointer("/output/0/content/0/text")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| "OpenAI没有返回可显示的分析结果".to_string())
}

fn provider_error(body: &Value) -> String {
    body.pointer("/error/message")
        .and_then(Value::as_str)
        .or_else(|| body.get("message").and_then(Value::as_str))
        .unwrap_or("未知错误")
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn path_stats_counts_files_without_reading_contents() {
        let root = std::env::temp_dir().join(format!(
            "qingpan-path-stats-{}",
            SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .expect("system clock")
                .as_nanos()
        ));
        fs::create_dir_all(root.join("nested")).expect("create test folders");
        let mut first = fs::File::create(root.join("first.bin")).expect("create first file");
        first.write_all(&[0; 7]).expect("write first file");
        let mut second =
            fs::File::create(root.join("nested/second.bin")).expect("create second file");
        second.write_all(&[0; 13]).expect("write second file");

        let stats = path_stats(&root);

        assert_eq!(stats.size_bytes, 20);
        assert_eq!(stats.modified_24h_bytes, 20);
        assert_eq!(stats.hourly_growth_bytes.iter().sum::<u64>(), 20);
        fs::remove_dir_all(root).expect("remove test folders");
    }

    #[test]
    #[ignore = "scans the current Mac and is run explicitly during release validation"]
    fn real_machine_scan_returns_disk_and_apps() {
        let scan = scan_system_blocking().expect("real machine scan");
        assert!(scan.disk_total_bytes > 0);
        assert!(scan.disk_total_bytes >= scan.disk_available_bytes);
        assert_eq!(
            scan.disk_used_bytes,
            scan.disk_total_bytes - scan.disk_available_bytes
        );
        assert!(!scan.device_name.is_empty());
        eprintln!(
            "Qingpan real scan: {} apps, {} bytes recognized, {} ms",
            scan.apps.len(),
            scan.recognized_apps_bytes,
            scan.duration_ms
        );
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            scan_system,
            scan_app_candidates,
            quarantine_items,
            list_quarantine_items,
            restore_quarantine_item,
            permanently_delete_quarantine_item,
            save_api_key,
            api_key_status,
            delete_api_key,
            analyze_scan,
            analyze_cleanup_candidates
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Qingpan desktop application");
}
