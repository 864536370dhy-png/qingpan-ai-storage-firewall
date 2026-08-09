use super::filesystem::{path_stats, PathStats};
use crate::{
    models::{ApplicationCategory, InstalledApplication, RiskLevel, SupportLevel},
    rules::{app_rules, AppRule, DataPathRule},
};
use plist::Value as PlistValue;
use rayon::prelude::*;
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
};

#[derive(Debug, Clone)]
struct ApplicationRoot {
    path: PathBuf,
    is_system_app: bool,
}

#[derive(Debug, Clone)]
struct DiscoveredBundle {
    path: PathBuf,
    is_system_app: bool,
}

#[derive(Debug, Default, Clone)]
struct BundleMetadata {
    bundle_id: Option<String>,
    display_name: Option<String>,
    bundle_name: Option<String>,
    version: Option<String>,
    bundle_version: Option<String>,
    icon_file: Option<String>,
}

fn application_roots(home: &Path) -> Vec<ApplicationRoot> {
    vec![
        ApplicationRoot {
            path: PathBuf::from("/Applications"),
            is_system_app: false,
        },
        ApplicationRoot {
            path: home.join("Applications"),
            is_system_app: false,
        },
        ApplicationRoot {
            path: PathBuf::from("/System/Applications"),
            is_system_app: true,
        },
        ApplicationRoot {
            path: PathBuf::from("/System/Applications/Utilities"),
            is_system_app: true,
        },
    ]
}

fn plist_string(dictionary: &plist::Dictionary, key: &str) -> Option<String> {
    dictionary
        .get(key)
        .and_then(PlistValue::as_string)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn read_bundle_metadata(app_path: &Path) -> BundleMetadata {
    let info_path = app_path.join("Contents/Info.plist");
    let dictionary = match PlistValue::from_file(info_path) {
        Ok(PlistValue::Dictionary(dictionary)) => dictionary,
        _ => return BundleMetadata::default(),
    };
    BundleMetadata {
        bundle_id: plist_string(&dictionary, "CFBundleIdentifier"),
        display_name: plist_string(&dictionary, "CFBundleDisplayName"),
        bundle_name: plist_string(&dictionary, "CFBundleName"),
        version: plist_string(&dictionary, "CFBundleShortVersionString"),
        bundle_version: plist_string(&dictionary, "CFBundleVersion"),
        icon_file: plist_string(&dictionary, "CFBundleIconFile"),
    }
}

fn discover_applications_in_roots(roots: &[ApplicationRoot]) -> (Vec<DiscoveredBundle>, u64) {
    let mut bundles = Vec::new();
    let mut seen_paths = HashSet::new();
    let mut permission_errors = 0_u64;

    for root in roots {
        if !root.path.exists() {
            continue;
        }
        let mut pending = vec![root.path.clone()];
        while let Some(directory) = pending.pop() {
            let entries = match fs::read_dir(&directory) {
                Ok(entries) => entries,
                Err(_) => {
                    permission_errors = permission_errors.saturating_add(1);
                    continue;
                }
            };
            for entry in entries {
                let entry = match entry {
                    Ok(entry) => entry,
                    Err(_) => {
                        permission_errors = permission_errors.saturating_add(1);
                        continue;
                    }
                };
                let path = entry.path();
                let metadata = match fs::symlink_metadata(&path) {
                    Ok(metadata) => metadata,
                    Err(_) => {
                        permission_errors = permission_errors.saturating_add(1);
                        continue;
                    }
                };
                if metadata.file_type().is_symlink() || !metadata.is_dir() {
                    continue;
                }
                let is_app = path
                    .extension()
                    .and_then(|value| value.to_str())
                    .is_some_and(|extension| extension.eq_ignore_ascii_case("app"));
                if is_app {
                    let identity = path.canonicalize().unwrap_or_else(|_| path.clone());
                    if seen_paths.insert(identity) {
                        bundles.push(DiscoveredBundle {
                            path,
                            is_system_app: root.is_system_app,
                        });
                    }
                } else {
                    pending.push(path);
                }
            }
        }
    }
    (bundles, permission_errors)
}

fn matching_rule<'a>(
    metadata: &BundleMetadata,
    bundle_path: &Path,
    rules: &'a [AppRule],
) -> Option<&'a AppRule> {
    let bundle_filename = bundle_path.file_name().and_then(|value| value.to_str());
    rules.iter().find(|rule| {
        metadata.bundle_id.as_deref().is_some_and(|bundle_id| {
            rule.bundle_ids
                .iter()
                .any(|candidate| candidate == &bundle_id)
        }) || bundle_filename.is_some_and(|filename| {
            rule.bundle_names
                .iter()
                .any(|candidate| candidate == &filename)
        })
    })
}

