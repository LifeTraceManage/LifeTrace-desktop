use chrono::{DateTime, NaiveDate};
use rusqlite::Connection;
use serde::Deserialize;

use crate::{
    database::{
        profile,
        repositories::{
            execution as task_repository,
            execution_cloud::{
                self as repository, FocusSessionRecord, FocusSessionWrite, ImportantDateRecord,
                ImportantDateWrite,
            },
        },
    },
    execution::{ExecutionError, ExecutionErrorKind, ExecutionResult},
};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportantDateInput {
    pub title: String,
    pub date: String,
    pub repeat: String,
    pub kind: String,
    pub calendar: String,
    pub lunar_year: Option<i64>,
    pub lunar_month: Option<i64>,
    pub lunar_day: Option<i64>,
    #[serde(default)]
    pub lunar_leap_month: bool,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusSessionInput {
    pub task_id: Option<String>,
    pub mode: String,
    pub started_at: String,
    pub ended_at: String,
    pub focus_seconds: i64,
    #[serde(default)]
    pub completed: bool,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FocusSessionQuery {
    pub task_id: Option<String>,
}

fn default_true() -> bool {
    true
}

fn error(kind: ExecutionErrorKind, message: impl Into<String>) -> ExecutionError {
    ExecutionError {
        kind,
        message: message.into(),
    }
}

fn validation(message: impl Into<String>) -> ExecutionError {
    error(ExecutionErrorKind::Validation, message)
}

fn not_found(message: impl Into<String>) -> ExecutionError {
    error(ExecutionErrorKind::NotFound, message)
}

fn storage(message: impl Into<String>) -> ExecutionError {
    error(ExecutionErrorKind::Storage, message)
}

fn active_user(connection: &Connection) -> ExecutionResult<String> {
    profile::active_profile_id(connection).map_err(storage)
}

fn clean_required(value: &str, label: &str, max: usize) -> ExecutionResult<String> {
    let value = value.trim();
    if value.is_empty() {
        return Err(validation(format!("{label}不能为空")));
    }
    if value.chars().count() > max {
        return Err(validation(format!("{label}不能超过 {max} 个字符")));
    }
    Ok(value.to_owned())
}

fn clean_optional(value: Option<String>, label: &str, max: usize) -> ExecutionResult<Option<String>> {
    let Some(value) = value else {
        return Ok(None);
    };
    let value = value.trim();
    if value.is_empty() {
        return Ok(None);
    }
    if value.chars().count() > max {
        return Err(validation(format!("{label}不能超过 {max} 个字符")));
    }
    Ok(Some(value.to_owned()))
}

fn normalize_important_date(
    user_id: String,
    id: Option<String>,
    input: ImportantDateInput,
) -> ExecutionResult<ImportantDateWrite> {
    let title = clean_required(&input.title, "重要日期标题", 240)?;
    let date = input.date.trim().to_owned();
    NaiveDate::parse_from_str(&date, "%Y-%m-%d")
        .map_err(|_| validation("重要日期必须是 YYYY-MM-DD"))?;

    if !matches!(input.repeat.as_str(), "once" | "yearly") {
        return Err(validation("repeat 必须是 once 或 yearly"));
    }
    if !matches!(
        input.kind.as_str(),
        "birthday" | "anniversary" | "milestone" | "other"
    ) {
        return Err(validation(
            "kind 必须是 birthday、anniversary、milestone 或 other",
        ));
    }
    if !matches!(input.calendar.as_str(), "solar" | "lunar") {
        return Err(validation("calendar 必须是 solar 或 lunar"));
    }

    if input.calendar == "solar" {
        if input.lunar_year.is_some()
            || input.lunar_month.is_some()
            || input.lunar_day.is_some()
            || input.lunar_leap_month
        {
            return Err(validation("公历日期不能包含农历字段"));
        }
    } else {
        let month = input
            .lunar_month
            .ok_or_else(|| validation("农历日期必须提供 lunarMonth"))?;
        let day = input
            .lunar_day
            .ok_or_else(|| validation("农历日期必须提供 lunarDay"))?;
        if !(1..=12).contains(&month) {
            return Err(validation("lunarMonth 必须位于 1..=12"));
        }
        if !(1..=30).contains(&day) {
            return Err(validation("lunarDay 必须位于 1..=30"));
        }
        if input.repeat == "once" && input.lunar_year.is_none() {
            return Err(validation("一次性农历日期必须提供 lunarYear"));
        }
        if let Some(year) = input.lunar_year {
            if !(1900..=2199).contains(&year) {
                return Err(validation("lunarYear 必须位于 1900..=2199"));
            }
        }
    }

    Ok(ImportantDateWrite {
        id,
        user_id,
        title,
        date,
        repeat: input.repeat,
        kind: input.kind,
        calendar: input.calendar,
        lunar_year: input.lunar_year,
        lunar_month: input.lunar_month,
        lunar_day: input.lunar_day,
        lunar_leap_month: input.lunar_leap_month,
        enabled: input.enabled,
    })
}

fn normalize_focus_session(
    connection: &Connection,
    user_id: String,
    id: Option<String>,
    input: FocusSessionInput,
) -> ExecutionResult<FocusSessionWrite> {
    if !matches!(input.mode.as_str(), "short" | "long") {
        return Err(validation("专注模式必须是 short 或 long"));
    }
    let started = DateTime::parse_from_rfc3339(&input.started_at)
        .map_err(|_| validation("startedAt 必须是 RFC3339 时间"))?;
    let ended = DateTime::parse_from_rfc3339(&input.ended_at)
        .map_err(|_| validation("endedAt 必须是 RFC3339 时间"))?;
    if ended < started {
        return Err(validation("endedAt 不能早于 startedAt"));
    }
    if input.focus_seconds < 0 {
        return Err(validation("focusSeconds 不能为负数"));
    }

    let task_id = clean_optional(input.task_id, "任务 ID", 128)?;
    if let Some(task_id) = task_id.as_deref() {
        let task = task_repository::get_task(connection, &user_id, task_id).map_err(storage)?;
        if task.is_none() {
            return Err(validation("关联任务不存在或不属于当前资料"));
        }
    }

    Ok(FocusSessionWrite {
        id,
        user_id,
        task_id,
        mode: input.mode,
        started_at: started.to_rfc3339(),
        ended_at: ended.to_rfc3339(),
        focus_seconds: input.focus_seconds,
        completed: input.completed,
    })
}

pub fn list_important_dates(connection: &Connection) -> ExecutionResult<Vec<ImportantDateRecord>> {
    let user_id = active_user(connection)?;
    repository::list_important_dates(connection, &user_id).map_err(storage)
}

pub fn get_important_date(
    connection: &Connection,
    id: &str,
) -> ExecutionResult<ImportantDateRecord> {
    let user_id = active_user(connection)?;
    repository::get_important_date(connection, &user_id, id)
        .map_err(storage)?
        .ok_or_else(|| not_found("重要日期不存在"))
}

pub fn create_important_date(
    connection: &Connection,
    input: ImportantDateInput,
) -> ExecutionResult<ImportantDateRecord> {
    let user_id = active_user(connection)?;
    let write = normalize_important_date(user_id, None, input)?;
    repository::save_important_date(connection, &write).map_err(storage)
}

pub fn update_important_date(
    connection: &Connection,
    id: &str,
    input: ImportantDateInput,
) -> ExecutionResult<ImportantDateRecord> {
    let user_id = active_user(connection)?;
    if repository::get_important_date(connection, &user_id, id)
        .map_err(storage)?
        .is_none()
    {
        return Err(not_found("重要日期不存在"));
    }
    let write = normalize_important_date(user_id, Some(id.to_owned()), input)?;
    repository::save_important_date(connection, &write).map_err(storage)
}

pub fn delete_important_date(connection: &Connection, id: &str) -> ExecutionResult<()> {
    let user_id = active_user(connection)?;
    if repository::delete_important_date(connection, &user_id, id).map_err(storage)? {
        Ok(())
    } else {
        Err(not_found("重要日期不存在"))
    }
}

pub fn list_focus_sessions(
    connection: &Connection,
    query: FocusSessionQuery,
) -> ExecutionResult<Vec<FocusSessionRecord>> {
    let user_id = active_user(connection)?;
    let task_id = clean_optional(query.task_id, "任务 ID", 128)?;
    repository::list_focus_sessions(connection, &user_id, task_id.as_deref()).map_err(storage)
}

pub fn get_focus_session(
    connection: &Connection,
    id: &str,
) -> ExecutionResult<FocusSessionRecord> {
    let user_id = active_user(connection)?;
    repository::get_focus_session(connection, &user_id, id)
        .map_err(storage)?
        .ok_or_else(|| not_found("专注记录不存在"))
}

pub fn create_focus_session(
    connection: &Connection,
    input: FocusSessionInput,
) -> ExecutionResult<FocusSessionRecord> {
    let user_id = active_user(connection)?;
    let write = normalize_focus_session(connection, user_id, None, input)?;
    repository::save_focus_session(connection, &write).map_err(storage)
}

pub fn update_focus_session(
    connection: &Connection,
    id: &str,
    input: FocusSessionInput,
) -> ExecutionResult<FocusSessionRecord> {
    let user_id = active_user(connection)?;
    if repository::get_focus_session(connection, &user_id, id)
        .map_err(storage)?
        .is_none()
    {
        return Err(not_found("专注记录不存在"));
    }
    let write = normalize_focus_session(connection, user_id, Some(id.to_owned()), input)?;
    repository::save_focus_session(connection, &write).map_err(storage)
}

pub fn delete_focus_session(connection: &Connection, id: &str) -> ExecutionResult<()> {
    let user_id = active_user(connection)?;
    if repository::delete_focus_session(connection, &user_id, id).map_err(storage)? {
        Ok(())
    } else {
        Err(not_found("专注记录不存在"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::migration_runner::{run, MigrationContext};
    use crate::database::migrations::all;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn database() -> Connection {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let data_dir = std::env::temp_dir().join(format!("lifetrace-execution-cloud-{unique}"));
        std::fs::create_dir_all(&data_dir).unwrap();
        let mut connection = Connection::open_in_memory().unwrap();
        connection.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        run(&mut connection, &MigrationContext::new(data_dir), &all()).unwrap();
        connection
    }

    #[test]
    fn important_date_validation_matches_cloud_contract() {
        let connection = database();
        let item = create_important_date(
            &connection,
            ImportantDateInput {
                title: "Birthday".to_owned(),
                date: "2026-10-15".to_owned(),
                repeat: "yearly".to_owned(),
                kind: "birthday".to_owned(),
                calendar: "solar".to_owned(),
                lunar_year: None,
                lunar_month: None,
                lunar_day: None,
                lunar_leap_month: false,
                enabled: true,
            },
        )
        .unwrap();
        assert_eq!(item.repeat, "yearly");

        let invalid = create_important_date(
            &connection,
            ImportantDateInput {
                title: "Invalid lunar".to_owned(),
                date: "2026-10-15".to_owned(),
                repeat: "once".to_owned(),
                kind: "other".to_owned(),
                calendar: "lunar".to_owned(),
                lunar_year: None,
                lunar_month: Some(8),
                lunar_day: Some(15),
                lunar_leap_month: false,
                enabled: true,
            },
        )
        .unwrap_err();
        assert_eq!(invalid.kind, ExecutionErrorKind::Validation);
    }
}
