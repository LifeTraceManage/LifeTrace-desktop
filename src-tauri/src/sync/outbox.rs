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
    {
        let mut statement = connection.prepare(
            "SELECT id,name,icon,color,parent_folder_id,sort_order,created_at,updated_at
             FROM note_folders WHERE user_id=?1 AND deleted_at IS NULL"
        ).map_err(|error| error.to_string())?;
        let values = statement.query_map([profile_id], |row| Ok(serde_json::json!({
            "id": row.get::<_,String>(0)?, "name": row.get::<_,String>(1)?,
            "icon": row.get::<_,String>(2)?, "color": row.get::<_,String>(3)?,
            "parentFolderId": row.get::<_,Option<String>>(4)?,
            "sortOrder": row.get::<_,i64>(5)?, "createdAt": row.get::<_,String>(6)?,
            "updatedAt": row.get::<_,String>(7)?, "userId": profile_id,
        }))).map_err(|error| error.to_string())?
          .collect::<rusqlite::Result<Vec<_>>>().map_err(|error| error.to_string())?;
        for value in values {
            if enqueue_upsert(connection, EntityType::NOTE_FOLDER, &value, None, MutationOrigin::Local)?.is_some() { total += 1; }
        }
    }
    {
        let mut statement = connection.prepare(
            "SELECT id,name,color,created_at,updated_at FROM note_tags WHERE user_id=?1 AND deleted_at IS NULL"
        ).map_err(|error| error.to_string())?;
        let values = statement.query_map([profile_id], |row| Ok(serde_json::json!({
            "id": row.get::<_,String>(0)?, "name": row.get::<_,String>(1)?,
            "color": row.get::<_,String>(2)?, "createdAt": row.get::<_,String>(3)?,
            "updatedAt": row.get::<_,String>(4)?, "userId": profile_id,
        }))).map_err(|error| error.to_string())?
          .collect::<rusqlite::Result<Vec<_>>>().map_err(|error| error.to_string())?;
        for value in values {
            if enqueue_upsert(connection, EntityType::NOTE_TAG, &value, None, MutationOrigin::Local)?.is_some() { total += 1; }
        }
    }
    {
        let mut statement = connection.prepare(
            "SELECT r.note_id,r.tag_id,r.created_at,n.updated_at
             FROM note_tag_relations r JOIN notes n ON n.id=r.note_id
             WHERE n.user_id=?1 AND n.deleted_at IS NULL"
        ).map_err(|error| error.to_string())?;
        let values = statement.query_map([profile_id], |row| {
            let note_id = row.get::<_,String>(0)?;
            let tag_id = row.get::<_,String>(1)?;
            Ok(serde_json::json!({
                "id": format!("{note_id}:{tag_id}"), "userId": profile_id,
                "noteId": note_id, "tagId": tag_id,
                "createdAt": row.get::<_,String>(2)?, "updatedAt": row.get::<_,String>(3)?,
            }))
        }).map_err(|error| error.to_string())?
          .collect::<rusqlite::Result<Vec<_>>>().map_err(|error| error.to_string())?;
        for value in values {
            if enqueue_upsert(connection, EntityType::NOTE_TAG_RELATION, &value, None, MutationOrigin::Local)?.is_some() { total += 1; }
        }
    }
    {
        let mut statement = connection.prepare(
            "SELECT r.id,r.note_id,r.entity_type,r.entity_id,r.relation_type,r.created_at,n.updated_at
             FROM note_relations r JOIN notes n ON n.id=r.note_id
             WHERE n.user_id=?1 AND n.deleted_at IS NULL"
        ).map_err(|error| error.to_string())?;
        let values = statement.query_map([profile_id], |row| Ok(serde_json::json!({
            "id": row.get::<_,String>(0)?, "userId": profile_id,
            "noteId": row.get::<_,String>(1)?, "entityType": row.get::<_,String>(2)?,
            "entityId": row.get::<_,String>(3)?, "relationType": row.get::<_,String>(4)?,
            "createdAt": row.get::<_,String>(5)?, "updatedAt": row.get::<_,String>(6)?,
        }))).map_err(|error| error.to_string())?
          .collect::<rusqlite::Result<Vec<_>>>().map_err(|error| error.to_string())?;
        for value in values {
            if enqueue_upsert(connection, EntityType::NOTE_RELATION, &value, None, MutationOrigin::Local)?.is_some() { total += 1; }
        }
    }
    {
        let mut statement = connection.prepare(
            "SELECT r.id,r.note_id,r.revision_version,r.title,r.content_json,r.content_html,r.content_markdown,
                    r.created_at,n.updated_at
             FROM note_revisions r JOIN notes n ON n.id=r.note_id
             WHERE n.user_id=?1 AND n.deleted_at IS NULL"
        ).map_err(|error| error.to_string())?;
        let values = statement.query_map([profile_id], |row| {
            let raw = row.get::<_,String>(4)?;
            let content_json = serde_json::from_str::<Value>(&raw).unwrap_or_else(|_| serde_json::json!({"type":"doc","content":[]}));
            Ok(serde_json::json!({
                "id": row.get::<_,String>(0)?, "userId": profile_id,
                "noteId": row.get::<_,String>(1)?, "revisionVersion": row.get::<_,i64>(2)?,
                "title": row.get::<_,Option<String>>(3)?, "contentJson": content_json,
                "contentHtml": row.get::<_,String>(5)?, "contentMarkdown": row.get::<_,String>(6)?,
                "createdAt": row.get::<_,String>(7)?, "updatedAt": row.get::<_,String>(8)?,
            }))
        }).map_err(|error| error.to_string())?
          .collect::<rusqlite::Result<Vec<_>>>().map_err(|error| error.to_string())?;
        for value in values {
            if enqueue_upsert(connection, EntityType::NOTE_REVISION, &value, None, MutationOrigin::Local)?.is_some() { total += 1; }
        }
    }
    Ok(total)
}



