use std::{
    collections::HashMap,
    io::Cursor,
    net::{Ipv4Addr, SocketAddr},
    path::{Path, PathBuf},
    sync::Arc,
};

use axum::{
    extract::{Path as AxumPath, Query, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use chrono::{NaiveDateTime, Utc};
use exif::{In, Reader as ExifReader, Tag, Value as ExifValue};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use tokio::{fs, net::TcpListener};

use super::AppState;

// Retained for local IPC callers. LAN pairing and upload services were removed.
pub struct Runtime;

impl Runtime {
    pub fn new(_data_dir: PathBuf) -> Arc<Self> {
        Arc::new(Self)
    }
}

#[derive(Debug, Clone, Default)]
pub(crate) struct PhotoExifMetadata {
    pub(crate) captured_at: Option<String>,
    pub(crate) latitude: Option<f64>,
    pub(crate) longitude: Option<f64>,
}

fn exif_ascii(value: &ExifValue) -> Option<String> {
    match value {
        ExifValue::Ascii(values) => values
            .first()
            .map(|value| String::from_utf8_lossy(value).trim().to_owned())
            .filter(|value| !value.is_empty()),
        _ => None,
    }
}

fn normalize_exif_datetime(value: &str) -> Option<String> {
    NaiveDateTime::parse_from_str(value.trim(), "%Y:%m:%d %H:%M:%S")
        .ok()
        .map(|value| value.format("%Y-%m-%dT%H:%M:%S").to_string())
}

fn gps_coordinate(value: &ExifValue, reference: &str) -> Option<f64> {
    let ExifValue::Rational(parts) = value else {
        return None;
    };
    if parts.len() < 3 || parts.iter().take(3).any(|part| part.denom == 0) {
        return None;
    }
    let coordinate = parts[0].to_f64()
        + parts[1].to_f64() / 60.0
        + parts[2].to_f64() / 3600.0;
    let sign = match reference.trim().to_ascii_uppercase().as_str() {
        "S" | "W" => -1.0,
        "N" | "E" => 1.0,
        _ => return None,
    };
    Some(coordinate * sign)
}

fn photo_exif_metadata(exif: &exif::Exif) -> PhotoExifMetadata {
    let captured_at = exif
        .get_field(Tag::DateTimeOriginal, In::PRIMARY)
        .or_else(|| exif.get_field(Tag::DateTime, In::PRIMARY))
        .and_then(|field| exif_ascii(&field.value))
        .and_then(|value| normalize_exif_datetime(&value));

    let latitude_ref = exif
        .get_field(Tag::GPSLatitudeRef, In::PRIMARY)
        .and_then(|field| exif_ascii(&field.value));
    let longitude_ref = exif
        .get_field(Tag::GPSLongitudeRef, In::PRIMARY)
        .and_then(|field| exif_ascii(&field.value));

    let latitude = exif
        .get_field(Tag::GPSLatitude, In::PRIMARY)
        .and_then(|field| {
            latitude_ref
                .as_deref()
                .and_then(|reference| gps_coordinate(&field.value, reference))
        })
        .filter(|value| (-90.0..=90.0).contains(value));
    let longitude = exif
        .get_field(Tag::GPSLongitude, In::PRIMARY)
        .and_then(|field| {
            longitude_ref
                .as_deref()
                .and_then(|reference| gps_coordinate(&field.value, reference))
        })
        .filter(|value| (-180.0..=180.0).contains(value));

    PhotoExifMetadata {
        captured_at,
        latitude,
        longitude,
    }
}

fn read_exif_metadata(bytes: &[u8]) -> PhotoExifMetadata {
    let mut cursor = Cursor::new(bytes);
    let Ok(exif) = ExifReader::new().read_from_container(&mut cursor) else {
        return PhotoExifMetadata::default();
    };
    photo_exif_metadata(&exif)
}

pub(crate) fn read_exif_metadata_from_path(path: &Path) -> PhotoExifMetadata {
    let Ok(file) = std::fs::File::open(path) else {
        return PhotoExifMetadata::default();
    };
    let mut reader = std::io::BufReader::new(file);
    let Ok(exif) = ExifReader::new().read_from_container(&mut reader) else {
        return PhotoExifMetadata::default();
    };
    photo_exif_metadata(&exif)
}

#[derive(Debug, Clone)]
struct PhotoExifCandidate {
    id: String,
    relative_path: String,
}

fn pending_exif_candidates(
    connection: &Connection,
    limit: i64,
) -> rusqlite::Result<Vec<PhotoExifCandidate>> {
    let limit = limit.clamp(1, 100);
    let mut statement = connection.prepare(
        "SELECT id,original_path
         FROM photos
         WHERE deleted_at IS NULL
           AND media_type='image'
           AND processing_status='completed'
           AND exif_scanned_at IS NULL
         ORDER BY imported_at DESC
         LIMIT ?1"
    )?;
    let rows = statement.query_map([limit], |row| {
        Ok(PhotoExifCandidate {
            id: row.get(0)?,
            relative_path: row.get(1)?,
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>()
}

fn apply_exif_metadata(
    connection: &Connection,
    photo_id: &str,
    metadata: &PhotoExifMetadata,
) -> rusqlite::Result<usize> {
    connection.execute(
        "UPDATE photos
         SET captured_at=COALESCE(captured_at,?1),
             latitude=COALESCE(latitude,?2),
             longitude=COALESCE(longitude,?3),
             exif_scanned_at=?4
         WHERE id=?5
           AND deleted_at IS NULL
           AND exif_scanned_at IS NULL",
        params![
            metadata.captured_at,
            metadata.latitude,
            metadata.longitude,
            Utc::now().to_rfc3339(),
            photo_id
        ],
    )
}

async fn index_exif_batch(state: &AppState, limit: i64) -> Result<usize, String> {
    let candidates = {
        let connection = state
            .database
            .lock()
            .map_err(|_| "照片数据库锁已损坏".to_owned())?;
        pending_exif_candidates(&connection, limit).map_err(|error| error.to_string())?
    };
    if candidates.is_empty() {
        return Ok(0);
    }

    let mut inspected = Vec::with_capacity(candidates.len());
    for candidate in candidates {
        let path = state.data_dir.join("photos").join(&candidate.relative_path);
        let metadata = tokio::task::spawn_blocking(move || read_exif_metadata_from_path(&path))
            .await
            .map_err(|error| format!("EXIF 解析任务失败：{error}"))?;
        // A permanently missing/corrupt local file resolves to empty metadata and is
        // still marked scanned below, so it cannot pin the indexer to one batch.
        inspected.push((candidate.id, metadata));
    }

    let connection = state
        .database
        .lock()
        .map_err(|_| "照片数据库锁已损坏".to_owned())?;
    let mut changed = 0usize;
    for (photo_id, metadata) in inspected {
        changed += apply_exif_metadata(&connection, &photo_id, &metadata)
            .map_err(|error| error.to_string())?;
    }
    Ok(changed)
}

pub(crate) async fn run_exif_background_indexer(state: AppState) {
    // Let migrations, local HTTP, and the first UI paint complete before historical
    // photo scanning begins.
    tokio::time::sleep(std::time::Duration::from_secs(3)).await;

    loop {
        match index_exif_batch(&state, 12).await {
            Ok(0) => {
                tokio::time::sleep(std::time::Duration::from_secs(60)).await;
            }
            Ok(_) => {
                // Yield between batches so large libraries never monopolize disk/CPU.
                tokio::time::sleep(std::time::Duration::from_millis(250)).await;
            }
            Err(error) => {
                eprintln!("LifeTrace EXIF background index skipped: {error}");
                tokio::time::sleep(std::time::Duration::from_secs(30)).await;
            }
        }
    }
}


pub fn ensure_schema(connection: &Connection) -> rusqlite::Result<()> {
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS photos(
           id TEXT PRIMARY KEY,content_hash TEXT NOT NULL UNIQUE,original_file_name TEXT NOT NULL,
           stored_file_name TEXT NOT NULL,original_path TEXT NOT NULL,thumbnail_path TEXT,
           media_type TEXT NOT NULL,mime_type TEXT,file_size INTEGER NOT NULL,width INTEGER,
           height INTEGER,duration_ms INTEGER,captured_at TEXT,latitude REAL,longitude REAL,exif_scanned_at TEXT,imported_at TEXT NOT NULL,
           processing_status TEXT NOT NULL,processing_error TEXT,source_device_id TEXT,deleted_at TEXT,
           storage_type TEXT NOT NULL DEFAULT 'managed',local_file_path TEXT,local_modified_at INTEGER
         );
         CREATE TABLE IF NOT EXISTS photo_sync_devices(
           id TEXT PRIMARY KEY,device_name TEXT NOT NULL,device_type TEXT NOT NULL,
           device_uuid TEXT NOT NULL UNIQUE,token_hash TEXT NOT NULL UNIQUE,status TEXT NOT NULL,
           paired_at TEXT NOT NULL,last_seen_at TEXT,revoked_at TEXT
         );
         CREATE TABLE IF NOT EXISTS photo_upload_tasks(
           id TEXT PRIMARY KEY,device_id TEXT NOT NULL,client_asset_id TEXT NOT NULL,
           original_file_name TEXT NOT NULL,media_type TEXT NOT NULL,mime_type TEXT,
           captured_at TEXT,expected_file_size INTEGER NOT NULL,received_file_size INTEGER NOT NULL DEFAULT 0,
           temporary_path TEXT NOT NULL,status TEXT NOT NULL,photo_id TEXT,created_at TEXT NOT NULL,
           updated_at TEXT NOT NULL,expires_at TEXT NOT NULL,error_code TEXT,error_message TEXT,
           is_duplicate INTEGER NOT NULL DEFAULT 0,UNIQUE(device_id,client_asset_id)
         );
         CREATE TABLE IF NOT EXISTS photo_device_assets(
           device_id TEXT NOT NULL,client_asset_id TEXT NOT NULL,photo_id TEXT NOT NULL,
           synced_at TEXT NOT NULL,UNIQUE(device_id,client_asset_id)
         );
         CREATE INDEX IF NOT EXISTS photos_captured_at_idx ON photos(captured_at);
         CREATE INDEX IF NOT EXISTS photo_tasks_status_idx ON photo_upload_tasks(status);",
    )?;
    for (column, ddl) in [
        ("latitude", "ALTER TABLE photos ADD COLUMN latitude REAL"),
        ("longitude", "ALTER TABLE photos ADD COLUMN longitude REAL"),
        ("exif_scanned_at", "ALTER TABLE photos ADD COLUMN exif_scanned_at TEXT"),
        ("storage_type", "ALTER TABLE photos ADD COLUMN storage_type TEXT NOT NULL DEFAULT 'managed'"),
        ("local_file_path", "ALTER TABLE photos ADD COLUMN local_file_path TEXT"),
        ("local_modified_at", "ALTER TABLE photos ADD COLUMN local_modified_at INTEGER"),
    ] {
        let exists: i64 = connection.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('photos') WHERE name=?1",
            [column],
            |row| row.get(0),
        )?;
        if exists == 0 {
            connection.execute_batch(ddl)?;
        }
    }
    // Existing databases receive the EXIF columns above before this partial index
    // is created, so upgrades never reference a column that is not present yet.
    connection.execute_batch(
        "CREATE INDEX IF NOT EXISTS photos_exif_pending_idx
           ON photos(imported_at DESC)
           WHERE exif_scanned_at IS NULL
             AND deleted_at IS NULL
             AND media_type='image'
             AND processing_status='completed';
         CREATE INDEX IF NOT EXISTS photos_geo_idx ON photos(latitude,longitude,captured_at)
           WHERE latitude IS NOT NULL AND longitude IS NOT NULL AND deleted_at IS NULL;
         CREATE UNIQUE INDEX IF NOT EXISTS photos_local_path_idx ON photos(local_file_path)
           WHERE storage_type='local' AND local_file_path IS NOT NULL;"
    )?;
    let footprint_links_exist: i64 = connection.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='footprint_entry_photos'",
        [],
        |row| row.get(0),
    )?;
    if footprint_links_exist > 0 {
        connection.execute_batch(
            "CREATE TRIGGER IF NOT EXISTS trg_footprint_photo_soft_delete
             AFTER UPDATE OF deleted_at ON photos
             WHEN NEW.deleted_at IS NOT NULL
             BEGIN
               DELETE FROM footprint_entry_photos WHERE photo_id=NEW.id;
             END;
             CREATE TRIGGER IF NOT EXISTS trg_footprint_photo_delete
             AFTER DELETE ON photos
             BEGIN
               DELETE FROM footprint_entry_photos WHERE photo_id=OLD.id;
             END;"
        )?;
    }
    // 上次隐藏任务被中断（例如加密完成前应用退出）时，把卡在“隐藏中”的照片
    // 恢复为可见：文件仍在磁盘，不丢数据，等待用户再次隐藏。
    connection.execute(
        "UPDATE photos SET processing_status='completed'
         WHERE processing_status='hiding' AND deleted_at IS NULL",
        [],
    )?;
    Ok(())
}

fn json_error(status: StatusCode, code: &str, message: &str) -> Response {
    (
        status,
        Json(json!({ "success": false, "error": code, "message": message })),
    )
        .into_response()
}

pub async fn dashboard_get(
    State(state): State<AppState>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    let page = query
        .get("page")
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(1)
        .max(1);
    let page_size = query
        .get("pageSize")
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(30)
        .clamp(1, 60);
    let connection = match state.database.lock() {
        Ok(value) => value,
        Err(_) => {
            return json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "DATABASE_ERROR",
                "数据库暂时不可用",
            )
        }
    };
    match dashboard(&connection, page, page_size) {
        Ok(value) => Json(value).into_response(),
        Err(message) => json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "DATABASE_ERROR",
            &message,
        ),
    }
}

fn rows(
    connection: &Connection,
    sql: &str,
    values: &[&dyn rusqlite::ToSql],
) -> Result<Vec<Value>, String> {
    let mut statement = connection.prepare(sql).map_err(|value| value.to_string())?;
    let names = statement
        .column_names()
        .iter()
        .map(|name| (*name).to_owned())
        .collect::<Vec<_>>();
    let mapped = statement
        .query_map(values, |row| {
            let mut object = serde_json::Map::new();
            for (index, name) in names.iter().enumerate() {
                let value = row.get_ref(index)?;
                let json_value = match value {
                    rusqlite::types::ValueRef::Null => Value::Null,
                    rusqlite::types::ValueRef::Integer(value) => json!(value),
                    rusqlite::types::ValueRef::Real(value) => json!(value),
                    rusqlite::types::ValueRef::Text(value) => json!(String::from_utf8_lossy(value)),
                    rusqlite::types::ValueRef::Blob(_) => Value::Null,
                };
                object.insert(name.clone(), json_value);
            }
            Ok(Value::Object(object))
        })
        .map_err(|value| value.to_string())?;
    mapped
        .map(|row| row.map_err(|value| value.to_string()))
        .collect()
}

fn dashboard(connection: &Connection, page: usize, page_size: usize) -> Result<Value, String> {
    let offset = (page - 1) * page_size;
    let photos = rows(connection, "SELECT p.id,p.original_file_name,p.media_type,p.mime_type,p.file_size,p.width,p.height,p.duration_ms,p.captured_at,p.imported_at,p.processing_status,p.processing_error,d.device_name FROM photos p LEFT JOIN photo_sync_devices d ON d.id=p.source_device_id WHERE p.deleted_at IS NULL AND p.storage_type <> 'local' AND p.processing_status <> 'hiding' ORDER BY COALESCE(p.captured_at,p.imported_at) DESC LIMIT ?1 OFFSET ?2", &[&(page_size as i64), &(offset as i64)])?;
    let devices = rows(connection, "SELECT id,device_name,device_type,status,paired_at,last_seen_at,revoked_at FROM photo_sync_devices ORDER BY paired_at DESC", &[])?;
    let tasks = rows(connection, "SELECT id,device_id,original_file_name,expected_file_size,received_file_size,status,photo_id,created_at,updated_at,error_code,error_message FROM photo_upload_tasks WHERE status NOT IN ('completed','expired') ORDER BY updated_at DESC LIMIT 100", &[])?;
    let total: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM photos WHERE deleted_at IS NULL AND storage_type <> 'local' AND processing_status <> 'hiding'",
            [],
            |row| row.get(0),
        )
        .map_err(|value| value.to_string())?;
    let summary = rows(connection, "SELECT COALESCE(SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END),0) success_count,COALESCE(SUM(CASE WHEN is_duplicate=1 THEN 1 ELSE 0 END),0) duplicate_count,COALESCE(SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END),0) failed_count,COALESCE(SUM(CASE WHEN status IN ('uploaded','processing') THEN 1 ELSE 0 END),0) processing_count,MAX(updated_at) last_sync_at FROM photo_upload_tasks", &[])?.into_iter().next().unwrap_or_else(|| json!({}));
    Ok(
        json!({ "photos": photos, "total": total, "page": page, "pageSize": page_size, "devices": devices, "tasks": tasks, "summary": summary }),
    )
}

