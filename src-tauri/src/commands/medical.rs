//! Local-only examination archive. Source bytes are preserved exactly as uploaded.
//! Medical data is intentionally stored UNENCRYPTED by product decision.
//! Never put report contents into sync outbox, agent history or telemetry.
use std::{collections::{HashMap, HashSet}, fs, path::{Path, PathBuf}};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use chrono::{NaiveDate, Utc};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tauri::State;
use uuid::Uuid;

use crate::{database, desktop::DesktopState};

const MAX_FILES: usize = 8;
const MAX_FILE_BYTES: usize = 5 * 1024 * 1024;
const MAX_PDF_BYTES: usize = 20 * 1024 * 1024;
const MAX_TOTAL_BYTES: usize = 30 * 1024 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all="camelCase")]
pub struct MedicalAssetInput {
    pub asset_id: String,
    pub original_name: String,
    pub mime_type: String,
    pub base64: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all="camelCase")]
pub struct MedicalCommitInput {
    pub idempotency_key: String,
    pub draft: Value,
    pub assets: Vec<MedicalAssetInput>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all="camelCase")]
pub struct MedicalReplaceInput {
    pub report_id: String,
    pub idempotency_key: String,
    pub draft: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all="camelCase")]
pub struct SavedMedicalReport {
    pub id: String,
    pub title: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all="camelCase")]
pub struct MedicalListItem {
    pub id: String,
    pub title: String,
    pub report_type: String,
    pub exam_at: Option<String>,
    pub facility: Option<String>,
    pub created_at: String,
    pub observation_count: i64,
    pub attachment_count: i64,
}
#[derive(Debug, Serialize)]
#[serde(rename_all="camelCase")]
pub struct MedicalAsset {
    pub id: String,
    pub original_name: String,
    pub mime_type: String,
    pub bytes_size: i64,
}
#[derive(Debug, Serialize)]
#[serde(rename_all="camelCase")]
pub struct MedicalReportDetail {
    pub id: String,
    pub report: Value,
    pub assets: Vec<MedicalAsset>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all="camelCase")]
pub struct MedicalAssetData {
    pub mime_type: String,
    pub original_name: String,
    pub base64: String,
}

struct DecodedAsset {
    source_id: String,
    id: String,
    name: String,
    mime: String,
    bytes: Vec<u8>,
    hash: String,
    filename: String,
}

fn open_db(root: &Path) -> Result<rusqlite::Connection, String> {
    database::connection::open(&root.join("lifetrace.db"))
        .map_err(|_| "无法读取医疗档案数据库".to_owned())
}

fn profile_id(db: &rusqlite::Connection) -> Result<String, String> {
    database::profile::active_profile_id(db)
}

