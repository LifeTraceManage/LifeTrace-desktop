use std::{
    path::PathBuf,
    process::Command,
};

use serde_json::{json, Value};
use tauri::State;
use tokio::fs;

pub struct DesktopState {
    pub data_dir: PathBuf,
}

#[tauri::command]
pub fn desktop_open_url(url: String) -> Result<(), String> {
    let parsed = url::Url::parse(&url).map_err(|_| "链接地址无效".to_owned())?;
    if !matches!(parsed.scheme(), "http" | "https" | "mailto") {
        return Err("不允许打开该类型的链接".to_owned());
    }

    #[cfg(target_os = "windows")]
    let result = Command::new("rundll32")
        .arg("url.dll,FileProtocolHandler")
        .arg(parsed.as_str())
        .spawn();
    #[cfg(target_os = "macos")]
    let result = Command::new("open").arg(parsed.as_str()).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let result = Command::new("xdg-open").arg(parsed.as_str()).spawn();

    result
        .map(|_| ())
        .map_err(|error| format!("无法调用系统默认浏览器：{error}"))
}

#[tauri::command]
pub async fn write_text_file(path: String, content: String) -> Result<Value, String> {
    fs::write(path, content)
        .await
        .map_err(|value| value.to_string())?;
    Ok(json!({ "ok": true }))
}

#[tauri::command]
pub async fn read_text_file(path: String) -> Result<String, String> {
    fs::read_to_string(path)
        .await
        .map_err(|value| value.to_string())
}
