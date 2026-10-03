use std::collections::HashSet;

use rusqlite::{
    params, params_from_iter,
    types::{Value as SqlValue, ValueRef},
    Connection,
};
use serde_json::{Map, Value};

#[derive(Debug, Clone, Copy)]
struct TableSpec {
    entity_type: &'static str,
    table: &'static str,
}

const TABLE_SPECS: &[TableSpec] = &[
    TableSpec { entity_type: "travel.trip", table: "travel_trips" },
    TableSpec { entity_type: "travel.place", table: "travel_places" },
    TableSpec { entity_type: "travel.visit", table: "travel_visits" },
    TableSpec { entity_type: "travel.photo_link", table: "travel_photo_links" },
];

pub const ENTITY_TYPES: &[&str] = &[
    "travel.trip",
    "travel.place",
    "travel.visit",
    "travel.photo_link",
];

pub fn is_travel(entity_type: &str) -> bool {
    ENTITY_TYPES.contains(&entity_type)
}

fn spec_for(entity_type: &str) -> Option<TableSpec> {
    TABLE_SPECS
        .iter()
        .copied()
        .find(|spec| spec.entity_type == entity_type)
}

fn snake_to_camel(value: &str) -> String {
    let mut result = String::with_capacity(value.len());
    let mut uppercase = false;
    for ch in value.chars() {
        if ch == '_' {
            uppercase = true;
        } else if uppercase {
            result.extend(ch.to_uppercase());
            uppercase = false;
        } else {
            result.push(ch);
        }
    }
    result
}

fn camel_to_snake(value: &str) -> String {
    let mut result = String::with_capacity(value.len() + 4);
    for ch in value.chars() {
        if ch.is_ascii_uppercase() {
            result.push('_');
            result.push(ch.to_ascii_lowercase());
        } else {
            result.push(ch);
        }
    }
    result
}

fn sqlite_value(value: ValueRef<'_>) -> Value {
    match value {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(value) => Value::Number(value.into()),
        ValueRef::Real(value) => serde_json::Number::from_f64(value)
            .map(Value::Number)
            .unwrap_or(Value::Null),
        ValueRef::Text(value) => Value::String(String::from_utf8_lossy(value).into_owned()),
        ValueRef::Blob(value) => Value::Array(
            value
                .iter()
                .map(|byte| Value::Number((*byte as u64).into()))
                .collect(),
        ),
    }
}

fn load_entity(
    connection: &Connection,
    profile: &str,
    spec: TableSpec,
    entity_id: &str,
) -> Result<Option<Value>, String> {
    let sql = format!("SELECT * FROM {} WHERE id=?1 AND user_id=?2", spec.table);
    let mut statement = connection
        .prepare(&sql)
        .map_err(|error| error.to_string())?;
    let column_names = statement
        .column_names()
        .iter()
        .map(|value| (*value).to_owned())
        .collect::<Vec<_>>();
    statement
        .query_row(params![entity_id, profile], |row| {
            let mut object = Map::new();
            for (index, column) in column_names.iter().enumerate() {
                object.insert(snake_to_camel(column), sqlite_value(row.get_ref(index)?));
            }
            Ok(Value::Object(object))
        })
        .optional()
        .map_err(|error| error.to_string())
}

pub fn load_local_entity(
    connection: &Connection,
    profile: &str,
    entity_type: &str,
    entity_id: &str,
) -> Result<Option<Value>, String> {
    let Some(spec) = spec_for(entity_type) else {
        return Ok(None);
    };
    load_entity(connection, profile, spec, entity_id)
}

pub fn existing_entities(
    connection: &Connection,
    profile: &str,
) -> Result<Vec<(&'static str, Value)>, String> {
    let mut result = Vec::new();
    for spec in TABLE_SPECS {
        let sql = format!(
            "SELECT id FROM {} WHERE user_id=?1 AND deleted_at IS NULL ORDER BY created_at,id",
            spec.table
        );
        let mut statement = connection
            .prepare(&sql)
            .map_err(|error| error.to_string())?;
        let ids = statement
            .query_map([profile], |row| row.get::<_, String>(0))
            .map_err(|error| error.to_string())?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|error| error.to_string())?;
        drop(statement);
        for id in ids {
            if let Some(value) = load_entity(connection, profile, *spec, &id)? {
                result.push((spec.entity_type, value));
            }
        }
    }
    Ok(result)
}

fn table_columns(connection: &Connection, table: &str) -> Result<Vec<String>, String> {
    let sql = format!("PRAGMA table_info({table})");
    let mut statement = connection
        .prepare(&sql)
        .map_err(|error| error.to_string())?;
    statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| error.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|error| error.to_string())
}

fn json_to_sql(value: &Value) -> SqlValue {
    match value {
        Value::Null => SqlValue::Null,
        Value::Bool(value) => SqlValue::Integer(if *value { 1 } else { 0 }),
        Value::Number(value) => value
            .as_i64()
            .map(SqlValue::Integer)
            .or_else(|| value.as_f64().map(SqlValue::Real))
            .unwrap_or(SqlValue::Null),
        Value::String(value) => SqlValue::Text(value.clone()),
        Value::Array(_) | Value::Object(_) => SqlValue::Text(value.to_string()),
    }
}

