use std::collections::HashSet;

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


#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TravelPhotoCandidate {
    pub photo_id: String,
    pub original_file_name: String,
    pub media_type: String,
    pub captured_at: Option<String>,
    pub imported_at: String,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
    pub thumbnail_url: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TravelPhotoLink {
    pub id: String,
    pub photo_id: String,
    pub original_file_name: String,
    pub media_type: String,
    pub thumbnail_url: String,
    pub trip_id: Option<String>,
    pub visit_id: Option<String>,
    pub place_id: Option<String>,
    pub place_name: Option<String>,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
    pub captured_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewPhotoLink {
    pub photo_id: String,
    pub trip_id: Option<String>,
    pub visit_id: Option<String>,
    pub place_id: Option<String>,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
    pub captured_at: Option<String>,
}

pub fn list_photo_candidates(
    connection: &Connection,
    limit: i64,
) -> Result<Vec<TravelPhotoCandidate>, String> {
    let limit = limit.clamp(1, 500);
    let mut statement = connection.prepare(
        "SELECT id,original_file_name,media_type,captured_at,imported_at,latitude,longitude
         FROM photos
         WHERE deleted_at IS NULL AND processing_status='completed'
         ORDER BY COALESCE(captured_at,imported_at) DESC
         LIMIT ?1"
    ).map_err(|e| e.to_string())?;
    let rows = statement.query_map([limit], |row| {
        let photo_id: String = row.get(0)?;
        Ok(TravelPhotoCandidate {
            thumbnail_url: format!(
                "http://127.0.0.1:3444/photo-sync/media/{photo_id}/thumbnail"
            ),
            photo_id,
            original_file_name: row.get(1)?,
            media_type: row.get(2)?,
            captured_at: row.get(3)?,
            imported_at: row.get(4)?,
            latitude: row.get(5)?,
            longitude: row.get(6)?,
        })
    }).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

pub fn list_photo_links(connection: &Connection) -> Result<Vec<TravelPhotoLink>, String> {
    let user_id = profile::active_profile_id(connection).map_err(|e| e.to_string())?;
    let mut statement = connection.prepare(
        "SELECT l.id,l.photo_id,p.original_file_name,p.media_type,l.trip_id,l.visit_id,l.place_id,
                place.name,
                COALESCE(l.latitude,place.latitude),
                COALESCE(l.longitude,place.longitude),
                COALESCE(l.captured_at,p.captured_at),
                l.created_at,l.updated_at
         FROM travel_photo_links l
         JOIN photos p ON p.id=l.photo_id AND p.deleted_at IS NULL
         LEFT JOIN travel_places place ON place.id=l.place_id AND place.deleted_at IS NULL
         WHERE l.user_id=?1 AND l.deleted_at IS NULL
         ORDER BY COALESCE(l.captured_at,p.captured_at,l.created_at) DESC"
    ).map_err(|e| e.to_string())?;
    let rows = statement.query_map([user_id], |row| {
        let photo_id: String = row.get(1)?;
        Ok(TravelPhotoLink {
            id: row.get(0)?,
            thumbnail_url: format!(
                "http://127.0.0.1:3444/photo-sync/media/{photo_id}/thumbnail"
            ),
            photo_id,
            original_file_name: row.get(2)?,
            media_type: row.get(3)?,
            trip_id: row.get(4)?,
            visit_id: row.get(5)?,
            place_id: row.get(6)?,
            place_name: row.get(7)?,
            latitude: row.get(8)?,
            longitude: row.get(9)?,
            captured_at: row.get(10)?,
            created_at: row.get(11)?,
            updated_at: row.get(12)?,
        })
    }).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

pub fn create_photo_link(
    connection: &Connection,
    input: NewPhotoLink,
) -> Result<TravelPhotoLink, String> {
    validate_coordinates(input.latitude, input.longitude)?;
    let user_id = profile::active_profile_id(connection).map_err(|e| e.to_string())?;

    let photo = connection.query_row(
        "SELECT captured_at,latitude,longitude FROM photos
         WHERE id=?1 AND deleted_at IS NULL AND processing_status='completed'",
        [&input.photo_id],
        |row| Ok((
            row.get::<_, Option<String>>(0)?,
            row.get::<_, Option<f64>>(1)?,
            row.get::<_, Option<f64>>(2)?,
        )),
    ).optional().map_err(|e| e.to_string())?
      .ok_or_else(|| "照片不存在或尚未处理完成".to_owned())?;

    let mut trip_id = input.trip_id;
    let mut place_id = input.place_id;
    let visit_id = input.visit_id;

    if let Some(id) = visit_id.as_deref() {
        let visit = connection.query_row(
            "SELECT trip_id,place_id FROM travel_visits
             WHERE id=?1 AND user_id=?2 AND deleted_at IS NULL",
            params![id,user_id],
            |row| Ok((row.get::<_, Option<String>>(0)?, row.get::<_, String>(1)?)),
        ).optional().map_err(|e| e.to_string())?
          .ok_or_else(|| "访问记录不存在".to_owned())?;
        if trip_id.is_none() { trip_id = visit.0; }
        if place_id.is_none() { place_id = Some(visit.1); }
    }

    if let Some(id) = trip_id.as_deref() {
        let exists = connection.query_row(
            "SELECT 1 FROM travel_trips WHERE id=?1 AND user_id=?2 AND deleted_at IS NULL",
            params![id,user_id],
            |_| Ok(()),
        ).optional().map_err(|e| e.to_string())?.is_some();
        if !exists { return Err("旅行不存在".to_owned()); }
    }

    let mut latitude = input.latitude.or(photo.1);
    let mut longitude = input.longitude.or(photo.2);
    if let Some(id) = place_id.as_deref() {
        let place = connection.query_row(
            "SELECT latitude,longitude FROM travel_places
             WHERE id=?1 AND user_id=?2 AND deleted_at IS NULL",
            params![id,user_id],
            |row| Ok((row.get::<_, Option<f64>>(0)?, row.get::<_, Option<f64>>(1)?)),
        ).optional().map_err(|e| e.to_string())?
          .ok_or_else(|| "地点不存在".to_owned())?;
        if latitude.is_none() { latitude = place.0; }
        if longitude.is_none() { longitude = place.1; }
    }

    if place_id.is_none() && latitude.is_none() && longitude.is_none() {
        return Err("照片至少需要关联地点或提供坐标".to_owned());
    }

    let id = Uuid::new_v4().to_string();
    let stamp = now();
    let captured_at = input.captured_at.or(photo.0);
    connection.execute(
        "INSERT INTO travel_photo_links(
           id,user_id,photo_id,trip_id,visit_id,place_id,latitude,longitude,captured_at,
           created_at,updated_at
         ) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?10)",
        params![
            id,user_id,input.photo_id,trip_id,visit_id,place_id,latitude,longitude,
            captured_at,stamp
        ],
    ).map_err(|e| {
        if e.to_string().contains("UNIQUE constraint failed") {
            "这张照片已经关联到该访问记录".to_owned()
        } else {
            e.to_string()
        }
    })?;

    list_photo_links(connection)?
        .into_iter()
        .find(|item| item.id == id)
        .ok_or_else(|| "照片关联创建后无法读取".to_owned())
}

pub fn delete_photo_link(connection: &Connection, id: &str) -> Result<(), String> {
    let user_id = profile::active_profile_id(connection).map_err(|e| e.to_string())?;
    let stamp = now();
    let changed = connection.execute(
        "UPDATE travel_photo_links
         SET deleted_at=?1,updated_at=?1,version=version+1
         WHERE id=?2 AND user_id=?3 AND deleted_at IS NULL",
        params![stamp,id,user_id],
    ).map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("照片关联不存在".to_owned());
    }
    Ok(())
}


