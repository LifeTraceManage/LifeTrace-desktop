//! Import computer photo files into the same local library used by the album and footprints.
//! Source files are never modified; importing copies originals and deduplicates by SHA-256.

use std::{
    collections::HashSet,
    fs::{self, File},
    io::{BufReader, Read},
    path::{Path, PathBuf},
};

use chrono::Utc;
use image::ImageFormat;
use rusqlite::{params, OptionalExtension};
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::State;
use uuid::Uuid;

use crate::{database, desktop::DesktopState, server::photo};

const MAX_PHOTOS_PER_SELECTION: usize = 20_000;
const MAX_DIRECTORY_DEPTH: usize = 32;
const MAX_PHOTO_BYTES: u64 = 500 * 1024 * 1024;

fn supported_extension(path: &Path) -> Option<&'static str> {
    let extension = path.extension()?.to_str()?;
    match extension.to_ascii_lowercase().as_str() {
        "jpg" | "jpeg" => Some("image/jpeg"),
        "png" => Some("image/png"),
        "webp" => Some("image/webp"),
        "gif" => Some("image/gif"),
        "bmp" => Some("image/bmp"),
        "tif" | "tiff" => Some("image/tiff"),
        _ => None,
    }
}

fn collect_photo_paths(paths: &[String]) -> Result<Vec<String>, String> {
    let mut found = Vec::new();
    let mut visited = HashSet::new();
    let mut pending: Vec<(PathBuf, usize)> = paths
        .iter()
        .map(|path| (PathBuf::from(path), 0))
        .collect();

    while let Some((path, depth)) = pending.pop() {
        let metadata = fs::symlink_metadata(&path)
            .map_err(|error| format!("无法访问 {}: {error}", path.display()))?;
        if metadata.file_type().is_symlink() {
            continue; // Never traverse links outside a selected folder.
        }
        if metadata.is_dir() {
            if depth >= MAX_DIRECTORY_DEPTH {
                return Err("文件夹嵌套过深，请选择更具体的照片文件夹".to_owned());
            }
            for entry in fs::read_dir(&path)
                .map_err(|error| format!("无法读取 {}: {error}", path.display()))?
            {
                let entry = entry.map_err(|error| error.to_string())?;
                pending.push((entry.path(), depth + 1));
            }
        } else if metadata.is_file()
            && supported_extension(&path).is_some()
            && visited.insert(path.clone())
        {
            if found.len() >= MAX_PHOTOS_PER_SELECTION {
                return Err(format!(
                    "本次最多导入 {MAX_PHOTOS_PER_SELECTION} 张照片，请分批选择文件夹"
                ));
            }
            found.push(path.to_string_lossy().to_string());
        }
    }
    found.sort();
    Ok(found)
}

#[tauri::command]
pub async fn photo_scan_local_paths(paths: Vec<String>) -> Result<Vec<String>, String> {
    if paths.is_empty() || paths.len() > MAX_PHOTOS_PER_SELECTION {
        return Err("请先选择照片或文件夹".to_owned());
    }
    tauri::async_runtime::spawn_blocking(move || collect_photo_paths(&paths))
        .await
        .map_err(|error| format!("无法扫描所选照片: {error}"))?
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    status: &'static str,
    photo_id: String,
}

fn clean_file_name(path: &Path) -> String {
    path.file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .chars()
        .filter(|character| !character.is_control())
        .take(180)
        .collect()
}