pub fn apply_upsert(
    connection: &Connection,
    profile: &str,
    entity_type: &str,
    legacy: &Value,
) -> Result<(), String> {
    let spec = spec_for(entity_type)
        .ok_or_else(|| format!("unsupported travel entity type: {entity_type}"))?;
    let object = legacy
        .as_object()
        .ok_or_else(|| "travel sync payload must be an object".to_owned())?;
    let table_columns = table_columns(connection, spec.table)?;
    let allowed = table_columns.iter().cloned().collect::<HashSet<_>>();
    let mut values_by_column = Map::new();

    for (key, value) in object {
        let column = camel_to_snake(key);
        if allowed.contains(&column) {
            values_by_column.insert(column, value.clone());
        }
    }
    values_by_column.insert("user_id".to_owned(), Value::String(profile.to_owned()));

    let id = values_by_column
        .get("id")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("{} payload is missing id", spec.entity_type))?;
    let _ = id;

    let columns = table_columns
        .iter()
        .filter(|column| values_by_column.contains_key(*column))
        .cloned()
        .collect::<Vec<_>>();
    let sql_values = columns
        .iter()
        .map(|column| json_to_sql(values_by_column.get(column).unwrap_or(&Value::Null)))
        .collect::<Vec<_>>();
    let placeholders = (1..=columns.len())
        .map(|index| format!("?{index}"))
        .collect::<Vec<_>>()
        .join(",");
    let updates = columns
        .iter()
        .filter(|column| column.as_str() != "id")
        .map(|column| format!("{column}=excluded.{column}"))
        .collect::<Vec<_>>()
        .join(",");
    let sql = format!(
        "INSERT INTO {}({}) VALUES({}) ON CONFLICT(id) DO UPDATE SET {}",
        spec.table,
        columns.join(","),
        placeholders,
        updates
    );

    connection
        .execute(&sql, params_from_iter(sql_values.iter()))
        .map(|_| ())
        .map_err(|error| format!("apply {} upsert: {error}", spec.entity_type))
}

pub fn apply_delete(
    connection: &Connection,
    profile: &str,
    entity_type: &str,
    entity_id: &str,
) -> Result<(), String> {
    let spec = spec_for(entity_type)
        .ok_or_else(|| format!("unsupported travel entity type: {entity_type}"))?;
    connection
        .execute(
            &format!(
                "UPDATE {} SET deleted_at=?1,updated_at=?1,version=version+1
                 WHERE id=?2 AND user_id=?3",
                spec.table
            ),
            params![chrono::Utc::now().to_rfc3339(), entity_id, profile],
        )
        .map(|_| ())
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::migration_runner::{run, MigrationContext};
    use crate::database::migrations::all;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn db(label: &str) -> (Connection, String) {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("lifetrace-sync-travel-{label}-{unique}"));
        std::fs::create_dir_all(&dir).unwrap();
        let mut connection = Connection::open_in_memory().unwrap();
        connection.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        run(&mut connection, &MigrationContext::new(dir), &all()).unwrap();
        let profile = crate::database::profile::active_profile_id(&connection).unwrap();
        (connection, profile)
    }

    #[test]
    fn travel_payload_round_trips_to_real_tables() {
        let (source, source_profile) = db("source");
        let (target, target_profile) = db("target");

        source.execute(
            "INSERT INTO travel_places(
               id,user_id,name,country,country_code,city,latitude,longitude,place_type,created_at,updated_at
             ) VALUES(
               'place-1',?1,'厦门','中国','CN','厦门',24.4798,118.0894,'city',
               '2026-10-01T00:00:00Z','2026-10-01T00:00:00Z'
             )",
            [&source_profile],
        ).unwrap();
        source.execute(
            "INSERT INTO travel_trips(id,user_id,title,start_at,created_at,updated_at)
             VALUES('trip-1',?1,'厦门旅行','2026-10-01T00:00:00Z','2026-10-01T00:00:00Z','2026-10-01T00:00:00Z')",
            [&source_profile],
        ).unwrap();
        source.execute(
            "INSERT INTO travel_visits(
               id,user_id,trip_id,place_id,arrived_at,sequence,created_at,updated_at
             ) VALUES(
               'visit-1',?1,'trip-1','place-1','2026-10-01T08:00:00Z',0,
               '2026-10-01T08:00:00Z','2026-10-01T08:00:00Z'
             )",
            [&source_profile],
        ).unwrap();

        for (entity_type, entity_id) in [
            ("travel.place", "place-1"),
            ("travel.trip", "trip-1"),
            ("travel.visit", "visit-1"),
        ] {
            let local = load_local_entity(&source, &source_profile, entity_type, entity_id)
                .unwrap()
                .unwrap();
            let wire = crate::sync::payload::legacy_to_wire(
                entity_type,
                &local,
                &source_profile,
                None,
            ).unwrap();
            let legacy = crate::sync::payload::wire_to_legacy(&wire).unwrap();
            apply_upsert(&target, &target_profile, entity_type, &legacy).unwrap();
        }

        let place_name: String = target.query_row(
            "SELECT name FROM travel_places WHERE id='place-1' AND user_id=?1",
            [&target_profile],
            |row| row.get(0),
        ).unwrap();
        assert_eq!(place_name, "厦门");
        let trip_title: String = target.query_row(
            "SELECT title FROM travel_trips WHERE id='trip-1' AND user_id=?1",
            [&target_profile],
            |row| row.get(0),
        ).unwrap();
        assert_eq!(trip_title, "厦门旅行");
        let visit_trip: String = target.query_row(
            "SELECT trip_id FROM travel_visits WHERE id='visit-1' AND user_id=?1",
            [&target_profile],
            |row| row.get(0),
        ).unwrap();
        assert_eq!(visit_trip, "trip-1");
    }
}
