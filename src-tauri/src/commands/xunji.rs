use serde_json::Value;
use tauri::{
    ipc::{InvokeBody, Request},
    State,
};

use crate::{desktop::DesktopState, server, sync::SyncDesktopState};

#[tauri::command]
pub async fn xunji_parse_image(
    state: State<'_, DesktopState>,
    sync_state: State<'_, SyncDesktopState>,
    request: Request<'_>,
) -> Result<Value, String> {
    let image = match request.body() {
        InvokeBody::Raw(bytes) => bytes.clone(),
        _ => return Err("训记图片必须通过 raw IPC 发送".to_owned()),
    };
    drop(request);

    let result = server::xunji::parse_image_bytes(state.data_dir.clone(), image)
        .await
        .map_err(|error| error.to_string())?;
    sync_state.signal_local_change();
    Ok(result)
}
