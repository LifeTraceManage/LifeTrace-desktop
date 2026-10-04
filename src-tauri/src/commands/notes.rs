use serde_json::Value;
use tauri::State;

use crate::{application, database, desktop::DesktopState, sync::SyncDesktopState};

fn open_connection(data_dir: &std::path::Path) -> Result<rusqlite::Connection, String> {
    database::connection::open(&data_dir.join("lifetrace.db"))
        .map_err(|error| format!("无法打开本机数据库: {error}"))
}

fn join_error(error: impl std::fmt::Display) -> String {
    format!("本机数据库任务异常结束: {error}")
}

#[tauri::command]
pub async fn notes_query(
    state: State<'_, DesktopState>,
    request: Value,
) -> Result<Value, String> {
    let data_dir = state.data_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let connection = open_connection(&data_dir)?;
        application::notes::query(&connection, &request)
    })
    .await
    .map_err(join_error)?
}

#[tauri::command]
pub async fn notes_mutate(
    state: State<'_, DesktopState>,
    sync_state: State<'_, SyncDesktopState>,
    request: Value,
) -> Result<Value, String> {
    let data_dir = state.data_dir.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let mut connection = open_connection(&data_dir)?;
        application::notes::mutate(&mut connection, &data_dir, &request)
    })
    .await
    .map_err(join_error)??;
    sync_state.signal_local_change();
    Ok(result)
}