#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReorderVisits {
    pub visit_ids: Vec<String>,
}

pub fn update_place(
    connection: &Connection,
    id: &str,
    input: NewPlace,
) -> Result<TravelPlace, String> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err("地点名称不能为空".to_owned());
    }
    validate_coordinates(input.latitude, input.longitude)?;
    let kind = input.place_type.unwrap_or_else(|| "custom".to_owned());
    let allowed = ["country","city","attraction","restaurant","hotel","station","airport","custom"];
    if !allowed.contains(&kind.as_str()) {
        return Err("地点类型不受支持".to_owned());
    }
    let user_id = profile::active_profile_id(connection).map_err(|e| e.to_string())?;
    let stamp = now();
    let changed = connection.execute(
        "UPDATE travel_places
         SET name=?1,country=?2,country_code=?3,province=?4,city=?5,latitude=?6,longitude=?7,
             place_type=?8,updated_at=?9,version=version+1
         WHERE id=?10 AND user_id=?11 AND deleted_at IS NULL",
        params![
            name,input.country,input.country_code,input.province,input.city,input.latitude,
            input.longitude,kind,stamp,id,user_id
        ],
    ).map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("地点不存在".to_owned());
    }
    list_places(connection)?
        .into_iter()
        .find(|item| item.id == id)
        .ok_or_else(|| "地点更新后无法读取".to_owned())
}

