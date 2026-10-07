use std::path::Path;

use rusqlite::{params, Connection};
use serde_json::{json, Map, Value};

use crate::database::repositories::{finance, habits, workouts};

const JSON_TABLES: [(&str, &str); 1] = [("settings", "settings")];

fn table_name(key: &str) -> Option<&'static str> {
    JSON_TABLES
        .iter()
        .find_map(|(candidate, table)| (*candidate == key).then_some(*table))
}

fn updated_at(value: &Value) -> String {
    value
        .get("updatedAt")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .unwrap_or_else(|| chrono::Utc::now().to_rfc3339())
}

fn put_json(connection: &Connection, table: &str, value: &Value) -> Result<(), String> {
    let id = value
        .get("id")
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty())
        .ok_or_else(|| "数据缺少 id".to_owned())?;
    let sql = format!(
        "INSERT INTO {table} (id, data_json, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(id) DO UPDATE SET data_json=excluded.data_json, updated_at=excluded.updated_at"
    );
    connection
        .execute(&sql, params![id, value.to_string(), updated_at(value)])
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn read_json_table(connection: &Connection, table: &str) -> Result<Value, String> {
    let sql = format!("SELECT data_json FROM {table} ORDER BY updated_at DESC");
    let mut statement = connection.prepare(&sql).map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?;
    let mut values = Vec::new();
    for row in rows {
        values.push(
            serde_json::from_str(&row.map_err(|error| error.to_string())?)
                .map_err(|error| error.to_string())?,
        );
    }
    Ok(Value::Array(values))
}

pub fn ensure_schema(connection: &Connection) -> rusqlite::Result<()> {
    for (_, table) in JSON_TABLES {
        connection.execute(
            &format!(
                "CREATE TABLE IF NOT EXISTS {table} (
                   id TEXT PRIMARY KEY,
                   data_json TEXT NOT NULL,
                   updated_at TEXT NOT NULL
                 )"
            ),
            [],
        )?;
    }
    let settings_count: i64 =
        connection.query_row("SELECT COUNT(*) FROM settings", [], |row| row.get(0))?;
    if settings_count == 0 {
        let stamp = chrono::Utc::now().to_rfc3339();
        let settings = json!({
            "id": "preferences",
            "dark": false,
            "timer": null,
            "updatedAt": stamp,
        });
        put_json(connection, "settings", &settings)
            .map_err(|message| rusqlite::Error::ToSqlConversionFailure(message.into()))?;
    }
    Ok(())
}

pub fn load(connection: &Connection) -> Result<Value, String> {
    let mut result = Map::new();
    result.insert(
        "activities".to_owned(),
        Value::Array(habits::list_activities(connection)?),
    );
    result.insert(
        "logs".to_owned(),
        Value::Array(habits::list_activity_logs(connection)?),
    );
    result.insert(
        "reviews".to_owned(),
        Value::Array(habits::list_daily_reviews(connection)?),
    );
    result.insert(
        "workoutHistory".to_owned(),
        Value::Array(workouts::list_workouts(connection)?),
    );

    for (key, table) in JSON_TABLES {
        let values = read_json_table(connection, table)?;
        result.insert(
            key.to_owned(),
            if key == "settings" {
                values
                    .as_array()
                    .and_then(|items| items.first())
                    .cloned()
                    .unwrap_or_else(|| json!({}))
            } else {
                values
            },
        );
    }

    result.insert(
        "accounts".to_owned(),
        Value::Array(finance::list_accounts(connection)?),
    );
    result.insert(
        "transactions".to_owned(),
        Value::Array(finance::list_transactions(connection)?),
    );
    result.insert(
        "categories".to_owned(),
        Value::Array(finance::list_categories(connection)?),
    );
    Ok(Value::Object(result))
}

fn object<'a>(body: &'a Value) -> Result<&'a serde_json::Map<String, Value>, String> {
    body.as_object()
        .ok_or_else(|| "SQLite 操作参数格式错误".to_owned())
}

fn existing_by_id(values: Vec<Value>, id: &str) -> Result<Value, String> {
    values
        .into_iter()
        .find(|item| item.get("id").and_then(Value::as_str) == Some(id))
        .ok_or_else(|| "项目不存在".to_owned())
}

