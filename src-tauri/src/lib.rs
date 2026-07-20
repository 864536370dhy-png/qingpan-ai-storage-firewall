use rayon::prelude::*;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    time::{Duration, Instant, SystemTime},
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
            save_api_key,
            api_key_status,
            delete_api_key,
            analyze_scan
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Qingpan desktop application");
}