fn category_from_stats(rule: &DataPathRule, stats: PathStats) -> ApplicationCategory {
    ApplicationCategory {
        id: rule.category_id.to_string(),
        label: rule.label.to_string(),
        description: rule.description.to_string(),
        source_type: rule.source_type.to_string(),
        size_bytes: stats.size_bytes,
        modified_24h_bytes: stats.modified_24h_bytes,
        risk_level: rule.risk_level,
        reviewable: rule.reviewable,
        regenerable: rule.regenerable,
        protected: rule.protected,
        requires_app_quit: rule.requires_app_quit,
    }
}

fn generic_categories(bundle_id: Option<&str>, home: &Path) -> (Vec<ApplicationCategory>, u64) {
    let Some(bundle_id) = bundle_id.filter(|value| !value.contains('/') && !value.contains(".."))
    else {
        return (Vec::new(), 0);
    };
    let candidates = [
        (
            "cache",
            "缓存目录",
            "cache",
            home.join("Library/Caches").join(bundle_id),
        ),
        (
            "container",
            "应用容器",
            "container",
            home.join("Library/Containers").join(bundle_id),
        ),
        (
            "support",
            "应用支持数据",
            "application_support",
            home.join("Library/Application Support").join(bundle_id),
        ),
        (
            "logs",
            "日志目录",
            "log",
            home.join("Library/Logs").join(bundle_id),
        ),
    ];
    let mut permission_errors = 0_u64;
    let categories = candidates
        .into_iter()
        .filter_map(|(id, label, source_type, path)| {
            let metadata = fs::symlink_metadata(&path).ok()?;
            if metadata.file_type().is_symlink() {
                return None;
            }
            let stats = path_stats(&path);
            permission_errors = permission_errors.saturating_add(stats.permission_errors);
            Some(ApplicationCategory {
                id: format!("generic-{id}"),
                label: label.to_string(),
                description:
                    "依据 Bundle ID 关联的通用目录；规则尚未深度验证，不能声称可安全处理。"
                        .to_string(),
                source_type: source_type.to_string(),
                size_bytes: stats.size_bytes,
                modified_24h_bytes: stats.modified_24h_bytes,
                risk_level: RiskLevel::Unknown,
                reviewable: true,
                regenerable: false,
                protected: false,
                requires_app_quit: false,
            })
        })
        .collect();
    (categories, permission_errors)
}

fn resolve_icon(app_path: &Path, icon_file: Option<&str>) -> Option<String> {
    let icon_file = icon_file?;
    let filename = if Path::new(icon_file).extension().is_some() {
        icon_file.to_string()
    } else {
        format!("{icon_file}.icns")
    };
    let path = app_path.join("Contents/Resources").join(filename);
    path.exists().then(|| path.to_string_lossy().to_string())
}

fn fallback_name(path: &Path) -> String {
    path.file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("未知应用")
        .to_string()
}

fn stable_id(bundle_id: Option<&str>, path: &Path) -> String {
    bundle_id
        .map(str::to_string)
        .unwrap_or_else(|| format!("path:{}", path.to_string_lossy()))
}

fn fallback_color(id: &str) -> String {
    const COLORS: &[&str] = &["#7086d8", "#6ba8b8", "#8b78cc", "#b08069", "#5f9f83"];
    let index = id
        .bytes()
        .fold(0_usize, |sum, byte| sum.wrapping_add(byte as usize))
        % COLORS.len();
    COLORS[index].to_string()
}