pub fn mutate(
    connection: &mut Connection,
    data_dir: &Path,
    body: &Value,
) -> Result<Value, String> {
    let body = object(body)?;
    let operation = body
        .get("operation")
        .and_then(Value::as_str)
        .unwrap_or_default();

    match operation {
        "put" => {
            let key = body
                .get("table")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let value = body
                .get("value")
                .ok_or_else(|| "缺少写入数据".to_owned())?;
            match key {
                "accounts" => finance::save_account(connection, value)?,
                "transactions" => finance::save_transaction(connection, value)?,
                "categories" => finance::save_category(connection, value)?,
                "activities" => habits::save_activity(connection, value)?,
                "logs" => habits::save_activity_log(connection, value)?,
                "reviews" => habits::save_daily_review(connection, value)?,
                "workoutHistory" => workouts::save_workout(connection, value)?,
                other => {
                    let table = table_name(other).ok_or_else(|| "不支持的数据表".to_owned())?;
                    put_json(connection, table, value)?;
                }
            }
            Ok(json!({ "ok": true }))
        }
        "patch" => {
            let key = body
                .get("table")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let id = body
                .get("id")
                .and_then(Value::as_str)
                .ok_or_else(|| "缺少数据 id".to_owned())?;
            let patch = body
                .get("patch")
                .and_then(Value::as_object)
                .ok_or_else(|| "缺少更新内容".to_owned())?;
            let mut value = match key {
                "accounts" => existing_by_id(finance::list_accounts(connection)?, id)?,
                "activities" => existing_by_id(habits::list_activities(connection)?, id)?,
                "settings" => return Err("设置不支持局部更新".to_owned()),
                _ => return Err("该数据表不支持局部更新".to_owned()),
            };
            if let Some(current) = value.as_object_mut() {
                current.extend(patch.clone());
                current.insert("id".to_owned(), Value::String(id.to_owned()));
            }
            match key {
                "accounts" => finance::save_account(connection, &value)?,
                "activities" => habits::save_activity(connection, &value)?,
                _ => unreachable!(),
            }
            Ok(json!({ "ok": true }))
        }
        "delete" => {
            let key = body
                .get("table")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let id = body
                .get("id")
                .and_then(Value::as_str)
                .ok_or_else(|| "缺少数据 id".to_owned())?;
            match key {
                "accounts" => finance::delete_account(connection, id)?,
                "transactions" => finance::delete_transaction(connection, id)?,
                "categories" => finance::delete_category(connection, id)?,
                "workoutHistory" => workouts::delete_workout(connection, id)?,
                "settings" => return Err("不能删除设置".to_owned()),
                _ => return Err("该数据表不支持删除".to_owned()),
            }
            Ok(json!({ "ok": true }))
        }
        "restore" => {
            let data = body
                .get("data")
                .and_then(Value::as_object)
                .ok_or_else(|| "备份数据格式错误".to_owned())?;
            crate::database::backup::create_backup(connection, data_dir, "before-restore")?;

            let accounts = data
                .get("accounts")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let transactions = data
                .get("transactions")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let activities = data
                .get("activities")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let logs = data
                .get("logs")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let reviews = data
                .get("reviews")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let workout_history = data
                .get("workoutHistory")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();

            let transaction = connection.transaction().map_err(|error| error.to_string())?;
            finance::replace_all(&transaction, &accounts, &transactions)?;
            habits::replace_all(&transaction, &activities, &logs, &reviews)?;
            workouts::replace_all(&transaction, &workout_history)?;
            transaction.commit().map_err(|error| error.to_string())?;
            Ok(json!({ "ok": true }))
        }
        _ => Err("不支持的数据操作".to_owned()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn application_state_bootstraps_settings_without_http() {
        let connection = Connection::open_in_memory().unwrap();
        ensure_schema(&connection).unwrap();
        let settings: String = connection
            .query_row("SELECT data_json FROM settings WHERE id='preferences'", [], |row| row.get(0))
            .unwrap();
        assert!(settings.contains("preferences"));
    }

    #[test]
    fn rejects_unknown_mutation_before_touching_business_tables() {
        let mut connection = Connection::open_in_memory().unwrap();
        let error = mutate(
            &mut connection,
            Path::new("."),
            &json!({ "operation": "unknown" }),
        )
        .unwrap_err();
        assert_eq!(error, "不支持的数据操作");
    }
}
