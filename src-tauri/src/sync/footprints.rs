use chrono::Utc;
use lifetrace_contracts::registry::EntityType;
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};

use crate::database::repositories::footprints::{
    self as repository, EntryWrite, LocationWrite,
};

fn required_text(value: &Value, key: &str) -> Result<String, String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .ok_or_else(|| format!("footprint sync payload missing {key}"))
}

fn optional_text(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn load_place(
    connection: &Connection,
    profile: &str,
    entity_id: &str,
) -> Result<Option<Value>, String> {
    connection
        .query_row(
            "SELECT id,country_code,country_name,province_code,province_name,city_code,city_name,
                    district_code,district_name,place_name,latitude,longitude,source,created_at,updated_at
             FROM footprint_locations
             WHERE id=?1 AND user_id=?2",
            params![entity_id, profile],
            |row| Ok(json!({
                "id": row.get::<_, String>(0)?,
                "userId": profile,
                "countryCode": row.get::<_, String>(1)?,
                "countryName": row.get::<_, String>(2)?,
                "provinceCode": row.get::<_, String>(3)?,
                "provinceName": row.get::<_, String>(4)?,
                "cityCode": row.get::<_, Option<String>>(5)?,
                "cityName": row.get::<_, Option<String>>(6)?,
                "districtCode": row.get::<_, Option<String>>(7)?,
                "districtName": row.get::<_, Option<String>>(8)?,
                "placeName": row.get::<_, Option<String>>(9)?,
                "latitude": row.get::<_, Option<f64>>(10)?,
                "longitude": row.get::<_, Option<f64>>(11)?,
                "source": row.get::<_, String>(12)?,
                "createdAt": row.get::<_, String>(13)?,
                "updatedAt": row.get::<_, String>(14)?,
            })),
        )
        .optional()
        .map_err(|error| error.to_string())
}

fn load_visit(
    connection: &Connection,
    profile: &str,
    entity_id: &str,
) -> Result<Option<Value>, String> {
    connection
        .query_row(
            "SELECT e.id,e.location_id,e.title,e.description,e.started_at,e.ended_at,e.visit_type,
                    e.rating,e.favorite,e.created_at,e.updated_at,e.deleted_at,
                    l.country_code,l.country_name,l.province_code,l.province_name,
                    l.city_code,l.city_name,l.district_code,l.district_name,l.place_name,
                    l.latitude,l.longitude,l.source
             FROM footprint_entries e
             JOIN footprint_locations l ON l.id=e.location_id
             WHERE e.id=?1 AND e.user_id=?2",
            params![entity_id, profile],
            |row| Ok(json!({
                "id": row.get::<_, String>(0)?,
                "userId": profile,
                "locationId": row.get::<_, String>(1)?,
                "title": row.get::<_, String>(2)?,
                "description": row.get::<_, Option<String>>(3)?,
                "startedAt": row.get::<_, String>(4)?,
                "endedAt": row.get::<_, Option<String>>(5)?,
                "visitType": row.get::<_, String>(6)?,
                "rating": row.get::<_, Option<i64>>(7)?,
                "favorite": row.get::<_, i64>(8)? != 0,
                "createdAt": row.get::<_, String>(9)?,
                "updatedAt": row.get::<_, String>(10)?,
                "deletedAt": row.get::<_, Option<String>>(11)?,
                "countryCode": row.get::<_, String>(12)?,
                "countryName": row.get::<_, String>(13)?,
                "provinceCode": row.get::<_, String>(14)?,
                "provinceName": row.get::<_, String>(15)?,
                "cityCode": row.get::<_, Option<String>>(16)?,
                "cityName": row.get::<_, Option<String>>(17)?,
                "districtCode": row.get::<_, Option<String>>(18)?,
                "districtName": row.get::<_, Option<String>>(19)?,
                "placeName": row.get::<_, Option<String>>(20)?,
                "latitude": row.get::<_, Option<f64>>(21)?,
                "longitude": row.get::<_, Option<f64>>(22)?,
                "locationSource": row.get::<_, String>(23)?,
            })),
        )
        .optional()
        .map_err(|error| error.to_string())
}

fn load_photo_link(
    connection: &Connection,
    profile: &str,
    entity_id: &str,
) -> Result<Option<Value>, String> {
    connection
        .query_row(
            "SELECT ep.entry_id,ep.photo_id,ep.sort_order,ep.is_cover,ep.created_at
             FROM footprint_entry_photos ep
             JOIN footprint_entries e ON e.id=ep.entry_id
             WHERE (ep.entry_id || ':' || ep.photo_id)=?1
               AND e.user_id=?2 AND e.deleted_at IS NULL",
            params![entity_id, profile],
            |row| Ok(json!({
                "id": entity_id,
                "userId": profile,
                "entryId": row.get::<_, String>(0)?,
                "photoId": row.get::<_, String>(1)?,
                "sortOrder": row.get::<_, i64>(2)?,
                "isCover": row.get::<_, i64>(3)? != 0,
                "createdAt": row.get::<_, String>(4)?,
                "updatedAt": row.get::<_, String>(4)?,
            })),
        )
        .optional()
        .map_err(|error| error.to_string())
}

pub fn is_footprint(entity_type: &str) -> bool {
    matches!(
        entity_type,
        EntityType::TRAVEL_PLACE | EntityType::TRAVEL_VISIT | EntityType::TRAVEL_PHOTO_LINK
    )
}

pub fn load_local_entity(
    connection: &Connection,
    profile: &str,
    entity_type: &str,
    entity_id: &str,
) -> Result<Option<Value>, String> {
    match entity_type {
        EntityType::TRAVEL_PLACE => load_place(connection, profile, entity_id),
        EntityType::TRAVEL_VISIT => load_visit(connection, profile, entity_id),
        EntityType::TRAVEL_PHOTO_LINK => load_photo_link(connection, profile, entity_id),
        _ => Ok(None),
    }
}

pub fn load_entity_link(
    connection: &Connection,
    profile: &str,
    entity_id: &str,
) -> Result<Option<Value>, String> {
    connection
        .query_row(
            "SELECT el.id,el.entry_id,el.entity_type,el.entity_id,el.relation_type,el.created_at
             FROM footprint_entry_links el
             JOIN footprint_entries e ON e.id=el.entry_id
             WHERE el.id=?1 AND e.user_id=?2 AND e.deleted_at IS NULL",
            params![entity_id, profile],
            |row| Ok(json!({
                "id": row.get::<_, String>(0)?,
                "userId": profile,
                "sourceType": EntityType::TRAVEL_VISIT,
                "sourceId": row.get::<_, String>(1)?,
                "targetType": row.get::<_, String>(2)?,
                "targetId": row.get::<_, String>(3)?,
                "relationType": row.get::<_, String>(4)?,
                "metadata": Value::Null,
                "createdAt": row.get::<_, String>(5)?,
                "updatedAt": row.get::<_, String>(5)?,
            })),
        )
        .optional()
        .map_err(|error| error.to_string())
}

fn ids(
    connection: &Connection,
    sql: &str,
    profile: &str,
) -> Result<Vec<String>, String> {
    let mut statement = connection.prepare(sql).map_err(|error| error.to_string())?;
    statement
        .query_map([profile], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|error| error.to_string())
}

pub fn existing_entities(
    connection: &Connection,
    profile: &str,
) -> Result<Vec<(String, Value)>, String> {
    let mut values = Vec::new();
    for (entity_type, sql) in [
        (
            EntityType::TRAVEL_PLACE,
            "SELECT id FROM footprint_locations WHERE user_id=?1 ORDER BY id",
        ),
        (
            EntityType::TRAVEL_VISIT,
            "SELECT id FROM footprint_entries WHERE user_id=?1 AND deleted_at IS NULL ORDER BY id",
        ),
        (
            EntityType::TRAVEL_PHOTO_LINK,
            "SELECT ep.entry_id || ':' || ep.photo_id
             FROM footprint_entry_photos ep
             JOIN footprint_entries e ON e.id=ep.entry_id
             WHERE e.user_id=?1 AND e.deleted_at IS NULL
             ORDER BY ep.entry_id,ep.sort_order,ep.photo_id",
        ),
    ] {
        for id in ids(connection, sql, profile)? {
            if let Some(value) = load_local_entity(connection, profile, entity_type, &id)? {
                values.push((entity_type.to_owned(), value));
            }
        }
    }
    for id in ids(
        connection,
        "SELECT el.id
         FROM footprint_entry_links el
         JOIN footprint_entries e ON e.id=el.entry_id
         WHERE e.user_id=?1 AND e.deleted_at IS NULL
         ORDER BY el.id",
        profile,
    )? {
        if let Some(value) = load_entity_link(connection, profile, &id)? {
            values.push((EntityType::ENTITY_LINK.to_owned(), value));
        }
    }
    Ok(values)
}

fn store_pending(
    connection: &Connection,
    entity_type: &str,
    entity_id: &str,
    entry_id: &str,
    payload: &Value,
) -> Result<(), String> {
    connection
        .execute(
            "INSERT INTO footprint_sync_pending(entity_type,entity_id,entry_id,payload_json,updated_at)
             VALUES(?1,?2,?3,?4,?5)
             ON CONFLICT(entity_type,entity_id) DO UPDATE SET
               entry_id=excluded.entry_id,payload_json=excluded.payload_json,updated_at=excluded.updated_at",
            params![
                entity_type,
                entity_id,
                entry_id,
                payload.to_string(),
                Utc::now().to_rfc3339(),
            ],
        )
        .map(|_| ())
        .map_err(|error| error.to_string())
}

fn entry_exists(
    connection: &Connection,
    profile: &str,
    entry_id: &str,
) -> Result<bool, String> {
    connection
        .query_row(
            "SELECT COUNT(*) FROM footprint_entries
             WHERE id=?1 AND user_id=?2 AND deleted_at IS NULL",
            params![entry_id, profile],
            |row| row.get::<_, i64>(0),
        )
        .map(|count| count > 0)
        .map_err(|error| error.to_string())
}

fn apply_place(
    connection: &Connection,
    profile: &str,
    value: &Value,
) -> Result<(), String> {
    let id = required_text(value, "id")?;
    repository::save_location(
        connection,
        profile,
        &LocationWrite {
            id: Some(id),
            country_code: optional_text(value, "countryCode").unwrap_or_else(|| "CN".to_owned()),
            country_name: optional_text(value, "countryName").unwrap_or_else(|| "中国".to_owned()),
            province_code: required_text(value, "provinceCode")?,
            province_name: required_text(value, "provinceName")?,
            city_code: optional_text(value, "cityCode"),
            city_name: optional_text(value, "cityName"),
            district_code: optional_text(value, "districtCode"),
            district_name: optional_text(value, "districtName"),
            place_name: optional_text(value, "placeName"),
            latitude: value.get("latitude").and_then(Value::as_f64),
            longitude: value.get("longitude").and_then(Value::as_f64),
            source: optional_text(value, "source")
                .or_else(|| optional_text(value, "locationSource"))
                .unwrap_or_else(|| "sync".to_owned()),
        },
    )?;
    Ok(())
}

fn ensure_visit_location(
    connection: &Connection,
    profile: &str,
    value: &Value,
) -> Result<String, String> {
    let location_id = required_text(value, "locationId")?;
    if repository::get_location(connection, profile, &location_id)?.is_none() {
        let place = json!({
            "id": location_id,
            "countryCode": value.get("countryCode").cloned().unwrap_or_else(|| json!("CN")),
            "countryName": value.get("countryName").cloned().unwrap_or_else(|| json!("中国")),
            "provinceCode": value.get("provinceCode").cloned().unwrap_or(Value::Null),
            "provinceName": value.get("provinceName").cloned().unwrap_or(Value::Null),
            "cityCode": value.get("cityCode").cloned().unwrap_or(Value::Null),
            "cityName": value.get("cityName").cloned().unwrap_or(Value::Null),
            "districtCode": value.get("districtCode").cloned().unwrap_or(Value::Null),
            "districtName": value.get("districtName").cloned().unwrap_or(Value::Null),
            "placeName": value.get("placeName").cloned().unwrap_or(Value::Null),
            "latitude": value.get("latitude").cloned().unwrap_or(Value::Null),
            "longitude": value.get("longitude").cloned().unwrap_or(Value::Null),
            "source": value.get("locationSource").cloned().unwrap_or_else(|| json!("sync")),
        });
        apply_place(connection, profile, &place)?;
    }
    Ok(location_id)
}

fn apply_photo_link_value(
    connection: &Connection,
    profile: &str,
    value: &Value,
    allow_pending: bool,
) -> Result<(), String> {
    let id = required_text(value, "id")?;
    let entry_id = required_text(value, "entryId")?;
    let photo_id = required_text(value, "photoId")?;
    if !entry_exists(connection, profile, &entry_id)? {
        if allow_pending {
            return store_pending(connection, EntityType::TRAVEL_PHOTO_LINK, &id, &entry_id, value);
        }
        return Err(format!("footprint photo link parent missing: {entry_id}"));
    }
    let is_cover = value.get("isCover").and_then(Value::as_bool).unwrap_or(false);
    if is_cover {
        connection
            .execute(
                "UPDATE footprint_entry_photos SET is_cover=0 WHERE entry_id=?1",
                [&entry_id],
            )
            .map_err(|error| error.to_string())?;
    }
    connection
        .execute(
            "INSERT INTO footprint_entry_photos(entry_id,photo_id,sort_order,is_cover,created_at)
             VALUES(?1,?2,?3,?4,?5)
             ON CONFLICT(entry_id,photo_id) DO UPDATE SET
               sort_order=excluded.sort_order,is_cover=excluded.is_cover",
            params![
                entry_id,
                photo_id,
                value.get("sortOrder").and_then(Value::as_i64).unwrap_or(0),
                i64::from(is_cover),
                optional_text(value, "createdAt").unwrap_or_else(|| Utc::now().to_rfc3339()),
            ],
        )
        .map(|_| ())
        .map_err(|error| error.to_string())
}

fn link_source(value: &Value) -> Option<(&str, &str)> {
    let source = value.get("source")?.as_object()?;
    Some((
        source.get("entityType")?.as_str()?,
        source.get("entityId")?.as_str()?,
    ))
}

fn apply_entity_link_value(
    connection: &Connection,
    profile: &str,
    value: &Value,
    allow_pending: bool,
) -> Result<bool, String> {
    let Some((source_type, source_id)) = link_source(value) else {
        return Ok(false);
    };
    if source_type != EntityType::TRAVEL_VISIT {
        return Ok(false);
    }
    let id = required_text(value, "id")?;
    if !entry_exists(connection, profile, source_id)? {
        if allow_pending {
            store_pending(connection, EntityType::ENTITY_LINK, &id, source_id, value)?;
            return Ok(true);
        }
        return Err(format!("footprint entity link parent missing: {source_id}"));
    }
    let target = value
        .get("target")
        .and_then(Value::as_object)
        .ok_or_else(|| "footprint entity link missing target".to_owned())?;
    let target_type = target
        .get("entityType")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "footprint entity link missing target.entityType".to_owned())?;
    let target_id = target
        .get("entityId")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "footprint entity link missing target.entityId".to_owned())?;
    connection
        .execute(
            "INSERT INTO footprint_entry_links(
               id,entry_id,entity_type,entity_id,relation_type,created_at
             ) VALUES(?1,?2,?3,?4,?5,?6)
             ON CONFLICT(id) DO UPDATE SET
               entry_id=excluded.entry_id,entity_type=excluded.entity_type,
               entity_id=excluded.entity_id,relation_type=excluded.relation_type",
            params![
                id,
                source_id,
                target_type,
                target_id,
                optional_text(value, "relationType").unwrap_or_else(|| "related".to_owned()),
                optional_text(value, "createdAt").unwrap_or_else(|| Utc::now().to_rfc3339()),
            ],
        )
        .map_err(|error| error.to_string())?;
    Ok(true)
}

