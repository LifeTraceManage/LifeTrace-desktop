use chrono::{NaiveDate, Utc};
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::Serialize;
use uuid::Uuid;

const ENTRY_COLUMNS: &str = r#"
e.id,e.location_id,e.title,e.description,e.started_at,e.ended_at,e.visit_type,e.rating,e.favorite,
e.created_at,e.updated_at,
l.country_code,l.country_name,l.province_code,l.province_name,l.city_code,l.city_name,
l.district_code,l.district_name,l.place_name,l.latitude,l.longitude,
(SELECT COUNT(*) FROM footprint_entry_photos ep WHERE ep.entry_id=e.id) AS photo_count,
(SELECT ep.photo_id FROM footprint_entry_photos ep WHERE ep.entry_id=e.id
 ORDER BY ep.is_cover DESC,ep.sort_order ASC,ep.photo_id ASC LIMIT 1) AS cover_photo_id
"#;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LocationRecord {
    pub id: String,
    pub country_code: String,
    pub country_name: String,
    pub province_code: String,
    pub province_name: String,
    pub city_code: Option<String>,
    pub city_name: Option<String>,
    pub district_code: Option<String>,
    pub district_name: Option<String>,
    pub place_name: Option<String>,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
    pub source: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone)]
pub struct LocationWrite {
    pub id: Option<String>,
    pub country_code: String,
    pub country_name: String,
    pub province_code: String,
    pub province_name: String,
    pub city_code: Option<String>,
    pub city_name: Option<String>,
    pub district_code: Option<String>,
    pub district_name: Option<String>,
    pub place_name: Option<String>,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EntryRecord {
    pub id: String,
    pub location_id: String,
    pub title: String,
    pub description: Option<String>,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub visit_type: String,
    pub rating: Option<i64>,
    pub favorite: bool,
    pub created_at: String,
    pub updated_at: String,
    pub country_code: String,
    pub country_name: String,
    pub province_code: String,
    pub province_name: String,
    pub city_code: Option<String>,
    pub city_name: Option<String>,
    pub district_code: Option<String>,
    pub district_name: Option<String>,
    pub place_name: Option<String>,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
    pub photo_count: i64,
    pub cover_photo_id: Option<String>,
}

#[derive(Debug, Clone)]
pub struct EntryWrite {
    pub id: Option<String>,
    pub location_id: String,
    pub title: String,
    pub description: Option<String>,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub visit_type: String,
    pub rating: Option<i64>,
    pub favorite: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PhotoRecord {
    pub id: String,
    pub original_file_name: String,
    pub media_type: String,
    pub captured_at: Option<String>,
    pub imported_at: String,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PhotoSuggestion {
    #[serde(flatten)]
    pub photo: PhotoRecord,
    pub score: i64,
    pub distance_km: Option<f64>,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PhotoDiscovery {
    pub id: String,
    pub photo_ids: Vec<String>,
    pub photo_count: usize,
    pub started_at: String,
    pub ended_at: String,
    pub latitude: f64,
    pub longitude: f64,
    pub sample_photo_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FootprintSummary {
    pub province_count: i64,
    pub city_count: i64,
    pub entry_count: i64,
    pub photo_count: i64,
    pub favorite_count: i64,
    pub first_visited_at: Option<String>,
    pub last_visited_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProvinceSummary {
    pub province_code: String,
    pub province_name: String,
    pub city_count: i64,
    pub visit_count: i64,
    pub photo_count: i64,
    pub first_visited_at: Option<String>,
    pub last_visited_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CitySummary {
    pub city_code: Option<String>,
    pub city_name: String,
    pub visit_count: i64,
    pub photo_count: i64,
    pub first_visited_at: Option<String>,
    pub last_visited_at: Option<String>,
}

fn stamp() -> String {
    Utc::now().to_rfc3339()
}

fn clean_optional(value: &Option<String>) -> Option<String> {
    value
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

pub fn active_profile_id(connection: &Connection) -> Result<String, String> {
    connection
        .query_row(
            "SELECT active_profile_id FROM app_profile_state WHERE singleton=1",
            [],
            |row| row.get(0),
        )
        .map_err(|error| format!("读取当前资料失败: {error}"))
}

fn location_from_row(row: &Row<'_>) -> rusqlite::Result<LocationRecord> {
    Ok(LocationRecord {
        id: row.get(0)?,
        country_code: row.get(1)?,
        country_name: row.get(2)?,
        province_code: row.get(3)?,
        province_name: row.get(4)?,
        city_code: row.get(5)?,
        city_name: row.get(6)?,
        district_code: row.get(7)?,
        district_name: row.get(8)?,
        place_name: row.get(9)?,
        latitude: row.get(10)?,
        longitude: row.get(11)?,
        source: row.get(12)?,
        created_at: row.get(13)?,
        updated_at: row.get(14)?,
    })
}

fn entry_from_row(row: &Row<'_>) -> rusqlite::Result<EntryRecord> {
    Ok(EntryRecord {
        id: row.get(0)?,
        location_id: row.get(1)?,
        title: row.get(2)?,
        description: row.get(3)?,
        started_at: row.get(4)?,
        ended_at: row.get(5)?,
        visit_type: row.get(6)?,
        rating: row.get(7)?,
        favorite: row.get::<_, i64>(8)? != 0,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
        country_code: row.get(11)?,
        country_name: row.get(12)?,
        province_code: row.get(13)?,
        province_name: row.get(14)?,
        city_code: row.get(15)?,
        city_name: row.get(16)?,
        district_code: row.get(17)?,
        district_name: row.get(18)?,
        place_name: row.get(19)?,
        latitude: row.get(20)?,
        longitude: row.get(21)?,
        photo_count: row.get(22)?,
        cover_photo_id: row.get(23)?,
    })
}

pub fn list_locations(connection: &Connection, user_id: &str) -> Result<Vec<LocationRecord>, String> {
    let mut statement = connection
        .prepare(
            "SELECT id,country_code,country_name,province_code,province_name,city_code,city_name,
                    district_code,district_name,place_name,latitude,longitude,source,created_at,updated_at
             FROM footprint_locations
             WHERE user_id=?1
             ORDER BY province_name,COALESCE(city_name,''),COALESCE(place_name,'')",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([user_id], location_from_row)
        .map_err(|error| error.to_string())?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|error| error.to_string())
}

pub fn get_location(
    connection: &Connection,
    user_id: &str,
    id: &str,
) -> Result<Option<LocationRecord>, String> {
    connection
        .query_row(
            "SELECT id,country_code,country_name,province_code,province_name,city_code,city_name,
                    district_code,district_name,place_name,latitude,longitude,source,created_at,updated_at
             FROM footprint_locations WHERE id=?1 AND user_id=?2",
            params![id, user_id],
            location_from_row,
        )
        .optional()
        .map_err(|error| error.to_string())
}

pub fn save_location(
    connection: &Connection,
    user_id: &str,
    input: &LocationWrite,
) -> Result<LocationRecord, String> {
    let country_code = input.country_code.trim();
    let country_name = input.country_name.trim();
    let province_code = input.province_code.trim();
    let province_name = input.province_name.trim();
    if country_code.is_empty() || country_name.is_empty() || province_code.is_empty() || province_name.is_empty() {
        return Err("国家和省份信息不能为空".to_owned());
    }
    if input.latitude.is_some_and(|value| !(-90.0..=90.0).contains(&value))
        || input.longitude.is_some_and(|value| !(-180.0..=180.0).contains(&value))
    {
        return Err("地点经纬度超出有效范围".to_owned());
    }

    let city_code = clean_optional(&input.city_code);
    let city_name = clean_optional(&input.city_name);
    let district_code = clean_optional(&input.district_code);
    let district_name = clean_optional(&input.district_name);
    let place_name = clean_optional(&input.place_name);
    let existing = if let Some(id) = input.id.as_deref() {
        get_location(connection, user_id, id)?
    } else {
        connection
            .query_row(
                "SELECT id,country_code,country_name,province_code,province_name,city_code,city_name,
                        district_code,district_name,place_name,latitude,longitude,source,created_at,updated_at
                 FROM footprint_locations
                 WHERE user_id=?1 AND country_code=?2 AND province_code=?3
                   AND IFNULL(city_code,'')=IFNULL(?4,'')
                   AND IFNULL(city_name,'')=IFNULL(?5,'')
                   AND IFNULL(district_code,'')=IFNULL(?6,'')
                   AND IFNULL(place_name,'')=IFNULL(?7,'')
                 LIMIT 1",
                params![
                    user_id,
                    country_code,
                    province_code,
                    city_code,
                    city_name,
                    district_code,
                    place_name
                ],
                location_from_row,
            )
            .optional()
            .map_err(|error| error.to_string())?
    };

    let now = stamp();
    let id = existing
        .as_ref()
        .map(|value| value.id.clone())
        .or_else(|| input.id.clone())
        .unwrap_or_else(|| Uuid::new_v4().to_string());

    if existing.is_some() {
        connection
            .execute(
                "UPDATE footprint_locations
                 SET country_code=?1,country_name=?2,province_code=?3,province_name=?4,
                     city_code=?5,city_name=?6,district_code=?7,district_name=?8,place_name=?9,
                     latitude=COALESCE(?10,latitude),longitude=COALESCE(?11,longitude),
                     source=?12,updated_at=?13
                 WHERE id=?14 AND user_id=?15",
                params![
                    country_code,
                    country_name,
                    province_code,
                    province_name,
                    city_code,
                    city_name,
                    district_code,
                    district_name,
                    place_name,
                    input.latitude,
                    input.longitude,
                    input.source.trim(),
                    now,
                    id,
                    user_id
                ],
            )
            .map_err(|error| error.to_string())?;
    } else {
        connection
            .execute(
                "INSERT INTO footprint_locations(
                   id,user_id,country_code,country_name,province_code,province_name,
                   city_code,city_name,district_code,district_name,place_name,
                   latitude,longitude,source,created_at,updated_at
                 ) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?15)",
                params![
                    id,
                    user_id,
                    country_code,
                    country_name,
                    province_code,
                    province_name,
                    city_code,
                    city_name,
                    district_code,
                    district_name,
                    place_name,
                    input.latitude,
                    input.longitude,
                    if input.source.trim().is_empty() { "manual" } else { input.source.trim() },
                    now
                ],
            )
            .map_err(|error| error.to_string())?;
    }

    get_location(connection, user_id, &id)?
        .ok_or_else(|| "地点保存后无法读取".to_owned())
}

pub fn list_entries(
    connection: &Connection,
    user_id: &str,
    query: Option<&str>,
    province_code: Option<&str>,
) -> Result<Vec<EntryRecord>, String> {
    let q = query.unwrap_or("").trim();
    let province = province_code.unwrap_or("").trim();
    let like = format!("%{q}%");
    let sql = format!(
        "SELECT {ENTRY_COLUMNS}
         FROM footprint_entries e
         JOIN footprint_locations l ON l.id=e.location_id
         WHERE e.user_id=?1 AND e.deleted_at IS NULL
           AND (?2='' OR l.province_code=?2)
           AND (?3='' OR e.title LIKE ?4 OR IFNULL(e.description,'') LIKE ?4
                OR l.province_name LIKE ?4 OR IFNULL(l.city_name,'') LIKE ?4
                OR IFNULL(l.place_name,'') LIKE ?4)
         ORDER BY e.started_at DESC,e.updated_at DESC"
    );
    let mut statement = connection.prepare(&sql).map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![user_id, province, q, like], entry_from_row)
        .map_err(|error| error.to_string())?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|error| error.to_string())
}

pub fn get_entry(
    connection: &Connection,
    user_id: &str,
    id: &str,
) -> Result<Option<EntryRecord>, String> {
    let sql = format!(
        "SELECT {ENTRY_COLUMNS}
         FROM footprint_entries e
         JOIN footprint_locations l ON l.id=e.location_id
         WHERE e.id=?1 AND e.user_id=?2 AND e.deleted_at IS NULL"
    );
    connection
        .query_row(&sql, params![id, user_id], entry_from_row)
        .optional()
        .map_err(|error| error.to_string())
}

pub fn save_entry(
    connection: &Connection,
    user_id: &str,
    input: &EntryWrite,
) -> Result<EntryRecord, String> {
    if input.title.trim().is_empty() {
        return Err("足迹标题不能为空".to_owned());
    }
    if input.started_at.trim().is_empty() {
        return Err("开始日期不能为空".to_owned());
    }
    if input.ended_at.as_deref().is_some_and(|ended| ended < input.started_at.as_str()) {
        return Err("结束日期不能早于开始日期".to_owned());
    }
    if input.rating.is_some_and(|rating| !(0..=5).contains(&rating)) {
        return Err("评分必须在 0 到 5 之间".to_owned());
    }
    let location_exists: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM footprint_locations WHERE id=?1 AND user_id=?2",
            params![input.location_id, user_id],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if location_exists == 0 {
        return Err("所选地点不存在".to_owned());
    }

    let id = input.id.clone().unwrap_or_else(|| Uuid::new_v4().to_string());
    let now = stamp();
    let existing = get_entry(connection, user_id, &id)?;
    if existing.is_some() {
        connection
            .execute(
                "UPDATE footprint_entries
                 SET location_id=?1,title=?2,description=?3,started_at=?4,ended_at=?5,
                     visit_type=?6,rating=?7,favorite=?8,updated_at=?9
                 WHERE id=?10 AND user_id=?11 AND deleted_at IS NULL",
                params![
                    input.location_id,
                    input.title.trim(),
                    clean_optional(&input.description),
                    input.started_at.trim(),
                    clean_optional(&input.ended_at),
                    if input.visit_type.trim().is_empty() { "trip" } else { input.visit_type.trim() },
                    input.rating,
                    if input.favorite { 1_i64 } else { 0_i64 },
                    now,
                    id,
                    user_id
                ],
            )
            .map_err(|error| error.to_string())?;
    } else {
        connection
            .execute(
                "INSERT INTO footprint_entries(
                   id,user_id,location_id,title,description,started_at,ended_at,
                   visit_type,rating,favorite,created_at,updated_at
                 ) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?11)",
                params![
                    id,
                    user_id,
                    input.location_id,
                    input.title.trim(),
                    clean_optional(&input.description),
                    input.started_at.trim(),
                    clean_optional(&input.ended_at),
                    if input.visit_type.trim().is_empty() { "trip" } else { input.visit_type.trim() },
                    input.rating,
                    i64::from(input.favorite),
                    now
                ],
            )
            .map_err(|error| error.to_string())?;
    }

    get_entry(connection, user_id, &id)?
        .ok_or_else(|| "足迹保存后无法读取".to_owned())
}

pub fn delete_entry(connection: &Connection, user_id: &str, id: &str) -> Result<bool, String> {
    let now = stamp();
    let changed = connection
        .execute(
            "UPDATE footprint_entries SET deleted_at=?1,updated_at=?1
             WHERE id=?2 AND user_id=?3 AND deleted_at IS NULL",
            params![now, id, user_id],
        )
        .map_err(|error| error.to_string())?;
    if changed > 0 {
        connection
            .execute("DELETE FROM footprint_entry_photos WHERE entry_id=?1", [id])
            .map_err(|error| error.to_string())?;
        connection
            .execute("DELETE FROM footprint_entry_links WHERE entry_id=?1", [id])
            .map_err(|error| error.to_string())?;
    }
    Ok(changed > 0)
}

pub fn list_entry_photos(connection: &Connection, entry_id: &str) -> Result<Vec<PhotoRecord>, String> {
    let mut statement = connection
        .prepare(
            "SELECT p.id,p.original_file_name,p.media_type,p.captured_at,p.imported_at,p.latitude,p.longitude
             FROM footprint_entry_photos ep
             JOIN photos p ON p.id=ep.photo_id
             WHERE ep.entry_id=?1 AND p.deleted_at IS NULL AND p.processing_status <> 'hiding'
             ORDER BY ep.is_cover DESC,ep.sort_order ASC,ep.photo_id ASC",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([entry_id], |row| {
            Ok(PhotoRecord {
                id: row.get(0)?,
                original_file_name: row.get(1)?,
                media_type: row.get(2)?,
                captured_at: row.get(3)?,
                imported_at: row.get(4)?,
                latitude: row.get(5)?,
                longitude: row.get(6)?,
            })
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|error| error.to_string())
}

pub fn replace_entry_photos(
    connection: &Connection,
    user_id: &str,
    entry_id: &str,
    photo_ids: &[String],
) -> Result<(), String> {
    if get_entry(connection, user_id, entry_id)?.is_none() {
        return Err("足迹不存在".to_owned());
    }
    let transaction = connection
        .unchecked_transaction()
        .map_err(|error| error.to_string())?;
    transaction
        .execute("DELETE FROM footprint_entry_photos WHERE entry_id=?1", [entry_id])
        .map_err(|error| error.to_string())?;

    for (index, photo_id) in photo_ids.iter().enumerate() {
        let exists: i64 = transaction
            .query_row(
                "SELECT COUNT(*) FROM photos
                 WHERE id=?1 AND deleted_at IS NULL AND processing_status <> 'hiding'",
                [photo_id],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        if exists == 0 {
            continue;
        }
        transaction
            .execute(
                "INSERT INTO footprint_entry_photos(entry_id,photo_id,sort_order,is_cover,created_at)
                 VALUES(?1,?2,?3,?4,?5)",
                params![entry_id, photo_id, index as i64, i64::from(index == 0), stamp()],
            )
            .map_err(|error| error.to_string())?;
    }
    transaction.commit().map_err(|error| error.to_string())
}

pub fn attach_photos(
    connection: &Connection,
    user_id: &str,
    entry_id: &str,
    photo_ids: &[String],
) -> Result<Vec<PhotoRecord>, String> {
    if get_entry(connection, user_id, entry_id)?.is_none() {
        return Err("足迹不存在".to_owned());
    }
    let start_order: i64 = connection
        .query_row(
            "SELECT COALESCE(MAX(sort_order),-1)+1 FROM footprint_entry_photos WHERE entry_id=?1",
            [entry_id],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    let has_cover: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM footprint_entry_photos WHERE entry_id=?1 AND is_cover=1",
            [entry_id],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;

    for (offset, photo_id) in photo_ids.iter().enumerate() {
        let exists: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM photos
                 WHERE id=?1 AND deleted_at IS NULL AND processing_status <> 'hiding'",
                [photo_id],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        if exists == 0 {
            continue;
        }
        connection
            .execute(
                "INSERT OR IGNORE INTO footprint_entry_photos(entry_id,photo_id,sort_order,is_cover,created_at)
                 VALUES(?1,?2,?3,?4,?5)",
                params![
                    entry_id,
                    photo_id,
                    start_order + offset as i64,
                    if has_cover == 0 && offset == 0 { 1_i64 } else { 0_i64 },
                    stamp()
                ],
            )
            .map_err(|error| error.to_string())?;
    }
    list_entry_photos(connection, entry_id)
}

pub fn detach_photo(
    connection: &Connection,
    user_id: &str,
    entry_id: &str,
    photo_id: &str,
) -> Result<bool, String> {
    if get_entry(connection, user_id, entry_id)?.is_none() {
        return Ok(false);
    }
    let was_cover: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM footprint_entry_photos
             WHERE entry_id=?1 AND photo_id=?2 AND is_cover=1",
            params![entry_id, photo_id],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    let changed = connection
        .execute(
            "DELETE FROM footprint_entry_photos WHERE entry_id=?1 AND photo_id=?2",
            params![entry_id, photo_id],
        )
        .map_err(|error| error.to_string())?;
    if was_cover > 0 {
        connection
            .execute(
                "UPDATE footprint_entry_photos SET is_cover=1
                 WHERE entry_id=?1 AND photo_id=(
                   SELECT photo_id FROM footprint_entry_photos
                   WHERE entry_id=?1 ORDER BY sort_order,photo_id LIMIT 1
                 )",
                [entry_id],
            )
            .map_err(|error| error.to_string())?;
    }
    Ok(changed > 0)
}

pub fn list_photos(
    connection: &Connection,
    page: usize,
    page_size: usize,
    query: Option<&str>,
) -> Result<(Vec<PhotoRecord>, i64), String> {
    let page = page.max(1);
    let page_size = page_size.clamp(1, 100);
    let offset = (page - 1) * page_size;
    let q = query.unwrap_or("").trim();
    let like = format!("%{q}%");
    let total: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM photos
             WHERE deleted_at IS NULL AND processing_status='completed' AND media_type='image'
               AND (?1='' OR original_file_name LIKE ?2)",
            params![q, like],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    let mut statement = connection
        .prepare(
            "SELECT id,original_file_name,media_type,captured_at,imported_at,latitude,longitude
             FROM photos
             WHERE deleted_at IS NULL AND processing_status='completed' AND media_type='image'
               AND (?1='' OR original_file_name LIKE ?2)
             ORDER BY COALESCE(captured_at,imported_at) DESC
             LIMIT ?3 OFFSET ?4",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![q, like, page_size as i64, offset as i64], |row| {
            Ok(PhotoRecord {
                id: row.get(0)?,
                original_file_name: row.get(1)?,
                media_type: row.get(2)?,
                captured_at: row.get(3)?,
                imported_at: row.get(4)?,
                latitude: row.get(5)?,
                longitude: row.get(6)?,
            })
        })
        .map_err(|error| error.to_string())?;
    let photos = rows
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|error| error.to_string())?;
    Ok((photos, total))
}

pub fn summary(connection: &Connection, user_id: &str) -> Result<FootprintSummary, String> {
    connection
        .query_row(
            "SELECT
               COUNT(DISTINCT l.province_code),
               COUNT(DISTINCT CASE
                 WHEN IFNULL(l.city_code,'')<>'' THEN l.city_code
                 WHEN IFNULL(l.city_name,'')<>'' THEN l.province_code || ':' || l.city_name
                 ELSE NULL END),
               COUNT(DISTINCT e.id),
               COUNT(DISTINCT ep.photo_id),
               COUNT(DISTINCT CASE WHEN e.favorite=1 THEN e.id END),
               MIN(e.started_at),
               MAX(COALESCE(e.ended_at,e.started_at))
             FROM footprint_entries e
             JOIN footprint_locations l ON l.id=e.location_id
             LEFT JOIN footprint_entry_photos ep ON ep.entry_id=e.id
             WHERE e.user_id=?1 AND e.deleted_at IS NULL",
            [user_id],
            |row| {
                Ok(FootprintSummary {
                    province_count: row.get(0)?,
                    city_count: row.get(1)?,
                    entry_count: row.get(2)?,
                    photo_count: row.get(3)?,
                    favorite_count: row.get(4)?,
                    first_visited_at: row.get(5)?,
                    last_visited_at: row.get(6)?,
                })
            },
        )
        .map_err(|error| error.to_string())
}

pub fn province_summaries(
    connection: &Connection,
    user_id: &str,
) -> Result<Vec<ProvinceSummary>, String> {
    let mut statement = connection
        .prepare(
            "SELECT l.province_code,l.province_name,
               COUNT(DISTINCT CASE
                 WHEN IFNULL(l.city_code,'')<>'' THEN l.city_code
                 WHEN IFNULL(l.city_name,'')<>'' THEN l.province_code || ':' || l.city_name
                 ELSE NULL END) city_count,
               COUNT(DISTINCT e.id) visit_count,
               COUNT(DISTINCT ep.photo_id) photo_count,
               MIN(e.started_at) first_visited_at,
               MAX(COALESCE(e.ended_at,e.started_at)) last_visited_at
             FROM footprint_entries e
             JOIN footprint_locations l ON l.id=e.location_id
             LEFT JOIN footprint_entry_photos ep ON ep.entry_id=e.id
             WHERE e.user_id=?1 AND e.deleted_at IS NULL
             GROUP BY l.province_code,l.province_name
             ORDER BY visit_count DESC,l.province_name",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([user_id], |row| {
            Ok(ProvinceSummary {
                province_code: row.get(0)?,
                province_name: row.get(1)?,
                city_count: row.get(2)?,
                visit_count: row.get(3)?,
                photo_count: row.get(4)?,
                first_visited_at: row.get(5)?,
                last_visited_at: row.get(6)?,
            })
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|error| error.to_string())
}

pub fn city_summaries(
    connection: &Connection,
    user_id: &str,
    province_code: &str,
) -> Result<Vec<CitySummary>, String> {
    let mut statement = connection
        .prepare(
            "SELECT l.city_code,COALESCE(NULLIF(l.city_name,''),l.province_name) city_name,
               COUNT(DISTINCT e.id) visit_count,
               COUNT(DISTINCT ep.photo_id) photo_count,
               MIN(e.started_at) first_visited_at,
               MAX(COALESCE(e.ended_at,e.started_at)) last_visited_at
             FROM footprint_entries e
             JOIN footprint_locations l ON l.id=e.location_id
             LEFT JOIN footprint_entry_photos ep ON ep.entry_id=e.id
             WHERE e.user_id=?1 AND e.deleted_at IS NULL AND l.province_code=?2
             GROUP BY l.city_code,COALESCE(NULLIF(l.city_name,''),l.province_name)
             ORDER BY visit_count DESC,city_name",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![user_id, province_code], |row| {
            Ok(CitySummary {
                city_code: row.get(0)?,
                city_name: row.get(1)?,
                visit_count: row.get(2)?,
                photo_count: row.get(3)?,
                first_visited_at: row.get(4)?,
                last_visited_at: row.get(5)?,
            })
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|error| error.to_string())
}

fn haversine_km(a_lat: f64, a_lon: f64, b_lat: f64, b_lon: f64) -> f64 {
    let earth_radius_km = 6371.0088_f64;
    let d_lat = (b_lat - a_lat).to_radians();
    let d_lon = (b_lon - a_lon).to_radians();
    let a_lat = a_lat.to_radians();
    let b_lat = b_lat.to_radians();
    let hav = (d_lat / 2.0).sin().powi(2)
        + a_lat.cos() * b_lat.cos() * (d_lon / 2.0).sin().powi(2);
    2.0 * earth_radius_km * hav.sqrt().asin()
}

pub fn photo_discoveries(
    connection: &Connection,
    user_id: &str,
) -> Result<Vec<PhotoDiscovery>, String> {
    #[derive(Debug)]
    struct DiscoveryPhoto {
        id: String,
        shot_date: NaiveDate,
        latitude: f64,
        longitude: f64,
    }

    #[derive(Debug)]
    struct DiscoveryCluster {
        photo_ids: Vec<String>,
        sample_photo_ids: Vec<String>,
        started_at: NaiveDate,
        ended_at: NaiveDate,
        last_date: NaiveDate,
        latitude_sum: f64,
        longitude_sum: f64,
    }

    let mut statement = connection
        .prepare(
            "SELECT p.id,date(COALESCE(p.captured_at,p.imported_at)),p.latitude,p.longitude
             FROM photos p
             WHERE p.deleted_at IS NULL
               AND p.processing_status='completed'
               AND p.media_type='image'
               AND p.latitude IS NOT NULL
               AND p.longitude IS NOT NULL
               AND date(COALESCE(p.captured_at,p.imported_at)) IS NOT NULL
               AND NOT EXISTS(
                 SELECT 1
                 FROM footprint_entry_photos ep
                 JOIN footprint_entries e ON e.id=ep.entry_id
                 WHERE ep.photo_id=p.id AND e.user_id=?1 AND e.deleted_at IS NULL
               )
             ORDER BY date(COALESCE(p.captured_at,p.imported_at)) ASC,
                      COALESCE(p.captured_at,p.imported_at) ASC
             LIMIT 1000",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([user_id], |row| {
            let shot_date: String = row.get(1)?;
            Ok((
                row.get::<_, String>(0)?,
                shot_date,
                row.get::<_, f64>(2)?,
                row.get::<_, f64>(3)?,
            ))
        })
        .map_err(|error| error.to_string())?;

