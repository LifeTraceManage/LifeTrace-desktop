//! Local HTTP compatibility adapter for core local state.
//!
//! Desktop renderer uses Tauri commands. Browser/dev compatibility keeps this
//! route, but all use-case logic lives in application::state.

use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use rusqlite::Connection;
use serde_json::{json, Value};

use crate::application;

use super::AppState;

fn error(status: StatusCode, message: impl Into<String>) -> Response {
    (status, Json(json!({ "error": message.into() }))).into_response()
}

fn finish(result: Result<Value, String>) -> Response {
    match result {
        Ok(value) => Json(value).into_response(),
        Err(message) => error(StatusCode::BAD_REQUEST, message),
    }
}

pub fn ensure_schema(connection: &Connection) -> rusqlite::Result<()> {
    application::state::ensure_schema(connection)
}

pub async fn get(State(state): State<AppState>) -> Response {
    let connection = match state.database.lock() {
        Ok(value) => value,
        Err(_) => return error(StatusCode::INTERNAL_SERVER_ERROR, "SQLite 锁已损坏"),
    };
    finish(application::state::load(&connection))
}

pub async fn mutate(State(state): State<AppState>, Json(body): Json<Value>) -> Response {
    let mut connection = match state.database.lock() {
        Ok(value) => value,
        Err(_) => return error(StatusCode::INTERNAL_SERVER_ERROR, "SQLite 锁已损坏"),
    };
    finish(application::state::mutate(
        &mut connection,
        &state.data_dir,
        &body,
    ))
}