fn required_str<'a>(value: &'a Value, name: &str, limit: usize) -> Result<&'a str, String> {
    let strval = value.get(name).and_then(Value::as_str)
        .ok_or_else(|| format!("报告缺少有效字段：{name}"))?;
    if strval.trim().is_empty() || strval.len() > limit {
        return Err(format!("报告字段无效：{name}"));
    }
    Ok(strval)
}
fn optional_str<'a>(value: &'a Value, name: &str, limit: usize) -> Result<Option<&'a str>, String> {
    match value.get(name) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(s)) if s.len() <= limit => Ok(Some(s.as_str())),
        _ => Err(format!("报告字段无效：{name}")),
    }
}
fn verify_date(date: Option<&str>) -> Result<(), String> {
    if let Some(date) = date {
        NaiveDate::parse_from_str(date, "%Y-%m-%d").map_err(|_| "报告日期格式错误".to_owned())?;
    }
    Ok(())
}
fn validate_report<'a>(report: &'a Value, sources: &HashSet<&str>) -> Result<&'a Vec<Value>, String> {
    let _title = required_str(report, "title", 200)?;
    let ty = required_str(report, "reportType", 40)?;
    if !matches!(ty,"laboratory"|"ultrasound"|"ct"|"mri"|"xray"|"ecg"|"pathology"|"endoscopy"|"other") {
        return Err("未知的检查类型".into());
    }
    for key in ["examAt","collectionAt","issuedAt"] {
        verify_date(optional_str(report,key,30)?)?;
    }
    for key in ["facility","department","reportNo","bodySite"] {
        optional_str(report,key,500)?;
    }
    let asset_ids = report.get("sourceAssetIds").and_then(Value::as_array)
        .ok_or("报告缺少源文件关联")?;
    if asset_ids.is_empty() || !asset_ids.iter().all(|id|id.as_str().is_some_and(|id|sources.contains(id))) {
        return Err("报告引用了无效的源文件".into());
    }
    if asset_ids.iter().filter_map(Value::as_str).collect::<HashSet<_>>().len() != asset_ids.len() {
        return Err("同一检查报告包含重复的源文件引用".into());
    }
    let sections = report.get("sections").and_then(Value::as_array).ok_or("缺少报告章节")?;
    let results = report.get("observations").and_then(Value::as_array).ok_or("缺少报告结果数组")?;
    if sections.len()>100 || results.len()>500 {return Err("报告条目过多".into());}
    for row in sections {
        required_str(row, "kind", 40)?;
        required_str(row, "titleRaw", 200)?;
        required_str(row, "textRaw", 30_000)?;
        if !row.get("sourceAssetId").and_then(Value::as_str).is_some_and(|x|asset_ids.iter().any(|v|v.as_str()==Some(x))) {
            return Err("章节证据关联无效".into());
        }
    }
    for row in results {
        required_str(row,"nameRaw",200)?;
        required_str(row,"valueRaw",200)?;
        required_str(row,"kind",40)?;
        if !row.get("sourceAssetId").and_then(Value::as_str).is_some_and(|x|asset_ids.iter().any(|v|v.as_str()==Some(x))) {
            return Err("指标证据关联无效".into());
        }
        if !row.get("valueNumber").unwrap_or(&Value::Null).is_null()
            && !row.get("valueNumber").is_some_and(Value::is_number) {
            return Err("指标数值格式无效".into());
        }
    }
    Ok(results)
}
fn decode_assets(inputs: &[MedicalAssetInput]) -> Result<Vec<DecodedAsset>, String> {
    if inputs.is_empty() || inputs.len()>MAX_FILES {return Err("每批允许 1 至 8 份报告原文件".into());}
    let mut seen=HashSet::new();
    let mut total=0usize;
    let mut decoded=Vec::with_capacity(inputs.len());
    for image in inputs {
        if image.asset_id.is_empty() || image.asset_id.len()>100
            || !image.asset_id.bytes().all(|b|b.is_ascii_alphanumeric()||b"-_".contains(&b))
            || !seen.insert(image.asset_id.as_str()) {
            return Err("附件 ID 重复或非法".into());
        }
        if image.original_name.is_empty() || image.original_name.len()>255 {
            return Err("原文件名无效".into());
        }
        let max_bytes = if image.mime_type == "application/pdf" { MAX_PDF_BYTES } else { MAX_FILE_BYTES };
        if image.base64.len()>max_bytes*4/3+8 {return Err("单个原文件超出大小限制".into());}
        let bytes=STANDARD.decode(&image.base64).map_err(|_|"图片编码无效".to_owned())?;
        total += bytes.len();
        if bytes.is_empty() || bytes.len()>max_bytes || total>MAX_TOTAL_BYTES {
            return Err("原始报告文件总大小超过限制".into());
        }
        let ext=match image.mime_type.as_str() {
            "image/jpeg" if bytes.starts_with(&[0xff,0xd8,0xff]) => "jpg",
            "image/png" if bytes.starts_with(b"\x89PNG\r\n\x1a\n") => "png",
            "image/webp" if bytes.len()>=12 && bytes.starts_with(b"RIFF") && &bytes[8..12]==b"WEBP" => "webp",
            "application/pdf" if bytes.starts_with(b"%PDF-") => "pdf",
            _=>return Err("仅支持 JPG、PNG、WebP、PDF 报告；格式必须匹配文件内容".into()),
        };
        let id=Uuid::new_v4().to_string();
        decoded.push(DecodedAsset {
            source_id:image.asset_id.clone(), id:id.clone(),
            name:Path::new(&image.original_name).file_name().and_then(|v|v.to_str())
                .unwrap_or("image").to_owned(),
            mime:image.mime_type.clone(), hash:format!("{:x}",Sha256::digest(&bytes)),
            filename:format!("{id}.{ext}"),bytes,
        });
    }
    Ok(decoded)
}
fn batch_report_ids(db: &rusqlite::Connection, batch_id: &str) -> Result<Vec<SavedMedicalReport>, String> {
    let mut stmt=db.prepare("SELECT id,title FROM medical_reports WHERE batch_id=?1 ORDER BY rowid")
        .map_err(|e|e.to_string())?;
    let rows = stmt.query_map([batch_id],|row|Ok(SavedMedicalReport{id:row.get(0)?,title:row.get(1)?}))
        .map_err(|e|e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?;
    Ok(rows)
}


#[derive(Debug, Serialize)]
#[serde(rename_all="camelCase")]
pub struct MedicalDuplicateMatch {
    pub source_asset_id: String,
    pub existing_report_id: Option<String>,
    pub existing_title: Option<String>,
}

fn find_duplicate_assets(
    db: &rusqlite::Connection,
    user: &str,
    images: &[DecodedAsset],
) -> Result<Vec<MedicalDuplicateMatch>, String> {
    let mut seen = HashSet::<&str>::new();
    let mut duplicates = Vec::new();
    for image in images {
        if !seen.insert(image.hash.as_str()) {
            return Err("同一次上传包含完全相同的图片，请移除重复文件后重试".to_owned());
        }
        let existing = db.query_row(
            "SELECT r.id, r.title FROM medical_report_assets a
             LEFT JOIN medical_report_asset_links l ON l.asset_id=a.id
             LEFT JOIN medical_reports r ON r.id=l.report_id AND r.user_id=a.user_id
             WHERE a.user_id=?1 AND a.sha256=?2 LIMIT 1",
            params![user, image.hash],
            |row| Ok((row.get::<_, Option<String>>(0)?, row.get::<_, Option<String>>(1)?)),
        ).optional().map_err(|e|e.to_string())?;
        if let Some((report_id, title)) = existing {
            duplicates.push(MedicalDuplicateMatch {
                source_asset_id: image.source_id.clone(),
                existing_report_id: report_id,
                existing_title: title,
            });
        }
    }
    Ok(duplicates)
}

#[tauri::command]
pub async fn medical_check_duplicates(
    state: State<'_, DesktopState>,
    images: Vec<MedicalAssetInput>,
) -> Result<Vec<MedicalDuplicateMatch>, String> {
    let root = state.data_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let decoded = decode_assets(&images)?;
        let db = open_db(&root)?;
        let user = profile_id(&db)?;
        find_duplicate_assets(&db, &user, &decoded)
    }).await.map_err(|_|"医疗报告重复检查失败".to_owned())?
}

