use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::Deserialize;
use serde::Serialize;

use crate::database::repositories::travel::{
    self, NewPhotoLink, NewPlace, NewTrip, NewVisit, ReorderVisits,
};

use super::{photo, AppState};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ErrorResponse {
    error: String,
    code: &'static str,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VisitQuery {
    pub trip_id: Option<String>,
    pub place_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhotoCandidateQuery {
    pub limit: Option<i64>,
}

fn lock_error() -> Response {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(ErrorResponse {
            error: "SQLite 锁已损坏".to_owned(),
            code: "TRAVEL_DATABASE_LOCK_FAILURE",
        }),
    )
        .into_response()
}

fn travel_error(message: String) -> Response {
    let status = if message.contains("不能为空")
        || message.contains("必须")
        || message.contains("不受支持")
        || message.contains("至少需要")
        || message.contains("仍有关联")
        || message.contains("顺序必须")
    {
        StatusCode::BAD_REQUEST
    } else if message.contains("不存在") {
        StatusCode::NOT_FOUND
    } else {
        StatusCode::INTERNAL_SERVER_ERROR
    };
    (
        status,
        Json(ErrorResponse {
            error: message,
            code: if status == StatusCode::BAD_REQUEST {
                "TRAVEL_VALIDATION"
            } else if status == StatusCode::NOT_FOUND {
                "TRAVEL_NOT_FOUND"
            } else {
                "TRAVEL_STORAGE_FAILURE"
            },
        }),
    )
        .into_response()
}

pub async fn summary(State(state): State<AppState>) -> Response {
    let connection = match state.database.lock() {
        Ok(value) => value,
        Err(_) => return lock_error(),
    };
    match travel::summary(&connection) {
        Ok(value) => Json(value).into_response(),
        Err(error) => travel_error(error),
    }
}

pub async fn list_places(State(state): State<AppState>) -> Response {
    let connection = match state.database.lock() {
        Ok(value) => value,
        Err(_) => return lock_error(),
    };
    match travel::list_places(&connection) {
        Ok(value) => Json(value).into_response(),
        Err(error) => travel_error(error),
    }
}

pub async fn create_place(
    State(state): State<AppState>,
    Json(input): Json<NewPlace>,
) -> Response {
    let connection = match state.database.lock() {
        Ok(value) => value,
        Err(_) => return lock_error(),
    };
    match travel::create_place(&connection, input) {
        Ok(value) => (StatusCode::CREATED, Json(value)).into_response(),
        Err(error) => travel_error(error),
    }
}

pub async fn list_trips(State(state): State<AppState>) -> Response {
    let connection = match state.database.lock() {
        Ok(value) => value,
        Err(_) => return lock_error(),
    };
    match travel::list_trips(&connection) {
        Ok(value) => Json(value).into_response(),
        Err(error) => travel_error(error),
    }
}

pub async fn create_trip(
    State(state): State<AppState>,
    Json(input): Json<NewTrip>,
) -> Response {
    let connection = match state.database.lock() {
        Ok(value) => value,
        Err(_) => return lock_error(),
    };
    match travel::create_trip(&connection, input) {
        Ok(value) => (StatusCode::CREATED, Json(value)).into_response(),
        Err(error) => travel_error(error),
    }
}

pub async fn list_visits(
    State(state): State<AppState>,
    Query(query): Query<VisitQuery>,
) -> Response {
    let connection = match state.database.lock() {
        Ok(value) => value,
        Err(_) => return lock_error(),
    };
    match travel::list_visits(
        &connection,
        query.trip_id.as_deref(),
        query.place_id.as_deref(),
    ) {
        Ok(value) => Json(value).into_response(),
        Err(error) => travel_error(error),
    }
}

pub async fn create_visit(
    State(state): State<AppState>,
    Json(input): Json<NewVisit>,
) -> Response {
    let connection = match state.database.lock() {
        Ok(value) => value,
        Err(_) => return lock_error(),
    };
    match travel::create_visit(&connection, input) {
        Ok(value) => (StatusCode::CREATED, Json(value)).into_response(),
        Err(error) => travel_error(error),
    }
}