pub fn delete_place(connection: &Connection, id: &str) -> Result<(), String> {
    let user_id = profile::active_profile_id(connection).map_err(|e| e.to_string())?;
    let visit_count: i64 = connection.query_row(
        "SELECT COUNT(*) FROM travel_visits
         WHERE user_id=?1 AND place_id=?2 AND deleted_at IS NULL",
        params![user_id,id],
        |row| row.get(0),
    ).map_err(|e| e.to_string())?;
    let photo_count: i64 = connection.query_row(
        "SELECT COUNT(*) FROM travel_photo_links
         WHERE user_id=?1 AND place_id=?2 AND deleted_at IS NULL",
        params![user_id,id],
        |row| row.get(0),
    ).map_err(|e| e.to_string())?;
    if visit_count > 0 || photo_count > 0 {
        return Err("地点仍有关联的访问记录或照片，请先移除这些关联".to_owned());
    }
    let stamp = now();
    let changed = connection.execute(
        "UPDATE travel_places
         SET deleted_at=?1,updated_at=?1,version=version+1
         WHERE id=?2 AND user_id=?3 AND deleted_at IS NULL",
        params![stamp,id,user_id],
    ).map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("地点不存在".to_owned());
    }
    Ok(())
}

pub fn update_trip(
    connection: &Connection,
    id: &str,
    input: NewTrip,
) -> Result<TravelTrip, String> {
    let title = input.title.trim();
    if title.is_empty() {
        return Err("旅行标题不能为空".to_owned());
    }
    let user_id = profile::active_profile_id(connection).map_err(|e| e.to_string())?;
    let stamp = now();
    let changed = connection.execute(
        "UPDATE travel_trips
         SET title=?1,start_at=?2,end_at=?3,description=?4,cover_photo_id=?5,
             updated_at=?6,version=version+1
         WHERE id=?7 AND user_id=?8 AND deleted_at IS NULL",
        params![
            title,input.start_at,input.end_at,input.description,input.cover_photo_id,
            stamp,id,user_id
        ],
    ).map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("旅行不存在".to_owned());
    }
    list_trips(connection)?
        .into_iter()
        .find(|item| item.id == id)
        .ok_or_else(|| "旅行更新后无法读取".to_owned())
}

pub fn delete_trip(connection: &Connection, id: &str) -> Result<(), String> {
    let user_id = profile::active_profile_id(connection).map_err(|e| e.to_string())?;
    let exists = connection.query_row(
        "SELECT 1 FROM travel_trips WHERE id=?1 AND user_id=?2 AND deleted_at IS NULL",
        params![id,user_id],
        |_| Ok(()),
    ).optional().map_err(|e| e.to_string())?.is_some();
    if !exists {
        return Err("旅行不存在".to_owned());
    }
    let stamp = now();
    let tx = connection.unchecked_transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "UPDATE travel_visits
         SET trip_id=NULL,sequence=NULL,updated_at=?1,version=version+1
         WHERE user_id=?2 AND trip_id=?3 AND deleted_at IS NULL",
        params![stamp,user_id,id],
    ).map_err(|e| e.to_string())?;
    tx.execute(
        "UPDATE travel_photo_links
         SET trip_id=NULL,updated_at=?1,version=version+1
         WHERE user_id=?2 AND trip_id=?3 AND deleted_at IS NULL",
        params![stamp,user_id,id],
    ).map_err(|e| e.to_string())?;
    tx.execute(
        "UPDATE travel_trips
         SET deleted_at=?1,updated_at=?1,version=version+1
         WHERE id=?2 AND user_id=?3 AND deleted_at IS NULL",
        params![stamp,id,user_id],
    ).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}

