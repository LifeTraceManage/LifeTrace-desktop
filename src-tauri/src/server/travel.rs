use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::Deserialize;
use serde::Serialize;
use std::{
    collections::HashMap,
    sync::OnceLock,
    time::{Duration, Instant},
};
use tokio::sync::Mutex as AsyncMutex;

use crate::database::repositories::travel::{
    self, AcceptTripSuggestion, AssignPhotoPlace, NewPhotoLink, NewPlace, NewTrip, NewVisit, ReorderVisits,
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


#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReverseGeocodeQuery {
    pub latitude: f64,
    pub longitude: f64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RouteCoordinate {
    pub latitude: f64,
    pub longitude: f64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoadRouteRequest {
    pub coordinates: Vec<RouteCoordinate>,
    pub profile: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoadRouteResult {
    pub coordinates: Vec<[f64; 2]>,
    pub distance_meters: f64,
    pub duration_seconds: f64,
    pub provider: &'static str,
}

#[derive(Debug, Deserialize)]
struct OsrmGeometry {
    coordinates: Vec<[f64; 2]>,
}

#[derive(Debug, Deserialize)]
struct OsrmRoute {
    distance: f64,
    duration: f64,
    geometry: OsrmGeometry,
}

#[derive(Debug, Deserialize)]
struct OsrmRouteResponse {
    code: String,
    #[serde(default)]
    routes: Vec<OsrmRoute>,
    message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReverseGeocodeResult {
    pub name: Option<String>,
    pub city: Option<String>,
    pub province: Option<String>,
    pub country: Option<String>,
    pub country_code: Option<String>,
    pub display_name: Option<String>,
    pub attribution: &'static str,
}

#[derive(Debug, Deserialize, Default)]
struct NominatimAddress {
    road: Option<String>,
    pedestrian: Option<String>,
    neighbourhood: Option<String>,
    suburb: Option<String>,
    city: Option<String>,
    town: Option<String>,
    village: Option<String>,
    municipality: Option<String>,
    county: Option<String>,
    state_district: Option<String>,
    state: Option<String>,
    region: Option<String>,
    country: Option<String>,
    country_code: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
struct NominatimReverse {
    name: Option<String>,
    display_name: Option<String>,
    #[serde(default)]
    address: NominatimAddress,
}

#[derive(Default)]
struct GeocoderState {
    last_request: Option<Instant>,
    cache: HashMap<String, ReverseGeocodeResult>,
}

struct ReverseGeocoder {
    client: reqwest::Client,
    endpoint: String,
    state: AsyncMutex<GeocoderState>,
}

static REVERSE_GEOCODER: OnceLock<ReverseGeocoder> = OnceLock::new();

fn reverse_geocoder() -> &'static ReverseGeocoder {
    REVERSE_GEOCODER.get_or_init(|| {
        let endpoint = std::env::var("LIFETRACE_TRAVEL_GEOCODER_URL")
            .unwrap_or_else(|_| "https://nominatim.openstreetmap.org/reverse".to_owned());
        let user_agent = format!(
            "LifeTraceDesktop/{} (+https://github.com/LifeTraceManage/LifeTrace-desktop)",
            env!("CARGO_PKG_VERSION")
        );
        let client = reqwest::Client::builder()
            .user_agent(user_agent)
            .timeout(Duration::from_secs(8))
            .build()
            .expect("build travel reverse geocoder client");
        ReverseGeocoder {
            client,
            endpoint,
            state: AsyncMutex::new(GeocoderState::default()),
        }
    })
}

fn clean_text(value: Option<String>) -> Option<String> {
    value.map(|value| value.trim().to_owned()).filter(|value| !value.is_empty())
}

fn parse_reverse_result(value: NominatimReverse) -> ReverseGeocodeResult {
    let address = value.address;
    let city = clean_text(
        address.city
            .or(address.town)
            .or(address.village)
            .or(address.municipality)
            .or(address.county.clone()),
    );
    let province = clean_text(
        address.state
            .or(address.state_district)
            .or(address.region),
    );
    let country = clean_text(address.country);
    let country_code = clean_text(address.country_code)
        .map(|value| value.to_ascii_uppercase());
    let name = clean_text(value.name)
        .or_else(|| clean_text(address.neighbourhood))
        .or_else(|| clean_text(address.suburb))
        .or_else(|| city.clone())
        .or_else(|| clean_text(address.road))
        .or_else(|| clean_text(address.pedestrian));

    ReverseGeocodeResult {
        name,
        city,
        province,
        country,
        country_code,
        display_name: clean_text(value.display_name),
        attribution: "© OpenStreetMap contributors",
    }
}

async fn reverse_geocode_lookup(
    latitude: f64,
    longitude: f64,
) -> Result<ReverseGeocodeResult, String> {
    if !(-90.0..=90.0).contains(&latitude) {
        return Err("纬度必须位于 -90 到 90 之间".to_owned());
    }
    if !(-180.0..=180.0).contains(&longitude) {
        return Err("经度必须位于 -180 到 180 之间".to_owned());
    }

    let geocoder = reverse_geocoder();
    if geocoder.endpoint.eq_ignore_ascii_case("off")
        || geocoder.endpoint.eq_ignore_ascii_case("disabled")
    {
        return Err("地点自动识别已禁用".to_owned());
    }
    let key = format!("{latitude:.5},{longitude:.5}");
    let mut state = geocoder.state.lock().await;
    if let Some(cached) = state.cache.get(&key) {
        return Ok(cached.clone());
    }

    if let Some(last_request) = state.last_request {
        let elapsed = last_request.elapsed();
        if elapsed < Duration::from_secs(1) {
            tokio::time::sleep(Duration::from_secs(1) - elapsed).await;
        }
    }

    state.last_request = Some(Instant::now());
    let response = geocoder.client
        .get(&geocoder.endpoint)
        .query(&[
            ("format", "jsonv2".to_owned()),
            ("addressdetails", "1".to_owned()),
            ("zoom", "18".to_owned()),
            ("accept-language", "zh-CN,zh,en".to_owned()),
            ("lat", latitude.to_string()),
            ("lon", longitude.to_string()),
        ])
        .send()
        .await
        .map_err(|error| format!("地点自动识别请求失败: {error}"))?;

    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Err("该坐标附近没有可识别的地点".to_owned());
    }
    if !response.status().is_success() {
        return Err(format!("地点自动识别服务返回 {}", response.status()));
    }

    let payload = response
        .json::<NominatimReverse>()
        .await
        .map_err(|error| format!("地点自动识别结果解析失败: {error}"))?;
    let result = parse_reverse_result(payload);
    if state.cache.len() >= 2048 {
        state.cache.clear();
    }
    state.cache.insert(key, result.clone());
    Ok(result)
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
        || message.contains("不合法")
        || message.contains("最多支持")
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

pub async fn reverse_geocode(
    Query(query): Query<ReverseGeocodeQuery>,
) -> Response {
    match reverse_geocode_lookup(query.latitude, query.longitude).await {
        Ok(value) => Json(value).into_response(),
        Err(error) => travel_error(error),
    }
}

fn routing_endpoint() -> Option<String> {
    let endpoint = std::env::var("LIFETRACE_TRAVEL_ROUTER_URL").ok()?;
    let endpoint = endpoint.trim();
    if endpoint.is_empty()
        || endpoint.eq_ignore_ascii_case("off")
        || endpoint.eq_ignore_ascii_case("disabled")
    {
        return None;
    }
    Some(endpoint.trim_end_matches('/').to_owned())
}

fn validate_route_profile(value: Option<String>) -> Result<String, String> {
    let profile = value.unwrap_or_else(|| "driving".to_owned());
    if profile.is_empty()
        || profile.len() > 32
        || !profile.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
    {
        return Err("道路路由 profile 不合法".to_owned());
    }
    Ok(profile)
}

fn parse_osrm_route(payload: OsrmRouteResponse) -> Result<RoadRouteResult, String> {
    if payload.code != "Ok" {
        return Err(payload
            .message
            .unwrap_or_else(|| format!("道路路由服务返回 {}", payload.code)));
    }
    let route = payload.routes.into_iter().next()
        .ok_or_else(|| "道路路由服务没有返回路线".to_owned())?;
    if route.geometry.coordinates.len() < 2 {
        return Err("道路路由服务返回的路线坐标不足".to_owned());
    }
    Ok(RoadRouteResult {
        coordinates: route.geometry.coordinates,
        distance_meters: route.distance,
        duration_seconds: route.duration,
        provider: "OSRM-compatible",
    })
}

async fn road_route_lookup(input: RoadRouteRequest) -> Result<RoadRouteResult, String> {
    if input.coordinates.len() < 2 {
        return Err("道路路线至少需要两个坐标点".to_owned());
    }
    if input.coordinates.len() > 25 {
        return Err("道路路线最多支持 25 个坐标点".to_owned());
    }
    for coordinate in &input.coordinates {
        if !(-90.0..=90.0).contains(&coordinate.latitude) {
            return Err("纬度必须位于 -90 到 90 之间".to_owned());
        }
        if !(-180.0..=180.0).contains(&coordinate.longitude) {
            return Err("经度必须位于 -180 到 180 之间".to_owned());
        }
    }
    let endpoint = routing_endpoint()
        .ok_or_else(|| "道路路由未配置；请设置 LIFETRACE_TRAVEL_ROUTER_URL".to_owned())?;
    let profile = validate_route_profile(input.profile)?;
    let coordinates = input.coordinates.iter()
        .map(|coordinate| format!("{:.6},{:.6}", coordinate.longitude, coordinate.latitude))
        .collect::<Vec<_>>()
        .join(";");
    let url = format!("{endpoint}/route/v1/{profile}/{coordinates}");
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .build()
        .map_err(|error| format!("道路路由客户端初始化失败: {error}"))?;
    let response = client.get(url)
        .query(&[
            ("overview", "full"),
            ("geometries", "geojson"),
            ("steps", "false"),
        ])
        .send()
        .await
        .map_err(|error| format!("道路路由请求失败: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("道路路由服务返回 {}", response.status()));
    }
    let payload = response.json::<OsrmRouteResponse>().await
        .map_err(|error| format!("道路路由结果解析失败: {error}"))?;
    parse_osrm_route(payload)
}

pub async fn road_route(Json(input): Json<RoadRouteRequest>) -> Response {
    match road_route_lookup(input).await {
        Ok(value) => Json(value).into_response(),
        Err(error) if error.contains("未配置") => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(ErrorResponse {
                error,
                code: "TRAVEL_ROUTING_UNAVAILABLE",
            }),
        ).into_response(),
        Err(error) => travel_error(error),
    }
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

pub async fn create_trip_from_suggestion(
    State(state): State<AppState>,
    Json(input): Json<AcceptTripSuggestion>,
) -> Response {
    let connection = match state.database.lock() {
        Ok(value) => value,
        Err(_) => return lock_error(),
    };
    match travel::create_trip_from_suggestion(&connection, input) {
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
    let _ = photo::backfill_exif_metadata(&connection, &state.data_dir, 8);
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

pub async fn assign_photo_link_place(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(input): Json<AssignPhotoPlace>,
) -> Response {
    let connection = match state.database.lock() {
        Ok(value) => value,
        Err(_) => return lock_error(),
    };
    match travel::assign_photo_link_place(&connection, &id, input) {
        Ok(value) => Json(value).into_response(),
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


#[cfg(test)]
mod reverse_geocode_tests {
    use super::*;

    #[test]
    fn reverse_geocode_parser_uses_locality_fallbacks() {
        let result = parse_reverse_result(NominatimReverse {
            name: None,
            display_name: Some("鼓浪屿, 厦门市, 福建省, 中国".to_owned()),
            address: NominatimAddress {
                neighbourhood: Some("鼓浪屿".to_owned()),
                city: Some("厦门市".to_owned()),
                state: Some("福建省".to_owned()),
                country: Some("中国".to_owned()),
                country_code: Some("cn".to_owned()),
                ..Default::default()
            },
        });
        assert_eq!(result.name.as_deref(), Some("鼓浪屿"));
        assert_eq!(result.city.as_deref(), Some("厦门市"));
        assert_eq!(result.province.as_deref(), Some("福建省"));
        assert_eq!(result.country.as_deref(), Some("中国"));
        assert_eq!(result.country_code.as_deref(), Some("CN"));
    }

    #[test]
    fn reverse_geocode_parser_falls_back_to_road() {
        let result = parse_reverse_result(NominatimReverse {
            address: NominatimAddress {
                road: Some("环岛南路".to_owned()),
                country_code: Some("CN".to_owned()),
                ..Default::default()
            },
            ..Default::default()
        });
        assert_eq!(result.name.as_deref(), Some("环岛南路"));
        assert_eq!(result.country_code.as_deref(), Some("CN"));
    }

    #[test]
    fn osrm_route_parser_keeps_geojson_order_and_metrics() {
        let result = parse_osrm_route(OsrmRouteResponse {
            code: "Ok".to_owned(),
            message: None,
            routes: vec![OsrmRoute {
                distance: 12345.6,
                duration: 987.0,
                geometry: OsrmGeometry {
                    coordinates: vec![
                        [118.0894, 24.4798],
                        [118.1200, 24.5000],
                        [118.1500, 24.5200],
                    ],
                },
            }],
        }).unwrap();

        assert_eq!(result.coordinates.len(), 3);
        assert_eq!(result.coordinates[0], [118.0894, 24.4798]);
        assert_eq!(result.distance_meters, 12345.6);
        assert_eq!(result.duration_seconds, 987.0);
        assert_eq!(result.provider, "OSRM-compatible");
    }

    #[test]
    fn osrm_route_parser_rejects_no_route_response() {
        let error = parse_osrm_route(OsrmRouteResponse {
            code: "NoRoute".to_owned(),
            message: Some("No route found".to_owned()),
            routes: vec![],
        }).unwrap_err();
        assert_eq!(error, "No route found");
    }

    #[test]
    fn route_profile_rejects_path_injection() {
        assert_eq!(validate_route_profile(None).unwrap(), "driving");
        assert!(validate_route_profile(Some("../route".to_owned())).is_err());
        assert!(validate_route_profile(Some("driving-car".to_owned())).is_ok());
    }
}
