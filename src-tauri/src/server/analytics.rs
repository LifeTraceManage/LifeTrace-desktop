//! Browser/dev compatibility adapter for local analytics.
//!
//! Tauri Desktop uses the analytics_query command. HTTP routes stay available
//! for browser tooling and delegate to the same application service.

use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::{application, database::repositories::analytics as analytics_repo};

use super::AppState;

fn failure(status: StatusCode, message: impl Into<String>) -> Response {
    (status, Json(json!({ "error": message.into() }))).into_response()
}

fn finish(result: Result<Value, String>) -> Response {
    match result {
        Ok(value) => Json(value).into_response(),
        Err(message) => failure(StatusCode::BAD_REQUEST, message),
    }
}

pub async fn status(State(state): State<AppState>) -> Response {
    let mut connection = match state.database.lock() {
        Ok(value) => value,
        Err(_) => return failure(StatusCode::INTERNAL_SERVER_ERROR, "SQLite 锁已损坏"),
    };
    finish(application::analytics::query(
        &mut connection,
        &json!({ "action": "status" }),
    ))
}

pub async fn rebuild(State(state): State<AppState>) -> Response {
    let mut connection = match state.database.lock() {
        Ok(value) => value,
        Err(_) => return failure(StatusCode::INTERNAL_SERVER_ERROR, "SQLite 锁已损坏"),
    };
    finish(application::analytics::query(
        &mut connection,
        &json!({ "action": "rebuild" }),
    ))
}

pub async fn timeline(
    State(state): State<AppState>,
    Query(query): Query<analytics_repo::TimelineQuery>,
) -> Response {
    let mut connection = match state.database.lock() {
        Ok(value) => value,
        Err(_) => return failure(StatusCode::INTERNAL_SERVER_ERROR, "SQLite 锁已损坏"),
    };
    let query = match serde_json::to_value(query) {
        Ok(value) => value,
        Err(error) => return failure(StatusCode::BAD_REQUEST, error.to_string()),
    };
    finish(application::analytics::query(
        &mut connection,
        &json!({ "action": "timeline", "query": query }),
    ))
}

pub async fn search(
    State(state): State<AppState>,
    Query(query): Query<analytics_repo::SearchQuery>,
) -> Response {
    let mut connection = match state.database.lock() {
        Ok(value) => value,
        Err(_) => return failure(StatusCode::INTERNAL_SERVER_ERROR, "SQLite 锁已损坏"),
    };
    let query = match serde_json::to_value(query) {
        Ok(value) => value,
        Err(error) => return failure(StatusCode::BAD_REQUEST, error.to_string()),
    };
    finish(application::analytics::query(
        &mut connection,
        &json!({ "action": "search", "query": query }),
    ))
}

#[derive(Debug, Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportQuery {
    report_type: String,
    period_start: String,
    period_end: String,
    timezone: Option<String>,
}

pub async fn report(State(state): State<AppState>, Query(query): Query<ReportQuery>) -> Response {
    let mut connection = match state.database.lock() {
        Ok(value) => value,
        Err(_) => return failure(StatusCode::INTERNAL_SERVER_ERROR, "SQLite 锁已损坏"),
    };
    let query = match serde_json::to_value(query) {
        Ok(value) => value,
        Err(error) => return failure(StatusCode::BAD_REQUEST, error.to_string()),
    };
    finish(application::analytics::query(
        &mut connection,
        &json!({ "action": "report", "query": query }),
    ))
}

#[derive(Debug, Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InsightQuery {
    period_start: String,
    period_end: String,
}

pub async fn insights(
    State(state): State<AppState>,
    Query(query): Query<InsightQuery>,
) -> Response {
    let mut connection = match state.database.lock() {
        Ok(value) => value,
        Err(_) => return failure(StatusCode::INTERNAL_SERVER_ERROR, "SQLite 锁已损坏"),
    };
    let query = match serde_json::to_value(query) {
        Ok(value) => value,
        Err(error) => return failure(StatusCode::BAD_REQUEST, error.to_string()),
    };
    finish(application::analytics::query(
        &mut connection,
        &json!({ "action": "insights", "query": query }),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn report_query_uses_camel_case_contract() {
        let query: ReportQuery = serde_json::from_value(json!({
            "reportType": "weekly",
            "periodStart": "2026-08-03",
            "periodEnd": "2026-08-09",
            "timezone": "Asia/Shanghai"
        }))
        .unwrap();
        assert_eq!(query.report_type, "weekly");
        assert_eq!(query.period_start, "2026-08-03");
        assert_eq!(query.period_end, "2026-08-09");
    }
}
