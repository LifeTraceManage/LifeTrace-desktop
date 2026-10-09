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
            ON statement_import_rows(external_id) WHERE external_id IS NOT NULL;
        CREATE TABLE IF NOT EXISTS statement_transaction_matches (
            bank_batch_id TEXT NOT NULL,
            bank_ordinal INTEGER NOT NULL,
            payment_batch_id TEXT NOT NULL,
            payment_ordinal INTEGER NOT NULL,
            reason TEXT NOT NULL,
            matched_at TEXT NOT NULL,
            PRIMARY KEY(bank_batch_id,bank_ordinal),
            UNIQUE(payment_batch_id,payment_ordinal),
            FOREIGN KEY(bank_batch_id,bank_ordinal)
                REFERENCES statement_import_rows(batch_id,ordinal) ON DELETE CASCADE,
            FOREIGN KEY(payment_batch_id,payment_ordinal)
                REFERENCES statement_import_rows(batch_id,ordinal) ON DELETE CASCADE
        );"
    ).map_err(|e| e.to_string())
}

fn signed_cents(raw: &str) -> Result<i64, String> {
    let raw = raw.replace(',', "");
    let (sign, number) = if let Some(v) = raw.strip_prefix('-') {
        (-1_i64, v)
    } else if let Some(v) = raw.strip_prefix('+') {
        (1_i64, v)
    } else {
        (1_i64, raw.as_str())
    };
    let (whole, fraction) = number.split_once('.').ok_or("银行金额缺少小数位")?;
    if whole.is_empty() || !whole.bytes().all(|b| b.is_ascii_digit())
        || fraction.len() != 2 || !fraction.bytes().all(|b| b.is_ascii_digit()) {
        return Err("银行金额格式不合法".into());
    }
    let major = whole.parse::<i64>().map_err(|e|e.to_string())?;
    let minor = fraction.parse::<i64>().map_err(|e|e.to_string())?;
    major.checked_mul(100).and_then(|v|v.checked_add(minor))
        .and_then(|v|v.checked_mul(sign)).ok_or("银行金额溢出".into())
}
fn bank_text<'a>(v: &'a Value, key: &str) -> Result<&'a str, String> {
    v.get(key).and_then(Value::as_str).filter(|v|!v.trim().is_empty())
        .ok_or_else(||format!("银行记录缺少字段 {key}"))
}
#[derive(Default)]
struct PageTotals { count: u64, income: i64, expense: i64 }
fn validate_verified_bank(req: &SaveStatementRequest) -> Result<(), String> {
    let reported = req.validation.get("transactions").and_then(Value::as_u64)
        .ok_or("银行校验报告缺少交易笔数")?;
    if reported != req.rows.len() as u64 {
        return Err("银行校验笔数与保存记录数不一致".into());
    }
    let reports = req.validation.get("pages").and_then(Value::as_array)
        .ok_or("银行校验报告缺少逐页校验").and_then(|v|
            if v.is_empty(){Err("银行校验报告为空".into())}else{Ok(v)})?;
    if req.validation.get("balanceErrors").and_then(Value::as_array)
        .is_some_and(|v|!v.is_empty()) {
        return Err("银行余额校验报告含异常".into());
    }
    let mut totals = std::collections::BTreeMap::<u64,PageTotals>::new();
    let mut prior: Option<(String,i64)> = None;
    for row in &req.rows {
        let page=row.payload.get("page").and_then(Value::as_u64)
            .filter(|v|*v>0).ok_or("银行流水缺少页码")?;
        let index=row.payload.get("row").and_then(Value::as_u64)
            .ok_or("银行流水缺少页内序号")?;
        let account=bank_text(&row.payload,"account")?;
        let _date=bank_text(&row.payload,"date")?;
        let _time=bank_text(&row.payload,"time")?;
        let amount=signed_cents(bank_text(&row.payload,"amount")?)?;
        let balance=signed_cents(bank_text(&row.payload,"balance")?)?;
        let entry=totals.entry(page).or_default();
        if index != entry.count+1 {return Err("银行页内流水不连续".into());}
        entry.count+=1;
        if amount>=0 {
            entry.income=entry.income.checked_add(amount).ok_or("银行合计溢出")?;
        } else {
            entry.expense=entry.expense.checked_add(-amount).ok_or("银行合计溢出")?;
        }
        if let Some((prev_account,prev_balance))=&prior {
            if prev_account==account && prev_balance.checked_add(amount)!=Some(balance) {
                return Err(format!("银行第 {} 页第 {} 笔余额不连续",page,index));
            }
        }
        prior=Some((account.to_owned(),balance));
    }
    if totals.len()!=reports.len(){return Err("银行页数与校验报告不一致".into());}
    for (i,report) in reports.iter().enumerate() {
        let page=(i+1) as u64;
        let expected_page=report.get("page").and_then(Value::as_u64)
            .ok_or("银行报告缺少页码")?;
        if expected_page!=page || report.get("valid").and_then(Value::as_bool)!=Some(true){
            return Err("银行页面验收未通过".into());
        }
        let sum=totals.get(&page).ok_or("银行缺少交易页")?;
        let count=report.get("expectedCount").and_then(Value::as_u64)
            .ok_or("银行报告缺少页内笔数")?;
        let income=signed_cents(report.get("expectedIncome").and_then(Value::as_str)
            .ok_or("银行报告缺少收入合计")?)?;
        let expense=signed_cents(report.get("expectedExpense").and_then(Value::as_str)
            .ok_or("银行报告缺少支出合计")?)?;
        if count!=sum.count || income!=sum.income || expense!=sum.expense {
            return Err(format!("银行第 {page} 页金额或笔数不一致"));
        }
    }
    Ok(())
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
    if req.source == "icbc" && req.verified { validate_verified_bank(req)?; }
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
    let rows = stmt.query_map([],|row|Ok(StoredBatch{
        id:row.get(0)?,source:row.get(1)?,filename:row.get(2)?,
        verified:row.get(3)?,expected_rows:row.get(4)?,stored_rows:row.get(5)?
    })).map_err(|e|e.to_string())?;
    let batches = rows.collect::<rusqlite::Result<Vec<_>>>().map_err(|e|e.to_string())?;
    Ok(batches)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatementMatch {
    pub bank_batch_id:String, pub bank_ordinal:i64,
    pub payment_batch_id:String, pub payment_ordinal:i64,
    pub reason:String,
}
// Every invocation represents the full set of currently unambiguous inferred links.
// Remove stale inference when a later statement makes an earlier match ambiguous.
// Never touch future explicitly confirmed (non-inferred) links.
pub fn save_matches(db:&mut Connection, matches:&[StatementMatch])->Result<usize,String>{
    schema(db)?;
    let tx=db.transaction().map_err(|e|e.to_string())?;
    tx.execute("DELETE FROM statement_transaction_matches WHERE reason=?1",
        ["unique-card-time-channel"]).map_err(|e|e.to_string())?;
    for item in matches {
        if item.reason!="unique-card-time-channel" || item.bank_ordinal<1 || item.payment_ordinal<1 {
            return Err("对账匹配依据或序号无效".into());
        }
        let (bank_source,payment_source):(String,String)=tx.query_row(
          "SELECT (SELECT source FROM statement_import_batches WHERE id=?1),
                  (SELECT source FROM statement_import_batches WHERE id=?2)",
          params![item.bank_batch_id,item.payment_batch_id],
          |row|Ok((row.get(0)?,row.get(1)?))).map_err(|e|e.to_string())?;
        if bank_source!="icbc" || !matches!(payment_source.as_str(),"wechat"|"alipay"){
            return Err("对账只能关联工商银行及微信或支付宝流水".into());
        }
        tx.execute("INSERT INTO statement_transaction_matches
            (bank_batch_id,bank_ordinal,payment_batch_id,payment_ordinal,reason,matched_at)
            VALUES(?1,?2,?3,?4,?5,?6)",
            params![item.bank_batch_id,item.bank_ordinal,item.payment_batch_id,
                item.payment_ordinal,item.reason,chrono::Utc::now().to_rfc3339()])
            .map_err(|e|e.to_string())?;
    }
    tx.commit().map_err(|e|e.to_string())?;
    Ok(matches.len())
}
#[tauri::command]
pub async fn statement_save_matches(state:State<'_,DesktopState>,matches:Vec<StatementMatch>)
    ->Result<usize,String>{
    if matches.len()>100_000 {return Err("对账条目过多".into());}
    let path=state.data_dir.join("lifetrace.db");
    tauri::async_runtime::spawn_blocking(move ||{
        let mut db=crate::database::connection::open(&path).map_err(|e|e.to_string())?;
        save_matches(&mut db,&matches)
    }).await.map_err(|e|e.to_string())?
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchivedStatementRow {
    pub batch_id: String,
    pub ordinal: i64,
    pub source: String,
    pub status: String,
    pub payload: Value,
}
pub fn list_raw_rows(db: &Connection) -> Result<Vec<ArchivedStatementRow>, String> {
    schema(db)?;
    let mut stmt=db.prepare(
        "SELECT r.batch_id,r.ordinal,b.source,r.status,r.payload_json
         FROM statement_import_rows r JOIN statement_import_batches b ON b.id=r.batch_id
         ORDER BY b.imported_at,r.ordinal"
    ).map_err(|e|e.to_string())?;
    let rows=stmt.query_map([],|row|{
        let payload_json:String=row.get(4)?;
        Ok((row.get::<_,String>(0)?,row.get::<_,i64>(1)?,
            row.get::<_,String>(2)?,row.get::<_,String>(3)?,payload_json))
    }).map_err(|e|e.to_string())?;
    let values=rows.collect::<rusqlite::Result<Vec<_>>>().map_err(|e|e.to_string())?;
    values.into_iter().map(|(batch_id,ordinal,source,status,json)|{
        Ok(ArchivedStatementRow{batch_id,ordinal,source,status,
            payload:serde_json::from_str(&json).map_err(|e:serde_json::Error|e.to_string())?})
    }).collect()
}
#[tauri::command]
pub async fn statement_list_raw_rows(state:State<'_,DesktopState>)
    ->Result<Vec<ArchivedStatementRow>,String>{
    let path=state.data_dir.join("lifetrace.db");
    tauri::async_runtime::spawn_blocking(move ||{
        let db=crate::database::connection::open(&path).map_err(|e|e.to_string())?;
        list_raw_rows(&db)
    }).await.map_err(|e|e.to_string())?
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
            validation:serde_json::json!({"transactions":2,"balanceErrors":[],"pages":[{"page":1,"valid":true,"expectedCount":2,"expectedIncome":"2.00","expectedExpense":"1.00"}]}),
            rows:vec![
                StatementRow{ordinal:1,source_id:None,payload:serde_json::json!({"page":1,"row":1,"date":"2026-06-01","time":"08:00:00","account":"BANK1234","amount":"-1.00","balance":"9.00"}),status:"parsed".into()},
                StatementRow{ordinal:2,source_id:None,payload:serde_json::json!({"page":1,"row":2,"date":"2026-06-01","time":"09:00:00","account":"BANK1234","amount":"+2.00","balance":"11.00"}),status:"review".into()}
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
        assert_eq!(list_raw_rows(&db).unwrap().len(),2);
    }
    #[test]
    fn verified_reparse_upgrades_prior_unverified_batch() {
        let mut db=Connection::open_in_memory().unwrap();
        let mut req=request();
        req.verified=false;
        req.rows[0].status="review".into();
        assert_eq!(save(&mut db,&req).unwrap().inserted,2);
        req.verified=true;
        req.rows[0].status="parsed".into();
        let upgraded=save(&mut db,&req).unwrap();
        assert!(upgraded.existing);
        assert_eq!((upgraded.inserted,upgraded.persisted),(2,2));
        let status:String=db.query_row("SELECT status FROM statement_import_rows WHERE ordinal=1",[],|r|r.get(0)).unwrap();
        assert_eq!(status,"parsed");
        let verified:bool=db.query_row("SELECT verified FROM statement_import_batches",[],|r|r.get(0)).unwrap();
        assert!(verified);
    }
    #[test]
    fn checked_bank_totals_reject_corrupt_rows() {
        let mut req=request();
        assert!(validate(&req).is_ok());
        req.rows[1].payload["balance"]=serde_json::json!("9.00");
        assert!(validate(&req).unwrap_err().contains("余额不连续"));
        req.rows[1].payload["balance"]=serde_json::json!("11.00");
        req.validation["pages"][0]["expectedIncome"]=serde_json::json!("99.00");
        assert!(validate(&req).unwrap_err().contains("金额或笔数不一致"));
    }
    #[test]
    fn persistent_matches_enforce_one_to_one_and_idempotence() {
        let mut db=Connection::open_in_memory().unwrap();
        let bank=save(&mut db,&request()).unwrap();
        let mut payment=request();
        payment.source="wechat".into();
        payment.verified=false;
        let wx=save(&mut db,&payment).unwrap();
        let link=StatementMatch{
            bank_batch_id:bank.batch_id.clone(),bank_ordinal:1,
            payment_batch_id:wx.batch_id.clone(),payment_ordinal:1,
            reason:"unique-card-time-channel".into(),
        };
        assert_eq!(save_matches(&mut db,&[link]).unwrap(),1);
        let duplicate=StatementMatch{
            bank_batch_id:bank.batch_id.clone(),bank_ordinal:1,
            payment_batch_id:wx.batch_id.clone(),payment_ordinal:1,
            reason:"unique-card-time-channel".into(),
        };
        assert_eq!(save_matches(&mut db,&[duplicate]).unwrap(),1);
        let conflict=StatementMatch{
            bank_batch_id:bank.batch_id,bank_ordinal:2,
            payment_batch_id:wx.batch_id,payment_ordinal:1,
            reason:"unique-card-time-channel".into(),
        };
        let first_again=StatementMatch{
            bank_batch_id:conflict.bank_batch_id.clone(),bank_ordinal:1,
            payment_batch_id:conflict.payment_batch_id.clone(),payment_ordinal:1,
            reason:"unique-card-time-channel".into(),
        };
        assert!(save_matches(&mut db,&[first_again,conflict]).is_err());
        let count:i64=db.query_row("SELECT COUNT(*) FROM statement_transaction_matches",[],|r|r.get(0)).unwrap();
        assert_eq!(count,1);
        assert_eq!(save_matches(&mut db,&[]).unwrap(),0);
        let empty:i64=db.query_row("SELECT COUNT(*) FROM statement_transaction_matches",[],|r|r.get(0)).unwrap();
        assert_eq!(empty,0);
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
        assert_eq!(save(&mut db,&req).unwrap().inserted,2);
    }
}