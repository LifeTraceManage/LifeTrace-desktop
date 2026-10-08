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
const MAX_TOTAL_BYTES: usize = 12 * 1024 * 1024;

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
    if inputs.is_empty() || inputs.len()>MAX_FILES {return Err("每批允许 1 至 8 张图片".into());}
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
        if image.base64.len()>MAX_FILE_BYTES*4/3+8 {return Err("单张图片超出大小限制".into());}
        let bytes=STANDARD.decode(&image.base64).map_err(|_|"图片编码无效".to_owned())?;
        total += bytes.len();
        if bytes.is_empty() || bytes.len()>MAX_FILE_BYTES || total>MAX_TOTAL_BYTES {
            return Err("图片总大小超过限制".into());
        }
        let ext=match image.mime_type.as_str() {
            "image/jpeg" if bytes.starts_with(&[0xff,0xd8,0xff]) => "jpg",
            "image/png" if bytes.starts_with(b"\x89PNG\r\n\x1a\n") => "png",
            "image/webp" if bytes.len()>=12 && bytes.starts_with(b"RIFF") && &bytes[8..12]==b"WEBP" => "webp",
            _=>return Err("仅支持 JPG、PNG 和 WebP 图片；格式必须匹配文件内容".into()),
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
    stmt.query_map([batch_id],|row|Ok(SavedMedicalReport{id:row.get(0)?,title:row.get(1)?}))
        .map_err(|e|e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())
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
    let sources=decoded.iter().map(|x|x.source_id.as_str()).collect::<HashSet<_>>();
    let reports=input.draft.get("reports").and_then(Value::as_array).ok_or("识别草稿没有报告")?;
    if reports.is_empty() || reports.len()>16 {return Err("报告数量不正确".into());}
    for report in reports {validate_report(report,&sources)?;}
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
        let mut saved=Vec::new();
        for report in reports {
            let id=Uuid::new_v4().to_string();
            let title=required_str(report,"title",200)?.to_owned();
            let kind=required_str(report,"reportType",40)?;
            tx.execute("INSERT INTO medical_reports(id,user_id,batch_id,title,report_type,exam_at,facility,content_json,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",
                params![id,user,batch_id,title,kind,optional_str(report,"examAt",30)?,optional_str(report,"facility",500)?,report.to_string(),stamp])
                .map_err(|e|e.to_string())?;
            for source_id in report["sourceAssetIds"].as_array().ok_or("缺少源文件")? {
                let key=source_id.as_str().ok_or("无效源文件")?;
                let asset_id=by_source.get(key).ok_or("未知源文件")?;
                tx.execute("INSERT INTO medical_report_asset_links(report_id,asset_id) VALUES(?1,?2)",
                    params![id,asset_id]).map_err(|e|e.to_string())?;
            }
            for (position,section) in report["sections"].as_array().ok_or("缺少章节")?.iter().enumerate() {
                tx.execute("INSERT INTO medical_report_sections(id,report_id,position,content_json) VALUES(?1,?2,?3,?4)",
                    params![Uuid::new_v4().to_string(),id,position as i64,section.to_string()]).map_err(|e|e.to_string())?;
            }
            for (position,result) in report["observations"].as_array().ok_or("缺少结果")?.iter().enumerate() {
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
        stmt.query_map([user],|r|Ok(MedicalListItem{
            id:r.get(0)?,title:r.get(1)?,report_type:r.get(2)?,exam_at:r.get(3)?,
            facility:r.get(4)?,created_at:r.get(5)?,observation_count:r.get(6)?,
            attachment_count:r.get(7)?
        })).map_err(|e|e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())
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
        let assets=stmt.query_map(params![id,user],|r|Ok(MedicalAsset {
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
}