pub async fn dashboard_post(State(state): State<AppState>, Json(body): Json<Value>) -> Response {
    let connection = match state.database.lock() {
        Ok(value) => value,
        Err(_) => {
            return json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "DATABASE_ERROR",
                "数据库暂时不可用",
            )
        }
    };
    let result = match body.get("action").and_then(Value::as_str) {
        Some("revokeDevice") => connection.execute(
            "UPDATE photo_sync_devices SET status='revoked',revoked_at=?1 WHERE id=?2",
            params![
                Utc::now().to_rfc3339(),
                body.get("deviceId")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
            ],
        ),
        Some("retryProcessing") => connection.execute(
            "UPDATE photos SET processing_status='completed',processing_error=NULL WHERE id=?1",
            [body
                .get("photoId")
                .and_then(Value::as_str)
                .unwrap_or_default()],
        ),
        _ => {
            return json_error(
                StatusCode::BAD_REQUEST,
                "UNSUPPORTED_ACTION",
                "不支持的照片同步操作",
            )
        }
    };
    match result {
        Ok(_) => Json(json!({ "success": true })).into_response(),
        Err(value) => json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "DATABASE_ERROR",
            &value.to_string(),
        ),
    }
}

pub async fn media(
    State(state): State<AppState>,
    AxumPath((photo_id, kind)): AxumPath<(String, String)>,
) -> Response {
    if !matches!(kind.as_str(), "thumbnail" | "original") {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let media = {
        let connection = match state.database.lock() {
            Ok(value) => value,
            Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
        };
        connection.query_row(
            "SELECT original_path,thumbnail_path,mime_type,original_file_name,storage_type,local_file_path
             FROM photos WHERE id=?1 AND deleted_at IS NULL AND processing_status='completed'",
            [&photo_id],
            |row| Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, Option<String>>(5)?,
            )),
        ).optional()
    };
    let Ok(Some((original, thumbnail, mime, file_name, storage_type, local_path))) = media else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let response = if storage_type == "local" {
        let Some(local_path) = local_path else { return StatusCode::NOT_FOUND.into_response() };
        let data_dir = state.data_dir.clone();
        // Never expose a database path directly: re-check the authorized library roots
        // at request time, including after a user removes a folder.
        tokio::task::spawn_blocking(move || {
            if kind == "thumbnail" {
                crate::photo_library::preview_bytes_from_library(&data_dir, &local_path, "thumbnail")
                    .map(|bytes| (bytes, "image/jpeg".to_owned()))
            } else {
                crate::photo_library::original_bytes_from_library(&data_dir, &local_path)
            }
        }).await
    } else {
        let relative = if kind == "thumbnail" {
            thumbnail.clone().unwrap_or_else(|| original.clone())
        } else {
            original
        };
        let path = state.data_dir.join("photos").join(relative);
        let content_type = if kind == "thumbnail" && thumbnail.is_some() {
            "image/jpeg".to_owned()
        } else {
            mime.unwrap_or_else(|| "application/octet-stream".to_owned())
        };
        return match fs::read(path).await {
            Ok(bytes) => photo_response(bytes, content_type, &file_name),
            Err(_) => StatusCode::NOT_FOUND.into_response(),
        };
    };
    match response {
        Ok(Ok((bytes, mime_type))) => photo_response(bytes, mime_type, &file_name),
        _ => StatusCode::NOT_FOUND.into_response(),
    }
}