fn scan_installed_application(
    discovered: &DiscoveredBundle,
    home: &Path,
    rules: &[AppRule],
) -> InstalledApplication {
    let metadata = read_bundle_metadata(&discovered.path);
    let rule = matching_rule(&metadata, &discovered.path, rules);
    let app_stats = path_stats(&discovered.path);
    let name = metadata
        .display_name
        .clone()
        .or_else(|| metadata.bundle_name.clone())
        .unwrap_or_else(|| fallback_name(&discovered.path));
    let raw_id = stable_id(metadata.bundle_id.as_deref(), &discovered.path);
    let (mut categories, mut permission_errors, support_level) = if let Some(rule) = rule {
        let mut errors = 0_u64;
        let categories = rule
            .data_paths
            .iter()
            .filter_map(|data_rule| {
                let path = home.join(data_rule.relative_path);
                let metadata = fs::symlink_metadata(&path).ok()?;
                if metadata.file_type().is_symlink() {
                    return None;
                }
                let stats = path_stats(&path);
                errors = errors.saturating_add(stats.permission_errors);
                Some(category_from_stats(data_rule, stats))
            })
            .collect();
        (categories, errors, rule.support_level)
    } else {
        let (categories, errors) = generic_categories(metadata.bundle_id.as_deref(), home);
        let level = if categories.is_empty() {
            SupportLevel::Basic
        } else {
            SupportLevel::Generic
        };
        (categories, errors, level)
    };

    categories.insert(
        0,
        ApplicationCategory {
            id: "application-bundle".to_string(),
            label: "应用本体".to_string(),
            description: "已安装的 .app 应用包，不属于建议检查的数据。".to_string(),
            source_type: "application_bundle".to_string(),
            size_bytes: app_stats.size_bytes,
            modified_24h_bytes: app_stats.modified_24h_bytes,
            risk_level: RiskLevel::Protected,
            reviewable: false,
            regenerable: false,
            protected: true,
            requires_app_quit: false,
        },
    );
    permission_errors = permission_errors.saturating_add(app_stats.permission_errors);
    let related_data_size_bytes = categories.iter().skip(1).map(|item| item.size_bytes).sum();
    let modified_24h_bytes = categories.iter().map(|item| item.modified_24h_bytes).sum();
    let reclaimable_bytes = categories
        .iter()
        .filter(|item| item.risk_level == RiskLevel::Safe && item.reviewable)
        .map(|item| item.size_bytes)
        .sum();
    let rule_id = rule.map(|rule| rule.rule_id.to_string());
    let glyph = rule
        .map(|rule| rule.glyph.to_string())
        .or_else(|| name.chars().next().map(|value| value.to_string()))
        .unwrap_or_else(|| "应".to_string());

    InstalledApplication {
        id: rule_id.unwrap_or_else(|| raw_id.clone()),
        bundle_id: metadata.bundle_id,
        name,
        version: metadata.version,
        bundle_version: metadata.bundle_version,
        application_path: Some(discovered.path.to_string_lossy().to_string()),
        icon_path: resolve_icon(&discovered.path, metadata.icon_file.as_deref()),
        installed: true,
        is_system_app: discovered.is_system_app,
        is_running: None,
        support_level,
        kind: rule
            .map(|rule| rule.category)
            .unwrap_or(if discovered.is_system_app {
                "系统应用"
            } else {
                "其他应用"
            })
            .to_string(),
        glyph,
        color: rule
            .map(|rule| rule.color.to_string())
            .unwrap_or_else(|| fallback_color(&raw_id)),
        app_size_bytes: app_stats.size_bytes,
        related_data_size_bytes,
        total_size_bytes: app_stats.size_bytes.saturating_add(related_data_size_bytes),
        modified_24h_bytes,
        reclaimable_bytes,
        permission_errors,
        categories,
    }
}

