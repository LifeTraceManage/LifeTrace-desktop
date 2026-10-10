use std::{
    fs,
    path::{Path, PathBuf},
};

use rusqlite::{params, Connection, OpenFlags, OptionalExtension};

const JSON_TABLES: [(&str, &str); 7] = [
    ("activities", "activities"),
    ("activity_logs", "activity_logs"),
    ("daily_reviews", "daily_reviews"),
    ("settings", "settings"),
    ("workout_history", "workout_history"),
    ("workout_import_records", "workout_imports"),
    ("training_notes", "training_notes"),
];

fn table_exists(connection: &Connection, table: &str) -> bool {
    connection
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1",
            [table],
            |_| Ok(()),
        )
        .optional()
        .ok()
        .flatten()
        .is_some()
}

fn has_column(connection: &Connection, table: &str, column: &str) -> bool {
    let mut statement = match connection.prepare(&format!("PRAGMA table_info({table})")) {
        Ok(statement) => statement,
        Err(_) => return false,
    };
    statement
        .query_map([], |row| row.get::<_, String>(1))
        .map(|rows| rows.flatten().any(|name| name == column))
        .unwrap_or(false)
}

fn collect_sqlite_files(directory: &Path, depth: usize, result: &mut Vec<PathBuf>) {
    if depth > 7 {
        return;
    }
    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_sqlite_files(&path, depth + 1, result);
        } else if path.extension().and_then(|value| value.to_str()) == Some("sqlite")
            && path.file_name().and_then(|value| value.to_str()) != Some("metadata.sqlite")
            && entry.metadata().is_ok_and(|value| value.len() > 64 * 1024)
        {
            result.push(path);
        }
    }
}

fn candidates(data_dir: &Path) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Some(roaming) = data_dir.parent() {
        roots.push(roaming.join("LifeTrace").join("wrangler-state"));
        roots.push(roaming.join("lifetrace").join("wrangler-state"));
    }
    if let Ok(project) = std::env::current_dir() {
        roots.push(project.join(".wrangler").join("state"));
    }
    let mut files = Vec::new();
    for root in roots {
        collect_sqlite_files(&root, 0, &mut files);
    }
    files.sort_by_key(|path| fs::metadata(path).and_then(|value| value.modified()).ok());
    files.reverse();
    files
}

fn copy_json_table(
    source: &Connection,
    destination: &mut Connection,
    source_table: &str,
    destination_table: &str,
) -> Result<usize, String> {
    if !table_exists(source, source_table) {
        return Ok(0);
    }
    if !has_column(destination, destination_table, "data_json") {
        // 目标已是规范化真实列表：通过对应 Repository 导入。
        return match destination_table {
            "activities" | "activity_logs" | "daily_reviews" => {
                crate::database::legacy::habits_d1::import_json_table(
                    source,
                    destination,
                    source_table,
                    destination_table,
                )
            }
            "workouts" | "workout_imports" | "training_notes" => {
                crate::database::legacy::workouts_d1::import_json_table(
                    source,
                    destination,
                    source_table,
                    destination_table,
                )
            }
            _ => Ok(0),
        };
    }
    let mut statement = source
        .prepare(&format!(
            "SELECT id,data_json,updated_at FROM {source_table}"
        ))
        .map_err(|value| value.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(|value| value.to_string())?;
    let mut copied = 0;
    for row in rows {
        let (id, data, updated_at) = row.map_err(|value| value.to_string())?;
        copied += destination
            .execute(
                &format!("INSERT OR IGNORE INTO {destination_table}(id,data_json,updated_at) VALUES(?1,?2,?3)"),
                params![id, data, updated_at],
            )
            .map_err(|value| value.to_string())?;
    }
    Ok(copied)
}

fn copy_json_query(
    source: &Connection,
    destination: &Connection,
    query: &str,
    destination_table: &str,
) -> Result<usize, String> {
    let mut statement = source.prepare(query).map_err(|value| value.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(|value| value.to_string())?;
    let mut copied = 0;
    for row in rows {
        let (id, data, updated_at) = row.map_err(|value| value.to_string())?;
        copied += destination.execute(
            &format!("INSERT OR IGNORE INTO {destination_table}(id,data_json,updated_at) VALUES(?1,?2,?3)"),
            params![id, data, updated_at],
        ).map_err(|value| value.to_string())?;
    }
    Ok(copied)
}

pub fn migrate_once(destination: &mut Connection, data_dir: &Path) -> Result<usize, String> {
    destination
        .execute(
            "CREATE TABLE IF NOT EXISTS app_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)",
            [],
        )
        .map_err(|value| value.to_string())?;
    let checked: Option<String> = destination
        .query_row(
            "SELECT value FROM app_meta WHERE key='legacy_d1_migration'",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|value| value.to_string())?;
    if checked.is_some() {
        return Ok(0);
    }
    let mut copied = 0;
    for path in candidates(data_dir) {
        let Ok(source) = Connection::open_with_flags(
            &path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        ) else {
            continue;
        };
        if !JSON_TABLES
            .iter()
            .any(|(table, _)| table_exists(&source, table))
        {
            continue;
        }
        for (source_table, destination_table) in JSON_TABLES {
            copied += copy_json_table(&source, destination, source_table, destination_table)?;
        }
        if copied > 0 {
            break;
        }
    }
    destination
        .execute(
            "INSERT OR REPLACE INTO app_meta(key,value) VALUES('legacy_d1_migration',?1)",
            [format!("{}:{copied}", chrono::Utc::now().to_rfc3339())],
        )
        .map_err(|value| value.to_string())?;
    Ok(copied)
}
