use std::time::Duration;

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use reqwest::header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE};
use reqwest::{redirect::Policy, Method};
use serde::{Deserialize, Serialize};
use url::Url;

const CREDENTIAL_TARGET: &str = "LifeTrace/cloud/lifetrace-desktop/refresh-token";
const MAX_AUTH_RESPONSE_BYTES: usize = 1024 * 1024;
const MAX_API_RESPONSE_BYTES: usize = 4 * 1024 * 1024;
const MAX_ATTACHMENT_RESPONSE_BYTES: usize = 24 * 1024 * 1024;
const MAX_JSON_REQUEST_BYTES: usize = 2 * 1024 * 1024;
const MAX_BINARY_REQUEST_BYTES: usize = 20 * 1024 * 1024;
const MAX_QUERY_BYTES: usize = 16 * 1024;

const AUTH_PATHS: &[&str] = &[
    "/api/v1/auth/capabilities",
    "/api/v1/auth/login",
    "/api/v1/auth/register",
    "/api/v1/auth/password/forgot",
    "/api/v1/auth/password/change",
    "/api/v1/auth/refresh",
    "/api/v1/auth/logout",
    "/api/v1/auth/logout-all",
    "/api/v1/auth/me",
    "/api/v1/auth/sessions",
    "/api/v1/auth/devices",
    "/api/v1/auth/apps",
];

const API_PREFIXES: &[&str] = &[
    "/api/v1/auth/",
    "/api/v1/mail/",
    "/api/v1/sync/",
    "/api/v1/files/",
    "/api/v1/photo/",
    "/api/v1/assistant/",
    "/api/v1/privacy/",
    "/api/v1/meta/",
    "/api/v1/beecount/",
];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudAuthHttpRequest {
    origin: String,
    path: String,
    query: Option<String>,
    method: String,
    body: Option<String>,
    body_base64: Option<String>,
    content_type: Option<String>,
    authorization: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudAuthHttpResponse {
    status: u16,
    body_base64: String,
    content_type: Option<String>,
}

fn allowed_api_path(path: &str) -> bool {
    path == "/api/v1/auth/capabilities"
        || path == "/api/v1/meta"
        || API_PREFIXES.iter().any(|prefix| path.starts_with(prefix))
}

fn cloud_url(origin: &str, path: &str, query: Option<&str>) -> Result<Url, String> {
    let mut url = Url::parse(origin.trim()).map_err(|_| "云服务地址格式无效".to_owned())?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err("云服务地址必须是有效的 HTTP 或 HTTPS 地址".to_owned());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("云服务地址不能包含用户名或密码".to_owned());
    }
    if url.path() != "/" || url.query().is_some() || url.fragment().is_some() {
        return Err("云服务地址只能填写服务器根地址".to_owned());
    }
    if !path.starts_with('/') || path.contains("..") || !allowed_api_path(path) {
        return Err("桌面端拒绝访问未授权的云 API 路径".to_owned());
    }
    url.set_path(path);
    if let Some(query) = query.filter(|value| !value.is_empty()) {
        if query.len() > MAX_QUERY_BYTES || query.contains('#') || query.starts_with('?') {
            return Err("云 API 查询参数无效或过长".to_owned());
        }
        url.set_query(Some(query));
    }
    Ok(url)
}

fn parse_method(value: &str) -> Result<Method, String> {
    match value.to_ascii_uppercase().as_str() {
        "GET" => Ok(Method::GET),
        "POST" => Ok(Method::POST),
        "PUT" => Ok(Method::PUT),
        "PATCH" => Ok(Method::PATCH),
        "DELETE" => Ok(Method::DELETE),
        _ => Err("桌面端云 API 不允许该 HTTP 方法".to_owned()),
    }
}

fn validate_auth_method(path: &str, method: &Method) -> Result<(), String> {
    if path == "/api/v1/auth/capabilities" {
        return if *method == Method::GET {
            Ok(())
        } else {
            Err("云认证 capabilities 只允许 GET".to_owned())
        };
    }
    if AUTH_PATHS.contains(&path) && *method != Method::GET && *method != Method::POST {
        return Err("该云认证接口只允许 GET 或 POST".to_owned());
    }
    Ok(())
}

fn valid_content_type(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 512
        && !value.contains('\r')
        && !value.contains('\n')
}

