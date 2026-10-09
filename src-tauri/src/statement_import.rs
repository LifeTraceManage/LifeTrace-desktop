//! Lossless source-statement staging store. Raw rows are NOT accounting transactions.
//! All records in a batch are inserted atomically, independent of classification.
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use base64::Engine;
use sha2::{Digest, Sha256};
use tauri::State;
use crate::desktop::DesktopState;

const MAX_ROWS: usize = 100_000;
const MAX_ROW_BYTES: usize = 64 * 1024;
const MAX_FILE_BYTES: usize = 32 * 1024 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatementRow {
    pub ordinal: usize,
    pub source_id: Option<String>,
    pub payload: Value,
    pub status: String,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveStatementRequest {
    pub source: String,
    pub filename: String,
    pub file_sha256: String,
    pub file_size: usize,
    pub file_base64: String,
    pub verified: bool,
    pub validation: Value,
    pub rows: Vec<StatementRow>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveStatementResult {
    pub batch_id: String,
    pub inserted: usize,
    pub existing: bool,
    pub persisted: usize,
}

fn schema(db: &Connection) -> Result<(), String> {
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS statement_import_batches(
            id TEXT PRIMARY KEY,
            source TEXT NOT NULL,
            filename TEXT NOT NULL,
            sha256 TEXT NOT NULL,
            original_file BLOB NOT NULL,
            file_size INTEGER NOT NULL,
            verified INTEGER NOT NULL,
            validation_json TEXT NOT NULL,
            row_count INTEGER NOT NULL,
            imported_at TEXT NOT NULL,
            UNIQUE(source, sha256)
        );
        CREATE TABLE IF NOT EXISTS statement_import_rows(
            batch_id TEXT NOT NULL REFERENCES statement_import_batches(id) ON DELETE CASCADE,
            ordinal INTEGER NOT NULL,
            external_id TEXT,
            status TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            PRIMARY KEY(batch_id, ordinal)
        );
        CREATE INDEX IF NOT EXISTS ix_statement_source_id
            ON statement_import_rows(external_id) WHERE external_id IS NOT NULL;"
    ).map_err(|e| e.to_string())
}
fn validate(req: &SaveStatementRequest) -> Result<(), String> {
    if !matches!(req.source.as_str(), "icbc" | "wechat" | "alipay" | "generic") {
        return Err("不支持的账单来源".into());
    }
    if req.file_size == 0 || req.file_size > MAX_FILE_BYTES ||
       req.filename.is_empty() || req.filename.len() > 512 {
        return Err("文件大小或名称不合法".into());
    }
    if req.file_base64.len() > (MAX_FILE_BYTES * 4 / 3 + 16) {
        return Err("来源文件过大".into());
    }
    if req.file_sha256.len() != 64 || !req.file_sha256.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("文件 SHA-256 不合法".into());
    }
    if req.rows.is_empty() || req.rows.len() > MAX_ROWS {
        return Err("账单行数不合法".into());
    }
    if req.validation.to_string().len() > 512 * 1024 {
        return Err("验证报告过大".into());
    }
    for (i, row) in req.rows.iter().enumerate() {
        if row.ordinal != i + 1 || !matches!(row.status.as_str(), "parsed" | "review" | "neutral" | "invalid") ||
           row.payload.is_null() || row.payload.to_string().len() > MAX_ROW_BYTES {
            return Err(format!("第 {} 行序号、状态或数据不合法", i + 1));
        }
    }
    if req.source == "icbc" && req.verified {
        let count = req.validation.get("transactions").and_then(Value::as_u64)
            .ok_or("银行校验报告缺少交易笔数")?;
        if count != req.rows.len() as u64 {
            return Err("银行校验笔数与保存记录数不一致".into());
        }
    }
    Ok(())
}
pub fn save(db: &mut Connection, req: &SaveStatementRequest) -> Result<SaveStatementResult, String> {
    validate(req)?;
    let original_file = base64::engine::general_purpose::STANDARD
        .decode(&req.file_base64).map_err(|_| "文件内容编码错误")?;
    if original_file.len() != req.file_size || format!("{:x}",Sha256::digest(&original_file)) != req.file_sha256.to_ascii_lowercase() {
        return Err("来源文件大小或哈希校验失败".into());
    }
    schema(db)?;
    let key = format!("{}:{}", req.source, req.file_sha256.to_ascii_lowercase());
    let batch_id = format!("{:x}", Sha256::digest(key.as_bytes()));
    let tx = db.transaction().map_err(|e| e.to_string())?;
    let old = tx.query_row("SELECT row_count,verified FROM statement_import_batches WHERE id=?1",
        [&batch_id], |row| Ok((row.get::<_, i64>(0)?,row.get::<_, bool>(1)?)))
        .optional().map_err(|e|e.to_string())?;
    if let Some((row_count,was_verified)) = old {
        let actual:i64=tx.query_row("SELECT COUNT(*) FROM statement_import_rows WHERE batch_id=?1",
            [&batch_id], |row|row.get(0)).map_err(|e|e.to_string())?;
        if actual!=row_count {return Err("已存在账单批次数据不完整，拒绝静默跳过".into());}
        // A previously unverified batch can be reparsed and upgraded without
        // losing the immutable source bytes or creating another batch.
        if !was_verified && req.verified {
            tx.execute("DELETE FROM statement_import_rows WHERE batch_id=?1",[&batch_id]).map_err(|e|e.to_string())?;
            for row in &req.rows {
                tx.execute("INSERT INTO statement_import_rows(batch_id,ordinal,external_id,status,payload_json) VALUES(?1,?2,?3,?4,?5)",
                    params![batch_id,row.ordinal,row.source_id,row.status,row.payload.to_string()])
                    .map_err(|e|e.to_string())?;
            }
            tx.execute("UPDATE statement_import_batches SET verified=1,validation_json=?2,row_count=?3 WHERE id=?1",
                params![batch_id,req.validation.to_string(),req.rows.len() as i64]).map_err(|e|e.to_string())?;
            let count:i64=tx.query_row("SELECT COUNT(*) FROM statement_import_rows WHERE batch_id=?1",
                [&batch_id],|row|row.get(0)).map_err(|e|e.to_string())?;
            if count!=req.rows.len() as i64 {return Err("升级入库笔数不一致".into());}
            tx.commit().map_err(|e|e.to_string())?;
            return Ok(SaveStatementResult{batch_id,inserted:req.rows.len(),existing:true,persisted:count as usize});
        }
        tx.commit().map_err(|e| e.to_string())?;
        return Ok(SaveStatementResult{batch_id,inserted:0,existing:true,persisted:actual as usize});
    }
    tx.execute("INSERT INTO statement_import_batches
        (id,source,filename,sha256,original_file,file_size,verified,validation_json,row_count,imported_at)
        VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
        params![batch_id,req.source,req.filename,req.file_sha256.to_ascii_lowercase(),
            original_file,req.file_size as i64,req.verified,req.validation.to_string(),req.rows.len() as i64,
            chrono::Utc::now().to_rfc3339()]
    ).map_err(|e| e.to_string())?;
    for row in &req.rows {
        tx.execute("INSERT INTO statement_import_rows(batch_id,ordinal,external_id,status,payload_json)
            VALUES(?1,?2,?3,?4,?5)",
            params![batch_id,row.ordinal,row.source_id,row.status,row.payload.to_string()]
        ).map_err(|e| e.to_string())?;
    }
    let actual:i64 = tx.query_row("SELECT COUNT(*) FROM statement_import_rows WHERE batch_id=?1",
        [&batch_id], |row| row.get(0)).map_err(|e| e.to_string())?;
    if actual != req.rows.len() as i64 {
        return Err("入库记录数不匹配，事务已回滚".into());
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(SaveStatementResult{batch_id,inserted:req.rows.len(),existing:false,persisted:actual as usize})
}


#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredBatch { pub id:String, pub source:String, pub filename:String, pub verified:bool, pub expected_rows:i64, pub stored_rows:i64 }
pub fn list_batches(db:&Connection)->Result<Vec<StoredBatch>,String>{
    schema(db)?;
    let mut stmt=db.prepare("SELECT b.id,b.source,b.filename,b.verified,b.row_count,COUNT(r.ordinal)
        FROM statement_import_batches b LEFT JOIN statement_import_rows r ON r.batch_id=b.id
        GROUP BY b.id ORDER BY b.imported_at DESC").map_err(|e|e.to_string())?;
    stmt.query_map([],|row|Ok(StoredBatch{
        id:row.get(0)?,source:row.get(1)?,filename:row.get(2)?,
        verified:row.get(3)?,expected_rows:row.get(4)?,stored_rows:row.get(5)?
    })).map_err(|e|e.to_string())?.collect::<rusqlite::Result<Vec<_>>>().map_err(|e|e.to_string())
}
#[tauri::command]
pub async fn statement_list_batches(state:State<'_,DesktopState>)->Result<Vec<StoredBatch>,String>{
    let path=state.data_dir.join("lifetrace.db");
    tauri::async_runtime::spawn_blocking(move || {
        let db=crate::database::connection::open(&path).map_err(|e|e.to_string())?;
        list_batches(&db)
    }).await.map_err(|e|e.to_string())?
}

#[tauri::command]
pub async fn statement_save_raw(
    state: State<'_, DesktopState>,
    request: SaveStatementRequest,
) -> Result<SaveStatementResult, String> {
    let path = state.data_dir.join("lifetrace.db");
    tauri::async_runtime::spawn_blocking(move || {
        let mut db = crate::database::connection::open(&path).map_err(|e| e.to_string())?;
        save(&mut db, &request)
    }).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    fn request() -> SaveStatementRequest {
        SaveStatementRequest {
            source:"icbc".into(), filename:"bank.pdf".into(),
            file_sha256:format!("{:x}",Sha256::digest(b"fixture")),file_size:7,
            file_base64:base64::engine::general_purpose::STANDARD.encode(b"fixture"),verified:true,
            validation:serde_json::json!({"transactions":2}),
            rows:vec![
                StatementRow{ordinal:1,source_id:None,payload:serde_json::json!({"amount":"-1.00","balance":"9.00"}),status:"parsed".into()},
                StatementRow{ordinal:2,source_id:None,payload:serde_json::json!({"amount":"+2.00","balance":"11.00"}),status:"review".into()}
            ]
        }
    }
    #[test]
    fn atomic_save_idempotent_and_complete() {
        let mut db=Connection::open_in_memory().unwrap();
        let r=save(&mut db,&request()).unwrap();
        assert_eq!((r.inserted,r.persisted,r.existing),(2,2,false));
        let again=save(&mut db,&request()).unwrap();
        assert_eq!((again.inserted,again.persisted,again.existing),(0,2,true));
        let total:i64=db.query_row("SELECT COUNT(*) FROM statement_import_rows",[],|r|r.get(0)).unwrap();
        assert_eq!(total,2);
        let batches=list_batches(&db).unwrap();
        assert_eq!((batches[0].expected_rows,batches[0].stored_rows),(2,2));
    }
    #[test]
    fn invalid_batch_never_partially_imported() {
        let mut db=Connection::open_in_memory().unwrap();
        let mut req=request();
        req.rows[1].ordinal=999;
        assert!(save(&mut db,&req).is_err());
        req.rows[1].ordinal=2;
        req.verified=false;
        assert_eq!(save(&mut db,&req).unwrap().inserted,2);
        req.verified=true;
        assert_eq!(save(&mut db,&req).unwrap().inserted,0);
    }
}