fn residual_application(rule: &AppRule, home: &Path) -> Option<InstalledApplication> {
    let mut permission_errors = 0_u64;
    let categories: Vec<_> = rule
        .data_paths
        .iter()
        .filter_map(|data_rule| {
            let path = home.join(data_rule.relative_path);
            let metadata = fs::symlink_metadata(&path).ok()?;
            if metadata.file_type().is_symlink() {
                return None;
            }
            let stats = path_stats(&path);
            permission_errors = permission_errors.saturating_add(stats.permission_errors);
            Some(category_from_stats(data_rule, stats))
        })
        .collect();
    let related_data_size_bytes: u64 = categories.iter().map(|item| item.size_bytes).sum();
    if related_data_size_bytes == 0 {
        return None;
    }
    let modified_24h_bytes = categories.iter().map(|item| item.modified_24h_bytes).sum();
    let reclaimable_bytes = categories
        .iter()
        .filter(|item| item.risk_level == RiskLevel::Safe && item.reviewable)
        .map(|item| item.size_bytes)
        .sum();
    Some(InstalledApplication {
        id: rule.rule_id.to_string(),
        bundle_id: rule.bundle_ids.first().map(|value| value.to_string()),
        name: rule.app_name.to_string(),
        version: None,
        bundle_version: None,
        application_path: None,
        icon_path: None,
        installed: false,
        is_system_app: false,
        is_running: None,
        support_level: rule.support_level,
        kind: rule.category.to_string(),
        glyph: rule.glyph.to_string(),
        color: rule.color.to_string(),
        app_size_bytes: 0,
        related_data_size_bytes,
        total_size_bytes: related_data_size_bytes,
        modified_24h_bytes,
        reclaimable_bytes,
        permission_errors,
        categories,
    })
}

pub fn scan_all_applications(home: &Path) -> (Vec<InstalledApplication>, u64) {
    let rules = app_rules();
    let (discovered, discovery_errors) = discover_applications_in_roots(&application_roots(home));
    let scanned: Vec<_> = discovered
        .par_iter()
        .map(|bundle| scan_installed_application(bundle, home, &rules))
        .collect();

    let mut apps = deduplicate_applications(scanned);

    let installed_rule_ids: HashSet<String> = apps
        .iter()
        .filter(|app| app.installed)
        .map(|app| app.id.clone())
        .collect();
    apps.extend(
        rules
            .iter()
            .filter(|rule| !installed_rule_ids.contains(rule.rule_id))
            .filter_map(|rule| residual_application(rule, home)),
    );
    (apps, discovery_errors)
}