fn commit(root: &Path, input: MedicalCommitInput) -> Result<Vec<SavedMedicalReport>, String> {
    if input.idempotency_key.trim().len()<8 || input.idempotency_key.len()>128 {
        return Err("提交标识无效".into());
    }
    let mut db=open_db(root)?;
    let user=profile_id(&db)?;
    // Repeated confirmation or a retry must never create duplicate reports or files.
    let existing:Option<String>=db.query_row("SELECT id FROM medical_import_batches WHERE user_id=?1 AND idempotency_key=?2",
        params![user,input.idempotency_key],|row|row.get(0)).optional().map_err(|e|e.to_string())?;
    if let Some(id)=existing {return batch_report_ids(&db,&id);}
    let decoded=decode_assets(&input.assets)?;
    let duplicate_matches = find_duplicate_assets(&db, &user, &decoded)?;
    if !duplicate_matches.is_empty() {
        return Err(format!("已有 {} 张相同原始图片归档，请不要重复添加；如需更正可重新识别原报告", duplicate_matches.len()));
    }
    let sources=decoded.iter().map(|x|x.source_id.as_str()).collect::<HashSet<_>>();
    let reports=input.draft.get("reports").and_then(Value::as_array).ok_or("识别草稿没有报告")?;
    if reports.is_empty() || reports.len()>16 {return Err("报告数量不正确".into());}
    let mut linked_sources = HashSet::new();
    for report in reports {
        validate_report(report,&sources)?;
        for id in report["sourceAssetIds"].as_array().ok_or("缺少报告源文件")? {
            let id = id.as_str().ok_or("附件来源格式不正确")?;
            linked_sources.insert(id);
        }
    }
    if linked_sources != sources {
        return Err("有原始图片未关联到任何识别报告，请先重新识别确认".into());
    }
    let dir=root.join("medical").join("originals");
    fs::create_dir_all(&dir).map_err(|_|"无法创建医疗档案目录".to_owned())?;
    let mut created=Vec::<PathBuf>::new();
    let result=(|| {
        // Only server-generated filenames are used; uploaded paths cannot escape the archive.
        for asset in &decoded {
            let path=dir.join(&asset.filename);
            use std::io::Write;
            let mut file=fs::OpenOptions::new().write(true).create_new(true).open(&path)
                .map_err(|_|"保存原始图片失败".to_owned())?;
            created.push(path.clone());
            file.write_all(&asset.bytes).and_then(|_|file.sync_all())
                .map_err(|_|"原始图片写入失败".to_owned())?;
        }
        let tx=db.transaction().map_err(|e|e.to_string())?;
        let batch_id=Uuid::new_v4().to_string();
        let stamp=Utc::now().to_rfc3339();
        tx.execute("INSERT INTO medical_import_batches(id,user_id,idempotency_key,created_at) VALUES(?1,?2,?3,?4)",
            params![batch_id,user,input.idempotency_key,stamp]).map_err(|e|e.to_string())?;
        let mut by_source=HashMap::new();
        for asset in &decoded {
            tx.execute("INSERT INTO medical_report_assets(id,user_id,batch_id,source_asset_id,original_name,mime_type,bytes_size,sha256,relative_path) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",
                params![asset.id,user,batch_id,asset.source_id,asset.name,asset.mime,asset.bytes.len() as i64,asset.hash,asset.filename]).map_err(|e|e.to_string())?;
            by_source.insert(asset.source_id.as_str(),asset.id.as_str());
        }
        // Source IDs supplied to the vision model are ephemeral. Persist durable local asset
        // IDs instead, so every section and observation can reopen its original file later.
        fn persist_source_ids(
            report: &Value,
            lookup: &HashMap<&str, &str>,
        ) -> Result<Value, String> {
            let mut persisted = report.clone();
            for field in ["sourceAssetIds"] {
                for source in persisted[field].as_array_mut().ok_or("无效源文件列表")? {
                    let id = source.as_str().ok_or("无效源文件")?;
                    *source = Value::String(lookup.get(id).ok_or("找不到源文件")?.to_string());
                }
            }
            for kind in ["sections", "observations"] {
                for entry in persisted[kind].as_array_mut().ok_or("源文件内容无效")? {
                    let id = entry["sourceAssetId"].as_str().ok_or("缺少字段源文件")?;
                    entry["sourceAssetId"] = Value::String(
                        lookup.get(id).ok_or("找不到字段来源文件")?.to_string()
                    );
                }
            }
            Ok(persisted)
        }

        let mut saved=Vec::new();
        for report in reports {
            let persisted = persist_source_ids(report, &by_source)?;
            let id=Uuid::new_v4().to_string();
            let title=required_str(report,"title",200)?.to_owned();
            let kind=required_str(report,"reportType",40)?;
            tx.execute("INSERT INTO medical_reports(id,user_id,batch_id,title,report_type,exam_at,facility,content_json,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",
                params![id,user,batch_id,title,kind,optional_str(report,"examAt",30)?,optional_str(report,"facility",500)?,persisted.to_string(),stamp])
                .map_err(|e|e.to_string())?;
            for source_id in report["sourceAssetIds"].as_array().ok_or("缺少源文件")? {
                let key=source_id.as_str().ok_or("无效源文件")?;
                let asset_id=by_source.get(key).ok_or("未知源文件")?;
                tx.execute("INSERT INTO medical_report_asset_links(report_id,asset_id) VALUES(?1,?2)",
                    params![id,asset_id]).map_err(|e|e.to_string())?;
            }
            for (position,section) in persisted["sections"].as_array().ok_or("缺少章节")?.iter().enumerate() {
                tx.execute("INSERT INTO medical_report_sections(id,report_id,position,content_json) VALUES(?1,?2,?3,?4)",
                    params![Uuid::new_v4().to_string(),id,position as i64,section.to_string()]).map_err(|e|e.to_string())?;
            }
            for (position,result) in persisted["observations"].as_array().ok_or("缺少结果")?.iter().enumerate() {
                tx.execute("INSERT INTO medical_observations(id,report_id,position,name_raw,metric_key,value_number,unit_raw,content_json) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",
                    params![Uuid::new_v4().to_string(),id,position as i64,required_str(result,"nameRaw",200)?,
                    optional_str(result,"metricKey",100)?,
                    result.get("valueNumber").and_then(Value::as_f64),optional_str(result,"unitRaw",80)?,result.to_string()])
                    .map_err(|e|e.to_string())?;
            }
            saved.push(SavedMedicalReport{id,title});
        }
        tx.commit().map_err(|e|e.to_string())?;
        Ok(saved)
    })();
    if result.is_err() {
        for path in created {let _=fs::remove_file(path);}
    }
    result
}

