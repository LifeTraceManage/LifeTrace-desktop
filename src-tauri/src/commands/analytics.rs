use serde_json::Value;
use tauri::State;

use crate::{application, database, desktop::DesktopState};

fn join_error(error: impl std::fmt::Display) -> String {
    format!("本机分析任务异常结束: {error}")
}

#[tauri::command]
pub async fn analytics_query(
    state: State<'_, DesktopState>,
    request: Value,
) -> Result<Value, String> {
    let data_dir = state.data_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut connection = database::connection::open(&data_dir.join("lifetrace.db"))
            .map_err(|error| format!("无法打开本机数据库: {error}"))?;
        application::analytics::query(&mut connection, &request)
    })
    .await
    .map_err(join_error)?
}
