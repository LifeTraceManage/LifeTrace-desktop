use std::collections::HashMap;

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use chrono::NaiveDate;
use serde::Deserialize;
use serde_json::json;

use crate::database::repositories::footprints::{
    self, EntryWrite, LocationWrite,
};

use super::AppState;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocationPayload {
    pub id: Option<String>,
    pub country_code: Option<String>,
    pub country_name: Option<String>,
    pub province_code: String,
    pub province_name: String,
    pub city_code: Option<String>,
    pub city_name: Option<String>,
    pub district_code: Option<String>,
    pub district_name: Option<String>,
    pub place_name: Option<String>,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
    pub source: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntryPayload {
    pub location_id: Option<String>,
    pub location: Option<LocationPayload>,
    pub title: String,
    pub description: Option<String>,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub visit_type: Option<String>,
    pub rating: Option<i64>,
    pub favorite: Option<bool>,
    pub photo_ids: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhotoLinksPayload {
    pub photo_ids: Vec<String>,
}

fn error(status: StatusCode, message: impl Into<String>) -> Response {
    (
        status,
        Json(json!({
            "ok": false,
            "error": message.into()
        })),
    )
        .into_response()
}

fn profile(connection: &rusqlite::Connection) -> Result<String, Response> {
    footprints::active_profile_id(connection)
        .map_err(|message| error(StatusCode::INTERNAL_SERVER_ERROR, message))
}

fn validate_date(value: &str, label: &str) -> Result<String, Response> {
    let value = value.trim();
    NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .map_err(|_| error(StatusCode::BAD_REQUEST, format!("{label}必须是 YYYY-MM-DD")))
        .map(|_| value.to_owned())
}

fn location_write(payload: &LocationPayload) -> LocationWrite {
    LocationWrite {
        id: payload.id.clone(),
        country_code: payload.country_code.clone().unwrap_or_else(|| "CN".to_owned()),
        country_name: payload.country_name.clone().unwrap_or_else(|| "中国".to_owned()),
        province_code: payload.province_code.clone(),
        province_name: payload.province_name.clone(),
        city_code: payload.city_code.clone(),
        city_name: payload.city_name.clone(),
        district_code: payload.district_code.clone(),
        district_name: payload.district_name.clone(),
        place_name: payload.place_name.clone(),
        latitude: payload.latitude,
        longitude: payload.longitude,
        source: payload.source.clone().unwrap_or_else(|| "manual".to_owned()),
    }
}

fn resolve_location(
    connection: &rusqlite::Connection,
    user_id: &str,
    payload: &EntryPayload,
) -> Result<String, Response> {
    if let Some(id) = payload.location_id.as_deref() {
        let location = footprints::get_location(connection, user_id, id)
            .map_err(|message| error(StatusCode::INTERNAL_SERVER_ERROR, message))?;
        return location
            .map(|value| value.id)
            .ok_or_else(|| error(StatusCode::BAD_REQUEST, "所选地点不存在"));
    }
    let payload = payload
        .location
        .as_ref()
        .ok_or_else(|| error(StatusCode::BAD_REQUEST, "缺少足迹地点"))?;
    footprints::save_location(connection, user_id, &location_write(payload))
        .map(|value| value.id)
        .map_err(|message| error(StatusCode::BAD_REQUEST, message))
}

pub async fn summary(State(state): State<AppState>) -> Response {
    let connection = match state.database.lock() {
        Ok(value) => value,
        Err(_) => return error(StatusCode::INTERNAL_SERVER_ERROR, "数据库暂时不可用"),
    };
    let user_id = match profile(&connection) {
        Ok(value) => value,
        Err(response) => return response,
    };
    match footprints::summary(&connection, &user_id) {
        Ok(value) => Json(value).into_response(),
        Err(message) => error(StatusCode::INTERNAL_SERVER_ERROR, message),
    }
}

pub async fn list_locations(State(state): State<AppState>) -> Response {
    let connection = match state.database.lock() {
        Ok(value) => value,
        Err(_) => return error(StatusCode::INTERNAL_SERVER_ERROR, "数据库暂时不可用"),
    };
    let user_id = match profile(&connection) {
        Ok(value) => value,
        Err(response) => return response,
    };
    match footprints::list_locations(&connection, &user_id) {
        Ok(value) => Json(value).into_response(),
        Err(message) => error(StatusCode::INTERNAL_SERVER_ERROR, message),
    }
}

pub async fn create_location(
    State(state): State<AppState>,
    Json(payload): Json<LocationPayload>,
) -> Response {
    let connection = match state.database.lock() {
        Ok(value) => value,
        Err(_) => return error(StatusCode::INTERNAL_SERVER_ERROR, "数据库暂时不可用"),
    };
    let user_id = match profile(&connection) {
        Ok(value) => value,
        Err(response) => return response,
    };
    match footprints::save_location(&connection, &user_id, &location_write(&payload)) {
        Ok(value) => (StatusCode::CREATED, Json(value)).into_response(),
        Err(message) => error(StatusCode::BAD_REQUEST, message),
    }
}

pub async fn list_entries(
    State(state): State<AppState>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    let connection = match state.database.lock() {
        Ok(value) => value,
        Err(_) => return error(StatusCode::INTERNAL_SERVER_ERROR, "数据库暂时不可用"),
    };
    let user_id = match profile(&connection) {
        Ok(value) => value,
        Err(response) => return response,
    };
    match footprints::list_entries(
        &connection,
        &user_id,
        query.get("q").map(String::as_str),
        query.get("provinceCode").map(String::as_str),
    ) {
        Ok(value) => Json(value).into_response(),
        Err(message) => error(StatusCode::INTERNAL_SERVER_ERROR, message),
    }
}

pub async fn get_entry(State(state): State<AppState>, Path(id): Path<String>) -> Response {
    let connection = match state.database.lock() {
        Ok(value) => value,
        Err(_) => return error(StatusCode::INTERNAL_SERVER_ERROR, "数据库暂时不可用"),
    };
    let user_id = match profile(&connection) {
        Ok(value) => value,
        Err(response) => return response,
    };
    match footprints::get_entry(&connection, &user_id, &id) {
        Ok(Some(entry)) => match footprints::list_entry_photos(&connection, &id) {
            Ok(photos) => Json(json!({ "entry": entry, "photos": photos })).into_response(),
            Err(message) => error(StatusCode::INTERNAL_SERVER_ERROR, message),
        },
        Ok(None) => error(StatusCode::NOT_FOUND, "足迹不存在"),
        Err(message) => error(StatusCode::INTERNAL_SERVER_ERROR, message),
    }
}

fn save_entry_response(
    connection: &rusqlite::Connection,
    user_id: &str,
    id: Option<String>,
    payload: EntryPayload,
    created: bool,
) -> Response {
    let started_at = match validate_date(&payload.started_at, "开始日期") {
        Ok(value) => value,
        Err(response) => return response,
    };
    let ended_at = match payload.ended_at.as_deref() {
        Some(value) if !value.trim().is_empty() => match validate_date(value, "结束日期") {
            Ok(value) => Some(value),
            Err(response) => return response,
        },
        _ => None,
    };
    if ended_at.as_deref().is_some_and(|value| value < started_at.as_str()) {
        return error(StatusCode::BAD_REQUEST, "结束日期不能早于开始日期");
    }
    let location_id = match resolve_location(connection, user_id, &payload) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let write = EntryWrite {
        id,
        location_id,
        title: payload.title,
        description: payload.description,
        started_at,
        ended_at,
        visit_type: payload.visit_type.unwrap_or_else(|| "trip".to_owned()),
        rating: payload.rating,
        favorite: payload.favorite.unwrap_or(false),
    };
    let entry = match footprints::save_entry(connection, user_id, &write) {
        Ok(value) => value,
        Err(message) => return error(StatusCode::BAD_REQUEST, message),
    };
    if let Some(photo_ids) = payload.photo_ids {
        if let Err(message) = footprints::replace_entry_photos(connection, user_id, &entry.id, &photo_ids) {
            return error(StatusCode::BAD_REQUEST, message);
        }
    }
    let entry = match footprints::get_entry(connection, user_id, &entry.id) {
        Ok(Some(value)) => value,
        Ok(None) => return error(StatusCode::INTERNAL_SERVER_ERROR, "足迹保存后无法读取"),
        Err(message) => return error(StatusCode::INTERNAL_SERVER_ERROR, message),
    };
    let photos = match footprints::list_entry_photos(connection, &entry.id) {
        Ok(value) => value,
        Err(message) => return error(StatusCode::INTERNAL_SERVER_ERROR, message),
    };
    let body = Json(json!({ "entry": entry, "photos": photos }));
    if created {
        (StatusCode::CREATED, body).into_response()
    } else {
        body.into_response()
    }
}

pub async fn create_entry(
    State(state): State<AppState>,
    Json(payload): Json<EntryPayload>,
) -> Response {
    let connection = match state.database.lock() {
        Ok(value) => value,
        Err(_) => return error(StatusCode::INTERNAL_SERVER_ERROR, "数据库暂时不可用"),
    };
    let user_id = match profile(&connection) {
        Ok(value) => value,
        Err(response) => return response,
    };
    save_entry_response(&connection, &user_id, None, payload, true)
}

pub async fn update_entry(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<EntryPayload>,
) -> Response {
    let connection = match state.database.lock() {
        Ok(value) => value,
        Err(_) => return error(StatusCode::INTERNAL_SERVER_ERROR, "数据库暂时不可用"),
    };
    let user_id = match profile(&connection) {
        Ok(value) => value,
        Err(response) => return response,
    };
    if matches!(footprints::get_entry(&connection, &user_id, &id), Ok(None)) {
        return error(StatusCode::NOT_FOUND, "足迹不存在");
    }
    save_entry_response(&connection, &user_id, Some(id), payload, false)
}

pub async fn delete_entry(State(state): State<AppState>, Path(id): Path<String>) -> Response {
    let connection = match state.database.lock() {
        Ok(value) => value,
        Err(_) => return error(StatusCode::INTERNAL_SERVER_ERROR, "数据库暂时不可用"),
    };
    let user_id = match profile(&connection) {
        Ok(value) => value,
        Err(response) => return response,
    };
    match footprints::delete_entry(&connection, &user_id, &id) {
        Ok(true) => Json(json!({ "ok": true })).into_response(),
        Ok(false) => error(StatusCode::NOT_FOUND, "足迹不存在"),
        Err(message) => error(StatusCode::INTERNAL_SERVER_ERROR, message),
    }
}

pub async fn provinces(State(state): State<AppState>) -> Response {
    let connection = match state.database.lock() {
        Ok(value) => value,
        Err(_) => return error(StatusCode::INTERNAL_SERVER_ERROR, "数据库暂时不可用"),
    };
    let user_id = match profile(&connection) {
        Ok(value) => value,
        Err(response) => return response,
    };
    match footprints::province_summaries(&connection, &user_id) {
        Ok(value) => Json(value).into_response(),
        Err(message) => error(StatusCode::INTERNAL_SERVER_ERROR, message),
    }
}

pub async fn province(
    State(state): State<AppState>,
    Path(code): Path<String>,
) -> Response {
    let connection = match state.database.lock() {
        Ok(value) => value,
        Err(_) => return error(StatusCode::INTERNAL_SERVER_ERROR, "数据库暂时不可用"),
    };
    let user_id = match profile(&connection) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let cities = match footprints::city_summaries(&connection, &user_id, &code) {
        Ok(value) => value,
        Err(message) => return error(StatusCode::INTERNAL_SERVER_ERROR, message),
    };
    let entries = match footprints::list_entries(&connection, &user_id, None, Some(&code)) {
        Ok(value) => value,
        Err(message) => return error(StatusCode::INTERNAL_SERVER_ERROR, message),
    };
    Json(json!({ "cities": cities, "entries": entries })).into_response()
}

pub async fn photos(
    State(state): State<AppState>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    let page = query
        .get("page")
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(1);
    let page_size = query
        .get("pageSize")
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(60);
    let connection = match state.database.lock() {
        Ok(value) => value,
        Err(_) => return error(StatusCode::INTERNAL_SERVER_ERROR, "数据库暂时不可用"),
    };
    match footprints::list_photos(
        &connection,
        page,
        page_size,
        query.get("q").map(String::as_str),
    ) {
        Ok((photos, total)) => Json(json!({
            "photos": photos,
            "total": total,
            "page": page.max(1),
            "pageSize": page_size.clamp(1,100)
        }))
        .into_response(),
        Err(message) => error(StatusCode::INTERNAL_SERVER_ERROR, message),
    }
}

pub async fn attach_photos(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<PhotoLinksPayload>,
) -> Response {
    let connection = match state.database.lock() {
        Ok(value) => value,
        Err(_) => return error(StatusCode::INTERNAL_SERVER_ERROR, "数据库暂时不可用"),
    };
    let user_id = match profile(&connection) {
        Ok(value) => value,
        Err(response) => return response,
    };
    match footprints::attach_photos(&connection, &user_id, &id, &payload.photo_ids) {
        Ok(value) => Json(value).into_response(),
        Err(message) => error(StatusCode::BAD_REQUEST, message),
    }
}

pub async fn detach_photo(
    State(state): State<AppState>,
    Path((id, photo_id)): Path<(String, String)>,
) -> Response {
    let connection = match state.database.lock() {
        Ok(value) => value,
        Err(_) => return error(StatusCode::INTERNAL_SERVER_ERROR, "数据库暂时不可用"),
    };
    let user_id = match profile(&connection) {
        Ok(value) => value,
        Err(response) => return response,
    };
    match footprints::detach_photo(&connection, &user_id, &id, &photo_id) {
        Ok(true) => Json(json!({ "ok": true })).into_response(),
        Ok(false) => error(StatusCode::NOT_FOUND, "照片关联不存在"),
        Err(message) => error(StatusCode::INTERNAL_SERVER_ERROR, message),
    }
}

pub async fn photo_suggestions(
    State(state): State<AppState>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    let Some(entry_id) = query.get("entryId") else {
        return error(StatusCode::BAD_REQUEST, "缺少 entryId");
    };
    let connection = match state.database.lock() {
        Ok(value) => value,
        Err(_) => return error(StatusCode::INTERNAL_SERVER_ERROR, "数据库暂时不可用"),
    };
    let user_id = match profile(&connection) {
        Ok(value) => value,
        Err(response) => return response,
    };
    match footprints::photo_suggestions(&connection, &user_id, entry_id) {
        Ok(value) => Json(value).into_response(),
        Err(message) => error(StatusCode::BAD_REQUEST, message),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn date_validation_is_strict_and_stable() {
        assert_eq!(validate_date("2026-05-01", "开始日期").unwrap(), "2026-05-01");
        assert!(validate_date("2026/05/01", "开始日期").is_err());
        assert!(validate_date("", "开始日期").is_err());
    }
}