fn response_limit(path: &str) -> usize {
    if path.starts_with("/api/v1/auth/") {
        MAX_AUTH_RESPONSE_BYTES
    } else if path.starts_with("/api/v1/mail/attachments/") {
        MAX_ATTACHMENT_RESPONSE_BYTES
    } else {
        MAX_API_RESPONSE_BYTES
    }
}

#[tauri::command]
pub async fn cloud_auth_http_request(
    request: CloudAuthHttpRequest,
) -> Result<CloudAuthHttpResponse, String> {
    let url = cloud_url(&request.origin, &request.path, request.query.as_deref())?;
    let method = parse_method(&request.method)?;
    validate_auth_method(&request.path, &method)?;

    if request.body.is_some() && request.body_base64.is_some() {
        return Err("云 API 请求体格式冲突".to_owned());
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(45))
        .redirect(Policy::none())
        .build()
        .map_err(|error| format!("无法初始化云端网络客户端: {error}"))?;
    let mut builder = client
        .request(method, url)
        .header(ACCEPT, "application/json, application/octet-stream;q=0.9, */*;q=0.8");

    if let Some(body) = request.body {
        if body.len() > MAX_JSON_REQUEST_BYTES {
            return Err("云 API JSON 请求体超过安全上限".to_owned());
        }
        let content_type = request
            .content_type
            .as_deref()
            .unwrap_or("application/json");
        if !valid_content_type(content_type) {
            return Err("云 API Content-Type 无效".to_owned());
        }
        builder = builder.header(CONTENT_TYPE, content_type).body(body);
    } else if let Some(encoded) = request.body_base64 {
        let bytes = BASE64
            .decode(encoded.as_bytes())
            .map_err(|_| "云 API 二进制请求体编码无效".to_owned())?;
        if bytes.len() > MAX_BINARY_REQUEST_BYTES {
            return Err("云 API 二进制请求体超过安全上限".to_owned());
        }
        let content_type = request
            .content_type
            .as_deref()
            .ok_or_else(|| "二进制云 API 请求缺少 Content-Type".to_owned())?;
        if !valid_content_type(content_type) {
            return Err("云 API Content-Type 无效".to_owned());
        }
        builder = builder.header(CONTENT_TYPE, content_type).body(bytes);
    }

    if let Some(authorization) = request.authorization {
        if authorization.len() > 8192 || !authorization.starts_with("Bearer ") {
            return Err("云 API Authorization 头无效".to_owned());
        }
        builder = builder.header(AUTHORIZATION, authorization);
    }

    let response = builder
        .send()
        .await
        .map_err(|error| format!("无法连接 LifeTrace 云端: {error}"))?;
    let status = response.status().as_u16();
    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    let max_response_bytes = response_limit(&request.path);
    if response
        .content_length()
        .is_some_and(|length| length > max_response_bytes as u64)
    {
        return Err("云 API 响应超过安全上限".to_owned());
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("读取云 API 响应失败: {error}"))?;
    if bytes.len() > max_response_bytes {
        return Err("云 API 响应超过安全上限".to_owned());
    }

    Ok(CloudAuthHttpResponse {
        status,
        body_base64: BASE64.encode(bytes),
        content_type,
    })
}

pub(crate) fn credential_set_internal(refresh_token: &str) -> Result<(), String> {
    if refresh_token.is_empty() || refresh_token.len() > 4096 {
        return Err("invalid refresh token length".to_owned());
    }
    platform::set(refresh_token)
}

pub(crate) fn credential_get_internal() -> Result<Option<String>, String> {
    platform::get()
}

pub(crate) fn credential_clear_internal() -> Result<(), String> {
    platform::clear()
}

#[tauri::command]
pub fn cloud_credential_set(refresh_token: String) -> Result<(), String> {
    if refresh_token.is_empty() || refresh_token.len() > 4096 {
        return Err("invalid refresh token length".to_owned());
    }
    credential_set_internal(&refresh_token)
}

#[tauri::command]
pub fn cloud_credential_get() -> Result<Option<String>, String> {
    credential_get_internal()
}

#[tauri::command]
pub fn cloud_credential_clear() -> Result<(), String> {
    credential_clear_internal()
}

#[cfg(windows)]
mod platform {
    use std::mem::zeroed;
    use std::ptr::{null_mut, slice_from_raw_parts};

    use windows_sys::Win32::Foundation::ERROR_NOT_FOUND;
    use windows_sys::Win32::Security::Credentials::{
        CredDeleteW, CredFree, CredReadW, CredWriteW, CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE,
        CRED_TYPE_GENERIC,
    };

