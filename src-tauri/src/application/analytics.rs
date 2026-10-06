use rusqlite::Connection;
use serde_json::{json, Value};

use crate::database::{profile, repositories::analytics as analytics_repo};

fn active_user(connection: &Connection) -> Result<String, String> {
    profile::active_profile_id(connection)
}

fn text<'a>(object: &'a serde_json::Map<String, Value>, key: &str) -> Result<&'a str, String> {
    object
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("缺少 {key}"))
}

pub fn query(connection: &mut Connection, request: &Value) -> Result<Value, String> {
    let object = request
        .as_object()
        .ok_or_else(|| "分析查询参数格式错误".to_owned())?;
    let action = object
        .get("action")
        .and_then(Value::as_str)
        .unwrap_or("status");
    if !matches!(action, "status" | "rebuild" | "timeline" | "search" | "report" | "insights") {
        return Err("不支持的分析操作".to_owned());
    }
    let user_id = active_user(connection)?;

    match action {
        "status" => serde_json::to_value(analytics_repo::projection_status(connection, &user_id)?)
            .map_err(|error| error.to_string()),
        "rebuild" => serde_json::to_value(analytics_repo::rebuild(connection, &user_id)?)
            .map_err(|error| error.to_string()),
        "timeline" => {
            analytics_repo::ensure_current(connection, &user_id)?;
            let query: analytics_repo::TimelineQuery = serde_json::from_value(
                object.get("query").cloned().unwrap_or_else(|| json!({})),
            )
            .map_err(|error| format!("时间线查询参数无效: {error}"))?;
            serde_json::to_value(analytics_repo::timeline(connection, &user_id, &query)?)
                .map_err(|error| error.to_string())
        }
        "search" => {
            analytics_repo::ensure_current(connection, &user_id)?;
            let query: analytics_repo::SearchQuery = serde_json::from_value(
                object.get("query").cloned().unwrap_or_else(|| json!({})),
            )
            .map_err(|error| format!("搜索参数无效: {error}"))?;
            serde_json::to_value(analytics_repo::search(connection, &user_id, &query)?)
                .map_err(|error| error.to_string())
        }
        "report" => {
            let params = object
                .get("query")
                .and_then(Value::as_object)
                .ok_or_else(|| "报表参数格式错误".to_owned())?;
            let report_type = text(params, "reportType")?;
            let period_start = text(params, "periodStart")?;
            let period_end = text(params, "periodEnd")?;
            let timezone = params
                .get("timezone")
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty())
                .unwrap_or("UTC");
            serde_json::to_value(analytics_repo::generate_report(
                connection,
                &user_id,
                report_type,
                period_start,
                period_end,
                timezone,
            )?)
            .map_err(|error| error.to_string())
        }
        "insights" => {
            let params = object
                .get("query")
                .and_then(Value::as_object)
                .ok_or_else(|| "洞察参数格式错误".to_owned())?;
            let period_start = text(params, "periodStart")?;
            let period_end = text(params, "periodEnd")?;
            serde_json::to_value(analytics_repo::generate_insights(
                connection,
                &user_id,
                period_start,
                period_end,
            )?)
            .map_err(|error| error.to_string())
        }
        _ => unreachable!("analytics action validated above"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_unknown_analytics_action_before_repository_query() {
        let mut connection = Connection::open_in_memory().unwrap();
        let error = query(&mut connection, &json!({ "action": "unknown" })).unwrap_err();
        assert_eq!(error, "不支持的分析操作");
    }
}
