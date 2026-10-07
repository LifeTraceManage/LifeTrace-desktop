//! Local HTTP compatibility adapter for Notes.
//!
//! Desktop UI uses Tauri commands. This route remains only for browser/dev
//! compatibility and delegates to the same application service.

use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::application;

use super::AppState;

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteQuery {
    action: Option<String>,
    id: Option<String>,
    q: Option<String>,
    scope: Option<String>,
    folder_id: Option<String>,
    tag_id: Option<String>,
    note_type: Option<String>,
    sort: Option<String>,
    limit: Option<usize>,
}

fn failure(status: StatusCode, message: impl Into<String>) -> Response {
    (status, Json(json!({ "error": message.into() }))).into_response()
}

fn finish(result: Result<Value, String>) -> Response {
    match result {
        Ok(value) => Json(value).into_response(),
        Err(message) => failure(
            if message.contains("不存在") {
                StatusCode::NOT_FOUND
            } else {
                StatusCode::BAD_REQUEST
            },
            message,
        ),
    }
}

pub async fn get(State(state): State<AppState>, Query(query): Query<NoteQuery>) -> Response {
    let connection = match state.database.lock() {
        Ok(value) => value,
        Err(_) => return failure(StatusCode::INTERNAL_SERVER_ERROR, "SQLite 锁已损坏"),
    };
    let request = match serde_json::to_value(query) {
        Ok(value) => value,
        Err(error) => return failure(StatusCode::BAD_REQUEST, error.to_string()),
    };
    finish(application::notes::query(&connection, &request))
}

pub async fn mutate(State(state): State<AppState>, Json(body): Json<Value>) -> Response {
    let mut connection = match state.database.lock() {
        Ok(value) => value,
        Err(_) => return failure(StatusCode::INTERNAL_SERVER_ERROR, "SQLite 锁已损坏"),
    };
    finish(application::notes::mutate(
        &mut connection,
        &state.data_dir,
        &body,
    ))
}