#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::migration_runner::{run, MigrationContext};
    use crate::database::migrations::all;
    use crate::database::repositories::notes;
    use rusqlite::Connection;
    use serde_json::json;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn db() -> (Connection, String) {
        let unique = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let data_dir = std::env::temp_dir().join(format!("lifetrace-note-sync-{unique}"));
        std::fs::create_dir_all(&data_dir).unwrap();
        let mut connection = Connection::open(data_dir.join("test.db")).unwrap();
        connection.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        run(&mut connection, &MigrationContext::new(data_dir), &all()).unwrap();
        let profile = crate::database::profile::active_profile_id(&connection).unwrap();
        (connection, profile)
    }

    #[test]
    fn profile_bind_enqueues_complete_note_graph_and_folder_hierarchy() {
        let (connection, profile) = db();
        let root = notes::save_folder(&connection, &json!({
            "name":"Knowledge","icon":"folder","color":"#2a7a5e","sortOrder":0
        })).unwrap();
        let child = notes::save_folder(&connection, &json!({
            "name":"Projects","icon":"folder","color":"#2a7a5e","sortOrder":1,"parentFolderId":root
        })).unwrap();
        let tag = notes::save_tag(&connection, &json!({
            "name":"work","color":"#64748b"
        })).unwrap();

        let note = notes::save_note(&connection, &json!({
            "title":"Sync Notes",
            "noteType":"document",
            "folderId":child,
            "contentJson":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"hello"}]}]},
            "contentHtml":"<p>hello</p>",
            "contentText":"hello",
            "contentMarkdown":"hello",
            "summary":"hello",
            "isPinned":false,
            "isFavorite":false,
            "isArchived":false,
            "tagIds":[tag],
            "relations":[{
                "id":"relation-1","entityType":"note.note","entityId":"target-note",
                "relationType":"wiki_link","createdAt":"2026-10-07T00:00:00Z"
            }]
        }), false, false).unwrap();
        let note_id = note["id"].as_str().unwrap().to_owned();

        let mut updated = note.clone();
        updated["contentText"] = json!("hello again");
        updated["contentMarkdown"] = json!("hello again");
        updated["contentHtml"] = json!("<p>hello again</p>");
        updated["contentJson"] = json!({"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"hello again"}]}]});
        updated["tagIds"] = json!([tag]);
        updated["relations"] = json!([{
            "id":"relation-1","noteId":note_id,"entityType":"note.note","entityId":"target-note",
            "relationType":"wiki_link","createdAt":"2026-10-07T00:00:00Z"
        }]);
        notes::save_note(&connection, &updated, true, true).unwrap();

        connection.execute("DELETE FROM sync_outbox", []).unwrap();
        let total = enqueue_existing_profile(&connection, &profile).unwrap();
        assert!(total >= 7, "expected note graph entities in backfill, got {total}");

        for entity_type in [
            "note.folder",
            "note.note",
            "note.tag",
            "note.tag_relation",
            "note.relation",
            "note.revision",
        ] {
            let count: i64 = connection.query_row(
                "SELECT COUNT(*) FROM sync_outbox WHERE profile_id=?1 AND entity_type=?2 AND status='pending'",
                params![profile, entity_type],
                |row| row.get(0),
            ).unwrap();
            assert!(count > 0, "missing {entity_type} from profile-bind outbox");
        }

        let child_payload: String = connection.query_row(
            "SELECT payload_json FROM sync_outbox WHERE entity_type='note.folder' AND entity_id=?1",
            [&child],
            |row| row.get(0),
        ).unwrap();
        let child_wire: Value = serde_json::from_str(&child_payload).unwrap();
        assert_eq!(child_wire["parentFolderId"], root);
    }
}
