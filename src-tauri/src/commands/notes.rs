use serde_json::Value;
use tauri::State;

use crate::{application, database, desktop::DesktopState, sync::SyncDesktopState};

fn open_connection(state: &DesktopState) -> Result<rusqlite::Connection, String> {
    database::connection::open(&state.data_dir.join("lifetrace.db"))
        .map_err(|error| format!("无法打开本机数据库: {error}"))
}

#[tauri::command]
pub fn notes_query(
    state: State<'_, DesktopState>,
    request: Value,
) -> Result<Value, String> {
    let connection = open_connection(&state)?;
    application::notes::query(&connection, &request)
}

#[tauri::command]
pub fn notes_mutate(
    state: State<'_, DesktopState>,
    sync_state: State<'_, SyncDesktopState>,
    request: Value,
) -> Result<Value, String> {
    let mut connection = open_connection(&state)?;
    let result = application::notes::mutate(&mut connection, &state.data_dir, &request)?;
    sync_state.signal_local_change();
    Ok(result)
}