#[tauri::command]
pub async fn medical_commit_draft(
    state:State<'_,DesktopState>, input:MedicalCommitInput
) -> Result<Vec<SavedMedicalReport>,String> {
    let dir=state.data_dir.clone();
    tauri::async_runtime::spawn_blocking(move ||commit(&dir,input))
        .await.map_err(|_|"医疗档案写入任务中断".to_owned())?
}
/// Updates one existing report from a newly reviewed vision draft.
/// Original media and its content hash never change.
fn replace_report(root: &Path, input: MedicalReplaceInput) -> Result<SavedMedicalReport, String> {
    if input.report_id.len()>100
        || input.idempotency_key.trim().len()<8 || input.idempotency_key.len()>128 {
        return Err("报告或修订标识无效".into());
    }
    let mut db=open_db(root)?;
    let owner=profile_id(&db)?;
    let old_json:String=db.query_row(
        "SELECT content_json FROM medical_reports WHERE id=?1 AND user_id=?2",
        params![input.report_id,owner], |row|row.get(0)
    ).map_err(|_|"报告不存在或无权限修改".to_owned())?;

    let existing:Option<i64>=db.query_row(
        "SELECT 1 FROM medical_report_revisions WHERE report_id=?1 AND request_key=?2",
        params![input.report_id,input.idempotency_key],|r|r.get(0)
    ).optional().map_err(|e|e.to_string())?;
    let current:Value=serde_json::from_str(&old_json)
        .map_err(|_|"原检查报告格式损坏".to_owned())?;
    if existing.is_some() {
        return Ok(SavedMedicalReport{
            id:input.report_id,
            title:required_str(&current,"title",200)?.to_owned(),
        });
    }
    let mut stmt=db.prepare("SELECT a.id FROM medical_report_assets a
        JOIN medical_report_asset_links l ON l.asset_id=a.id
        WHERE l.report_id=?1 AND a.user_id=?2").map_err(|e|e.to_string())?;
    let source_ids=stmt.query_map(params![input.report_id,owner],|r|r.get::<_,String>(0))
        .map_err(|e|e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?;
    drop(stmt);
    let sources=source_ids.iter().map(String::as_str).collect::<HashSet<_>>();
    if sources.is_empty() {return Err("原报告没有可用附件".into());}
    let reports=input.draft.get("reports").and_then(Value::as_array)
        .ok_or("缺少重新识别结果")?;
    if reports.len()!=1 {
        return Err("重新识别必须对应唯一一份已有报告，请调整图片分组".into());
    }
    let report=&reports[0];
    validate_report(report,&sources)?;
    let associated=report["sourceAssetIds"].as_array().ok_or("缺少来源照片")?
        .iter().filter_map(Value::as_str).collect::<HashSet<_>>();
    if associated!=sources {
        return Err("重新识别必须保留原报告的全部源文件".into());
    }

    let id=input.report_id;
    let title=required_str(report,"title",200)?.to_owned();
    let kind=required_str(report,"reportType",40)?;
    let tx=db.transaction().map_err(|e|e.to_string())?;
    tx.execute("INSERT INTO medical_report_revisions
        (id,report_id,request_key,old_content_json,new_content_json,created_at)
        VALUES (?1,?2,?3,?4,?5,?6)",
        params![Uuid::new_v4().to_string(),id,input.idempotency_key,
        old_json,report.to_string(),Utc::now().to_rfc3339()]
    ).map_err(|e|e.to_string())?;
    tx.execute("UPDATE medical_reports SET title=?1, report_type=?2, exam_at=?3,
        facility=?4, content_json=?5 WHERE id=?6 AND user_id=?7",
        params![title,kind,optional_str(report,"examAt",30)?,
        optional_str(report,"facility",500)?,report.to_string(),id,owner]
    ).map_err(|e|e.to_string())?;
    tx.execute("DELETE FROM medical_report_sections WHERE report_id=?1",[&id])
        .map_err(|e|e.to_string())?;
    tx.execute("DELETE FROM medical_observations WHERE report_id=?1",[&id])
        .map_err(|e|e.to_string())?;
    for (n,section) in report["sections"].as_array().ok_or("缺少原文章节")?.iter().enumerate(){
        tx.execute("INSERT INTO medical_report_sections(id,report_id,position,content_json)
            VALUES (?1,?2,?3,?4)",
            params![Uuid::new_v4().to_string(),id,n as i64,section.to_string()]
        ).map_err(|e|e.to_string())?;
    }
    for (n,item) in report["observations"].as_array().ok_or("缺少结构化结果")?.iter().enumerate(){
        tx.execute("INSERT INTO medical_observations
            (id,report_id,position,name_raw,metric_key,value_number,unit_raw,content_json)
            VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
            params![Uuid::new_v4().to_string(),id,n as i64,required_str(item,"nameRaw",200)?,
                optional_str(item,"metricKey",100)?,item.get("valueNumber").and_then(Value::as_f64),
                optional_str(item,"unitRaw",80)?,item.to_string()]
        ).map_err(|e|e.to_string())?;
    }
    tx.commit().map_err(|e|e.to_string())?;
    Ok(SavedMedicalReport{id,title})
}

#[tauri::command]
pub async fn medical_replace_report(
    state: State<'_,DesktopState>,
    input: MedicalReplaceInput,
) -> Result<SavedMedicalReport, String> {
    let root=state.data_dir.clone();
    tauri::async_runtime::spawn_blocking(move ||replace_report(&root,input))
        .await.map_err(|_|"医疗报告修订任务中断".to_owned())?
}

#[derive(Debug, Serialize)]
#[serde(rename_all="camelCase")]
pub struct MedicalReportRevision {
    pub id: String,
    pub changed_at: String,
    pub previous: Value,
    pub updated: Value,
}

#[tauri::command]
pub async fn medical_list_revisions(
    state: State<'_,DesktopState>,
    report_id: String,
) -> Result<Vec<MedicalReportRevision>, String> {
    let root=state.data_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let db=open_db(&root)?;
        let owner=profile_id(&db)?;
        let mut stmt=db.prepare(
            "SELECT rev.id, rev.created_at, rev.old_content_json, rev.new_content_json
             FROM medical_report_revisions rev
             JOIN medical_reports report ON report.id=rev.report_id
             WHERE rev.report_id=?1 AND report.user_id=?2
             ORDER BY rev.created_at DESC LIMIT 30"
        ).map_err(|e|e.to_string())?;
        let rows=stmt.query_map(params![report_id,owner],|r|{
            let original:String=r.get(2)?;
            let updated:String=r.get(3)?;
            Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,original,updated))
        }).map_err(|e|e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?;
        rows.into_iter().map(|(id,changed_at,old_json,new_json)|{
            Ok(MedicalReportRevision{
                id,changed_at,
                previous:serde_json::from_str(&old_json).map_err(|_|"旧版报告数据格式错误")?,
                updated:serde_json::from_str(&new_json).map_err(|_|"新版报告数据格式错误")?,
            })
        }).collect()
    }).await.map_err(|_|"医疗报告修订历史查询失败".to_owned())?
}