pub async fn list_photo_candidates(
    State(state): State<AppState>,
    Query(query): Query<PhotoCandidateQuery>,
) -> Response {
    let connection = match state.database.lock() {
        Ok(value) => value,
        Err(_) => return lock_error(),
    };
    // Gradually enrich historical local photos without a one-time blocking migration.
    // New imports already persist EXIF metadata in the photo table.
    let _ = photo::backfill_exif_metadata(&connection, &state.data_dir, 24);
    match travel::list_photo_candidates(&connection, query.limit.unwrap_or(120)) {
        Ok(value) => Json(value).into_response(),
        Err(error) => travel_error(error),
    }
}

pub async fn list_photo_links(State(state): State<AppState>) -> Response {
    let connection = match state.database.lock() {
        Ok(value) => value,
        Err(_) => return lock_error(),
    };
    match travel::list_photo_links(&connection) {
        Ok(value) => Json(value).into_response(),
        Err(error) => travel_error(error),
    }
}

pub async fn create_photo_link(
    State(state): State<AppState>,
    Json(input): Json<NewPhotoLink>,
) -> Response {
    let connection = match state.database.lock() {
        Ok(value) => value,
        Err(_) => return lock_error(),
    };
    match travel::create_photo_link(&connection, input) {
        Ok(value) => (StatusCode::CREATED, Json(value)).into_response(),
        Err(error) => travel_error(error),
    }
}

pub async fn delete_photo_link(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Response {
    let connection = match state.database.lock() {
        Ok(value) => value,
        Err(_) => return lock_error(),
    };
    match travel::delete_photo_link(&connection, &id) {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(error) => travel_error(error),
    }
}


pub async fn update_place(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(input): Json<NewPlace>,
) -> Response {
    let connection = match state.database.lock() {
        Ok(value) => value,
        Err(_) => return lock_error(),
    };
    match travel::update_place(&connection, &id, input) {
        Ok(value) => Json(value).into_response(),
        Err(error) => travel_error(error),
    }
}

pub async fn delete_place(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Response {
    let connection = match state.database.lock() {
        Ok(value) => value,
        Err(_) => return lock_error(),
    };
    match travel::delete_place(&connection, &id) {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(error) => travel_error(error),
    }
}

pub async fn update_trip(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(input): Json<NewTrip>,
) -> Response {
    let connection = match state.database.lock() {
        Ok(value) => value,
        Err(_) => return lock_error(),
    };
    match travel::update_trip(&connection, &id, input) {
        Ok(value) => Json(value).into_response(),
        Err(error) => travel_error(error),
    }
}

pub async fn delete_trip(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Response {
    let connection = match state.database.lock() {
        Ok(value) => value,
        Err(_) => return lock_error(),
    };
    match travel::delete_trip(&connection, &id) {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(error) => travel_error(error),
    }
}

pub async fn update_visit(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(input): Json<NewVisit>,
) -> Response {
    let connection = match state.database.lock() {
        Ok(value) => value,
        Err(_) => return lock_error(),
    };
    match travel::update_visit(&connection, &id, input) {
        Ok(value) => Json(value).into_response(),
        Err(error) => travel_error(error),
    }
}

pub async fn delete_visit(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Response {
    let connection = match state.database.lock() {
        Ok(value) => value,
        Err(_) => return lock_error(),
    };
    match travel::delete_visit(&connection, &id) {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(error) => travel_error(error),
    }
}

pub async fn reorder_visits(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(input): Json<ReorderVisits>,
) -> Response {
    let connection = match state.database.lock() {
        Ok(value) => value,
        Err(_) => return lock_error(),
    };
    match travel::reorder_visits(&connection, &id, input) {
        Ok(value) => Json(value).into_response(),
        Err(error) => travel_error(error),
    }
}
