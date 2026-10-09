//! Portable, UNENCRYPTED backup of the current profile's medical report archive.
//! Writes a self-contained folder: manifest.json + exact original media bytes.
//! A backup is complete only after a successful atomic folder rename.
use std::{collections::{HashMap, HashSet}, fs, path::{Path, PathBuf}};
use chrono::Utc;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tauri::State;
use uuid::Uuid;

use crate::{database, desktop::DesktopState};

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ArchiveAsset {
    id: String,
    original_name: String,
    mime_type: String,
    sha256: String,
    filename: String,
    bytes_size: u64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ArchiveReport {
    id: String,
    title: String,
    report_type: String,
    exam_at: Option<String>,
    facility: Option<String>,
    content: Value,
    created_at: String,
    asset_ids: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ArchiveRevision {
    report_id: String,
    request_key: String,
    old_content: Value,
    new_content: Value,
    created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MedicalBackup {
    format: String,
    version: u32,
    created_at: String,
    assets: Vec<ArchiveAsset>,
    reports: Vec<ArchiveReport>,
    revisions: Vec<ArchiveRevision>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MedicalBackupResult {
    pub path: String,
    pub reports: usize,
    pub files: usize,
}

fn open_db(root: &Path) -> Result<rusqlite::Connection, String> {
    database::connection::open(&root.join("lifetrace.db"))
        .map_err(|_| "无法打开本地数据库".to_owned())
}

fn safe_filename(name: &str) -> bool {
    !name.is_empty() && name.len() <= 128 && !name.contains("..")
        && !name.contains('/') && !name.contains('\\')
        && name.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-' || c == b'.')
}

fn load_snapshot(root: &Path) -> Result<MedicalBackup, String> {
    let db=open_db(root)?;
    let owner=database::profile::active_profile_id(&db)?;
    let mut report_query=db.prepare(
        "SELECT id,title,report_type,exam_at,facility,content_json,created_at
        FROM medical_reports WHERE user_id=?1 ORDER BY created_at,id"
    ).map_err(|e|e.to_string())?;
    let mut reports:Vec<ArchiveReport>=report_query.query_map([&owner],|r|{
        let content:String=r.get(5)?;
        Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,
            r.get::<_,Option<String>>(3)?,r.get::<_,Option<String>>(4)?,
            content,r.get::<_,String>(6)?))
    }).map_err(|e|e.to_string())?.map(|r|{
        let (id,title,report_type,exam_at,facility,content,created_at)=r.map_err(|e|e.to_string())?;
        Ok(ArchiveReport{id,title,report_type,exam_at,facility,
            content:serde_json::from_str(&content).map_err(|_|"报告原文 JSON 无效")?,
            created_at,asset_ids:Vec::new()})
    }).collect::<Result<Vec<_>,String>>()?;
    drop(report_query);
    let mut all_ids=HashSet::new();
    for report in &mut reports {
        let mut stmt=db.prepare("SELECT a.id FROM medical_report_assets a
          JOIN medical_report_asset_links l ON l.asset_id=a.id
          WHERE l.report_id=?1 AND a.user_id=?2 ORDER BY a.rowid")
            .map_err(|e|e.to_string())?;
        report.asset_ids=stmt.query_map(params![report.id,owner],|r|r.get(0))
            .map_err(|e|e.to_string())?.collect::<Result<Vec<String>,_>>()
            .map_err(|e|e.to_string())?;
        if report.asset_ids.is_empty(){return Err("报告缺少原始附件，不允许生成不完整备份".into());}
        all_ids.extend(report.asset_ids.iter().cloned());
    }
    let mut assets=Vec::new();
    for id in all_ids {
        let asset:ArchiveAsset=db.query_row(
            "SELECT id,original_name,mime_type,sha256,relative_path,bytes_size
             FROM medical_report_assets WHERE id=?1 AND user_id=?2",
             params![id,owner],|r|Ok(ArchiveAsset{
                 id:r.get(0)?, original_name:r.get(1)?, mime_type:r.get(2)?,
                 sha256:r.get(3)?,filename:r.get(4)?,
                 bytes_size:r.get::<_,i64>(5)? as u64,
             })
        ).map_err(|_|"医疗档案存在无效的原图引用")?;
        if !safe_filename(&asset.filename){return Err("不合法的医疗附件文件路径".into());}
        assets.push(asset);
    }
    assets.sort_by(|a,b|a.id.cmp(&b.id));
    let mut revisions=Vec::new();
    let mut stmt=db.prepare(
        "SELECT rv.report_id,rv.request_key,rv.old_content_json,rv.new_content_json,rv.created_at
         FROM medical_report_revisions rv JOIN medical_reports r ON rv.report_id=r.id
         WHERE r.user_id=?1 ORDER BY rv.created_at,rv.id"
    ).map_err(|e|e.to_string())?;
    let rows=stmt.query_map([owner],|r|Ok((
        r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,
        r.get::<_,String>(3)?,r.get::<_,String>(4)?
    ))).map_err(|e|e.to_string())?;
    for row in rows {
        let (report_id,request_key,old_content,new_content,created_at)=row.map_err(|e|e.to_string())?;
        revisions.push(ArchiveRevision{report_id,request_key,
            old_content:serde_json::from_str(&old_content).map_err(|_|"历史报告数据损坏")?,
            new_content:serde_json::from_str(&new_content).map_err(|_|"历史报告数据损坏")?,
            created_at});
    }
    Ok(MedicalBackup{
        format:"lifetrace-medical-backup".into(),
        version:1,created_at:Utc::now().to_rfc3339(),assets,reports,revisions,
    })
}

fn export_backup(root: &Path, destination: &Path) -> Result<MedicalBackupResult,String> {
    if !destination.is_absolute() || !destination.is_dir() {
        return Err("请选择存在的本机备份目标文件夹".into());
    }
    let snapshot=load_snapshot(root)?;
    let marker=Uuid::new_v4().to_string();
    let folder=format!("LifeTrace-medical-{}-{}",Utc::now().format("%Y%m%d"),&marker[..8]);
    let final_path=destination.join(folder);
    let staging=destination.join(format!(".lifetrace-medical-{marker}.tmp"));
    fs::create_dir(&staging).map_err(|_|"无法创建临时备份文件夹".to_owned())?;
    let result=(|| {
        fs::create_dir(staging.join("files")).map_err(|_|"无法创建附件备份目录")?;
        for asset in &snapshot.assets {
            let source=root.join("medical/originals").join(&asset.filename);
            let bytes=fs::read(&source).map_err(|_|"医疗报告原图丢失，备份已中止")?;
            if bytes.len() as u64!=asset.bytes_size ||
                format!("{:x}",Sha256::digest(&bytes))!=asset.sha256 {
                return Err("医疗原件内容与数据库哈希不一致，备份中止".to_owned());
            }
            fs::write(staging.join("files").join(&asset.filename),bytes)
                .map_err(|_|"无法写入原始报告备份文件")?;
        }
        let manifest=serde_json::to_vec_pretty(&snapshot).map_err(|_|"无法序列化医疗报告备份")?;
        fs::write(staging.join("manifest.json"),manifest).map_err(|_|"无法写入备份清单")?;
        fs::rename(&staging,&final_path).map_err(|_|"无法完成医疗档案备份文件夹")?;
        Ok(MedicalBackupResult{
            path:final_path.to_string_lossy().into_owned(),
            reports:snapshot.reports.len(),files:snapshot.assets.len(),
        })
    })();
    if result.is_err(){let _=fs::remove_dir_all(&staging);}
    result
}

fn remap_payload(raw:&Value,mapping:&HashMap<String,String>)->Result<Value,String>{
    let mut v=raw.clone();
    for id in v["sourceAssetIds"].as_array_mut().ok_or("旧报告缺少附件引用")? {
        let before=id.as_str().ok_or("无效历史文件 ID")?;
        *id=Value::String(mapping.get(before).ok_or("找不到备份原图关联")?.clone());
    }
    for key in ["sections","observations"] {
        for item in v[key].as_array_mut().ok_or("旧报告缺少结构化记录")? {
            let before=item["sourceAssetId"].as_str().ok_or("旧结果无来源文件")?;
            item["sourceAssetId"]=Value::String(mapping.get(before).ok_or("历史结果附件已丢失")?.clone());
        }
    }
    Ok(v)
}

/// Restore data to the current local profile; reject duplicate originals instead of silently
/// creating multiple copies. Every file is checked before mutating the target database.
fn import_backup(root:&Path,source:&Path)->Result<MedicalBackupResult,String>{
    if !source.is_absolute() || !source.is_dir(){return Err("请选择完整的医疗档案备份目录".into());}
    let manifest_bytes=fs::read(source.join("manifest.json"))
        .map_err(|_|"目录中找不到医疗备份 manifest.json")?;
    if manifest_bytes.len()>32*1024*1024 {return Err("备份清单超过安全大小限制".into());}
    let backup:MedicalBackup=serde_json::from_slice(&manifest_bytes).map_err(|_|"医疗备份清单 JSON 无效")?;
    if backup.format!="lifetrace-medical-backup"||backup.version!=1{
        return Err("不支持的医疗档案备份格式或版本".into());
    }
    if backup.assets.len()>10_000||backup.reports.len()>10_000||backup.revisions.len()>50_000{
        return Err("医疗备份记录数量超过安全限制".into());
    }
    let linked_ids=backup.assets.iter().map(|a|a.id.as_str()).collect::<HashSet<_>>();
    if linked_ids.len()!=backup.assets.len(){return Err("备份存在重复附件 ID".into());}
    let mut seen_hashes=HashSet::new();
    let mut verified_files=Vec::<PathBuf>::new();
    for asset in &backup.assets {
        if !safe_filename(&asset.filename)||!seen_hashes.insert(asset.sha256.as_str()){
            return Err("备份文件名非法或同份报告原件重复".into());
        }
        let path=source.join("files").join(&asset.filename);
        // Do not follow a symlink outside the selected backup directory.
        let real=fs::canonicalize(&path).map_err(|_|"备份附件丢失")?;
        let base=fs::canonicalize(source.join("files")).map_err(|_|"备份附件目录损坏")?;
        if !real.starts_with(base) {return Err("备份附件路径不安全".into());}
        use std::io::Read;
        let mut reader=fs::File::open(&real).map_err(|_|"无法读取备份附件")?;
        let mut hasher=Sha256::new();
        let mut total=0u64;
        let mut buffer=[0u8;65536];
        loop {
            let read=reader.read(&mut buffer).map_err(|_|"读取备份附件失败")?;
            if read==0 {break;}
            total+=read as u64;
            if total>20*1024*1024 {return Err("备份中单个原件超过 20 MiB".into());}
            hasher.update(&buffer[..read]);
        }
        if total!=asset.bytes_size||format!("{:x}",hasher.finalize())!=asset.sha256 {
            return Err("备份附件完整性验证失败".into());
        }
        verified_files.push(real);
    }
    let reports_by_id=backup.reports.iter().map(|r|r.id.as_str()).collect::<HashSet<_>>();
    if reports_by_id.len()!=backup.reports.len(){return Err("备份报告 ID 重复".into());}
    if backup.revisions.iter().any(|r|!reports_by_id.contains(r.report_id.as_str())) ||
        backup.reports.iter().any(|r|
            r.asset_ids.is_empty() || r.asset_ids.iter().any(|id|!linked_ids.contains(id.as_str()))) {
        return Err("备份报告与附件关联不完整".into());
    }
    let mut db=open_db(root)?;
    let owner=database::profile::active_profile_id(&db)?;
    for asset in &backup.assets {
        let already:Option<i64>=db.query_row(
          "SELECT 1 FROM medical_report_assets WHERE user_id=?1 AND sha256=?2",
          params![owner,asset.sha256],|r|r.get(0))
          .optional().map_err(|e|e.to_string())?;
        if already.is_some(){return Err("备份中的原始报告已存在，禁止重复恢复".into());}
    }
    let target=root.join("medical/originals");
    fs::create_dir_all(&target).map_err(|_|"无法创建本机医疗档案目录")?;
    let mut created=Vec::<PathBuf>::new();
    let result=(|| {
        let mut mapped=HashMap::<String,String>::new();
        let mut filenames=Vec::new();
        for asset in &backup.assets {
            let new_id=Uuid::new_v4().to_string();
            let ext=asset.filename.rsplit_once('.').map(|x|x.1).ok_or("附件缺少扩展名")?;
            if !matches!(ext,"pdf"|"png"|"jpg"|"webp") {return Err("备份含不支持的原始文件格式".into());}
            let new_file=format!("{new_id}.{ext}");
            mapped.insert(asset.id.clone(),new_id);
            filenames.push(new_file);
        }
        for (source,file) in verified_files.iter().zip(&filenames) {
            let path=target.join(file);
            let handle=fs::OpenOptions::new().write(true).create_new(true)
                .open(&path).map_err(|_|"备份还原原图失败")?;
            created.push(path.clone());
            drop(handle);
            fs::copy(source,&path).map_err(|_|"备份原图写入失败")?;
            fs::File::open(&path).and_then(|f|f.sync_all())
                .map_err(|_|"备份原图落盘失败")?;
        }
        let tx=db.transaction().map_err(|e|e.to_string())?;
        let batch_id=Uuid::new_v4().to_string();
        tx.execute("INSERT INTO medical_import_batches (id,user_id,idempotency_key,created_at)
            VALUES (?1,?2,?3,?4)",
            params![batch_id,owner,format!("backup-{}",Uuid::new_v4()),Utc::now().to_rfc3339()])
            .map_err(|e|e.to_string())?;
        for (asset,file) in backup.assets.iter().zip(&filenames) {
            tx.execute("INSERT INTO medical_report_assets
                (id,user_id,batch_id,source_asset_id,original_name,mime_type,bytes_size,sha256,relative_path)
                VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
                params![mapped[&asset.id],owner,batch_id,asset.id,asset.original_name,
                    asset.mime_type,asset.bytes_size as i64,asset.sha256,file])
                .map_err(|e|e.to_string())?;
        }
        let mut report_ids=HashMap::<String,String>::new();
        for report in &backup.reports {
            let id=Uuid::new_v4().to_string();
            report_ids.insert(report.id.clone(),id.clone());
            let data=remap_payload(&report.content,&mapped)?;
            tx.execute("INSERT INTO medical_reports
               (id,user_id,batch_id,title,report_type,exam_at,facility,content_json,created_at)
               VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
               params![id,owner,batch_id,report.title,report.report_type,report.exam_at,
                   report.facility,data.to_string(),report.created_at])
               .map_err(|e|e.to_string())?;
            for old in &report.asset_ids {
                tx.execute("INSERT INTO medical_report_asset_links(report_id,asset_id) VALUES(?1,?2)",
                  params![id,mapped[old]]).map_err(|e|e.to_string())?;
            }
            for (index,section) in data["sections"].as_array().ok_or("备份缺少原文章节")?.iter().enumerate(){
                tx.execute("INSERT INTO medical_report_sections(id,report_id,position,content_json) VALUES(?1,?2,?3,?4)",
                    params![Uuid::new_v4().to_string(),id,index as i64,section.to_string()])
                    .map_err(|e|e.to_string())?;
            }
            for (index,obs) in data["observations"].as_array().ok_or("备份缺少指标结果")?.iter().enumerate() {
                tx.execute("INSERT INTO medical_observations
                    (id,report_id,position,name_raw,metric_key,value_number,unit_raw,content_json)
                    VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
                    params![Uuid::new_v4().to_string(),id,index as i64,
                        obs["nameRaw"].as_str().ok_or("备份指标名缺失")?,
                        obs["metricKey"].as_str(),obs["valueNumber"].as_f64(),
                        obs["unitRaw"].as_str(),obs.to_string()])
                    .map_err(|e|e.to_string())?;
            }
        }
        for revision in &backup.revisions {
            let id=&report_ids[&revision.report_id];
            let previous=remap_payload(&revision.old_content,&mapped)?;
            let updated=remap_payload(&revision.new_content,&mapped)?;
            tx.execute("INSERT INTO medical_report_revisions
                (id,report_id,request_key,old_content_json,new_content_json,created_at)
                VALUES (?1,?2,?3,?4,?5,?6)",
                params![Uuid::new_v4().to_string(),id,revision.request_key,
                    previous.to_string(),updated.to_string(),revision.created_at])
                .map_err(|e|e.to_string())?;
        }
        tx.commit().map_err(|e|e.to_string())?;
        Ok(MedicalBackupResult{path:source.to_string_lossy().into_owned(),
            reports:backup.reports.len(),files:backup.assets.len()})
    })();
    if result.is_err(){for p in created{let _=fs::remove_file(p);}}
    result
}

#[tauri::command]
pub async fn medical_export_backup(state:State<'_,DesktopState>,directory:String)
    ->Result<MedicalBackupResult,String>{
    let root=state.data_dir.clone();
    tauri::async_runtime::spawn_blocking(move||export_backup(&root,Path::new(&directory)))
        .await.map_err(|_|"医疗档案备份任务中断".to_owned())?
}

#[tauri::command]
pub async fn medical_import_backup(state:State<'_,DesktopState>,directory:String)
    ->Result<MedicalBackupResult,String>{
    let root=state.data_dir.clone();
    tauri::async_runtime::spawn_blocking(move||import_backup(&root,Path::new(&directory)))
        .await.map_err(|_|"医疗档案恢复任务中断".to_owned())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_filename_escape_and_unknown_versions() {
        assert!(!safe_filename("../test.pdf"));
        assert!(!safe_filename("..\\test.pdf"));
        assert!(!safe_filename("/etc/passwd"));
        assert!(safe_filename("dbeef.pdf"));
        let corrupted=serde_json::json!({"sourceAssetIds":["x"],"sections":[],
          "observations":[{"sourceAssetId":"x"}]});
        assert!(remap_payload(&corrupted,&HashMap::new()).is_err());
    }
}
