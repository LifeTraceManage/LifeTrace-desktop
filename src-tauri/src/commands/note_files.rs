use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

use reqwest::{redirect::Policy, Client, Method};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::State;
use tokio::fs;
use url::Url;
use uuid::Uuid;

use crate::sync::SyncDesktopState;

const MAX_NOTE_ATTACHMENT_BYTES: u64 = 256 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudNoteAttachment {
    pub id: String,
    pub domain: String,
    pub original_name: String,
    pub mime_type: String,
    pub size_bytes: i64,
    pub sha256: String,
    pub entity_type: Option<String>,
    pub entity_id: Option<String>,
    pub status: String,
    pub failure_reason: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub available_at: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FileList {
    items: Vec<CloudNoteAttachment>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SignedTransfer {
    url: String,
    required_headers: BTreeMap<String, String>,
    #[allow(dead_code)]
    expires_seconds: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PrepareResponse {
    file: CloudNoteAttachment,
    #[allow(dead_code)]
    deduplicated: bool,
    upload: Option<SignedTransfer>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadedAttachment {
    id: String,
    note_id: String,
    file_name: String,
    original_name: String,
    mime_type: String,
    file_size: i64,
    storage_path: String,
    created_at: String,
}

fn safe_segment(value: &str) -> Result<&str, String> {
    if value.is_empty()
        || value.len() > 180
        || value.contains(['/', '\\'])
        || value == "."
        || value == ".."
    {
        Err("笔记或文件标识无效".to_owned())
    } else {
        Ok(value)
    }
}

fn clean_file_name(value: &str) -> String {
    let clean = value
        .chars()
        .filter(|character| !character.is_control() && !matches!(character, '/' | '\\'))
        .take(120)
        .collect::<String>();
    if clean.trim().is_empty() {
        "attachment".to_owned()
    } else {
        clean
    }
}

async fn auth_context(state: &SyncDesktopState) -> Result<(String, String), String> {
    let auth = state.auth.read().await;
    let token = auth
        .access_token
        .clone()
        .ok_or_else(|| "请先登录 LifeTrace 云端".to_owned())?;
    if auth.origin.trim().is_empty() {
        return Err("云服务尚未配置".to_owned());
    }
    Ok((auth.origin.trim_end_matches('/').to_owned(), token))
}

fn api_url(origin: &str, path: &str) -> Result<Url, String> {
    let origin = Url::parse(origin).map_err(|_| "云服务地址格式无效".to_owned())?;
    if !matches!(origin.scheme(), "http" | "https") || origin.host_str().is_none() {
        return Err("云服务地址必须是 HTTP 或 HTTPS".to_owned());
    }
    origin.join(path).map_err(|_| "无法构造云文件地址".to_owned())
}

fn transfer_url(origin: &str, value: &str) -> Result<Url, String> {
    let url = match Url::parse(value) {
        Ok(url) => url,
        Err(url::ParseError::RelativeUrlWithoutBase) => api_url(origin, "/")?
            .join(value)
            .map_err(|_| "文件传输地址无效".to_owned())?,
        Err(_) => return Err("文件传输地址无效".to_owned()),
    };
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err("文件传输地址协议不受支持".to_owned());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("文件传输地址不能包含用户名或密码".to_owned());
    }
    Ok(url)
}

fn client() -> Result<Client, String> {
    Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(120))
        .redirect(Policy::none())
        .build()
        .map_err(|error| format!("无法初始化云文件客户端: {error}"))
}

fn response_error(status: u16, body: &str) -> String {
    let parsed = serde_json::from_str::<Value>(body).ok();
    parsed
        .as_ref()
        .and_then(|value| {
            value
                .get("message")
                .and_then(Value::as_str)
                .or_else(|| value.pointer("/error/message").and_then(Value::as_str))
        })
        .map(str::to_owned)
        .unwrap_or_else(|| format!("云文件请求失败 (HTTP {status})"))
}

async fn json_request<T: DeserializeOwned>(
    client: &Client,
    method: Method,
    url: Url,
    token: &str,
    body: Option<Value>,
) -> Result<T, String> {
    let mut request = client.request(method, url).bearer_auth(token);
    if let Some(body) = body {
        request = request.json(&body);
    }
    let response = request
        .send()
        .await
        .map_err(|error| format!("无法连接云文件服务: {error}"))?;
    let status = response.status();
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("读取云文件响应失败: {error}"))?;
    if !status.is_success() {
        return Err(response_error(
            status.as_u16(),
            &String::from_utf8_lossy(&bytes),
        ));
    }
    serde_json::from_slice(&bytes).map_err(|error| format!("云文件响应格式无效: {error}"))
}

async fn trusted_local_attachment(
    data_dir: &Path,
    note_id: &str,
    path: &str,
) -> Result<PathBuf, String> {
    let note_id = safe_segment(note_id)?;
    let root = data_dir.join("attachments").join(note_id);
    fs::create_dir_all(&root)
        .await
        .map_err(|error| format!("无法准备附件目录: {error}"))?;
    let root = fs::canonicalize(&root)
        .await
        .map_err(|error| format!("无法校验附件目录: {error}"))?;
    let path = fs::canonicalize(PathBuf::from(path))
        .await
        .map_err(|_| "附件文件不存在".to_owned())?;
    if !path.starts_with(&root) {
        return Err("只允许上传当前笔记已导入到 LifeTrace 的附件".to_owned());
    }
    Ok(path)
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hash = Sha256::new();
    hash.update(bytes);
    format!("{:x}", hash.finalize())
}

#[tauri::command]
pub async fn note_cloud_list_attachments(
    state: State<'_, SyncDesktopState>,
    note_id: String,
) -> Result<Vec<CloudNoteAttachment>, String> {
    safe_segment(&note_id)?;
    let (origin, token) = auth_context(&state).await?;
    let client = client()?;
    let mut url = api_url(&origin, "/api/v1/files")?;
    url.query_pairs_mut()
        .append_pair("domain", "notes_attachments")
        .append_pair("entityType", "note.note")
        .append_pair("entityId", &note_id)
        .append_pair("limit", "100");
    let response: FileList = json_request(&client, Method::GET, url, &token, None).await?;
    Ok(response.items)
}

#[tauri::command]
pub async fn note_cloud_upload_attachment(
    state: State<'_, SyncDesktopState>,
    note_id: String,
    local_path: String,
) -> Result<CloudNoteAttachment, String> {
    let path = trusted_local_attachment(&state.data_dir, &note_id, &local_path).await?;
    let metadata = fs::metadata(&path)
        .await
        .map_err(|error| format!("无法读取附件信息: {error}"))?;
    if metadata.len() == 0 || metadata.len() > MAX_NOTE_ATTACHMENT_BYTES {
        return Err(format!(
            "附件大小必须在 1..={} MB",
            MAX_NOTE_ATTACHMENT_BYTES / 1024 / 1024
        ));
    }
    let bytes = fs::read(&path)
        .await
        .map_err(|error| format!("无法读取附件: {error}"))?;
    let original_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .map(clean_file_name)
        .ok_or_else(|| "附件名称无效".to_owned())?;
    // Local copies are prefixed with a UUID. Keep the display name from the
    // copy metadata when possible by stripping only our generated prefix.
    let original_name = if original_name.len() > 37
        && original_name.as_bytes().get(36) == Some(&b'-')
        && Uuid::parse_str(&original_name[..36]).is_ok()
    {
        original_name[37..].to_owned()
    } else {
        original_name
    };
    let mime_type = mime_guess::from_path(&path)
        .first_or_octet_stream()
        .essence_str()
        .to_owned();
    let checksum = sha256_hex(&bytes);

    let (origin, token) = auth_context(&state).await?;
    let client = client()?;
    let prepare: PrepareResponse = json_request(
        &client,
        Method::POST,
        api_url(&origin, "/api/v1/files")?,
        &token,
        Some(json!({
            "domain":"notes_attachments",
            "originalName":original_name,
            "mimeType":mime_type,
            "sizeBytes":metadata.len(),
            "sha256":checksum,
            "entityType":"note.note",
            "entityId":note_id,
        })),
    )
    .await?;

    if prepare.file.status == "available" {
        return Ok(prepare.file);
    }
    let upload = prepare
        .upload
        .ok_or_else(|| "云文件服务未返回上传地址".to_owned())?;
    let upload_url = transfer_url(&origin, &upload.url)?;
    let mut request = client.put(upload_url).body(bytes);
    let has_content_type = upload
        .required_headers
        .keys()
        .any(|key| key.eq_ignore_ascii_case("content-type"));
    for (name, value) in upload.required_headers {
        request = request.header(name, value);
    }
    if !has_content_type {
        request = request.header(reqwest::header::CONTENT_TYPE, mime_type);
    }
    let uploaded = request
        .send()
        .await
        .map_err(|error| format!("上传附件到对象存储失败: {error}"))?;
    if !uploaded.status().is_success() {
        let reason = format!("object upload failed ({})", uploaded.status().as_u16());
        let _ = json_request::<CloudNoteAttachment>(
            &client,
            Method::POST,
            api_url(&origin, &format!("/api/v1/files/{}/fail", prepare.file.id))?,
            &token,
            Some(json!({"reason":reason})),
        )
        .await;
        return Err(format!("附件上传失败 (HTTP {})", uploaded.status().as_u16()));
    }

    json_request(
        &client,
        Method::POST,
        api_url(
            &origin,
            &format!("/api/v1/files/{}/complete", prepare.file.id),
        )?,
        &token,
        Some(json!({})),
    )
    .await
}

#[tauri::command]
pub async fn note_cloud_download_attachment(
    state: State<'_, SyncDesktopState>,
    note_id: String,
    file_id: String,
) -> Result<DownloadedAttachment, String> {
    let note_id = safe_segment(&note_id)?.to_owned();
    let file_id = safe_segment(&file_id)?.to_owned();
    let (origin, token) = auth_context(&state).await?;
    let client = client()?;
    let file: CloudNoteAttachment = json_request(
        &client,
        Method::GET,
        api_url(&origin, &format!("/api/v1/files/{file_id}"))?,
        &token,
        None,
    )
    .await?;
    if file.domain != "notes_attachments"
        || file.entity_type.as_deref() != Some("note.note")
        || file.entity_id.as_deref() != Some(note_id.as_str())
    {
        return Err("云文件不属于当前笔记".to_owned());
    }
    if file.status != "available" {
        return Err("云附件尚未完成上传".to_owned());
    }
    let signed: SignedTransfer = json_request(
        &client,
        Method::POST,
        api_url(&origin, &format!("/api/v1/files/{file_id}/download-url"))?,
        &token,
        Some(json!({})),
    )
    .await?;
    let download_url = transfer_url(&origin, &signed.url)?;
    let response = client
        .get(download_url)
        .send()
        .await
        .map_err(|error| format!("下载云附件失败: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("下载云附件失败 (HTTP {})", response.status().as_u16()));
    }
    if response
        .content_length()
        .is_some_and(|size| size > MAX_NOTE_ATTACHMENT_BYTES)
    {
        return Err("云附件超过 Desktop 安全大小上限".to_owned());
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("读取云附件失败: {error}"))?;
    if bytes.len() as u64 > MAX_NOTE_ATTACHMENT_BYTES {
        return Err("云附件超过 Desktop 安全大小上限".to_owned());
    }

    let folder = state.data_dir.join("attachments").join(&note_id);
    fs::create_dir_all(&folder)
        .await
        .map_err(|error| format!("无法创建附件目录: {error}"))?;
    let clean_name = clean_file_name(&file.original_name);
    let file_name = format!("cloud-{}-{clean_name}", file.id);
    let destination = folder.join(&file_name);
    fs::write(&destination, &bytes)
        .await
        .map_err(|error| format!("无法保存云附件: {error}"))?;

    Ok(DownloadedAttachment {
        id: file.id,
        note_id,
        file_name,
        original_name: file.original_name,
        mime_type: file.mime_type,
        file_size: i64::try_from(bytes.len()).unwrap_or(i64::MAX),
        storage_path: destination.display().to_string(),
        created_at: file.created_at,
    })
}

#[tauri::command]
pub async fn note_cloud_delete_attachment(
    state: State<'_, SyncDesktopState>,
    file_id: String,
) -> Result<Value, String> {
    let file_id = safe_segment(&file_id)?;
    let (origin, token) = auth_context(&state).await?;
    let client = client()?;
    json_request(
        &client,
        Method::DELETE,
        api_url(&origin, &format!("/api/v1/files/{file_id}"))?,
        &token,
        None,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_names_are_sanitized() {
        assert_eq!(clean_file_name("a/b\\c.txt"), "abc.txt");
        assert_eq!(clean_file_name(""), "attachment");
    }

    #[test]
    fn transfer_url_accepts_only_http_and_https() {
        assert!(transfer_url("https://life.example", "https://objects.example/file").is_ok());
        assert!(transfer_url("https://life.example", "/signed/file").is_ok());
        assert!(transfer_url("https://life.example", "file:///tmp/secret").is_err());
    }

    #[test]
    fn safe_segment_rejects_path_traversal() {
        assert!(safe_segment("../secret").is_err());
        assert!(safe_segment("note-1").is_ok());
    }
}
