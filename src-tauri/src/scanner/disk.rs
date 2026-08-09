use std::{ffi::CString, path::Path, process::Command};

pub fn disk_space(path: &Path) -> Result<(u64, u64), String> {
    let c_path = CString::new(path.to_string_lossy().as_bytes())
        .map_err(|_| "磁盘路径包含无效字符".to_string())?;
    let mut stats = std::mem::MaybeUninit::<libc::statvfs>::uninit();
    let result = unsafe { libc::statvfs(c_path.as_ptr(), stats.as_mut_ptr()) };
    if result != 0 {
        return Err("无法读取磁盘容量".to_string());
    }
    let stats = unsafe { stats.assume_init() };
    Ok((
        (stats.f_blocks as u64).saturating_mul(stats.f_frsize as u64),
        (stats.f_bavail as u64).saturating_mul(stats.f_frsize as u64),
    ))
}

pub fn os_version() -> String {
    Command::new("sw_vers")
        .arg("-productVersion")
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
        .filter(|value| !value.is_empty())
        .map(|value| format!("macOS {value}"))
        .unwrap_or_else(|| "macOS".to_string())
}