pub fn update_visit(
    connection: &Connection,
    id: &str,
    input: NewVisit,
) -> Result<TravelVisit, String> {
    let user_id = profile::active_profile_id(connection).map_err(|e| e.to_string())?;
    let place_exists = connection.query_row(
        "SELECT 1 FROM travel_places WHERE id=?1 AND user_id=?2 AND deleted_at IS NULL",
        params![input.place_id,user_id],
        |_| Ok(()),
    ).optional().map_err(|e| e.to_string())?.is_some();
    if !place_exists {
        return Err("地点不存在".to_owned());
    }
    if let Some(trip_id) = input.trip_id.as_deref() {
        let trip_exists = connection.query_row(
            "SELECT 1 FROM travel_trips WHERE id=?1 AND user_id=?2 AND deleted_at IS NULL",
            params![trip_id,user_id],
            |_| Ok(()),
        ).optional().map_err(|e| e.to_string())?.is_some();
        if !trip_exists {
            return Err("旅行不存在".to_owned());
        }
    }
    let stamp = now();
    let changed = connection.execute(
        "UPDATE travel_visits
         SET trip_id=?1,place_id=?2,arrived_at=?3,left_at=?4,note=?5,sequence=?6,
             updated_at=?7,version=version+1
         WHERE id=?8 AND user_id=?9 AND deleted_at IS NULL",
        params![
            input.trip_id,input.place_id,input.arrived_at,input.left_at,input.note,input.sequence,
            stamp,id,user_id
        ],
    ).map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("访问记录不存在".to_owned());
    }
    list_visits(connection, None, None)?
        .into_iter()
        .find(|item| item.id == id)
        .ok_or_else(|| "访问记录更新后无法读取".to_owned())
}

pub fn delete_visit(connection: &Connection, id: &str) -> Result<(), String> {
    let user_id = profile::active_profile_id(connection).map_err(|e| e.to_string())?;
    let exists = connection.query_row(
        "SELECT 1 FROM travel_visits WHERE id=?1 AND user_id=?2 AND deleted_at IS NULL",
        params![id,user_id],
        |_| Ok(()),
    ).optional().map_err(|e| e.to_string())?.is_some();
    if !exists {
        return Err("访问记录不存在".to_owned());
    }
    let stamp = now();
    let tx = connection.unchecked_transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "UPDATE travel_photo_links
         SET visit_id=NULL,updated_at=?1,version=version+1
         WHERE user_id=?2 AND visit_id=?3 AND deleted_at IS NULL",
        params![stamp,user_id,id],
    ).map_err(|e| e.to_string())?;
    tx.execute(
        "UPDATE travel_visits
         SET deleted_at=?1,updated_at=?1,version=version+1
         WHERE id=?2 AND user_id=?3 AND deleted_at IS NULL",
        params![stamp,id,user_id],
    ).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}