fn photo_response(bytes: Vec<u8>, mime: String, file_name: &str) -> Response {
    (
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, mime),
            (
                header::CONTENT_DISPOSITION,
                format!("inline; filename=\"{}\"", file_name.replace(['"', '\r', '\n'], "")),
            ),
            (header::CACHE_CONTROL, "private, max-age=3600".to_owned()),
        ],
        bytes,
    ).into_response()
}

pub async fn serve_media(state: AppState) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let app = Router::new()
        .route("/photo-sync/media/{photo_id}/{kind}", get(media))
        .with_state(state);
    let listener = TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, 3444))).await?;
    axum::serve(listener, app).await?;
    Ok(())
}



#[cfg(test)]
mod exif_tests {
    use super::*;
    use exif::Rational;

    fn dms(degrees: u32, minutes: u32, seconds_x100: u32) -> ExifValue {
        ExifValue::Rational(vec![
            Rational { num: degrees, denom: 1 },
            Rational { num: minutes, denom: 1 },
            Rational { num: seconds_x100, denom: 100 },
        ])
    }

    #[test]
    fn gps_coordinates_respect_hemisphere() {
        let latitude = gps_coordinate(&dms(24, 28, 788), "N").unwrap();
        let longitude = gps_coordinate(&dms(118, 5, 2184), "E").unwrap();
        assert!((latitude - 24.4688555).abs() < 0.00001);
        assert!((longitude - 118.0894).abs() < 0.00001);

        let south = gps_coordinate(&dms(33, 51, 0), "S").unwrap();
        let west = gps_coordinate(&dms(118, 15, 0), "W").unwrap();
        assert!(south < 0.0);
        assert!(west < 0.0);
    }

