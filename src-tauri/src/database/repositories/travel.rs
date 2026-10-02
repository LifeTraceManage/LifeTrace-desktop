use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::database::profile;

fn now() -> String { Utc::now().to_rfc3339() }

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TravelPlace {
    pub id: String,
    pub name: String,
    pub country: Option<String>,
    pub country_code: Option<String>,
    pub province: Option<String>,
    pub city: Option<String>,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
    pub place_type: String,
    pub visit_count: i64,
    pub photo_count: i64,
    pub latest_visit_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewPlace {
    pub name: String,
    pub country: Option<String>,
    pub country_code: Option<String>,
    pub province: Option<String>,
    pub city: Option<String>,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
    pub place_type: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TravelTrip {
    pub id: String,
    pub title: String,
    pub start_at: Option<String>,
    pub end_at: Option<String>,
    pub description: Option<String>,
    pub cover_photo_id: Option<String>,
    pub visit_count: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewTrip {
    pub title: String,
    pub start_at: Option<String>,
    pub end_at: Option<String>,
    pub description: Option<String>,
    pub cover_photo_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TravelVisit {
    pub id: String,
    pub trip_id: Option<String>,
    pub place_id: String,
    pub place_name: String,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
    pub arrived_at: Option<String>,
    pub left_at: Option<String>,
    pub note: Option<String>,
    pub sequence: Option<i64>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewVisit {
    pub trip_id: Option<String>,
    pub place_id: String,
    pub arrived_at: Option<String>,
    pub left_at: Option<String>,
    pub note: Option<String>,
    pub sequence: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TravelSummary {
    pub place_count: i64,
    pub visit_count: i64,
    pub trip_count: i64,
    pub photo_count: i64,
    pub city_count: i64,
}

fn validate_coordinates(latitude: Option<f64>, longitude: Option<f64>) -> Result<(), String> {
    if latitude.is_some_and(|value| !(-90.0..=90.0).contains(&value)) {
        return Err("纬度必须位于 -90 到 90 之间".to_owned());
    }
    if longitude.is_some_and(|value| !(-180.0..=180.0).contains(&value)) {
        return Err("经度必须位于 -180 到 180 之间".to_owned());
    }
    Ok(())
}

pub fn summary(connection: &Connection) -> Result<TravelSummary, String> {
    let user_id = profile::active_profile_id(connection).map_err(|e| e.to_string())?;
    let count = |table: &str| -> Result<i64, String> {
        connection.query_row(
            &format!("SELECT COUNT(*) FROM {table} WHERE user_id=?1 AND deleted_at IS NULL"),
            [&user_id],
            |row| row.get(0),
        ).map_err(|e| e.to_string())
    };
    let city_count = connection.query_row(
        "SELECT COUNT(DISTINCT COALESCE(NULLIF(city,''),NULLIF(name,'')))
         FROM travel_places WHERE user_id=?1 AND deleted_at IS NULL",
        [&user_id],
        |row| row.get(0),
    ).map_err(|e| e.to_string())?;
    Ok(TravelSummary {
        place_count: count("travel_places")?,
        visit_count: count("travel_visits")?,
        trip_count: count("travel_trips")?,
        photo_count: count("travel_photo_links")?,
        city_count,
    })
}

pub fn list_places(connection: &Connection) -> Result<Vec<TravelPlace>, String> {
    let user_id = profile::active_profile_id(connection).map_err(|e| e.to_string())?;
    let mut statement = connection.prepare(
        "SELECT p.id,p.name,p.country,p.country_code,p.province,p.city,p.latitude,p.longitude,p.place_type,
                (SELECT COUNT(*) FROM travel_visits v WHERE v.user_id=p.user_id AND v.place_id=p.id AND v.deleted_at IS NULL),
                (SELECT COUNT(*) FROM travel_photo_links l WHERE l.user_id=p.user_id AND l.place_id=p.id AND l.deleted_at IS NULL),
                (SELECT MAX(v2.arrived_at) FROM travel_visits v2 WHERE v2.user_id=p.user_id AND v2.place_id=p.id AND v2.deleted_at IS NULL),
                p.created_at,p.updated_at
         FROM travel_places p
         WHERE p.user_id=?1 AND p.deleted_at IS NULL
         ORDER BY COALESCE((SELECT MAX(v3.arrived_at) FROM travel_visits v3 WHERE v3.place_id=p.id AND v3.deleted_at IS NULL),p.updated_at) DESC"
    ).map_err(|e| e.to_string())?;
    let rows = statement.query_map([user_id], |row| Ok(TravelPlace {
        id: row.get(0)?, name: row.get(1)?, country: row.get(2)?, country_code: row.get(3)?,
        province: row.get(4)?, city: row.get(5)?, latitude: row.get(6)?, longitude: row.get(7)?,
        place_type: row.get(8)?, visit_count: row.get(9)?, photo_count: row.get(10)?,
        latest_visit_at: row.get(11)?, created_at: row.get(12)?, updated_at: row.get(13)?,
    })).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

pub fn create_place(connection: &Connection, input: NewPlace) -> Result<TravelPlace, String> {
    let name = input.name.trim();
    if name.is_empty() { return Err("地点名称不能为空".to_owned()); }
    validate_coordinates(input.latitude, input.longitude)?;
    let kind = input.place_type.unwrap_or_else(|| "custom".to_owned());
    let allowed = ["country","city","attraction","restaurant","hotel","station","airport","custom"];
    if !allowed.contains(&kind.as_str()) { return Err("地点类型不受支持".to_owned()); }
    let id = Uuid::new_v4().to_string();
    let stamp = now();
    let user_id = profile::active_profile_id(connection).map_err(|e| e.to_string())?;
    connection.execute(
        "INSERT INTO travel_places(id,user_id,name,country,country_code,province,city,latitude,longitude,place_type,created_at,updated_at)
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?11)",
        params![id,user_id,name,input.country,input.country_code,input.province,input.city,input.latitude,input.longitude,kind,stamp],
    ).map_err(|e| e.to_string())?;
    list_places(connection)?.into_iter().find(|item| item.id == id).ok_or_else(|| "地点创建后无法读取".to_owned())
}

pub fn list_trips(connection: &Connection) -> Result<Vec<TravelTrip>, String> {
    let user_id = profile::active_profile_id(connection).map_err(|e| e.to_string())?;
    let mut statement = connection.prepare(
        "SELECT t.id,t.title,t.start_at,t.end_at,t.description,t.cover_photo_id,
                (SELECT COUNT(*) FROM travel_visits v WHERE v.trip_id=t.id AND v.deleted_at IS NULL),
                t.created_at,t.updated_at
         FROM travel_trips t WHERE t.user_id=?1 AND t.deleted_at IS NULL
         ORDER BY COALESCE(t.start_at,t.updated_at) DESC"
    ).map_err(|e| e.to_string())?;
    let rows = statement.query_map([user_id], |row| Ok(TravelTrip {
        id: row.get(0)?, title: row.get(1)?, start_at: row.get(2)?, end_at: row.get(3)?,
        description: row.get(4)?, cover_photo_id: row.get(5)?, visit_count: row.get(6)?,
        created_at: row.get(7)?, updated_at: row.get(8)?,
    })).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

pub fn create_trip(connection: &Connection, input: NewTrip) -> Result<TravelTrip, String> {
    let title = input.title.trim();
    if title.is_empty() { return Err("旅行标题不能为空".to_owned()); }
    let id = Uuid::new_v4().to_string();
    let stamp = now();
    let user_id = profile::active_profile_id(connection).map_err(|e| e.to_string())?;
    connection.execute(
        "INSERT INTO travel_trips(id,user_id,title,start_at,end_at,description,cover_photo_id,created_at,updated_at)
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?8)",
        params![id,user_id,title,input.start_at,input.end_at,input.description,input.cover_photo_id,stamp],
    ).map_err(|e| e.to_string())?;
    list_trips(connection)?.into_iter().find(|item| item.id == id).ok_or_else(|| "旅行创建后无法读取".to_owned())
}

pub fn list_visits(connection: &Connection, trip_id: Option<&str>, place_id: Option<&str>) -> Result<Vec<TravelVisit>, String> {
    let user_id = profile::active_profile_id(connection).map_err(|e| e.to_string())?;
    let mut statement = connection.prepare(
        "SELECT v.id,v.trip_id,v.place_id,p.name,p.latitude,p.longitude,v.arrived_at,v.left_at,v.note,v.sequence,v.created_at,v.updated_at
         FROM travel_visits v
         JOIN travel_places p ON p.id=v.place_id
         WHERE v.user_id=?1 AND v.deleted_at IS NULL
           AND (?2 IS NULL OR v.trip_id=?2)
           AND (?3 IS NULL OR v.place_id=?3)
         ORDER BY CASE WHEN v.sequence IS NULL THEN 1 ELSE 0 END,v.sequence,v.arrived_at,v.created_at"
    ).map_err(|e| e.to_string())?;
    let rows = statement.query_map(params![user_id,trip_id,place_id], |row| Ok(TravelVisit {
        id: row.get(0)?, trip_id: row.get(1)?, place_id: row.get(2)?, place_name: row.get(3)?,
        latitude: row.get(4)?, longitude: row.get(5)?, arrived_at: row.get(6)?, left_at: row.get(7)?,
        note: row.get(8)?, sequence: row.get(9)?, created_at: row.get(10)?, updated_at: row.get(11)?,
    })).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

pub fn create_visit(connection: &Connection, input: NewVisit) -> Result<TravelVisit, String> {
    let user_id = profile::active_profile_id(connection).map_err(|e| e.to_string())?;
    let place_exists = connection.query_row(
        "SELECT 1 FROM travel_places WHERE id=?1 AND user_id=?2 AND deleted_at IS NULL",
        params![input.place_id,user_id],
        |_| Ok(()),
    ).optional().map_err(|e| e.to_string())?.is_some();
    if !place_exists { return Err("地点不存在".to_owned()); }
    if let Some(trip_id) = input.trip_id.as_deref() {
        let trip_exists = connection.query_row(
            "SELECT 1 FROM travel_trips WHERE id=?1 AND user_id=?2 AND deleted_at IS NULL",
            params![trip_id,user_id],
            |_| Ok(()),
        ).optional().map_err(|e| e.to_string())?.is_some();
        if !trip_exists { return Err("旅行不存在".to_owned()); }
    }
    let id = Uuid::new_v4().to_string();
    let stamp = now();
    connection.execute(
        "INSERT INTO travel_visits(id,user_id,trip_id,place_id,arrived_at,left_at,note,sequence,created_at,updated_at)
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?9)",
        params![id,user_id,input.trip_id,input.place_id,input.arrived_at,input.left_at,input.note,input.sequence,stamp],
    ).map_err(|e| e.to_string())?;
    list_visits(connection, None, None)?.into_iter().find(|item| item.id == id).ok_or_else(|| "访问记录创建后无法读取".to_owned())
}
