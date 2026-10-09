//! Read-only access to the computer's Pictures library. Files stay where they are.
use std::{
    collections::HashSet,
    fs,
    io::Read,
    path::{Component, Path, PathBuf},
    sync::Mutex,
    time::UNIX_EPOCH,
};

use base64::Engine;
use image::ImageFormat;
use serde::Serialize;
use rusqlite::{params, OptionalExtension};
use sha2::{Digest, Sha256};
use tauri::State;

use crate::desktop::DesktopState;

const MAX_DEPTH: usize = 24;
const MAX_PHOTOS: usize = 25_000;
const MAX_ROOTS: usize = 24;
const MAX_IMAGE_BYTES: u64 = 160 * 1024 * 1024;
const MAX_PIXELS: u64 = 120_000_000;
static INDEX_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryRoot {
    path: String,
    name: String,
    removable: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryPhoto {
    path: String,
    name: String,
    size: u64,
    modified_at: u64,
}

#[derive(Clone, Serialize)]
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
    library_scan_roots(roots(data_dir)?)
}

// Production scans system Pictures plus registered folders; tests supply an
// explicit fixture root list so they cannot index the developer's real photos.
fn library_scan_roots(roots: Vec<LibraryRoot>) -> Result<LibrarySnapshot, String> {
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


fn modified_at_nanos(metadata: &fs::Metadata) -> i64 {
    metadata.modified().ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .and_then(|duration| i64::try_from(duration.as_nanos()).ok())
        .unwrap_or(0)
}

fn mime_type(path: &Path) -> &'static str {
    match path.extension().and_then(|extension| extension.to_str())
        .unwrap_or("").to_ascii_lowercase().as_str()
    {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        "tif" | "tiff" => "image/tiff",
        _ => "application/octet-stream",
    }
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|error| error.to_string())?;
    let mut hash = Sha256::new();
    let mut buffer = [0_u8; 128 * 1024];
    loop {
        let n = file.read(&mut buffer).map_err(|error| error.to_string())?;
        if n == 0 { break; }
        Digest::update(&mut hash, &buffer[..n]);
    }
    Ok(format!("{:x}", hash.finalize()))
}

/// Safely return only paths under the application's managed-photo directory.
/// No local-library original is ever a deletion target.
fn managed_file(data_dir: &Path, relative: &str) -> Option<PathBuf> {
    let relative = Path::new(relative);
    if !relative.components().all(|part| matches!(part, Component::Normal(_))) {
        return None;
    }
    let mut parts = relative.components();
    if !matches!(parts.next(), Some(Component::Normal(name)) if name == "originals" || name == "thumbnails") {
        return None;
    }
    if parts.next().is_none() { return None; }
    let root = fs::canonicalize(data_dir.join("photos")).ok()?;
    let candidate = fs::canonicalize(data_dir.join("photos").join(relative)).ok()?;
    if !candidate.starts_with(&root) || candidate == root { return None; }
    Some(candidate)
}