    #[test]
    fn invalid_gps_reference_is_rejected() {
        assert!(gps_coordinate(&dms(1, 2, 300), "X").is_none());
        let zero_denominator = ExifValue::Rational(vec![
            Rational { num: 1, denom: 1 },
            Rational { num: 2, denom: 0 },
            Rational { num: 3, denom: 1 },
        ]);
        assert!(gps_coordinate(&zero_denominator, "N").is_none());
    }

    #[test]
    fn exif_datetime_is_normalized_without_inventing_timezone() {
        assert_eq!(
            normalize_exif_datetime("2026:09:27 18:42:03").as_deref(),
            Some("2026-09-27T18:42:03")
        );
        assert!(normalize_exif_datetime("not-a-date").is_none());
    }

    #[test]
    fn pending_exif_candidates_only_returns_unscanned_images() {
        let connection = Connection::open_in_memory().unwrap();
        ensure_schema(&connection).unwrap();
        connection.execute(
            "INSERT INTO photos(
               id,content_hash,original_file_name,stored_file_name,original_path,
               media_type,file_size,imported_at,processing_status
             ) VALUES(
               'photo-1','hash-1','one.jpg','one.jpg','one.jpg',
               'image',123,'2026-10-01T00:00:00Z','completed'
             )",
            [],
        ).unwrap();
        connection.execute(
            "INSERT INTO photos(
               id,content_hash,original_file_name,stored_file_name,original_path,
               media_type,file_size,exif_scanned_at,imported_at,processing_status
             ) VALUES(
               'photo-2','hash-2','two.jpg','two.jpg','two.jpg',
               'image',456,'2026-10-02T00:00:00Z','2026-10-02T00:00:00Z','completed'
             )",
            [],
        ).unwrap();

        let candidates = pending_exif_candidates(&connection, 20).unwrap();
        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].id, "photo-1");
        assert_eq!(candidates[0].relative_path, "one.jpg");
    }

    #[test]
    fn ensure_schema_upgrades_legacy_photo_table_before_exif_index() {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch(
            "CREATE TABLE photos(
               id TEXT PRIMARY KEY,
               content_hash TEXT NOT NULL UNIQUE,
               original_file_name TEXT NOT NULL,
               stored_file_name TEXT NOT NULL,
               original_path TEXT NOT NULL,
               thumbnail_path TEXT,
               media_type TEXT NOT NULL,
               mime_type TEXT,
               file_size INTEGER NOT NULL,
               width INTEGER,
               height INTEGER,
               duration_ms INTEGER,
               captured_at TEXT,
               imported_at TEXT NOT NULL,
               processing_status TEXT NOT NULL,
               processing_error TEXT,
               source_device_id TEXT,
               deleted_at TEXT
             );"
        ).unwrap();

        ensure_schema(&connection).unwrap();

        for column in ["latitude", "longitude", "exif_scanned_at", "storage_type", "local_file_path", "local_modified_at"] {
            let exists: i64 = connection.query_row(
                "SELECT COUNT(*) FROM pragma_table_info('photos') WHERE name=?1",
                [column],
                |row| row.get(0),
            ).unwrap();
            assert_eq!(exists, 1, "missing upgraded column {column}");
        }
        let index_exists: i64 = connection.query_row(
            "SELECT COUNT(*) FROM sqlite_master
             WHERE type='index' AND name='photos_exif_pending_idx'",
            [],
            |row| row.get(0),
        ).unwrap();
        assert_eq!(index_exists, 1);
    }

    #[test]
    fn apply_exif_metadata_marks_scan_complete_without_overwriting_existing_values() {
        let connection = Connection::open_in_memory().unwrap();
        ensure_schema(&connection).unwrap();
        connection.execute(
            "INSERT INTO photos(
               id,content_hash,original_file_name,stored_file_name,original_path,
               media_type,file_size,captured_at,latitude,longitude,imported_at,processing_status
             ) VALUES(
               'photo-1','hash-1','one.jpg','one.jpg','one.jpg',
               'image',123,'2026-09-01T12:00:00',10.0,20.0,
               '2026-10-01T00:00:00Z','completed'
             )",
            [],
        ).unwrap();

        let metadata = PhotoExifMetadata {
            captured_at: Some("2026-09-02T13:00:00".to_owned()),
            latitude: Some(30.0),
            longitude: Some(40.0),
        };
        assert_eq!(apply_exif_metadata(&connection, "photo-1", &metadata).unwrap(), 1);

        let (captured_at, latitude, longitude, scanned_at): (
            Option<String>,
            Option<f64>,
            Option<f64>,
            Option<String>,
        ) = connection.query_row(
            "SELECT captured_at,latitude,longitude,exif_scanned_at
             FROM photos WHERE id='photo-1'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        ).unwrap();

        assert_eq!(captured_at.as_deref(), Some("2026-09-01T12:00:00"));
        assert_eq!(latitude, Some(10.0));
        assert_eq!(longitude, Some(20.0));
        assert!(scanned_at.is_some());
        assert!(pending_exif_candidates(&connection, 20).unwrap().is_empty());
    }
