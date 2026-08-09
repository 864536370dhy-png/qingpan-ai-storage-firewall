const KEYRING_SERVICE: &str = "com.qingpan.desktop.ai";

pub(crate) fn keyring_entry(provider: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, provider)
        .map_err(|error| format!("无法访问系统钥匙串：{error}"))
}

#[tauri::command]
pub fn save_api_key(provider: String, api_key: String) -> Result<(), String> {
    if api_key.trim().is_empty() {
        return Err("API Key不能为空".to_string());
    }
    keyring_entry(&provider)?
        .set_password(api_key.trim())
        .map_err(|error| format!("保存API Key失败：{error}"))
}

#[tauri::command]
pub fn api_key_status(provider: String) -> Result<bool, String> {
    match keyring_entry(&provider)?.get_password() {
        Ok(value) => Ok(!value.trim().is_empty()),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(error) => Err(format!("读取钥匙串状态失败：{error}")),
    }
}

#[tauri::command]
pub fn delete_api_key(provider: String) -> Result<(), String> {
    match keyring_entry(&provider)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(format!("移除API Key失败：{error}")),
    }
}