fn flush_pending(
    connection: &Connection,
    profile: &str,
    entry_id: &str,
) -> Result<(), String> {
    let rows = {
        let mut statement = connection
            .prepare(
                "SELECT entity_type,entity_id,payload_json
                 FROM footprint_sync_pending
                 WHERE entry_id=?1
                 ORDER BY entity_type,entity_id",
            )
            .map_err(|error| error.to_string())?;
        statement
            .query_map([entry_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(|error| error.to_string())?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|error| error.to_string())?
    };
    for (entity_type, entity_id, raw) in rows {
        let value: Value = serde_json::from_str(&raw).map_err(|error| error.to_string())?;
        match entity_type.as_str() {
            EntityType::TRAVEL_PHOTO_LINK => {
                apply_photo_link_value(connection, profile, &value, false)?;
            }
            EntityType::ENTITY_LINK => {
                let _ = apply_entity_link_value(connection, profile, &value, false)?;
            }
            _ => {}
        }
        connection
            .execute(
                "DELETE FROM footprint_sync_pending WHERE entity_type=?1 AND entity_id=?2",
                params![entity_type, entity_id],
            )
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn apply_visit(
    connection: &Connection,
    profile: &str,
    value: &Value,
) -> Result<(), String> {
    let id = required_text(value, "id")?;
    let location_id = ensure_visit_location(connection, profile, value)?;
    repository::save_entry(
        connection,
        profile,
        &EntryWrite {
            id: Some(id.clone()),
            location_id,
            title: required_text(value, "title")?,
            description: optional_text(value, "description"),
            started_at: required_text(value, "startedAt")?,
            ended_at: optional_text(value, "endedAt"),
            visit_type: optional_text(value, "visitType").unwrap_or_else(|| "trip".to_owned()),
            rating: value.get("rating").and_then(Value::as_i64),
            favorite: value.get("favorite").and_then(Value::as_bool).unwrap_or(false),
        },
    )?;
    flush_pending(connection, profile, &id)
}

pub fn apply_upsert(
    connection: &Connection,
    profile: &str,
    entity_type: &str,
    value: &Value,
) -> Result<(), String> {
    match entity_type {
        EntityType::TRAVEL_PLACE => apply_place(connection, profile, value),
        EntityType::TRAVEL_VISIT => apply_visit(connection, profile, value),
        EntityType::TRAVEL_PHOTO_LINK => {
            apply_photo_link_value(connection, profile, value, true)
        }
        _ => Ok(()),
    }
}

pub fn apply_entity_link(
    connection: &Connection,
    profile: &str,
    value: &Value,
) -> Result<bool, String> {
    apply_entity_link_value(connection, profile, value, true)
}

pub fn apply_delete(
    connection: &Connection,
    profile: &str,
    entity_type: &str,
    entity_id: &str,
) -> Result<(), String> {
    match entity_type {
        EntityType::TRAVEL_PLACE => {
            connection
                .execute(
                    "DELETE FROM footprint_locations
                     WHERE id=?1 AND user_id=?2
                       AND NOT EXISTS(SELECT 1 FROM footprint_entries WHERE location_id=?1)",
                    params![entity_id, profile],
                )
                .map_err(|error| error.to_string())?;
        }
        EntityType::TRAVEL_VISIT => {
            let _ = repository::delete_entry(connection, profile, entity_id)?;
            connection
                .execute(
                    "DELETE FROM footprint_sync_pending WHERE entry_id=?1",
                    [entity_id],
                )
                .map_err(|error| error.to_string())?;
        }
        EntityType::TRAVEL_PHOTO_LINK => {
            let (entry_id, photo_id) = entity_id
                .split_once(':')
                .ok_or_else(|| "invalid travel.photo_link entity id".to_owned())?;
            connection
                .execute(
                    "DELETE FROM footprint_entry_photos WHERE entry_id=?1 AND photo_id=?2",
                    params![entry_id, photo_id],
                )
                .map_err(|error| error.to_string())?;
            connection
                .execute(
                    "DELETE FROM footprint_sync_pending
                     WHERE entity_type=?1 AND entity_id=?2",
                    params![EntityType::TRAVEL_PHOTO_LINK, entity_id],
                )
                .map_err(|error| error.to_string())?;
        }
        _ => {}
    }
    Ok(())
}

pub fn delete_entity_link(
    connection: &Connection,
    profile: &str,
    entity_id: &str,
) -> Result<bool, String> {
    let changed = connection
        .execute(
            "DELETE FROM footprint_entry_links
             WHERE id=?1 AND EXISTS(
               SELECT 1 FROM footprint_entries e
               WHERE e.id=footprint_entry_links.entry_id AND e.user_id=?2
             )",
            params![entity_id, profile],
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "DELETE FROM footprint_sync_pending WHERE entity_type=?1 AND entity_id=?2",
            params![EntityType::ENTITY_LINK, entity_id],
        )
        .map_err(|error| error.to_string())?;
    Ok(changed > 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::migration_runner::{run, MigrationContext};
    use crate::database::migrations::all;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn database() -> (Connection, String) {
        let unique = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let data_dir = std::env::temp_dir().join(format!("lifetrace-footprint-sync-{unique}"));
        std::fs::create_dir_all(&data_dir).unwrap();
        let mut connection = Connection::open_in_memory().unwrap();
        connection.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        run(&mut connection, &MigrationContext::new(data_dir), &all()).unwrap();
        let profile = crate::database::profile::active_profile_id(&connection).unwrap();
        connection.execute("UPDATE sync_context SET origin='remote' WHERE singleton=1", []).unwrap();
        (connection, profile)
    }

    #[test]
    fn remote_visit_reconstructs_place_and_flushes_children() {
        let (connection, profile) = database();
        let photo_link = json!({
            "id":"visit-1:photo-1","entryId":"visit-1","photoId":"photo-1",
            "sortOrder":0,"isCover":true,"createdAt":"2026-05-01T00:00:00Z"
        });
        apply_upsert(&connection, &profile, EntityType::TRAVEL_PHOTO_LINK, &photo_link).unwrap();
        let pending: i64 = connection.query_row(
            "SELECT COUNT(*) FROM footprint_sync_pending",
            [],
            |row| row.get(0),
        ).unwrap();
        assert_eq!(pending, 1);

        let visit = json!({
            "id":"visit-1","locationId":"place-1","title":"成都","startedAt":"2026-05-01",
            "visitType":"trip","favorite":false,"countryCode":"CN","countryName":"中国",
            "provinceCode":"510000","provinceName":"四川省","cityCode":"510100","cityName":"成都市",
            "latitude":30.57,"longitude":104.06
        });
        apply_upsert(&connection, &profile, EntityType::TRAVEL_VISIT, &visit).unwrap();
        assert!(repository::get_entry(&connection, &profile, "visit-1").unwrap().is_some());
        assert!(repository::get_location(&connection, &profile, "place-1").unwrap().is_some());
        let links: i64 = connection.query_row(
            "SELECT COUNT(*) FROM footprint_entry_photos WHERE entry_id='visit-1' AND photo_id='photo-1'",
            [],
            |row| row.get(0),
        ).unwrap();
        assert_eq!(links, 1);
        let remaining: i64 = connection.query_row(
            "SELECT COUNT(*) FROM footprint_sync_pending",
            [],
            |row| row.get(0),
        ).unwrap();
        assert_eq!(remaining, 0);
    }

    #[test]
    fn entity_link_round_trips_through_footprint_links() {
        let (connection, profile) = database();
        let visit = json!({
            "id":"visit-1","locationId":"place-1","title":"成都","startedAt":"2026-05-01",
            "provinceCode":"510000","provinceName":"四川省"
        });
        apply_upsert(&connection, &profile, EntityType::TRAVEL_VISIT, &visit).unwrap();
        let link = json!({
            "id":"link-1",
            "source":{"entityType":"travel.visit","entityId":"visit-1"},
            "target":{"entityType":"note.note","entityId":"note-1"},
            "relationType":"related",
            "createdAt":"2026-05-01T00:00:00Z"
        });
        assert!(apply_entity_link(&connection, &profile, &link).unwrap());
        let loaded = load_entity_link(&connection, &profile, "link-1").unwrap().unwrap();
        assert_eq!(loaded["sourceType"], EntityType::TRAVEL_VISIT);
        assert_eq!(loaded["targetType"], EntityType::NOTE_NOTE);
        assert!(delete_entity_link(&connection, &profile, "link-1").unwrap());
    }
}
