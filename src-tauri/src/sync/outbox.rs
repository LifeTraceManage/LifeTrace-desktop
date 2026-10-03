use chrono::Utc;
use lifetrace_contracts::registry::EntityType;
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;
use uuid::Uuid;

use crate::database::profile;

use super::payload::legacy_to_wire;

/// 写入来源。当前实现只从本地写入路径入队；`Remote` 与 `Migration`
/// 保留用于未来的远端应用/迁移路径（EPIC-05 WriteOrigin 语义）。
#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MutationOrigin {
    Local,
    Remote,
    Migration,
}

pub fn enqueue_upsert(
    connection: &Connection,
    entity_type: &str,
    value: &Value,
    atomic_group_id: Option<&str>,
    origin: MutationOrigin,
) -> Result<Option<String>, String> {
    if origin != MutationOrigin::Local {
        return Ok(None);
    }
    let entity_id = value
        .get("id")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "outbox entity is missing id".to_owned())?;
    enqueue(
        connection,
        entity_type,
        entity_id,
        "upsert",
        Some(value),
        atomic_group_id,
    )
}

fn enqueue(
    connection: &Connection,
    entity_type: &str,
    entity_id: &str,
    operation: &str,
    value: Option<&Value>,
    atomic_group_id: Option<&str>,
) -> Result<Option<String>, String> {
    if !super::payload::is_syncable(entity_type) {
        return Ok(None);
    }
    let profile_id = profile::active_profile_id(connection)?;
    let base_version: Option<String> = connection.query_row(
        "SELECT server_version FROM sync_metadata WHERE profile_id=?1 AND entity_type=?2 AND entity_id=?3",
        params![profile_id, entity_type, entity_id], |row| row.get(0)
    ).optional().map_err(|error| error.to_string())?.flatten();
    let payload = match value {
        Some(value) => Some(legacy_to_wire(
            entity_type,
            value,
            &profile_id,
            base_version.as_deref(),
        )?),
        None => None,
    };
    // A not-yet-sent mutation is safely coalesced. Leased rows are immutable
    // because the server may have accepted their changeId already.
    connection.execute(
        "DELETE FROM sync_outbox WHERE profile_id=?1 AND entity_type=?2 AND entity_id=?3 AND status='pending'",
        params![profile_id, entity_type, entity_id]
    ).map_err(|error| error.to_string())?;
    let change_id = Uuid::new_v4().to_string();
    let stamp = Utc::now().to_rfc3339();
    connection
        .execute(
            "INSERT INTO sync_outbox(
           change_id,profile_id,entity_type,entity_id,operation,base_server_version,
           entity_schema_version,payload_json,dependencies_json,atomic_group_id,status,
           retry_count,created_at,updated_at
         ) VALUES(?1,?2,?3,?4,?5,?6,1,?7,'[]',?8,'pending',0,?9,?9)",
            params![
                change_id,
                profile_id,
                entity_type,
                entity_id,
                operation,
                base_version.as_deref().unwrap_or("0"),
                payload.map(|value| value.to_string()),
                atomic_group_id,
                stamp
            ],
        )
        .map_err(|error| error.to_string())?;
    connection.execute(
        "INSERT INTO sync_audit_log(id,profile_id,event_type,entity_type,entity_id,details_json,created_at)
         VALUES(?1,?2,'outbox_enqueued',?3,?4,?5,?6)",
        params![Uuid::new_v4().to_string(), profile_id, entity_type, entity_id,
            serde_json::json!({"changeId": change_id, "operation": operation}).to_string(), stamp]
    ).map_err(|error| error.to_string())?;
    Ok(Some(change_id))
}