fn import_photo_file(data_dir: &Path, source: &Path) -> Result<ImportResult, String> {
    let mime_type = supported_extension(source)
        .ok_or_else(|| "仅支持 JPG、PNG、WebP、GIF、BMP 和 TIFF 照片".to_owned())?;
    let metadata = fs::symlink_metadata(source).map_err(|error| error.to_string())?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err("照片文件不存在或是符号链接".to_owned());
    }
    if metadata.len() == 0 || metadata.len() > MAX_PHOTO_BYTES {
        return Err("照片必须大于 0 字节且不超过 500 MB".to_owned());
    }

    // Streaming hash avoids loading large originals into IPC or process memory.
    let mut reader = BufReader::new(File::open(source).map_err(|error| error.to_string())?);
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 128 * 1024];
    loop {
        let length = reader.read(&mut buffer).map_err(|error| error.to_string())?;
        if length == 0 { break; }
        hasher.update(&buffer[..length]);
    }
    let content_hash = format!("{:x}", hasher.finalize());
    let connection = database::connection::open(&data_dir.join("lifetrace.db"))
        .map_err(|error| error.to_string())?;

    // Includes hidden/deleted records: never re-expose a hidden photo on import.
    if let Some(id) = connection
        .query_row("SELECT id FROM photos WHERE content_hash=?1", [&content_hash], |row| row.get(0))
        .optional()
        .map_err(|error| error.to_string())?
    {
        return Ok(ImportResult { status: "duplicate", photo_id: id });
    }

    let decoded = image::open(source)
        .map_err(|error| format!("无法解码照片（文件可能已损坏）: {error}"))?;
    let exif = photo::read_exif_metadata_from_path(source);
    let photo_id = format!("photo_{}", Uuid::new_v4());
    let extension = source.extension().and_then(|value| value.to_str())
        .unwrap_or("jpg").to_ascii_lowercase();
    let file_name = format!("{photo_id}.{extension}");
    let root = data_dir.join("photos");
    let originals = root.join("originals");
    let thumbnails = root.join("thumbnails");
    fs::create_dir_all(&originals).map_err(|error| error.to_string())?;
    fs::create_dir_all(&thumbnails).map_err(|error| error.to_string())?;
    let original_path = originals.join(&file_name);
    let partial_path = originals.join(format!("{file_name}.part"));
    let thumb_name = format!("{photo_id}.jpg");
    let thumb_path = thumbnails.join(&thumb_name);

    let persist = (|| -> Result<usize, String> {
        fs::copy(source, &partial_path)
            .map_err(|error| format!("复制原图失败: {error}"))?;
        fs::rename(&partial_path, &original_path)
            .map_err(|error| format!("归档原图失败: {error}"))?;
        decoded.thumbnail(640, 640)
            .save_with_format(&thumb_path, ImageFormat::Jpeg)
            .map_err(|error| format!("生成缩略图失败: {error}"))?;
        let stamp = Utc::now().to_rfc3339();
        connection.execute(
            "INSERT OR IGNORE INTO photos (
                id, content_hash, original_file_name, stored_file_name, original_path,
                thumbnail_path, media_type, mime_type, file_size, width, height,
                captured_at, latitude, longitude, exif_scanned_at, imported_at,
                processing_status, source_device_id
            ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, 'image', ?7, ?8, ?9, ?10,
                ?11, ?12, ?13, ?14, ?15, 'completed', NULL
            )",
            params![
                photo_id, content_hash, clean_file_name(source), file_name,
                format!("originals/{file_name}"), format!("thumbnails/{thumb_name}"),
                mime_type, metadata.len() as i64, decoded.width() as i64,
                decoded.height() as i64, exif.captured_at, exif.latitude,
                exif.longitude, stamp, stamp
            ],
        )
        .map_err(|error| format!("记录照片索引失败: {error}"))
    })();

    match persist {
        Ok(1) => Ok(ImportResult { status: "imported", photo_id }),
        outcome => {
            // No orphaned library files on failed insert, including a concurrent duplicate.
            fs::remove_file(&partial_path).ok();
            fs::remove_file(&original_path).ok();
            fs::remove_file(&thumb_path).ok();
            match outcome {
                Ok(_) => {
                    let id = connection.query_row(
                        "SELECT id FROM photos WHERE content_hash=?1",
                        [&content_hash],
                        |row| row.get(0)
                    ).map_err(|error| error.to_string())?;
                    Ok(ImportResult { status: "duplicate", photo_id: id })
                }
                Err(error) => Err(error),
            }
        }
    }
}

#[tauri::command]
pub async fn photo_import_local_file(
    state: State<'_, DesktopState>,
    path: String,
) -> Result<ImportResult, String> {
    let data_dir = state.data_dir.clone();
    tauri::async_runtime::spawn_blocking(move || import_photo_file(&data_dir, Path::new(&path)))
        .await
        .map_err(|error| format!("照片导入任务中断: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extensions_are_restricted_to_decodable_images() {
        assert_eq!(supported_extension(Path::new("photo.JPG")), Some("image/jpeg"));
        assert_eq!(supported_extension(Path::new("photo.heic")), None);
        assert_eq!(supported_extension(Path::new("photo.mp4")), None);
    }

    #[test]
    fn directory_scan_finds_nested_images_without_other_files() {
        let root = std::env::temp_dir().join(format!("lifetrace-photo-scan-{}", Uuid::new_v4()));
        let nested = root.join("nested");
        fs::create_dir_all(&nested).unwrap();
        fs::write(root.join("one.jpg"), b"fixture").unwrap();
        fs::write(nested.join("two.PNG"), b"fixture").unwrap();
        fs::write(nested.join("notes.txt"), b"fixture").unwrap();
        let files = collect_photo_paths(&[root.to_string_lossy().to_string()]).unwrap();
        assert_eq!(files.len(), 2);
        assert!(files.iter().any(|path| path.ends_with("one.jpg")));
        assert!(files.iter().any(|path| path.ends_with("two.PNG")));
        fs::remove_dir_all(root).unwrap();
    }
}
