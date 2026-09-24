use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::Serialize;

use crate::{
    execution::{ExecutionError, ExecutionErrorKind},
    execution_cloud::{
        self, FocusSessionInput, FocusSessionQuery, ImportantDateInput,
    },
};

use super::AppState;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OkResponse {
    ok: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ErrorResponse {
    error: String,
    code: &'static str,
}

fn execution_error(error: ExecutionError) -> Response {
    let (status, code) = match error.kind {
        ExecutionErrorKind::Validation => (StatusCode::BAD_REQUEST, "EXECUTION_VALIDATION"),
        ExecutionErrorKind::NotFound => (StatusCode::NOT_FOUND, "EXECUTION_NOT_FOUND"),
        ExecutionErrorKind::Conflict => (StatusCode::CONFLICT, "EXECUTION_CONFLICT"),
        ExecutionErrorKind::Storage => (
            StatusCode::INTERNAL_SERVER_ERROR,
            "EXECUTION_STORAGE_FAILURE",
        ),
    };
    (
        status,
        Json(ErrorResponse {
            error: error.message,
            code,
        }),
    )
        .into_response()
}

fn lock_error() -> Response {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(ErrorResponse {
            error: "SQLite 锁已损坏".to_owned(),
            code: "EXECUTION_DATABASE_LOCK_FAILURE",
        }),
    )
        .into_response()
}

pub async fn list_important_dates(State(state): State<AppState>) -> Response {
    let connection = match state.database.lock() {
        Ok(value) => value,
        Err(_) => return lock_error(),
    };
    match execution_cloud::list_important_dates(&connection) {
        Ok(items) => Json(items).into_response(),
        Err(error) => execution_error(error),
    }
}

pub async fn get_important_date(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Response {
    let connection = match state.database.lock() {
        Ok(value) => value,
        Err(_) => return lock_error(),
    };
    match execution_cloud::get_important_date(&connection, &id) {
        Ok(item) => Json(item).into_response(),
        Err(error) => execution_error(error),
    }
}

pub async fn create_important_date(
    State(state): State<AppState>,
    Json(input): Json<ImportantDateInput>,
) -> Response {
    let connection = match state.database.lock() {
        Ok(value) => value,
        Err(_) => return lock_error(),
    };
    match execution_cloud::create_important_date(&connection, input) {
        Ok(item) => (StatusCode::CREATED, Json(item)).into_response(),
        Err(error) => execution_error(error),
    }
}

pub async fn update_important_date(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(input): Json<ImportantDateInput>,
) -> Response {
    let connection = match state.database.lock() {
        Ok(value) => value,
        Err(_) => return lock_error(),
    };
    match execution_cloud::update_important_date(&connection, &id, input) {
        Ok(item) => Json(item).into_response(),
        Err(error) => execution_error(error),
    }
}

pub async fn delete_important_date(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Response {
    let connection = match state.database.lock() {
        Ok(value) => value,
        Err(_) => return lock_error(),
    };
    match execution_cloud::delete_important_date(&connection, &id) {
        Ok(()) => Json(OkResponse { ok: true }).into_response(),
        Err(error) => execution_error(error),
    }
}

pub async fn list_focus_sessions(
    State(state): State<AppState>,
    Query(query): Query<FocusSessionQuery>,
) -> Response {
    let connection = match state.database.lock() {
        Ok(value) => value,
        Err(_) => return lock_error(),
    };
    match execution_cloud::list_focus_sessions(&connection, query) {
        Ok(items) => Json(items).into_response(),
        Err(error) => execution_error(error),
    }
}

pub async fn get_focus_session(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Response {
    let connection = match state.database.lock() {
        Ok(value) => value,
        Err(_) => return lock_error(),
    };
    match execution_cloud::get_focus_session(&connection, &id) {
        Ok(item) => Json(item).into_response(),
        Err(error) => execution_error(error),
    }
}

pub async fn create_focus_session(
    State(state): State<AppState>,
    Json(input): Json<FocusSessionInput>,
) -> Response {
    let connection = match state.database.lock() {
        Ok(value) => value,
        Err(_) => return lock_error(),
    };
    match execution_cloud::create_focus_session(&connection, input) {
        Ok(item) => (StatusCode::CREATED, Json(item)).into_response(),
        Err(error) => execution_error(error),
    }
}

pub async fn update_focus_session(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(input): Json<FocusSessionInput>,
) -> Response {
    let connection = match state.database.lock() {
        Ok(value) => value,
        Err(_) => return lock_error(),
    };
    match execution_cloud::update_focus_session(&connection, &id, input) {
        Ok(item) => Json(item).into_response(),
        Err(error) => execution_error(error),
    }
}

pub async fn delete_focus_session(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Response {
    let connection = match state.database.lock() {
        Ok(value) => value,
        Err(_) => return lock_error(),
    };
    match execution_cloud::delete_focus_session(&connection, &id) {
        Ok(()) => Json(OkResponse { ok: true }).into_response(),
        Err(error) => execution_error(error),
    }
}
