//! Read-only access to the computer's Pictures library. Files stay where they are.
use std::{
    collections::HashSet,
    fs,
    io,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

use base64::Engine;
use image::ImageFormat;
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::State;

use crate::desktop::DesktopState;

const MAX_DEPTH: usize = 24;
const MAX_PHOTOS: usize = 25_000;
const MAX_ROOTS: usize = 24;
const MAX_IMAGE_BYTES: u64 = 160 * 1024 * 1024;
const MAX_PIXELS: u64 = 120_000_000;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryRoot {
    path: String,
    name: String,
    removable: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryPhoto {
    path: String,
    name: String,
    size: u64,
    modified_at: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySnapshot {
    roots: Vec<LibraryRoot>,
    photos: Vec<LibraryPhoto>,
    truncated: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryImage {
    mime_type: &'static str,
    data_base64: String,
}

fn supported(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|value| value.to_str())
            .unwrap_or("")
            .to_ascii_lowercase()
            .as_str(),
        "jpg" | "jpeg" | "png" | "webp" | "gif" | "bmp" | "tif" | "tiff"
    )
}

fn modified_at(metadata: &fs::Metadata) -> u64 {
    metadata.modified().ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn system_picture_folders() -> Vec<PathBuf> {
    let mut result = Vec::new();
    if let Some(home) = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")) {
        result.push(PathBuf::from(home).join("Pictures"));
    }
    for key in ["OneDrive", "OneDriveConsumer", "OneDriveCommercial"] {
        if let Some(dir) = std::env::var_os(key) {
            result.push(PathBuf::from(dir).join("Pictures"));
        }
    }
    // Respect the freedesktop user-dirs configuration when available.
    if let Some(home) = std::env::var_os("HOME") {
        let home = PathBuf::from(home);
        if let Ok(content) = fs::read_to_string(home.join(".config/user-dirs.dirs")) {
            for line in content.lines() {
                if let Some(raw) = line.trim().strip_prefix("XDG_PICTURES_DIR=") {
                    let raw = raw.trim().trim_matches('"');
                    if let Some(suffix) = raw.strip_prefix("$HOME/") {
                        result.push(home.join(suffix));
                    } else if raw.starts_with('/') {
                        result.push(PathBuf::from(raw));
                    }
                }
            }
        }
    }
    result
}

fn registered_folders(data_dir: &Path) -> Result<Vec<String>, String> {
    let path = data_dir.join("photo-library-folders.json");
    if !path.exists() { return Ok(Vec::new()); }
    let value = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str::<Vec<String>>(&value)
        .map_err(|error| format!("照片图库配置损坏: {error}"))
}

fn save_registered(data_dir: &Path, folders: &[String]) -> Result<(), String> {
    fs::create_dir_all(data_dir).map_err(|error| error.to_string())?;
    let target = data_dir.join("photo-library-folders.json");
    let temporary = data_dir.join("photo-library-folders.json.tmp");
    fs::write(&temporary, serde_json::to_vec(folders).map_err(|error| error.to_string())?)
        .map_err(|error| error.to_string())?;
    fs::rename(&temporary, target).map_err(|error| error.to_string())
}

fn roots(data_dir: &Path) -> Result<Vec<LibraryRoot>, String> {
    let mut result = Vec::new();
    let mut seen = HashSet::new();
    for folder in system_picture_folders() {
        if !folder.is_dir() { continue; }
        if let Ok(path) = fs::canonicalize(folder) {
            if seen.insert(path.clone()) {
                result.push(LibraryRoot {
                    name: "系统图片".to_owned(),
                    path: path.to_string_lossy().to_string(),
                    removable: false,
                });
            }
        }
    }
    for folder in registered_folders(data_dir)? {
        if let Ok(path) = fs::canonicalize(&folder) {
            if path.is_dir() && seen.insert(path.clone()) {
                let name = path.file_name().unwrap_or_default().to_string_lossy().to_string();
                result.push(LibraryRoot {
                    name,
                    path: path.to_string_lossy().to_string(),
                    removable: true,
                });
            }
        }
    }
    Ok(result)
}

fn library_scan(data_dir: &Path) -> Result<LibrarySnapshot, String> {
    let roots = roots(data_dir)?;
    let mut photos = Vec::new();
    let mut seen = HashSet::new();
    let mut pending: Vec<(PathBuf, usize)> = roots
        .iter().map(|root| (PathBuf::from(&root.path), 0)).collect();
    let mut truncated = false;
    while let Some((folder, depth)) = pending.pop() {
        if depth > MAX_DEPTH { truncated = true; continue; }
        let entries = match fs::read_dir(&folder) {
            Ok(entries) => entries,
            Err(_) => continue, // One unreadable folder must not break the whole gallery.
        };
        for entry in entries {
            let Ok(entry) = entry else { continue };
            let path = entry.path();
            let Ok(metadata) = fs::symlink_metadata(&path) else { continue };
            if metadata.file_type().is_symlink() { continue; }
            if metadata.is_dir() {
                pending.push((path, depth + 1));
            } else if metadata.is_file() && supported(&path) && seen.insert(path.clone()) {
                if photos.len() >= MAX_PHOTOS {
                    truncated = true;
                    pending.clear();
                    break;
                }
                photos.push(LibraryPhoto {
                    name: path.file_name().unwrap_or_default().to_string_lossy().to_string(),
                    path: path.to_string_lossy().to_string(),
                    size: metadata.len(),
                    modified_at: modified_at(&metadata),
                });
            }
        }
    }
    photos.sort_by(|a, b| b.modified_at.cmp(&a.modified_at).then_with(|| a.path.cmp(&b.path)));
    Ok(LibrarySnapshot { roots, photos, truncated })
}

fn add_folder(data_dir: &Path, path: String) -> Result<(), String> {
    let candidate = fs::canonicalize(&path)
        .map_err(|error| format!("无法找到所选图库文件夹: {error}"))?;
    if !candidate.is_dir() { return Err("所选路径不是文件夹".to_owned()); }
    let mut configured = registered_folders(data_dir)?;
    let canonical = candidate.to_string_lossy().to_string();
    if !configured.iter().any(|value| value == &canonical) {
        if configured.len() >= MAX_ROOTS {
            return Err(format!("最多添加 {MAX_ROOTS} 个图库文件夹"));
        }
        configured.push(canonical);
        save_registered(data_dir, &configured)?;
    }
    Ok(())
}

fn remove_folder(data_dir: &Path, path: String) -> Result<(), String> {
    let mut configured = registered_folders(data_dir)?;
    configured.retain(|value| value != &path);
    save_registered(data_dir, &configured)
}

fn image_from_library(data_dir: &Path, path: &str, kind: &str) -> Result<LibraryImage, String> {
    if !matches!(kind, "thumbnail" | "preview") {
        return Err("不支持的图片尺寸".to_owned());
    }
    let original = Path::new(path);
    if !supported(original) {
        return Err("不支持的图片格式".to_owned());
    }
    let original_meta = fs::symlink_metadata(original)
        .map_err(|error| format!("无法读取照片: {error}"))?;
    if original_meta.file_type().is_symlink() || !original_meta.is_file()
        || original_meta.len() > MAX_IMAGE_BYTES
    {
        return Err("照片不可读取，或文件超过 160MB".to_owned());
    }
    let canonical = fs::canonicalize(original).map_err(|error| error.to_string())?;
    let allowed = roots(data_dir)?.iter().any(|root| canonical.starts_with(&root.path));
    if !allowed { return Err("照片不属于已经授权的本地图库".to_owned()); }

    let width = if kind == "thumbnail" { 360 } else { 1920 };
    let digest = Sha256::digest(format!(
        "{}:{}:{}:{}",
        canonical.display(), original_meta.len(), modified_at(&original_meta), width
    ).as_bytes());
    let cache_dir = data_dir.join("photo-library-thumbnails");
    let cache_file = cache_dir.join(format!("{digest:x}.jpg"));
    let bytes = if cache_file.is_file() {
        fs::read(&cache_file).map_err(|error| error.to_string())?
    } else {
        let reader = image::ImageReader::open(&canonical)
            .map_err(|error| error.to_string())?
            .with_guessed_format()
            .map_err(|error| error.to_string())?;
        let (w, h) = reader.into_dimensions().map_err(|error| error.to_string())?;
        if u64::from(w) * u64::from(h) > MAX_PIXELS {
            return Err("照片分辨率过大，暂无法预览".to_owned());
        }
        let image = image::open(&canonical)
            .map_err(|error| format!("无法解码原图: {error}"))?;
        fs::create_dir_all(&cache_dir).map_err(|error| error.to_string())?;
        let temporary = cache_dir.join(format!("{digest:x}-{}.tmp", std::process::id()));
        image.thumbnail(width, width)
            .save_with_format(&temporary, ImageFormat::Jpeg)
            .map_err(|error| error.to_string())?;
        if fs::rename(&temporary, &cache_file).is_err() {
            fs::remove_file(&temporary).ok(); // Concurrent request may have won the race.
        }
        fs::read(&cache_file).map_err(|error| error.to_string())?
    };
    Ok(LibraryImage {
        mime_type: "image/jpeg",
        data_base64: base64::engine::general_purpose::STANDARD.encode(bytes),
    })
}

#[tauri::command]
pub async fn photo_library_scan(state: State<'_, DesktopState>) -> Result<LibrarySnapshot, String> {
    let data_dir = state.data_dir.clone();
    tauri::async_runtime::spawn_blocking(move || library_scan(&data_dir))
        .await.map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn photo_library_add_folder(
    state: State<'_, DesktopState>,
    path: String,
) -> Result<(), String> {
    let data_dir = state.data_dir.clone();
    tauri::async_runtime::spawn_blocking(move || add_folder(&data_dir, path))
        .await.map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn photo_library_remove_folder(
    state: State<'_, DesktopState>,
    path: String,
) -> Result<(), String> {
    let data_dir = state.data_dir.clone();
    tauri::async_runtime::spawn_blocking(move || remove_folder(&data_dir, path))
        .await.map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn photo_library_image(
    state: State<'_, DesktopState>,
    path: String,
    kind: String,
) -> Result<LibraryImage, String> {
    let data_dir = state.data_dir.clone();
    tauri::async_runtime::spawn_blocking(move || image_from_library(&data_dir, &path, &kind))
        .await.map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn supported_image_extensions_only() {
        assert!(supported(Path::new("photo.JPG")));
        assert!(supported(Path::new("photo.TiFf")));
        assert!(!supported(Path::new("notes.pdf")));
        assert!(!supported(Path::new("video.mp4")));
    }

    #[test]
    fn scans_nested_folders_without_importing_or_changing_files() {
        let dir = std::env::temp_dir().join(format!("lifetrace-library-{}", uuid::Uuid::new_v4()));
        let data_dir = dir.join("config");
        let pictures = dir.join("pictures").join("nested");
        fs::create_dir_all(&pictures).unwrap();
        let file = pictures.join("sample.JPG");
        fs::write(&file, b"unchanged").unwrap();
        add_folder(&data_dir, dir.join("pictures").to_string_lossy().to_string()).unwrap();
        let snapshot = library_scan(&data_dir).unwrap();
        assert!(snapshot.photos.iter().any(|image| image.name == "sample.JPG"));
        assert_eq!(fs::read(&file).unwrap(), b"unchanged");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn rejects_images_outside_authorized_folders() {
        let dir = std::env::temp_dir().join(format!("lifetrace-library-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let external = dir.join("external.png");
        fs::write(&external, b"test").unwrap();
        let result = image_from_library(&dir.join("empty-config"), &external.to_string_lossy(), "thumbnail");
        assert!(result.is_err());
        fs::remove_dir_all(dir).unwrap();
    }
}
