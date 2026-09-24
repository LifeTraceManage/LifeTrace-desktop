use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::Serialize;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImportantDateRecord {
    pub id: String,
    pub user_id: String,
    pub title: String,
    pub date: String,
    pub repeat: String,
    pub kind: String,
    pub calendar: String,
    pub lunar_year: Option<i64>,
    pub lunar_month: Option<i64>,
    pub lunar_day: Option<i64>,
    pub lunar_leap_month: bool,
    pub enabled: bool,
    pub version: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone)]
pub struct ImportantDateWrite {
    pub id: Option<String>,
    pub user_id: String,
    pub title: String,
    pub date: String,
    pub repeat: String,
    pub kind: String,
    pub calendar: String,
    pub lunar_year: Option<i64>,
    pub lunar_month: Option<i64>,
    pub lunar_day: Option<i64>,
    pub lunar_leap_month: bool,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FocusSessionRecord {
    pub id: String,
    pub user_id: String,
    pub task_id: Option<String>,
    pub mode: String,
    pub started_at: String,
    pub ended_at: String,
    pub focus_seconds: i64,
    pub completed: bool,
    pub version: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone)]
pub struct FocusSessionWrite {
    pub id: Option<String>,
    pub user_id: String,
    pub task_id: Option<String>,
    pub mode: String,
    pub started_at: String,
    pub ended_at: String,
    pub focus_seconds: i64,
    pub completed: bool,
}

fn now() -> String {
    Utc::now().to_rfc3339()
}

fn important_date_from_row(row: &Row<'_>) -> rusqlite::Result<ImportantDateRecord> {
    Ok(ImportantDateRecord {
        id: row.get(0)?,
        user_id: row.get(1)?,
        title: row.get(2)?,
        date: row.get(3)?,
        repeat: row.get(4)?,
        kind: row.get(5)?,
        calendar: row.get(6)?,
        lunar_year: row.get(7)?,
        lunar_month: row.get(8)?,
        lunar_day: row.get(9)?,
        lunar_leap_month: row.get(10)?,
        enabled: row.get(11)?,
        version: row.get(12)?,
        created_at: row.get(13)?,
        updated_at: row.get(14)?,
    })
}

fn focus_session_from_row(row: &Row<'_>) -> rusqlite::Result<FocusSessionRecord> {
    Ok(FocusSessionRecord {
        id: row.get(0)?,
        user_id: row.get(1)?,
        task_id: row.get(2)?,
        mode: row.get(3)?,
        started_at: row.get(4)?,
        ended_at: row.get(5)?,
        focus_seconds: row.get(6)?,
        completed: row.get(7)?,
        version: row.get(8)?,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
    })
}

const IMPORTANT_DATE_COLUMNS: &str =
    "id,user_id,title,date,repeat,kind,calendar,lunar_year,lunar_month,lunar_day,lunar_leap_month,enabled,version,created_at,updated_at";
const FOCUS_SESSION_COLUMNS: &str =
    "id,user_id,task_id,mode,started_at,ended_at,focus_seconds,completed,version,created_at,updated_at";

pub fn list_important_dates(
    connection: &Connection,
    user_id: &str,
) -> Result<Vec<ImportantDateRecord>, String> {
    let sql = format!(
        "SELECT {IMPORTANT_DATE_COLUMNS} FROM execution_important_dates
         WHERE user_id=?1 ORDER BY enabled DESC,date ASC,title ASC"
    );
    let mut statement = connection.prepare(&sql).map_err(|error| error.to_string())?;
    statement
        .query_map([user_id], important_date_from_row)
        .map_err(|error| error.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|error| error.to_string())
}

pub fn get_important_date(
    connection: &Connection,
    user_id: &str,
    id: &str,
) -> Result<Option<ImportantDateRecord>, String> {
    let sql = format!(
        "SELECT {IMPORTANT_DATE_COLUMNS} FROM execution_important_dates
         WHERE id=?1 AND user_id=?2"
    );
    connection
        .query_row(&sql, params![id, user_id], important_date_from_row)
        .optional()
        .map_err(|error| error.to_string())
}