/// Migrate existing footprint links and remove an old imported copy only after
/// a byte-for-byte SHA-256 match with a live local-library file.
fn remove_matching_managed_copy(
    connection: &mut rusqlite::Connection,
    data_dir: &Path,
    local_id: &str,
    path: &Path,
    file_size: u64,
) -> Result<usize, String> {
    let candidates: i64 = connection.query_row(
        "SELECT COUNT(*) FROM photos WHERE storage_type='managed' AND deleted_at IS NULL
         AND processing_status='completed' AND file_size=?1",
        [file_size as i64], |row| row.get(0),
    ).map_err(|error| error.to_string())?;
    if candidates == 0 { return Ok(0); }
    let hash = sha256_file(path)?;
    let imported: Option<(String, String, Option<String>)> = connection.query_row(
        "SELECT id,original_path,thumbnail_path FROM photos
         WHERE content_hash=?1 AND storage_type='managed' AND deleted_at IS NULL
           AND processing_status='completed'",
        [&hash],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    ).optional().map_err(|error| error.to_string())?;
    let Some((old_id, original_path, thumbnail_path)) = imported else {
        return Ok(0);
    };
    let Some(old_original) = managed_file(data_dir, &original_path) else {
        return Ok(0);
    };
    // Check the old managed file is still the same content. A stale DB hash must
    // never make us remove an unrelated edited copy.
    if old_original == path ||
        !old_original.is_file() ||
        sha256_file(&old_original).ok().as_deref() != Some(hash.as_str())
    {
        return Ok(0);
    }
    let have_footprint_links: i64 = connection.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='footprint_entry_photos'",
        [], |row| row.get(0)
    ).map_err(|error| error.to_string())?;
    if have_footprint_links == 0 { return Ok(0); }
    let txn = connection.transaction().map_err(|error| error.to_string())?;
    txn.execute(
        "INSERT OR IGNORE INTO footprint_entry_photos(entry_id,photo_id,sort_order,is_cover,created_at)
         SELECT entry_id,?1,sort_order,is_cover,created_at FROM footprint_entry_photos WHERE photo_id=?2",
        params![local_id, old_id],
    ).map_err(|error| error.to_string())?;
    txn.execute("DELETE FROM footprint_entry_photos WHERE photo_id=?1", [&old_id])
        .map_err(|error| error.to_string())?;
    txn.execute("UPDATE photo_upload_tasks SET photo_id=?1 WHERE photo_id=?2",
        params![local_id, old_id]).map_err(|error| error.to_string())?;
    txn.execute("DELETE FROM photo_device_assets WHERE photo_id=?1", [&old_id])
        .map_err(|error| error.to_string())?;
    txn.execute("DELETE FROM photos WHERE id=?1 AND storage_type='managed'", [&old_id])
        .map_err(|error| error.to_string())?;
    txn.commit().map_err(|error| error.to_string())?;
    // Database references now resolve to the local original. Delete only the
    // verified managed duplicate and its generated thumbnail, never the source.
    if let Err(error) = fs::remove_file(&old_original) {
        eprintln!("LifeTrace managed duplicate cleanup failed: {error}");
    }
    if let Some(thumb) = thumbnail_path.and_then(|p| managed_file(data_dir, &p)) {
        if let Err(error) = fs::remove_file(&thumb) {
            eprintln!("LifeTrace managed thumbnail cleanup failed: {error}");
        }
    }
    Ok(1)
}