    let mut photos = Vec::new();
    for row in rows {
        let (id, shot_date, latitude, longitude) = row.map_err(|error| error.to_string())?;
        let Ok(shot_date) = NaiveDate::parse_from_str(&shot_date, "%Y-%m-%d") else {
            continue;
        };
        photos.push(DiscoveryPhoto {
            id,
            shot_date,
            latitude,
            longitude,
        });
    }

    let mut clusters: Vec<DiscoveryCluster> = Vec::new();
    for photo in photos {
        let mut best_match: Option<(usize, f64)> = None;
        for (index, cluster) in clusters.iter().enumerate() {
            let day_gap = (photo.shot_date - cluster.last_date).num_days();
            if !(0..=3).contains(&day_gap) {
                continue;
            }
            let count = cluster.photo_ids.len() as f64;
            let center_latitude = cluster.latitude_sum / count;
            let center_longitude = cluster.longitude_sum / count;
            let distance = haversine_km(
                center_latitude,
                center_longitude,
                photo.latitude,
                photo.longitude,
            );
            if distance <= 120.0
                && best_match
                    .as_ref()
                    .map_or(true, |(_, current_distance)| distance < *current_distance)
            {
                best_match = Some((index, distance));
            }
        }

        if let Some((index, _)) = best_match {
            let cluster = &mut clusters[index];
            if cluster.sample_photo_ids.len() < 4 {
                cluster.sample_photo_ids.push(photo.id.clone());
            }
            cluster.photo_ids.push(photo.id);
            cluster.started_at = cluster.started_at.min(photo.shot_date);
            cluster.ended_at = cluster.ended_at.max(photo.shot_date);
            cluster.last_date = cluster.last_date.max(photo.shot_date);
            cluster.latitude_sum += photo.latitude;
            cluster.longitude_sum += photo.longitude;
        } else {
            clusters.push(DiscoveryCluster {
                photo_ids: vec![photo.id.clone()],
                sample_photo_ids: vec![photo.id],
                started_at: photo.shot_date,
                ended_at: photo.shot_date,
                last_date: photo.shot_date,
                latitude_sum: photo.latitude,
                longitude_sum: photo.longitude,
            });
        }
    }