#[tauri::command]
pub async fn medical_list_reports(state:State<'_,DesktopState>) -> Result<Vec<MedicalListItem>,String> {
    let dir=state.data_dir.clone();
    tauri::async_runtime::spawn_blocking(move ||{
        let db=open_db(&dir)?;
        let user=profile_id(&db)?;
        let mut stmt=db.prepare("SELECT r.id,r.title,r.report_type,r.exam_at,r.facility,r.created_at,
            (SELECT count(*) FROM medical_observations o WHERE o.report_id=r.id),
            (SELECT count(*) FROM medical_report_asset_links l WHERE l.report_id=r.id)
            FROM medical_reports r WHERE r.user_id=?1 ORDER BY COALESCE(r.exam_at,r.created_at) DESC LIMIT 500")
            .map_err(|e|e.to_string())?;
        let rows = stmt.query_map([user],|r|Ok(MedicalListItem{
            id:r.get(0)?,title:r.get(1)?,report_type:r.get(2)?,exam_at:r.get(3)?,
            facility:r.get(4)?,created_at:r.get(5)?,observation_count:r.get(6)?,
            attachment_count:r.get(7)?
        })).map_err(|e|e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?;
        Ok(rows)
    }).await.map_err(|_|"医疗档案查询任务中断".to_owned())?
}

#[tauri::command]
pub async fn medical_get_report(state:State<'_,DesktopState>, id:String) -> Result<MedicalReportDetail,String> {
    let dir=state.data_dir.clone();
    tauri::async_runtime::spawn_blocking(move ||{
        let db=open_db(&dir)?;
        let user=profile_id(&db)?;
        let payload:String=db.query_row("SELECT content_json FROM medical_reports WHERE id=?1 AND user_id=?2",
            params![id,user],|r|r.get(0)).map_err(|_|"检查报告不存在或无权查看".to_owned())?;
        let mut stmt=db.prepare("SELECT a.id,a.original_name,a.mime_type,a.bytes_size FROM medical_report_assets a
            INNER JOIN medical_report_asset_links l ON a.id=l.asset_id
            WHERE l.report_id=?1 AND a.user_id=?2 ORDER BY a.rowid")
            .map_err(|e|e.to_string())?;
        let assets = stmt.query_map(params![id,user],|r|Ok(MedicalAsset {
            id:r.get(0)?,original_name:r.get(1)?,mime_type:r.get(2)?,bytes_size:r.get(3)?
        })).map_err(|e|e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?;
        Ok(MedicalReportDetail{id,report:serde_json::from_str(&payload).map_err(|_|"检查报告数据格式错误")?,assets})
    }).await.map_err(|_|"医疗档案查询任务中断".to_owned())?
}
#[tauri::command]
pub async fn medical_read_asset(state:State<'_,DesktopState>,id:String) -> Result<MedicalAssetData,String> {
    let root=state.data_dir.clone();
    tauri::async_runtime::spawn_blocking(move ||{
        let db=open_db(&root)?;
        let user=profile_id(&db)?;
        let (filename,name,mime,hash):(String,String,String,String)=db.query_row(
            "SELECT relative_path,original_name,mime_type,sha256 FROM medical_report_assets WHERE id=?1 AND user_id=?2",
            params![id,user],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?)))
            .map_err(|_|"医疗报告附件不存在或无权访问".to_owned())?;
        // Existing content from a database must still not be able to escape the archive root.
        if filename.contains('/') || filename.contains('\\') || filename.contains("..") {
            return Err("医疗附件路径非法".to_owned());
        }
        let bytes=fs::read(root.join("medical").join("originals").join(filename))
            .map_err(|_|"无法读取原始附件".to_owned())?;
        if format!("{:x}",Sha256::digest(&bytes)) != hash {
            return Err("原始附件完整性校验失败".to_owned());
        }
        Ok(MedicalAssetData{mime_type:mime,original_name:name,base64:STANDARD.encode(bytes)})
    }).await.map_err(|_|"医疗附件读取任务中断".to_owned())?
}


#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MedicalMetricHistoryPoint {
    pub report_id: String,
    pub report_title: String,
    pub exam_at: String,
    pub value_number: f64,
    pub unit_raw: String,
}

#[tauri::command]
pub async fn medical_metric_history(
    state: State<'_, DesktopState>,
    name_raw: String,
    unit_raw: String,
) -> Result<Vec<MedicalMetricHistoryPoint>, String> {
    if name_raw.trim().is_empty() || name_raw.len() > 200 || unit_raw.len() > 80 {
        return Err("检查指标名称或单位无效".to_owned());
    }
    let dir = state.data_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let db = open_db(&dir)?;
        let user = profile_id(&db)?;
        let mut stmt = db.prepare(
            "SELECT r.id, r.title, r.exam_at, o.value_number, COALESCE(o.unit_raw,'')
             FROM medical_observations o
             JOIN medical_reports r ON o.report_id=r.id
             WHERE r.user_id=?1 AND o.name_raw=?2 AND COALESCE(o.unit_raw,'')=?3
               AND r.exam_at IS NOT NULL AND o.value_number IS NOT NULL
             ORDER BY r.exam_at ASC, r.created_at ASC LIMIT 200"
        ).map_err(|e|e.to_string())?;
        let points = stmt.query_map(params![user, name_raw, unit_raw], |row| {
            Ok(MedicalMetricHistoryPoint {
                report_id: row.get(0)?,
                report_title: row.get(1)?,
                exam_at: row.get(2)?,
                value_number: row.get(3)?,
                unit_raw: row.get(4)?,
            })
        }).map_err(|e|e.to_string())?.collect::<Result<Vec<_>, _>>()
            .map_err(|e|e.to_string())?;
        Ok(points)
    }).await.map_err(|_|"医疗指标趋势读取失败".to_owned())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_unsupported_media_and_bad_source_links() {
        assert!(decode_assets(&[MedicalAssetInput{
            asset_id:"one".into(),original_name:"report.txt".into(),
            mime_type:"text/plain".into(),base64:STANDARD.encode(b"test")
        }]).is_err());
        let report=serde_json::json!({
          "title":"甲状腺彩超","reportType":"ultrasound","examAt":null,
          "sourceAssetIds":["other"],"sections":[],"observations":[]
        });
        let ids=HashSet::from(["one"]);
        assert!(validate_report(&report,&ids).is_err());
    }
    #[test]
    fn preserves_raw_qualitative_values_and_unknown_dates() {
        let report=serde_json::json!({
          "title":"检验报告","reportType":"laboratory","examAt":null,
          "sourceAssetIds":["one"],"sections":[],
          "observations":[{"nameRaw":"抗体","valueRaw":"阴性","kind":"qualitative","sourceAssetId":"one","pageIndex":0}]
        });
        let ids=HashSet::from(["one"]);
        assert_eq!(validate_report(&report,&ids).unwrap().len(),1);
    }
    #[test]
    fn keeps_original_pdf_bytes_and_page_index_as_uploaded() {
        use crate::database::migration_runner::{Migration, MigrationContext};
        use crate::database::migrations::{M0022MedicalReports,M0023MedicalReportRevisions};

        let root=std::env::temp_dir().join(format!("lifetrace-medical-pdf-{}",Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let mut db=open_db(&root).unwrap();
        db.execute_batch("CREATE TABLE local_profiles(id TEXT PRIMARY KEY);
            INSERT INTO local_profiles VALUES('local');").unwrap();
        let tx=db.transaction().unwrap();
        M0022MedicalReports.up(&tx,&MigrationContext::new(root.clone())).unwrap();
        M0023MedicalReportRevisions.up(&tx,&MigrationContext::new(root.clone())).unwrap();
        tx.commit().unwrap();
        drop(db);
        // This test checks raw-file preservation; PDF rasterization is tested in the client.
        let original=b"%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF".to_vec();
        let saved=commit(&root,MedicalCommitInput{
            idempotency_key:"pdf-roundtrip-001".to_owned(),
            assets:vec![MedicalAssetInput{
                asset_id:"pdf-1".to_owned(),original_name:"clinic.pdf".to_owned(),
                mime_type:"application/pdf".to_owned(),base64:STANDARD.encode(&original),
            }],
            draft:serde_json::json!({"reports":[{
                "title":"生化检验","reportType":"laboratory",
                "sourceAssetIds":["pdf-1"],"examAt":null,"sections":[],
                "observations":[{
                    "kind":"numeric","nameRaw":"白蛋白","valueRaw":"42.0",
                    "valueNumber":42.0,"unitRaw":"g/L","sourceAssetId":"pdf-1",
                    "pageIndex":2
                }]
            }]}),
        }).unwrap();
        assert_eq!(saved.len(),1);
        let db=open_db(&root).unwrap();
        let (name,mime,relative,id):(String,String,String,String)=db.query_row(
            "SELECT original_name,mime_type,relative_path,id FROM medical_report_assets LIMIT 1",
            [],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?)),
        ).unwrap();
        assert_eq!(name,"clinic.pdf");
        assert_eq!(mime,"application/pdf");
        let content:String=db.query_row(
            "SELECT content_json FROM medical_reports WHERE id=?1",[&saved[0].id],
            |r|r.get(0),
        ).unwrap();
        let report:Value=serde_json::from_str(&content).unwrap();
        assert_eq!(report["observations"][0]["pageIndex"],2);
        assert_eq!(report["observations"][0]["sourceAssetId"],id);
        assert_eq!(fs::read(root.join("medical/originals").join(relative)).unwrap(),original);
        drop(db);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn commits_original_image_report_and_numeric_results_once() {
        use crate::database::migration_runner::{Migration, MigrationContext};
        use crate::database::migrations::{M0022MedicalReports, M0023MedicalReportRevisions};

        let dir=std::env::temp_dir().join(format!("lifetrace-medical-test-{}",Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        {
            let mut db=open_db(&dir).unwrap();
            db.execute_batch("CREATE TABLE local_profiles(id TEXT PRIMARY KEY);
                INSERT INTO local_profiles VALUES('local');").unwrap();
            let tx=db.transaction().unwrap();
            M0022MedicalReports.up(&tx,&MigrationContext::new(dir.clone())).unwrap();
            M0023MedicalReportRevisions.up(&tx,&MigrationContext::new(dir.clone())).unwrap();
            tx.commit().unwrap();
        }
        let image=vec![0xff,0xd8,0xff,0xe0,1,2,3,4];
        let make_input=||MedicalCommitInput{
            idempotency_key:"fixed-request-123".into(),
            assets:vec![MedicalAssetInput{
                asset_id:"scan-1".into(),original_name:"report.jpg".into(),
                mime_type:"image/jpeg".into(),base64:STANDARD.encode(&image),
            }],
            draft:serde_json::json!({"reports":[
                {"title":"血检","reportType":"laboratory","examAt":"2026-10-08",
                 "facility":"测试医院","sourceAssetIds":["scan-1"],
                 "sections":[],
                 "observations":[{"nameRaw":"ALT","valueRaw":"89.0","valueNumber":89.0,
                   "kind":"numeric","unitRaw":"U/L","referenceRangeRaw":"9-60",
                   "sourceAssetId":"scan-1","pageIndex":0}]}
            ]}),
        };
        let mut orphan = make_input();
        orphan.idempotency_key = "unlinked-pages-123".into();
        orphan.assets.push(MedicalAssetInput {
            asset_id: "unlinked-page".into(), original_name: "second.jpg".into(),
            mime_type: "image/jpeg".into(), base64: STANDARD.encode([0xff,0xd8,0xff,0xe0,9,8,7]),
        });
        assert!(commit(&dir,orphan).unwrap_err().contains("未关联"));
        let first=commit(&dir,make_input()).unwrap();
        assert_eq!(first.len(),1);
        let second=commit(&dir,make_input()).unwrap();
        assert_eq!(first[0].id,second[0].id);
        let mut alternate = make_input();
        alternate.idempotency_key = "different-request-123".into();
        assert!(commit(&dir,alternate).unwrap_err().contains("相同原始图片"));
        let mut repeated_images = make_input();
        repeated_images.idempotency_key = "repeated-images-123".into();
        repeated_images.assets.push(MedicalAssetInput {
            asset_id: "identical-second".into(), original_name: "repeat.jpg".into(),
            mime_type: "image/jpeg".into(), base64: STANDARD.encode(&image),
        });
        assert!(commit(&dir,repeated_images).unwrap_err().contains("完全相同"));
        {
            let db=open_db(&dir).unwrap();
            let report_count:i64=db.query_row("SELECT count(*) FROM medical_reports",[],|r|r.get(0)).unwrap();
            let obs_count:i64=db.query_row("SELECT count(*) FROM medical_observations",[],|r|r.get(0)).unwrap();
            let asset_count:i64=db.query_row("SELECT count(*) FROM medical_report_assets",[],|r|r.get(0)).unwrap();
            assert_eq!((report_count,obs_count,asset_count),(1,1,1));
            let row:(String,String,f64)=db.query_row(
                "SELECT name_raw,unit_raw,value_number FROM medical_observations LIMIT 1",
                [],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).unwrap();
            assert_eq!(row,("ALT".to_owned(),"U/L".to_owned(),89.0));
            let source_id:String=db.query_row("SELECT id FROM medical_report_assets LIMIT 1",[],|r|r.get(0)).unwrap();
            let report_json:String=db.query_row("SELECT content_json FROM medical_reports LIMIT 1",[],|r|r.get(0)).unwrap();
            let restored:Value=serde_json::from_str(&report_json).unwrap();
            assert_eq!(restored["sourceAssetIds"][0].as_str(),Some(source_id.as_str()));
            assert_eq!(restored["observations"][0]["sourceAssetId"].as_str(),Some(source_id.as_str()));
            let obs_json:String=db.query_row("SELECT content_json FROM medical_observations LIMIT 1",[],|r|r.get(0)).unwrap();
            let observation:Value=serde_json::from_str(&obs_json).unwrap();
            assert_eq!(observation["sourceAssetId"].as_str(),Some(source_id.as_str()));
        }
        let asset_dir=dir.join("medical/originals");
        let stored=fs::read_dir(&asset_dir).unwrap().collect::<Result<Vec<_>,_>>().unwrap();
        assert_eq!(stored.len(),1);
        assert_eq!(fs::read(stored[0].path()).unwrap(),image);
        let persistent_id:String=open_db(&dir).unwrap().query_row(
            "SELECT id FROM medical_report_assets LIMIT 1",[],|r|r.get(0)
        ).unwrap();
        let proposed = serde_json::json!({"reports":[{
            "title":"血检（复核后）","reportType":"laboratory","examAt":"2026-10-08",
            "facility":"测试医院","sourceAssetIds":[persistent_id],
            "sections":[],
            "observations":[{"nameRaw":"ALT","valueRaw":"36.0","valueNumber":36.0,
                "kind":"numeric","unitRaw":"U/L","referenceRangeRaw":"9-60",
                "sourceAssetId":persistent_id,"pageIndex":0}]
        }]});
        let change = || MedicalReplaceInput{
            report_id:first[0].id.clone(),
            idempotency_key:"reviewed-revision-123".into(),
            draft:proposed.clone(),
        };
        let result=replace_report(&dir,change()).unwrap();
        assert_eq!(result.id,first[0].id);
        assert_eq!(result.title,"血检（复核后）");
        assert_eq!(replace_report(&dir,change()).unwrap().id,first[0].id);
        let db=open_db(&dir).unwrap();
        let revision_count:i64=db.query_row(
            "SELECT count(*) FROM medical_report_revisions",[],|r|r.get(0)
        ).unwrap();
        assert_eq!(revision_count,1);
        let old:String=db.query_row(
            "SELECT old_content_json FROM medical_report_revisions LIMIT 1",[],|r|r.get(0)
        ).unwrap();
        assert_eq!(serde_json::from_str::<Value>(&old).unwrap()["observations"][0]["valueRaw"],"89.0");
        let updated:f64=db.query_row(
            "SELECT value_number FROM medical_observations",[],|r|r.get(0)
        ).unwrap();
        assert_eq!(updated,36.0);
        let count:i64=db.query_row("SELECT count(*) FROM medical_report_assets",[],|r|r.get(0)).unwrap();
        assert_eq!(count,1);
        assert_eq!(fs::read(stored[0].path()).unwrap(),image);
        drop(db);
        fs::remove_dir_all(dir).unwrap();
    }

}