pub fn save_important_date(
    connection: &Connection,
    input: &ImportantDateWrite,
) -> Result<ImportantDateRecord, String> {
    let id = input.id.clone().unwrap_or_else(|| Uuid::new_v4().to_string());
    let stamp = now();
    if get_important_date(connection, &input.user_id, &id)?.is_some() {
        connection.execute(
            "UPDATE execution_important_dates
             SET title=?1,date=?2,repeat=?3,kind=?4,calendar=?5,lunar_year=?6,lunar_month=?7,
                 lunar_day=?8,lunar_leap_month=?9,enabled=?10,updated_at=?11,version=version+1
             WHERE id=?12 AND user_id=?13",
            params![
                input.title,input.date,input.repeat,input.kind,input.calendar,input.lunar_year,
                input.lunar_month,input.lunar_day,input.lunar_leap_month,input.enabled,stamp,id,input.user_id
            ],
        ).map_err(|error| error.to_string())?;
    } else {
        connection.execute(
            "INSERT INTO execution_important_dates(
               id,user_id,title,date,repeat,kind,calendar,lunar_year,lunar_month,lunar_day,
               lunar_leap_month,enabled,created_at,updated_at,version
             ) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?13,1)",
            params![
                id,input.user_id,input.title,input.date,input.repeat,input.kind,input.calendar,
                input.lunar_year,input.lunar_month,input.lunar_day,input.lunar_leap_month,input.enabled,stamp
            ],
        ).map_err(|error| error.to_string())?;
    }
    get_important_date(connection, &input.user_id, &id)?
        .ok_or_else(|| "重要日期保存后读取失败".to_owned())
}

pub fn delete_important_date(
    connection: &Connection,
    user_id: &str,
    id: &str,
) -> Result<bool, String> {
    connection
        .execute(
            "DELETE FROM execution_important_dates WHERE id=?1 AND user_id=?2",
            params![id,user_id],
        )
        .map(|changed| changed == 1)
        .map_err(|error| error.to_string())
}

pub fn list_focus_sessions(
    connection: &Connection,
    user_id: &str,
    task_id: Option<&str>,
) -> Result<Vec<FocusSessionRecord>, String> {
    let sql = format!(
        "SELECT {FOCUS_SESSION_COLUMNS} FROM execution_focus_sessions
         WHERE user_id=?1 AND (?2 IS NULL OR task_id=?2)
         ORDER BY started_at DESC,id DESC"
    );
    let mut statement = connection.prepare(&sql).map_err(|error| error.to_string())?;
    statement
        .query_map(params![user_id,task_id], focus_session_from_row)
        .map_err(|error| error.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|error| error.to_string())
}

pub fn get_focus_session(
    connection: &Connection,
    user_id: &str,
    id: &str,
) -> Result<Option<FocusSessionRecord>, String> {
    let sql = format!(
        "SELECT {FOCUS_SESSION_COLUMNS} FROM execution_focus_sessions
         WHERE id=?1 AND user_id=?2"
    );
    connection
        .query_row(&sql, params![id,user_id], focus_session_from_row)
        .optional()
        .map_err(|error| error.to_string())
}

pub fn save_focus_session(
    connection: &Connection,
    input: &FocusSessionWrite,
) -> Result<FocusSessionRecord, String> {
    let id = input.id.clone().unwrap_or_else(|| Uuid::new_v4().to_string());
    let stamp = now();
    if get_focus_session(connection, &input.user_id, &id)?.is_some() {
        connection.execute(
            "UPDATE execution_focus_sessions
             SET task_id=?1,mode=?2,started_at=?3,ended_at=?4,focus_seconds=?5,completed=?6,
                 updated_at=?7,version=version+1
             WHERE id=?8 AND user_id=?9",
            params![
                input.task_id,input.mode,input.started_at,input.ended_at,input.focus_seconds,
                input.completed,stamp,id,input.user_id
            ],
        ).map_err(|error| error.to_string())?;
    } else {
        connection.execute(
            "INSERT INTO execution_focus_sessions(
               id,user_id,task_id,mode,started_at,ended_at,focus_seconds,completed,
               created_at,updated_at,version
             ) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?9,1)",
            params![
                id,input.user_id,input.task_id,input.mode,input.started_at,input.ended_at,
                input.focus_seconds,input.completed,stamp
            ],
        ).map_err(|error| error.to_string())?;
    }
    get_focus_session(connection, &input.user_id, &id)?
        .ok_or_else(|| "专注记录保存后读取失败".to_owned())
}

pub fn delete_focus_session(
    connection: &Connection,
    user_id: &str,
    id: &str,
) -> Result<bool, String> {
    connection
        .execute(
            "DELETE FROM execution_focus_sessions WHERE id=?1 AND user_id=?2",
            params![id,user_id],
        )
        .map(|changed| changed == 1)
        .map_err(|error| error.to_string())
}