#[cfg(test)]
mod footprint_cleanup_tests {
    use super::*;
        #[test]
        fn footprint_photo_links_are_removed_when_photo_is_soft_deleted() {
            let connection = Connection::open_in_memory().unwrap();
            connection.execute_batch(
                "CREATE TABLE footprint_entry_photos(
                   entry_id TEXT NOT NULL,
                   photo_id TEXT NOT NULL,
                   sort_order INTEGER NOT NULL DEFAULT 0,
                   is_cover INTEGER NOT NULL DEFAULT 0,
                   created_at TEXT NOT NULL,
                   PRIMARY KEY(entry_id,photo_id)
                 );"
            ).unwrap();
            ensure_schema(&connection).unwrap();
            connection.execute(
                "INSERT INTO photos(
                   id,content_hash,original_file_name,stored_file_name,original_path,
                   media_type,file_size,imported_at,processing_status
                 ) VALUES(
                   'photo-1','hash-1','photo.jpg','photo.jpg','photo.jpg',
                   'image',1,'2026-01-01T00:00:00Z','completed'
                 )",
                [],
            ).unwrap();
            connection.execute(
                "INSERT INTO footprint_entry_photos(entry_id,photo_id,created_at)
                 VALUES('entry-1','photo-1','2026-01-01T00:00:00Z')",
                [],
            ).unwrap();
    
            connection.execute(
                "UPDATE photos SET deleted_at='2026-01-02T00:00:00Z' WHERE id='photo-1'",
                [],
            ).unwrap();
    
            let count: i64 = connection.query_row(
                "SELECT COUNT(*) FROM footprint_entry_photos WHERE photo_id='photo-1'",
                [],
                |row| row.get(0),
            ).unwrap();
            assert_eq!(count, 0);
        }
    
    
}

}