pub fn reorder_visits(
    connection: &Connection,
    trip_id: &str,
    input: ReorderVisits,
) -> Result<Vec<TravelVisit>, String> {
    let user_id = profile::active_profile_id(connection).map_err(|e| e.to_string())?;
    let mut statement = connection.prepare(
        "SELECT id FROM travel_visits
         WHERE user_id=?1 AND trip_id=?2 AND deleted_at IS NULL"
    ).map_err(|e| e.to_string())?;
    let current = statement.query_map(params![user_id,trip_id], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    let expected = current.iter().cloned().collect::<HashSet<_>>();
    let requested = input.visit_ids.iter().cloned().collect::<HashSet<_>>();
    if expected != requested || requested.len() != input.visit_ids.len() {
        return Err("访问顺序必须完整包含该旅行的全部站点且不能重复".to_owned());
    }
    drop(statement);

    let stamp = now();
    let tx = connection.unchecked_transaction().map_err(|e| e.to_string())?;
    for (index, visit_id) in input.visit_ids.iter().enumerate() {
        tx.execute(
            "UPDATE travel_visits
             SET sequence=?1,updated_at=?2,version=version+1
             WHERE id=?3 AND user_id=?4 AND trip_id=?5 AND deleted_at IS NULL",
            params![index as i64,stamp,visit_id,user_id,trip_id],
        ).map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    list_visits(connection, Some(trip_id), None)
}


#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::migration_runner::{run, MigrationContext};
    use crate::database::migrations::all;
    use rusqlite::Connection;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn db(label: &str) -> Connection {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("lifetrace-travel-repo-{label}-{unique}"));
        std::fs::create_dir_all(&dir).unwrap();
        let mut connection = Connection::open_in_memory().unwrap();
        connection.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        run(&mut connection, &MigrationContext::new(dir), &all()).unwrap();
        connection
    }

    fn place(connection: &Connection, name: &str, latitude: f64, longitude: f64) -> TravelPlace {
        create_place(connection, NewPlace {
            name: name.to_owned(),
            country: Some("China".to_owned()),
            country_code: Some("CN".to_owned()),
            province: None,
            city: Some(name.to_owned()),
            latitude: Some(latitude),
            longitude: Some(longitude),
            place_type: Some("city".to_owned()),
        }).unwrap()
    }

    #[test]
    fn trip_reorder_persists_and_delete_only_detaches_visits() {
        let connection = db("trip");
        let xiamen = place(&connection, "厦门", 24.4798, 118.0894);
        let changsha = place(&connection, "长沙", 28.2278, 112.9389);
        let trip = create_trip(&connection, NewTrip {
            title: "2026 旅行".to_owned(),
            start_at: Some("2026-09-27T00:00:00Z".to_owned()),
            end_at: None,
            description: None,
            cover_photo_id: None,
        }).unwrap();
        let first = create_visit(&connection, NewVisit {
            trip_id: Some(trip.id.clone()),
            place_id: xiamen.id.clone(),
            arrived_at: Some("2026-09-27T00:00:00Z".to_owned()),
            left_at: None,
            note: None,
            sequence: Some(0),
        }).unwrap();
        let second = create_visit(&connection, NewVisit {
            trip_id: Some(trip.id.clone()),
            place_id: changsha.id.clone(),
            arrived_at: Some("2026-09-28T00:00:00Z".to_owned()),
            left_at: None,
            note: None,
            sequence: Some(1),
        }).unwrap();

        let reordered = reorder_visits(&connection, &trip.id, ReorderVisits {
            visit_ids: vec![second.id.clone(), first.id.clone()],
        }).unwrap();
        assert_eq!(
            reordered.iter().map(|visit| visit.id.as_str()).collect::<Vec<_>>(),
            vec![second.id.as_str(), first.id.as_str()]
        );
        assert_eq!(reordered[0].sequence, Some(0));
        assert_eq!(reordered[1].sequence, Some(1));

        delete_trip(&connection, &trip.id).unwrap();
        assert!(list_trips(&connection).unwrap().is_empty());
        let remaining = list_visits(&connection, None, None).unwrap();
        assert_eq!(remaining.len(), 2);
        assert!(remaining.iter().all(|visit| visit.trip_id.is_none()));
        assert_eq!(list_places(&connection).unwrap().len(), 2);
    }

    #[test]
    fn place_with_active_visit_requires_explicit_visit_removal_first() {
        let connection = db("place-delete");
        let xiamen = place(&connection, "厦门", 24.4798, 118.0894);
        let visit = create_visit(&connection, NewVisit {
            trip_id: None,
            place_id: xiamen.id.clone(),
            arrived_at: Some("2026-09-27T00:00:00Z".to_owned()),
            left_at: None,
            note: None,
            sequence: None,
        }).unwrap();

        assert!(delete_place(&connection, &xiamen.id).is_err());
        delete_visit(&connection, &visit.id).unwrap();
        delete_place(&connection, &xiamen.id).unwrap();
        assert!(list_places(&connection).unwrap().is_empty());
    }
}