    let mut discoveries = clusters
        .into_iter()
        .filter(|cluster| cluster.photo_ids.len() >= 2)
        .map(|cluster| {
            let photo_count = cluster.photo_ids.len();
            let count = photo_count as f64;
            let latitude = cluster.latitude_sum / count;
            let longitude = cluster.longitude_sum / count;
            PhotoDiscovery {
                id: format!(
                    "{}:{}",
                    cluster.started_at.format("%Y-%m-%d"),
                    cluster.photo_ids.first().cloned().unwrap_or_default()
                ),
                photo_ids: cluster.photo_ids,
                photo_count,
                started_at: cluster.started_at.format("%Y-%m-%d").to_string(),
                ended_at: cluster.ended_at.format("%Y-%m-%d").to_string(),
                latitude: (latitude * 100_000.0).round() / 100_000.0,
                longitude: (longitude * 100_000.0).round() / 100_000.0,
                sample_photo_ids: cluster.sample_photo_ids,
            }
        })
        .collect::<Vec<_>>();

    discoveries.sort_by(|left, right| {
        right
            .ended_at
            .cmp(&left.ended_at)
            .then_with(|| right.photo_count.cmp(&left.photo_count))
    });
    discoveries.truncate(24);
    Ok(discoveries)
}

pub fn photo_suggestions(
    connection: &Connection,
    user_id: &str,
    entry_id: &str,
) -> Result<Vec<PhotoSuggestion>, String> {
    let entry = get_entry(connection, user_id, entry_id)?
        .ok_or_else(|| "足迹不存在".to_owned())?;
    let end = entry.ended_at.as_deref().unwrap_or(&entry.started_at);
    let mut statement = connection
        .prepare(
            "SELECT p.id,p.original_file_name,p.media_type,p.captured_at,p.imported_at,p.latitude,p.longitude
             FROM photos p
             WHERE p.deleted_at IS NULL
               AND p.processing_status='completed'
               AND p.media_type='image'
               AND date(COALESCE(p.captured_at,p.imported_at)) BETWEEN date(?1) AND date(?2)
               AND NOT EXISTS(
                 SELECT 1 FROM footprint_entry_photos ep
                 WHERE ep.entry_id=?3 AND ep.photo_id=p.id
               )
             ORDER BY COALESCE(p.captured_at,p.imported_at) DESC
             LIMIT 120",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![entry.started_at, end, entry_id], |row| {
            Ok(PhotoRecord {
                id: row.get(0)?,
                original_file_name: row.get(1)?,
                media_type: row.get(2)?,
                captured_at: row.get(3)?,
                imported_at: row.get(4)?,
                latitude: row.get(5)?,
                longitude: row.get(6)?,
            })
        })
        .map_err(|error| error.to_string())?;