    use super::CREDENTIAL_TARGET;

    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(std::iter::once(0)).collect()
    }

    pub fn set(secret: &str) -> Result<(), String> {
        let target = wide(CREDENTIAL_TARGET);
        let username = wide("LifeTrace Desktop");
        let mut bytes = secret.as_bytes().to_vec();
        let mut credential: CREDENTIALW = unsafe { zeroed() };
        credential.Type = CRED_TYPE_GENERIC;
        credential.TargetName = target.as_ptr() as *mut u16;
        credential.CredentialBlobSize = bytes.len() as u32;
        credential.CredentialBlob = bytes.as_mut_ptr();
        credential.Persist = CRED_PERSIST_LOCAL_MACHINE;
        credential.UserName = username.as_ptr() as *mut u16;
        let success = unsafe { CredWriteW(&credential, 0) };
        bytes.fill(0);
        if success == 0 {
            Err(format!(
                "Windows Credential Manager write failed: {}",
                std::io::Error::last_os_error()
            ))
        } else {
            Ok(())
        }
    }

    pub fn get() -> Result<Option<String>, String> {
        let target = wide(CREDENTIAL_TARGET);
        let mut pointer: *mut CREDENTIALW = null_mut();
        let success = unsafe { CredReadW(target.as_ptr(), CRED_TYPE_GENERIC, 0, &mut pointer) };
        if success == 0 {
            let error = std::io::Error::last_os_error();
            if error.raw_os_error() == Some(ERROR_NOT_FOUND as i32) {
                return Ok(None);
            }
            return Err(format!("Windows Credential Manager read failed: {error}"));
        }
        if pointer.is_null() {
            return Ok(None);
        }
        let credential = unsafe { &*pointer };
        let blob = unsafe {
            &*slice_from_raw_parts(
                credential.CredentialBlob,
                credential.CredentialBlobSize as usize,
            )
        };
        let result = String::from_utf8(blob.to_vec())
            .map(Some)
            .map_err(|_| "stored cloud credential is not valid UTF-8".to_owned());
        unsafe { CredFree(pointer.cast()) };
        result
    }

    pub fn clear() -> Result<(), String> {
        let target = wide(CREDENTIAL_TARGET);
        let success = unsafe { CredDeleteW(target.as_ptr(), CRED_TYPE_GENERIC, 0) };
        if success == 0 {
            let error = std::io::Error::last_os_error();
            if error.raw_os_error() == Some(ERROR_NOT_FOUND as i32) {
                return Ok(());
            }
            Err(format!("Windows Credential Manager delete failed: {error}"))
        } else {
            Ok(())
        }
    }
}

#[cfg(not(windows))]
mod platform {
    pub fn set(_: &str) -> Result<(), String> {
        Err(
            "secure cloud credential storage is available only in the Windows desktop build"
                .to_owned(),
        )
    }

    pub fn get() -> Result<Option<String>, String> {
        Ok(None)
    }

    pub fn clear() -> Result<(), String> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::cloud_url;

    #[test]
    fn credential_target_is_stable_and_contains_no_secret() {
        assert_eq!(
            super::CREDENTIAL_TARGET,
            "LifeTrace/cloud/lifetrace-desktop/refresh-token"
        );
    }

    #[test]
    fn native_cloud_transport_only_accepts_server_origin_and_known_api_paths() {
        let url = cloud_url(
            "https://8-148-75-45.sslip.io",
            "/api/v1/auth/login",
            None,
        )
        .unwrap();
        assert_eq!(
            url.as_str(),
            "https://8-148-75-45.sslip.io/api/v1/auth/login"
        );
        let mail = cloud_url(
            "https://8-148-75-45.sslip.io",
            "/api/v1/mail/messages",
            Some("limit=50&unreadOnly=true"),
        )
        .unwrap();
        assert_eq!(
            mail.as_str(),
            "https://8-148-75-45.sslip.io/api/v1/mail/messages?limit=50&unreadOnly=true"
        );
        assert!(cloud_url(
            "https://8-148-75-45.sslip.io/api",
            "/api/v1/auth/login",
            None
        )
        .is_err());
        assert!(cloud_url(
            "https://8-148-75-45.sslip.io",
            "/api/v1/admin/users",
            None
        )
        .is_err());
        assert!(cloud_url("file:///tmp/lifetrace", "/api/v1/auth/login", None).is_err());
    }
}