/// Queue all existing user-owned rows when the user explicitly chooses to bind
/// the current local profile. This is never called automatically on login.
pub fn enqueue_existing_profile(
    connection: &Connection,
    profile_id: &str,
) -> Result<usize, String> {
    let mut total = 0usize;
    let sources: [(&str, Vec<Value>); 7] = [
        (
            EntityType::FINANCE_ACCOUNT,
            crate::database::repositories::finance::list_accounts(connection)?,
        ),
        (
            EntityType::FINANCE_TRANSACTION,
            crate::database::repositories::finance::list_transactions(connection)?,
        ),
        (
            EntityType::HABIT_ACTIVITY,
            crate::database::repositories::habits::list_activities(connection)?,
        ),
        (
            EntityType::HABIT_LOG,
            crate::database::repositories::habits::list_activity_logs(connection)?,
        ),
        (
            EntityType::REVIEW_DAILY,
            crate::database::repositories::habits::list_daily_reviews(connection)?,
        ),
        (
            EntityType::WORKOUT_WORKOUT,
            crate::database::repositories::workouts::list_workouts(connection)?,
        ),
        (
            EntityType::WORKOUT_IMPORT,
            crate::database::repositories::workouts::list_imports(connection)?,
        ),
    ];
    for (entity_type, values) in sources {
        for mut value in values {
            if value
                .get("userId")
                .and_then(Value::as_str)
                .is_some_and(|owner| owner != profile_id)
            {
                continue;
            }
            if let Some(object) = value.as_object_mut() {
                object.insert("userId".to_owned(), Value::String(profile_id.to_owned()));
            }
            if enqueue_upsert(connection, entity_type, &value, None, MutationOrigin::Local)?
                .is_some()
            {
                total += 1;
            }
        }
    }
    for (entity_type, value) in super::execution::existing_entities(connection, profile_id)? {
        if enqueue_upsert(connection, entity_type, &value, None, MutationOrigin::Local)?.is_some() {
            total += 1;
        }
    }
    for (entity_type, value) in super::travel::existing_entities(connection, profile_id)? {
        if enqueue_upsert(connection, entity_type, &value, None, MutationOrigin::Local)?.is_some() {
            total += 1;
        }
    }
    let mut ids = connection
        .prepare("SELECT id FROM notes WHERE user_id=?1 AND deleted_at IS NULL")
        .map_err(|error| error.to_string())?;
    let note_ids = ids
        .query_map([profile_id], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|error| error.to_string())?;
    drop(ids);
    for id in note_ids {
        if let Some(note) = crate::database::repositories::notes::get_note(connection, &id)? {
            if enqueue_upsert(
                connection,
                EntityType::NOTE_NOTE,
                &note,
                None,
                MutationOrigin::Local,
            )?
            .is_some()
            {
                total += 1;
            }
        }
    }
    for (table, entity_type, columns) in [
        (
            "note_folders",
            EntityType::NOTE_FOLDER,
            "id,name,icon,color,sort_order,created_at,updated_at",
        ),
        (
            "note_tags",
            EntityType::NOTE_TAG,
            "id,name,'' AS icon,color,0 AS sort_order,created_at,updated_at",
        ),
    ] {
        let sql = format!("SELECT {columns} FROM {table} WHERE user_id=?1 AND deleted_at IS NULL");
        let mut statement = connection
            .prepare(&sql)
            .map_err(|error| error.to_string())?;
        let values = statement
            .query_map([profile_id], |row| {
                Ok(serde_json::json!({
                    "id": row.get::<_,String>(0)?, "name": row.get::<_,String>(1)?,
                    "icon": row.get::<_,String>(2)?, "color": row.get::<_,String>(3)?,
                    "sortOrder": row.get::<_,i64>(4)?, "createdAt": row.get::<_,String>(5)?,
                    "updatedAt": row.get::<_,String>(6)?, "userId": profile_id,
                }))
            })
            .map_err(|error| error.to_string())?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|error| error.to_string())?;
        for value in values {
            if enqueue_upsert(connection, entity_type, &value, None, MutationOrigin::Local)?
                .is_some()
            {
                total += 1;
            }
        }
    }
    Ok(total)
}


#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::migration_runner::{run, MigrationContext};
    use crate::database::migrations::all;
    use rusqlite::Connection;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn db() -> (Connection, String) {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("lifetrace-sync-outbox-travel-{unique}"));
        std::fs::create_dir_all(&dir).unwrap();
        let mut connection = Connection::open_in_memory().unwrap();
        connection.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        run(&mut connection, &MigrationContext::new(dir), &all()).unwrap();
        let profile = crate::database::profile::active_profile_id(&connection).unwrap();
        (connection, profile)
    }

    #[test]
    fn existing_profile_bootstrap_includes_travel_entities() {
        let (connection, profile) = db();

        connection.execute(
            "INSERT INTO travel_places(
               id,user_id,name,place_type,created_at,updated_at
             ) VALUES(
               'place-bootstrap',?1,'厦门','city',
               '2026-10-03T00:00:00Z','2026-10-03T00:00:00Z'
             )",
            [&profile],
        ).unwrap();
        connection.execute(
            "INSERT INTO travel_trips(
               id,user_id,title,created_at,updated_at
             ) VALUES(
               'trip-bootstrap',?1,'厦门旅行',
               '2026-10-03T00:00:00Z','2026-10-03T00:00:00Z'
             )",
            [&profile],
        ).unwrap();
        connection.execute(
            "INSERT INTO travel_visits(
               id,user_id,trip_id,place_id,created_at,updated_at
             ) VALUES(
               'visit-bootstrap',?1,'trip-bootstrap','place-bootstrap',
               '2026-10-03T00:00:00Z','2026-10-03T00:00:00Z'
             )",
            [&profile],
        ).unwrap();
        connection.execute(
            "INSERT INTO travel_photo_links(
               id,user_id,photo_id,trip_id,place_id,created_at,updated_at
             ) VALUES(
               'photo-link-bootstrap',?1,'photo-remote','trip-bootstrap','place-bootstrap',
               '2026-10-03T00:00:00Z','2026-10-03T00:00:00Z'
             )",
            [&profile],
        ).unwrap();

        connection.execute("DELETE FROM sync_outbox", []).unwrap();
        enqueue_existing_profile(&connection, &profile).unwrap();

        for (entity_type, entity_id) in [
            ("travel.place", "place-bootstrap"),
            ("travel.trip", "trip-bootstrap"),
            ("travel.visit", "visit-bootstrap"),
            ("travel.photo_link", "photo-link-bootstrap"),
        ] {
            let count: i64 = connection.query_row(
                "SELECT COUNT(*) FROM sync_outbox
                 WHERE entity_type=?1 AND entity_id=?2 AND operation='upsert'",
                params![entity_type, entity_id],
                |row| row.get(0),
            ).unwrap();
            assert_eq!(count, 1, "missing bootstrap outbox row for {entity_type}");
        }
    }
}