    let mut suggestions = Vec::new();
    for photo in rows {
        let photo = photo.map_err(|error| error.to_string())?;
        let distance = match (entry.latitude, entry.longitude, photo.latitude, photo.longitude) {
            (Some(a_lat), Some(a_lon), Some(b_lat), Some(b_lon)) => {
                Some(haversine_km(a_lat, a_lon, b_lat, b_lon))
            }
            _ => None,
        };
        let (score, reason) = match distance {
            Some(value) if value <= 75.0 => (3, "日期和 GPS 均匹配".to_owned()),
            Some(value) if value <= 200.0 => (2, "日期匹配，GPS 位于附近".to_owned()),
            Some(_) => (1, "拍摄日期匹配".to_owned()),
            None => (1, "拍摄日期匹配".to_owned()),
        };
        suggestions.push(PhotoSuggestion {
            photo,
            score,
            distance_km: distance.map(|value| (value * 10.0).round() / 10.0),
            reason,
        });
    }
    suggestions.sort_by(|left, right| {
        right
            .score
            .cmp(&left.score)
            .then_with(|| left.distance_km.partial_cmp(&right.distance_km).unwrap_or(std::cmp::Ordering::Equal))
    });
    suggestions.truncate(60);
    Ok(suggestions)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn connection() -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                r#"
                PRAGMA foreign_keys=ON;
                CREATE TABLE local_profiles(
                  id TEXT PRIMARY KEY,display_name TEXT NOT NULL,cloud_user_id TEXT,
                  cloud_binding_state TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
                );
                INSERT INTO local_profiles VALUES('profile-1','Test',NULL,'local_only','now','now');
                CREATE TABLE app_profile_state(
                  singleton INTEGER PRIMARY KEY,active_profile_id TEXT NOT NULL,updated_at TEXT NOT NULL
                );
                INSERT INTO app_profile_state VALUES(1,'profile-1','now');
                CREATE TABLE footprint_locations(
                  id TEXT PRIMARY KEY,user_id TEXT NOT NULL,country_code TEXT NOT NULL,country_name TEXT NOT NULL,
                  province_code TEXT NOT NULL,province_name TEXT NOT NULL,city_code TEXT,city_name TEXT,
                  district_code TEXT,district_name TEXT,place_name TEXT,latitude REAL,longitude REAL,
                  source TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
                );
                CREATE TABLE footprint_entries(
                  id TEXT PRIMARY KEY,user_id TEXT NOT NULL,location_id TEXT NOT NULL,title TEXT NOT NULL,
                  description TEXT,started_at TEXT NOT NULL,ended_at TEXT,visit_type TEXT NOT NULL,
                  rating INTEGER,favorite INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,deleted_at TEXT
                );
                CREATE TABLE footprint_entry_photos(
                  entry_id TEXT NOT NULL,photo_id TEXT NOT NULL,sort_order INTEGER NOT NULL,is_cover INTEGER NOT NULL,
                  created_at TEXT NOT NULL,PRIMARY KEY(entry_id,photo_id)
                );
                CREATE TABLE footprint_entry_links(
                  id TEXT PRIMARY KEY,entry_id TEXT NOT NULL,entity_type TEXT NOT NULL,entity_id TEXT NOT NULL,
                  relation_type TEXT NOT NULL,created_at TEXT NOT NULL
                );
                CREATE TABLE photos(
                  id TEXT PRIMARY KEY,original_file_name TEXT NOT NULL,media_type TEXT NOT NULL,
                  captured_at TEXT,imported_at TEXT NOT NULL,latitude REAL,longitude REAL,
                  processing_status TEXT NOT NULL,deleted_at TEXT
                );
                "#,
            )
            .unwrap();
        connection
    }

    fn location_write() -> LocationWrite {
        LocationWrite {
            id: None,
            country_code: "CN".to_owned(),
            country_name: "中国".to_owned(),
            province_code: "510000".to_owned(),
            province_name: "四川省".to_owned(),
            city_code: Some("510100".to_owned()),
            city_name: Some("成都市".to_owned()),
            district_code: None,
            district_name: None,
            place_name: None,
            latitude: Some(30.5728),
            longitude: Some(104.0668),
            source: "manual".to_owned(),
        }
    }

    #[test]
    fn crud_summary_and_photo_links_share_the_photo_catalog() {
        let connection = connection();
        let user = active_profile_id(&connection).unwrap();
        let location = save_location(&connection, &user, &location_write()).unwrap();
        let entry = save_entry(
            &connection,
            &user,
            &EntryWrite {
                id: None,
                location_id: location.id.clone(),
                title: "五一成都".to_owned(),
                description: Some("青城山".to_owned()),
                started_at: "2026-05-01".to_owned(),
                ended_at: Some("2026-05-04".to_owned()),
                visit_type: "trip".to_owned(),
                rating: Some(5),
                favorite: true,
            },
        )
        .unwrap();
        connection.execute(
            "INSERT INTO photos VALUES(
               'photo-1','one.jpg','image','2026-05-02T12:00:00','2026-05-02T12:00:00',
               30.60,104.08,'completed',NULL
             )",
            [],
        ).unwrap();

        replace_entry_photos(&connection, &user, &entry.id, &["photo-1".to_owned()]).unwrap();
        let refreshed = get_entry(&connection, &user, &entry.id).unwrap().unwrap();
        assert_eq!(refreshed.photo_count, 1);
        assert_eq!(refreshed.cover_photo_id.as_deref(), Some("photo-1"));

        let summary = summary(&connection, &user).unwrap();
        assert_eq!(summary.province_count, 1);
        assert_eq!(summary.city_count, 1);
        assert_eq!(summary.entry_count, 1);
        assert_eq!(summary.photo_count, 1);

        assert!(delete_entry(&connection, &user, &entry.id).unwrap());
        let photo_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM photos WHERE id='photo-1'", [], |row| row.get(0))
            .unwrap();
        assert_eq!(photo_count, 1, "deleting an entry must never delete the photo");
        let link_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM footprint_entry_photos", [], |row| row.get(0))
            .unwrap();
        assert_eq!(link_count, 0);
    }

    #[test]
    fn photo_discoveries_cluster_unlinked_gps_photos() {
        let connection = connection();
        let user = active_profile_id(&connection).unwrap();
        let location = save_location(&connection, &user, &location_write()).unwrap();
        let entry = save_entry(
            &connection,
            &user,
            &EntryWrite {
                id: None,
                location_id: location.id,
                title: "已有成都足迹".to_owned(),
                description: None,
                started_at: "2026-05-01".to_owned(),
                ended_at: Some("2026-05-02".to_owned()),
                visit_type: "trip".to_owned(),
                rating: None,
                favorite: false,
            },
        )
        .unwrap();

        connection.execute_batch(
            r#"
            INSERT INTO photos VALUES(
              'a','a.jpg','image','2026-06-01T09:00:00','2026-06-01T09:00:00',
              30.57,104.06,'completed',NULL
            );
            INSERT INTO photos VALUES(
              'b','b.jpg','image','2026-06-02T09:00:00','2026-06-02T09:00:00',
              30.59,104.08,'completed',NULL
            );
            INSERT INTO photos VALUES(
              'linked','linked.jpg','image','2026-06-02T10:00:00','2026-06-02T10:00:00',
              30.58,104.07,'completed',NULL
            );
            INSERT INTO photos VALUES(
              'far','far.jpg','image','2026-06-02T11:00:00','2026-06-02T11:00:00',
              39.90,116.40,'completed',NULL
            );
            INSERT INTO photos VALUES(
              'nogps','nogps.jpg','image','2026-06-02T12:00:00','2026-06-02T12:00:00',
              NULL,NULL,'completed',NULL
            );
            "#,
        )
        .unwrap();
        replace_entry_photos(&connection, &user, &entry.id, &["linked".to_owned()]).unwrap();

        let discoveries = photo_discoveries(&connection, &user).unwrap();
        assert_eq!(discoveries.len(), 1);
        let discovery = &discoveries[0];
        assert_eq!(discovery.photo_count, 2);
        assert_eq!(discovery.started_at, "2026-06-01");
        assert_eq!(discovery.ended_at, "2026-06-02");
        assert_eq!(discovery.photo_ids, vec!["a".to_owned(), "b".to_owned()]);
        assert!(discovery.latitude > 30.57 && discovery.latitude < 30.59);
        assert!(discovery.longitude > 104.06 && discovery.longitude < 104.08);
    }

    #[test]
    fn photo_suggestions_prefer_date_and_nearby_gps() {
        let connection = connection();
        let user = active_profile_id(&connection).unwrap();
        let location = save_location(&connection, &user, &location_write()).unwrap();
        let entry = save_entry(
            &connection,
            &user,
            &EntryWrite {
                id: None,
                location_id: location.id,
                title: "成都".to_owned(),
                description: None,
                started_at: "2026-05-01".to_owned(),
                ended_at: Some("2026-05-04".to_owned()),
                visit_type: "trip".to_owned(),
                rating: None,
                favorite: false,
            },
        )
        .unwrap();
        connection.execute(
            "INSERT INTO photos VALUES(
              'near','near.jpg','image','2026-05-02T09:00:00','2026-05-02T09:00:00',
              30.58,104.07,'completed',NULL
            ),(
              'far','far.jpg','image','2026-05-02T09:00:00','2026-05-02T09:00:00',
              39.90,116.40,'completed',NULL
            ),(
              'outside','outside.jpg','image','2026-06-02T09:00:00','2026-06-02T09:00:00',
              30.58,104.07,'completed',NULL
            )",
            [],
        ).unwrap();

        let suggestions = photo_suggestions(&connection, &user, &entry.id).unwrap();
        assert_eq!(suggestions.len(), 2);
        assert_eq!(suggestions[0].photo.id, "near");
        assert_eq!(suggestions[0].score, 3);
        assert_eq!(suggestions[1].photo.id, "far");
        assert_eq!(suggestions[1].score, 1);
    }
}