fn deduplicate_applications(scanned: Vec<InstalledApplication>) -> Vec<InstalledApplication> {
    let mut seen_bundle_ids = HashSet::new();
    let mut seen_paths = HashSet::new();
    let mut apps = Vec::new();
    for app in scanned {
        let duplicate_bundle = app
            .bundle_id
            .as_ref()
            .is_some_and(|bundle_id| !seen_bundle_ids.insert(bundle_id.clone()));
        let duplicate_path = app
            .application_path
            .as_ref()
            .is_some_and(|path| !seen_paths.insert(path.clone()));
        if !duplicate_bundle && !duplicate_path {
            apps.push(app);
        }
    }
    apps
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_root(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "qingpan-app-{label}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    fn fake_app(root: &Path, name: &str, bundle_id: Option<&str>) -> PathBuf {
        let app = root.join(format!("{name}.app"));
        fs::create_dir_all(app.join("Contents/MacOS")).unwrap();
        fs::write(app.join("Contents/MacOS/test"), vec![0_u8; 32]).unwrap();
        let mut info = plist::Dictionary::new();
        info.insert(
            "CFBundleDisplayName".into(),
            PlistValue::String(name.into()),
        );
        info.insert(
            "CFBundleShortVersionString".into(),
            PlistValue::String("1.2.3".into()),
        );
        info.insert("CFBundleVersion".into(), PlistValue::String("45".into()));
        if let Some(bundle_id) = bundle_id {
            info.insert(
                "CFBundleIdentifier".into(),
                PlistValue::String(bundle_id.into()),
            );
        }
        PlistValue::Dictionary(info)
            .to_file_xml(app.join("Contents/Info.plist"))
            .unwrap();
        app
    }

    #[test]
    fn reads_info_plist_metadata() {
        let root = test_root("metadata");
        let app = fake_app(&root, "Fixture", Some("com.example.fixture"));
        let metadata = read_bundle_metadata(&app);
        assert_eq!(metadata.bundle_id.as_deref(), Some("com.example.fixture"));
        assert_eq!(metadata.display_name.as_deref(), Some("Fixture"));
        assert_eq!(metadata.version.as_deref(), Some("1.2.3"));
        assert_eq!(metadata.bundle_version.as_deref(), Some("45"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn missing_bundle_id_falls_back_to_path_identity() {
        let root = test_root("fallback");
        let app_path = fake_app(&root, "NoIdentifier", None);
        let discovered = DiscoveredBundle {
            path: app_path.clone(),
            is_system_app: false,
        };
        let app = scan_installed_application(&discovered, &root, &[]);
        assert!(app.id.starts_with("path:"));
        assert_eq!(app.support_level, SupportLevel::Basic);
        assert_eq!(app.categories[0].risk_level, RiskLevel::Protected);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn unknown_associated_directories_default_to_unknown_risk() {
        let root = test_root("unknown-risk");
        let applications = root.join("Applications");
        let app_path = fake_app(&applications, "Generic", Some("com.example.generic"));
        let cache = root.join("Library/Caches/com.example.generic");
        fs::create_dir_all(&cache).unwrap();
        fs::write(cache.join("cache.bin"), vec![0_u8; 64]).unwrap();
        let discovered = DiscoveredBundle {
            path: app_path,
            is_system_app: false,
        };
        let app = scan_installed_application(&discovered, &root, &[]);
        assert_eq!(app.support_level, SupportLevel::Generic);
        assert_eq!(app.categories[1].risk_level, RiskLevel::Unknown);
        assert!(!app.categories[1].regenerable);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn discovery_deduplicates_paths_and_bundle_ids() {
        let root = test_root("dedupe");
        let first = root.join("first");
        let second = root.join("second");
        fake_app(&first, "One", Some("com.example.same"));
        fake_app(&second, "Two", Some("com.example.same"));
        let roots = vec![
            ApplicationRoot {
                path: first,
                is_system_app: false,
            },
            ApplicationRoot {
                path: second,
                is_system_app: false,
            },
        ];
        let (found, _) = discover_applications_in_roots(&roots);
        let scanned = found
            .iter()
            .map(|item| scan_installed_application(item, &root, &[]))
            .collect();
        assert_eq!(deduplicate_applications(scanned).len(), 1);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn classifies_system_and_user_roots() {
        let root = test_root("classification");
        let user = root.join("user");
        let system = root.join("system");
        fake_app(&user, "UserTool", Some("com.example.user"));
        fake_app(&system, "SystemTool", Some("com.example.system"));
        let roots = vec![
            ApplicationRoot {
                path: user,
                is_system_app: false,
            },
            ApplicationRoot {
                path: system,
                is_system_app: true,
            },
        ];
        let (found, errors) = discover_applications_in_roots(&roots);
        assert_eq!(errors, 0);
        assert_eq!(found.iter().filter(|item| item.is_system_app).count(), 1);
        assert_eq!(found.iter().filter(|item| !item.is_system_app).count(), 1);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn unreadable_or_missing_roots_do_not_abort_discovery() {
        let root = test_root("partial");
        let valid = root.join("valid");
        fake_app(&valid, "Visible", Some("com.example.visible"));
        let roots = vec![
            ApplicationRoot {
                path: root.join("missing"),
                is_system_app: false,
            },
            ApplicationRoot {
                path: valid,
                is_system_app: false,
            },
        ];
        let (found, _) = discover_applications_in_roots(&roots);
        assert_eq!(found.len(), 1);
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn permission_error_does_not_hide_apps_from_readable_roots() {
        use std::os::unix::fs::PermissionsExt;
        let root = test_root("permission");
        let readable = root.join("readable");
        let unreadable = root.join("unreadable");
        fake_app(&readable, "Visible", Some("com.example.visible"));
        fs::create_dir_all(&unreadable).unwrap();
        fs::set_permissions(&unreadable, fs::Permissions::from_mode(0o000)).unwrap();
        let roots = vec![
            ApplicationRoot {
                path: unreadable.clone(),
                is_system_app: false,
            },
            ApplicationRoot {
                path: readable,
                is_system_app: false,
            },
        ];
        let (found, errors) = discover_applications_in_roots(&roots);
        assert_eq!(found.len(), 1);
        if unsafe { libc::geteuid() } != 0 {
            assert!(errors > 0);
        }
        fs::set_permissions(&unreadable, fs::Permissions::from_mode(0o700)).unwrap();
        fs::remove_dir_all(root).unwrap();
    }
}