/// Store references and EXIF metadata in the same 'photos' table as footprint
/// recommendations. No original photos are copied, moved, or modified.
fn index_snapshot(data_dir: &Path, snapshot: &LibrarySnapshot) -> Result<(usize, usize), String> {
    let _guard = INDEX_LOCK.lock().map_err(|_| "图库索引锁不可用".to_owned())?;
    fs::create_dir_all(data_dir).map_err(|error| error.to_string())?;
    let mut connection = crate::database::connection::open(&data_dir.join("lifetrace.db"))
        .map_err(|error| error.to_string())?;
    crate::server::photo::ensure_schema(&connection).map_err(|error| error.to_string())?;
    let mut changed = 0;
    let mut cleaned = 0;
    let mut indexed = HashSet::new();
    let allowed: Vec<PathBuf> = roots(data_dir)?.iter().map(|root| PathBuf::from(&root.path)).collect();

    for photo in &snapshot.photos {
        let original = Path::new(&photo.path);
        if !supported(original) { continue; }
        let Ok(meta) = fs::symlink_metadata(original) else { continue };
        if meta.file_type().is_symlink() || !meta.is_file() || meta.len() > MAX_IMAGE_BYTES { continue; }
        let Ok(path) = fs::canonicalize(original) else { continue };
        if !allowed.iter().any(|root| path.starts_with(root)) { continue; }
        let identity = format!("{:x}", Sha256::digest(path.to_string_lossy().as_bytes()));
        let id = format!("local_{identity}");
        let mtime = modified_at_nanos(&meta);
        indexed.insert(id.clone());
        let previous: Option<(i64, Option<i64>, String)> = connection.query_row(
            "SELECT file_size,local_modified_at,processing_status FROM photos
             WHERE id=?1 AND storage_type='local' AND deleted_at IS NULL",
            [&id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        ).optional().map_err(|error| error.to_string())?;
        if previous.as_ref().is_some_and(|(size, modified, status)| {
            *size == meta.len() as i64 && *modified == Some(mtime) && status == "completed"
        }) {
            // A prior indexing pass may have stopped before cleaning managed copies.
            cleaned += remove_matching_managed_copy(&mut connection, data_dir, &id, &path, meta.len())?;
            continue;
        }
        let exif = crate::server::photo::read_exif_metadata_from_path(&path);
        let dims = image::ImageReader::open(&path).ok()
            .and_then(|reader| reader.with_guessed_format().ok())
            .and_then(|reader| reader.into_dimensions().ok());
        let (width, height) = dims.map(|(w, h)| (Some(i64::from(w)), Some(i64::from(h))))
            .unwrap_or((None, None));
        let path_text = path.to_string_lossy().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        connection.execute(
            "INSERT INTO photos (
              id,content_hash,original_file_name,stored_file_name,original_path,thumbnail_path,
              media_type,mime_type,file_size,width,height,captured_at,latitude,longitude,
              exif_scanned_at,imported_at,processing_status,storage_type,local_file_path,local_modified_at
             ) VALUES (
              ?1,?2,?3,?4,'',NULL,'image',?5,?6,?7,?8,?9,?10,?11,?12,?13,'completed','local',?14,?15
             ) ON CONFLICT(id) DO UPDATE SET
              original_file_name=excluded.original_file_name,
              stored_file_name=excluded.stored_file_name,
              mime_type=excluded.mime_type,
              file_size=excluded.file_size,width=excluded.width,height=excluded.height,
              captured_at=excluded.captured_at,latitude=excluded.latitude,longitude=excluded.longitude,
              exif_scanned_at=excluded.exif_scanned_at,processing_status='completed',
              processing_error=NULL,local_file_path=excluded.local_file_path,
              local_modified_at=excluded.local_modified_at
             WHERE photos.storage_type='local'",
            params![
                id, format!("local-path:{identity}"), photo.name, photo.name,
                mime_type(&path), meta.len() as i64, width, height,
                exif.captured_at, exif.latitude, exif.longitude,
                now, now, path_text, mtime,
            ],
        ).map_err(|error| error.to_string())?;
        changed += 1;
        cleaned += remove_matching_managed_copy(&mut connection, data_dir, &id, &path, meta.len())?;
    }
    // A complete scan may mark removed paths unavailable; do not remove the
    // record or footprint links. A truncated scan cannot detect deletions.
    if !snapshot.truncated {
        let mut stmt = connection.prepare(
            "SELECT id FROM photos WHERE storage_type='local' AND deleted_at IS NULL
             AND processing_status='completed'"
        ).map_err(|error| error.to_string())?;
        let known = stmt.query_map([], |row| row.get::<_, String>(0))
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>().map_err(|error| error.to_string())?;
        drop(stmt);
        for id in known {
            if !indexed.contains(&id) {
                connection.execute(
                    "UPDATE photos SET processing_status='unavailable' WHERE id=?1 AND storage_type='local'",
                    [&id],
                ).map_err(|error| error.to_string())?;
            }
        }
    }
    Ok((changed, cleaned))
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


fn authorized_file(data_dir: &Path, path: &str) -> Result<PathBuf, String> {
    let original = Path::new(path);
    if !supported(original) { return Err("不支持的图片格式".to_owned()); }
    let meta = fs::symlink_metadata(original).map_err(|error| format!("无法读取照片: {error}"))?;
    if meta.file_type().is_symlink() || !meta.is_file() || meta.len() > MAX_IMAGE_BYTES {
        return Err("照片不可读取，或文件超过 160MB".to_owned());
    }
    let canonical = fs::canonicalize(original).map_err(|error| error.to_string())?;
    let allowed = roots(data_dir)?.iter().any(|root| canonical.starts_with(Path::new(&root.path)));
    if !allowed { return Err("照片不属于已经授权的本地图库".to_owned()); }
    Ok(canonical)
}

pub(crate) fn original_bytes_from_library(
    data_dir: &Path, path: &str,
) -> Result<(Vec<u8>, String), String> {
    let canonical = authorized_file(data_dir, path)?;
    let mime = mime_type(&canonical).to_owned();
    let bytes = fs::read(&canonical).map_err(|error| error.to_string())?;
    Ok((bytes, mime))
}

pub(crate) fn preview_bytes_from_library(
    data_dir: &Path, path: &str, kind: &str,
) -> Result<Vec<u8>, String> {
    if !matches!(kind, "thumbnail" | "preview") {
        return Err("不支持的图片尺寸".to_owned());
    }
    let canonical = authorized_file(data_dir, path)?;
    let meta = fs::metadata(&canonical).map_err(|error| error.to_string())?;
    let width = if kind == "thumbnail" { 360 } else { 1920 };
    let digest = Sha256::digest(format!(
        "{}:{}:{}:{}",
        canonical.display(), meta.len(), modified_at(&meta), width
    ).as_bytes());
    let cache_dir = data_dir.join("photo-library-thumbnails");
    let cache_file = cache_dir.join(format!("{digest:x}.jpg"));
    if cache_file.is_file() {
        return fs::read(&cache_file).map_err(|error| error.to_string());
    }
    let reader = image::ImageReader::open(&canonical).map_err(|error| error.to_string())?
        .with_guessed_format().map_err(|error| error.to_string())?;
    let (w, h) = reader.into_dimensions().map_err(|error| error.to_string())?;
    if u64::from(w) * u64::from(h) > MAX_PIXELS {
        return Err("照片分辨率过大，暂无法预览".to_owned());
    }
    let image = image::open(&canonical).map_err(|error| format!("无法解码原图: {error}"))?;
    fs::create_dir_all(&cache_dir).map_err(|error| error.to_string())?;
    let temporary = cache_dir.join(format!("{digest:x}-{}.tmp", uuid::Uuid::new_v4()));
    image.thumbnail(width, width).save_with_format(&temporary, ImageFormat::Jpeg)
        .map_err(|error| error.to_string())?;
    if fs::rename(&temporary, &cache_file).is_err() { fs::remove_file(&temporary).ok(); }
    fs::read(&cache_file).map_err(|error| error.to_string())
}

fn image_from_library(data_dir: &Path, path: &str, kind: &str) -> Result<LibraryImage, String> {
    let bytes = preview_bytes_from_library(data_dir, path, kind)?;
    Ok(LibraryImage {
        mime_type: "image/jpeg",
        data_base64: base64::engine::general_purpose::STANDARD.encode(bytes),
    })
}

#[tauri::command]
pub async fn photo_library_scan(state: State<'_, DesktopState>) -> Result<LibrarySnapshot, String> {
    let data_dir = state.data_dir.clone();
    let snapshot = tauri::async_runtime::spawn_blocking({
        let data_dir = data_dir.clone();
        move || library_scan(&data_dir)
    }).await.map_err(|error| error.to_string())??;
    let to_index = snapshot.clone();
    tauri::async_runtime::spawn_blocking(move || {
        match index_snapshot(&data_dir, &to_index) {
            Ok((updated, removed)) => eprintln!("LifeTrace indexed {updated} local photo records; cleaned {removed} verified imported copies"),
            Err(error) => eprintln!("LifeTrace local photo metadata indexing failed: {error}"),
        }
    });
    Ok(snapshot)
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

    fn scan_registered_fixture(data_dir: &Path) -> LibrarySnapshot {
        let folders = registered_folders(data_dir).unwrap();
        let roots = folders.into_iter().map(|folder| {
            let path = fs::canonicalize(folder).unwrap();
            LibraryRoot {
                name: path.file_name().unwrap_or_default().to_string_lossy().into_owned(),
                path: path.to_string_lossy().into_owned(),
                removable: true,
            }
        }).collect();
        library_scan_roots(roots).unwrap()
    }

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
        let snapshot = scan_registered_fixture(&data_dir);
        assert!(snapshot.photos.iter().any(|image| image.name == "sample.JPG"));
        assert_eq!(fs::read(&file).unwrap(), b"unchanged");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn fixture_scan_does_not_include_unregistered_neighbor_folders() {
        let dir = std::env::temp_dir().join(format!("lifetrace-gallery-fixture-{}", uuid::Uuid::new_v4()));
        let data = dir.join("data");
        let included = dir.join("included");
        let excluded = dir.join("excluded");
        fs::create_dir_all(&included).unwrap();
        fs::create_dir_all(&excluded).unwrap();
        fs::write(included.join("one.jpg"), b"fixture one").unwrap();
        fs::write(excluded.join("other.jpg"), b"fixture two").unwrap();
        add_folder(&data, included.to_string_lossy().to_string()).unwrap();
        let result = scan_registered_fixture(&data);
        assert_eq!(result.photos.len(), 1);
        assert_eq!(result.photos[0].name, "one.jpg");
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
    #[test]
    fn indexes_local_metadata_without_copying_originals() {
        let dir = std::env::temp_dir().join(format!("lifetrace-local-index-{}", uuid::Uuid::new_v4()));
        let data = dir.join("data");
        let photos = dir.join("Pictures");
        fs::create_dir_all(&photos).unwrap();
        let file = photos.join("sample.jpg");
        image::RgbImage::from_pixel(4, 4, image::Rgb([20, 40, 60])).save(&file).unwrap();
        let bytes = fs::read(&file).unwrap();
        add_folder(&data, photos.to_string_lossy().to_string()).unwrap();
        let snapshot = scan_registered_fixture(&data);
        assert_eq!(index_snapshot(&data, &snapshot).unwrap(), (1, 0));
        assert_eq!(index_snapshot(&data, &snapshot).unwrap(), (0, 0));
        assert_eq!(fs::read(&file).unwrap(), bytes);

        let db = crate::database::connection::open(&data.join("lifetrace.db")).unwrap();
        let (storage, name, width, height, gps): (String, String, Option<i64>, Option<i64>, Option<f64>) =
            db.query_row(
                "SELECT storage_type,original_file_name,width,height,latitude FROM photos
                 WHERE local_file_path=?1", [fs::canonicalize(&file).unwrap().to_string_lossy().to_string()],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
            ).unwrap();
        assert_eq!(storage, "local");
        assert_eq!(name, "sample.jpg");
        assert_eq!((width, height), (Some(4), Some(4)));
        assert!(gps.is_none());
        drop(db);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn verified_import_duplicate_is_deleted_and_footprint_link_migrated() {
        let dir = std::env::temp_dir().join(format!("lifetrace-dedup-{}", uuid::Uuid::new_v4()));
        let data = dir.join("data");
        let originals = data.join("photos").join("originals");
        let pictures = dir.join("Pictures");
        fs::create_dir_all(&originals).unwrap();
        fs::create_dir_all(&pictures).unwrap();
        let source = pictures.join("same.jpg");
        image::RgbImage::from_pixel(4, 4, image::Rgb([100, 140, 180])).save(&source).unwrap();
        let old = originals.join("old.jpg");
        fs::copy(&source, &old).unwrap();
        let hash = sha256_file(&source).unwrap();

        let db = crate::database::connection::open(&data.join("lifetrace.db")).unwrap();
        db.execute_batch(
            "CREATE TABLE footprint_entry_photos (
                entry_id TEXT NOT NULL,photo_id TEXT NOT NULL,
                sort_order INTEGER NOT NULL,is_cover INTEGER NOT NULL,
                created_at TEXT NOT NULL,PRIMARY KEY(entry_id,photo_id)
            );"
        ).unwrap();
        crate::server::photo::ensure_schema(&db).unwrap();
        db.execute(
            "INSERT INTO photos(id,content_hash,original_file_name,stored_file_name,original_path,
                media_type,mime_type,file_size,imported_at,processing_status)
              VALUES('old',?1,'same.jpg','old.jpg','originals/old.jpg','image','image/jpeg',?2,
                '2026-01-01T00:00:00Z','completed')",
            params![hash, fs::metadata(&old).unwrap().len() as i64],
        ).unwrap();
        db.execute(
            "INSERT INTO footprint_entry_photos VALUES('trip','old',0,1,'2026-01-01')", [],
        ).unwrap();
        drop(db);

        add_folder(&data, pictures.to_string_lossy().to_string()).unwrap();
        let snapshot = scan_registered_fixture(&data);
        assert_eq!(index_snapshot(&data, &snapshot).unwrap(), (1, 1));
        assert!(source.is_file(), "the local original must remain intact");
        assert!(!old.exists(), "only the verified imported copy is removed");

        let db = crate::database::connection::open(&data.join("lifetrace.db")).unwrap();
        let old_count: i64 = db.query_row(
            "SELECT COUNT(*) FROM photos WHERE id='old'", [], |row| row.get(0)
        ).unwrap();
        assert_eq!(old_count, 0);
        let linked_source: String = db.query_row(
            "SELECT p.storage_type FROM photos p JOIN footprint_entry_photos ep ON p.id=ep.photo_id
             WHERE ep.entry_id='trip'", [], |row| row.get(0)
        ).unwrap();
        assert_eq!(linked_source, "local");
        drop(db);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn unmatched_old_import_remains_untouched() {
        let dir = std::env::temp_dir().join(format!("lifetrace-unmatched-{}", uuid::Uuid::new_v4()));
        let data = dir.join("data");
        let originals = data.join("photos").join("originals");
        let pictures = dir.join("Pictures");
        fs::create_dir_all(&originals).unwrap();
        fs::create_dir_all(&pictures).unwrap();
        let new_file = pictures.join("new.jpg");
        image::RgbImage::from_pixel(2, 2, image::Rgb([0, 255, 0])).save(&new_file).unwrap();
        let old = originals.join("unique.jpg");
        fs::write(&old, b"an original without a matching local file").unwrap();
        let hash = sha256_file(&old).unwrap();
        let db = crate::database::connection::open(&data.join("lifetrace.db")).unwrap();
        crate::server::photo::ensure_schema(&db).unwrap();
        db.execute(
            "INSERT INTO photos(id,content_hash,original_file_name,stored_file_name,original_path,
                media_type,file_size,imported_at,processing_status)
              VALUES('old',?1,'unique.jpg','unique.jpg','originals/unique.jpg','image',?2,
                '2026-01-01T00:00:00Z','completed')",
            params![hash, fs::metadata(&new_file).unwrap().len() as i64],
        ).unwrap();
        drop(db);
        add_folder(&data, pictures.to_string_lossy().to_string()).unwrap();
        let snap = scan_registered_fixture(&data);
        assert_eq!(index_snapshot(&data, &snap).unwrap(), (1, 0));
        assert!(old.exists());
        fs::remove_dir_all(dir).unwrap();
    }

}
