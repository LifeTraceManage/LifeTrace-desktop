use axum::{
    body::{to_bytes, Body},
    http::{header::CONTENT_TYPE, Method, Request},
};
use serde::{Deserialize, Serialize};
use tauri::State;
use tower::ServiceExt;

use crate::{desktop::DesktopState, server, sync::SyncDesktopState};

const MAX_RESPONSE_BYTES: usize = 8 * 1024 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalJsonApiRequest {
    path: String,
    query: Option<String>,
    method: String,
    body: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalJsonApiResponse {
    status: u16,
    body: String,
    content_type: Option<String>,
}

fn allowed_path(path: &str) -> bool {
    path.starts_with("/api/footprints/")
        || path == "/api/photo-sync/dashboard"
        || path == "/api/xunji/imports"
}

#[tauri::command]
pub async fn local_json_api_request(
    state: State<'_, DesktopState>,
    sync_state: State<'_, SyncDesktopState>,
    request: LocalJsonApiRequest,
) -> Result<LocalJsonApiResponse, String> {
    if !allowed_path(&request.path) {
        return Err("本机 JSON IPC 路径不在允许列表".to_owned());
    }

    let method = Method::from_bytes(request.method.as_bytes())
        .map_err(|_| "本机 JSON IPC 请求方法无效".to_owned())?;
    if !matches!(
        method,
        Method::GET | Method::POST | Method::PUT | Method::PATCH | Method::DELETE
    ) {
        return Err("本机 JSON IPC 不允许该请求方法".to_owned());
    }

    let uri = match request.query.as_deref().filter(|value| !value.is_empty()) {
        Some(query) => format!("{}?{}", request.path, query),
        None => request.path.clone(),
    };
    let mut builder = Request::builder().method(method.clone()).uri(uri);
    if request.body.is_some() {
        builder = builder.header(CONTENT_TYPE, "application/json");
    }
    let http_request = builder
        .body(Body::from(request.body.unwrap_or_default()))
        .map_err(|error| format!("无法构造本机 JSON IPC 请求: {error}"))?;

    let response = server::local_json_ipc_router(
        state.data_dir.clone(),
        state.photo_runtime.clone(),
    )?
    .oneshot(http_request)
    .await
    .map_err(|error| format!("本机 JSON IPC 路由失败: {error}"))?;

    let status = response.status();
    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    let body = to_bytes(response.into_body(), MAX_RESPONSE_BYTES)
        .await
        .map_err(|error| format!("读取本机 JSON IPC 响应失败: {error}"))?;

    if matches!(method, Method::POST | Method::PUT | Method::PATCH | Method::DELETE)
        && status.is_success()
    {
        sync_state.signal_local_change();
    }

    Ok(LocalJsonApiResponse {
        status: status.as_u16(),
        body: String::from_utf8_lossy(&body).into_owned(),
        content_type,
    })
}
