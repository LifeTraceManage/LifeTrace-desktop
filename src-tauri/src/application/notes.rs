use std::path::Path;

use rusqlite::Connection;
use serde_json::{json, Value};

use crate::database::repositories::notes as notes_repo;

fn text<'a>(object: &'a serde_json::Map<String, Value>, key: &str) -> Option<&'a str> {
    object.get(key).and_then(Value::as_str)
}

fn usize_value(object: &serde_json::Map<String, Value>, key: &str) -> Option<usize> {
    object
        .get(key)
        .and_then(Value::as_u64)
        .and_then(|value| usize::try_from(value).ok())
}

/// Notes application service.
///
/// Transport adapters (Tauri commands / local HTTP compatibility routes) only
/// parse transport envelopes and delegate here. Repository code remains the
/// single owner of SQLite persistence details.
pub fn query(connection: &Connection, request: &Value) -> Result<Value, String> {
    let object = request
        .as_object()
        .ok_or_else(|| "笔记查询参数格式错误".to_owned())?;
    let action = text(object, "action").unwrap_or("list");
    match action {
        "get" => {
            let note_id = text(object, "id").ok_or_else(|| "缺少笔记 id".to_owned())?;
            match notes_repo::get_note(connection, note_id)? {
                Some(note) => crate::database::note_links::enrich_note(connection, note),
                None => Err("笔记不存在".to_owned()),
            }
        }
        "meta" => notes_repo::meta(connection),
        "revisions" => {
            let note_id = text(object, "id").unwrap_or_default();
            Ok(Value::Array(notes_repo::list_revisions(connection, note_id)?))
        }
        "backup" => notes_repo::backup(connection),
        "list" => notes_repo::list_notes(
            connection,
            text(object, "q"),
            text(object, "scope"),
            text(object, "folderId"),
            text(object, "tagId"),
            text(object, "noteType"),
            text(object, "sort"),
            usize_value(object, "limit").unwrap_or(100),
        )
        .map(Value::Array),
        _ => Err("不支持的笔记查询".to_owned()),
    }
}

pub fn mutate(
    connection: &mut Connection,
    data_dir: &Path,
    request: &Value,
) -> Result<Value, String> {
    let object = request
        .as_object()
        .ok_or_else(|| "笔记操作参数格式错误".to_owned())?;
    let action = text(object, "action").unwrap_or_default();

    match action {
        "create" => {
            let note = object.get("note").ok_or_else(|| "缺少笔记内容".to_owned())?;
            let saved = notes_repo::save_note(connection, note, false, false)?;
            crate::database::note_links::sync_note_links(connection, &saved)?;
            crate::database::note_links::enrich_note(connection, saved)
        }
        "update" => {
            let note = object.get("note").ok_or_else(|| "缺少笔记内容".to_owned())?;
            let create_revision = object
                .get("createRevision")
                .and_then(Value::as_bool)
                .or_else(|| note.get("createRevision").and_then(Value::as_bool))
                .unwrap_or(false);
            let saved = notes_repo::save_note(connection, note, true, create_revision)?;
            crate::database::note_links::sync_note_links(connection, &saved)?;
            crate::database::note_links::enrich_note(connection, saved)
        }
        "trash" | "restore" => {
            let note_id = text(object, "id").ok_or_else(|| "缺少笔记 id".to_owned())?;
            notes_repo::set_deleted(connection, note_id, action == "trash")?;
            if action == "restore" {
                if let Some(note) = notes_repo::get_note(connection, note_id)? {
                    crate::database::note_links::sync_note_links(connection, &note)?;
                }
            }
            Ok(json!({ "ok": true }))
        }
        "delete" => {
            let note_id = text(object, "id").ok_or_else(|| "缺少笔记 id".to_owned())?;
            notes_repo::delete_note(connection, note_id)?;
            Ok(json!({ "ok": true }))
        }
        "duplicate" => {
            let note_id = text(object, "id").ok_or_else(|| "缺少笔记 id".to_owned())?;
            let duplicated = notes_repo::duplicate_note(connection, note_id)?;
            crate::database::note_links::sync_note_links(connection, &duplicated)?;
            crate::database::note_links::enrich_note(connection, duplicated)
        }
        "folder.save" | "tag.save" => {
            let key = if action == "folder.save" { "folder" } else { "tag" };
            let input = object
                .get(key)
                .ok_or_else(|| format!("缺少{key}数据"))?;
            let entity_id = if action == "folder.save" {
                notes_repo::save_folder(connection, input)?
            } else {
                notes_repo::save_tag(connection, input)?
            };
            Ok(json!({ "ok": true, "id": entity_id }))
        }
        "folder.delete" => {
            let entity_id = text(object, "id").ok_or_else(|| "缺少 id".to_owned())?;
            notes_repo::delete_folder(connection, entity_id)?;
            Ok(json!({ "ok": true }))
        }
        "tag.delete" => {
            let entity_id = text(object, "id").ok_or_else(|| "缺少 id".to_owned())?;
            notes_repo::delete_tag(connection, entity_id)?;
            Ok(json!({ "ok": true }))
        }
        "revision.restore" => {
            let revision_id = text(object, "id").ok_or_else(|| "缺少版本 id".to_owned())?;
            let restored = notes_repo::restore_revision(connection, revision_id)?;
            crate::database::note_links::sync_note_links(connection, &restored)?;
            crate::database::note_links::enrich_note(connection, restored)
        }
        "attachment.record" => {
            let file = object.get("file").ok_or_else(|| "缺少附件数据".to_owned())?;
            let note_id = file
                .get("noteId")
                .and_then(Value::as_str)
                .ok_or_else(|| "附件缺少 noteId".to_owned())?;
            notes_repo::record_attachment(connection, note_id, file)?;
            Ok(json!({ "ok": true }))
        }
        "attachment.delete" => {
            let attachment_id = text(object, "id").ok_or_else(|| "缺少附件 id".to_owned())?;
            notes_repo::delete_attachment(connection, attachment_id)?;
            Ok(json!({ "ok": true }))
        }
        "backup.restore" => {
            let data = object.get("data").ok_or_else(|| "备份格式错误".to_owned())?;
            crate::database::backup::create_backup(connection, data_dir, "before-notes-restore")?;
            notes_repo::restore_backup(connection, data)?;
            crate::database::note_links::rebuild_all(connection)?;
            Ok(json!({ "ok": true }))
        }
        _ => Err("不支持的笔记操作".to_owned()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_unknown_transport_actions_before_repository_access() {
        let connection = Connection::open_in_memory().unwrap();
        assert_eq!(
            query(&connection, &json!({ "action": "unknown" })).unwrap_err(),
            "不支持的笔记查询"
        );
    }
}
