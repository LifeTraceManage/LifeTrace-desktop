use rusqlite::Transaction;
use crate::database::migration_runner::{Migration, MigrationContext, MigrationError, MigrationReport};

/// Local-only medical examinations. No sync triggers and no encryption.
pub struct M0022MedicalReports;

impl Migration for M0022MedicalReports {
    fn version(&self) -> i64 { 22 }
    fn name(&self) -> &'static str { "medical-reports-local-only" }
    fn checksum(&self) -> &'static str { "m0022-medical-reports-v1" }
    fn up(&self, tx: &Transaction, _ctx: &MigrationContext) -> Result<MigrationReport, MigrationError> {
        tx.execute_batch(r#"
          CREATE TABLE IF NOT EXISTS medical_import_batches(
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES local_profiles(id) ON DELETE CASCADE,
            idempotency_key TEXT NOT NULL,
            created_at TEXT NOT NULL,
            UNIQUE(user_id, idempotency_key)
          );
          CREATE TABLE IF NOT EXISTS medical_reports(
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES local_profiles(id) ON DELETE CASCADE,
            batch_id TEXT NOT NULL REFERENCES medical_import_batches(id) ON DELETE CASCADE,
            title TEXT NOT NULL,
            report_type TEXT NOT NULL,
            exam_at TEXT,
            facility TEXT,
            content_json TEXT NOT NULL,
            created_at TEXT NOT NULL
          );
          CREATE INDEX IF NOT EXISTS medical_reports_user_date ON medical_reports(user_id,exam_at DESC,created_at DESC);
          CREATE TABLE IF NOT EXISTS medical_report_assets(
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES local_profiles(id) ON DELETE CASCADE,
            batch_id TEXT NOT NULL REFERENCES medical_import_batches(id) ON DELETE CASCADE,
            source_asset_id TEXT NOT NULL,
            original_name TEXT NOT NULL,
            mime_type TEXT NOT NULL,
            bytes_size INTEGER NOT NULL,
            sha256 TEXT NOT NULL,
            relative_path TEXT NOT NULL,
            UNIQUE(batch_id,source_asset_id)
          );
          CREATE UNIQUE INDEX IF NOT EXISTS medical_assets_user_sha256 ON medical_report_assets(user_id,sha256);
          CREATE TABLE IF NOT EXISTS medical_report_asset_links(
            report_id TEXT NOT NULL REFERENCES medical_reports(id) ON DELETE CASCADE,
            asset_id TEXT NOT NULL REFERENCES medical_report_assets(id) ON DELETE CASCADE,
            PRIMARY KEY(report_id,asset_id)
          );
          CREATE TABLE IF NOT EXISTS medical_report_sections(
            id TEXT PRIMARY KEY,
            report_id TEXT NOT NULL REFERENCES medical_reports(id) ON DELETE CASCADE,
            position INTEGER NOT NULL,
            content_json TEXT NOT NULL
          );
          CREATE TABLE IF NOT EXISTS medical_observations(
            id TEXT PRIMARY KEY,
            report_id TEXT NOT NULL REFERENCES medical_reports(id) ON DELETE CASCADE,
            position INTEGER NOT NULL,
            name_raw TEXT NOT NULL,
            metric_key TEXT,
            value_number REAL,
            unit_raw TEXT,
            content_json TEXT NOT NULL
          );
          CREATE INDEX IF NOT EXISTS medical_observation_name ON medical_observations(metric_key,name_raw);
        "#).map_err(|e| MigrationError { version: 22, message:e.to_string() })?;
        let mut result = MigrationReport::default();
        result.migrated = 7;
        result.metrics.insert("medical_tables".into(), 7);
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;
    use std::path::PathBuf;
    #[test]
    fn medical_data_has_profile_foreign_keys_and_no_sync_triggers() {
        let mut db = Connection::open_in_memory().unwrap();
        db.execute_batch("PRAGMA foreign_keys=ON; CREATE TABLE local_profiles(id TEXT PRIMARY KEY); INSERT INTO local_profiles VALUES('p');").unwrap();
        let tx=db.transaction().unwrap();
        M0022MedicalReports.up(&tx,&MigrationContext::new(PathBuf::from("."))).unwrap();
        tx.commit().unwrap();
        db.execute("INSERT INTO medical_import_batches VALUES ('b','p','request','now')",[]).unwrap();
        assert!(db.execute("INSERT INTO medical_reports VALUES('r','unknown','b','test','lab',NULL,NULL,'{}','now')",[]).is_err());
        let triggers:i64=db.query_row("SELECT count(*) FROM sqlite_master WHERE type='trigger' AND tbl_name LIKE 'medical_%'",[],|r|r.get(0)).unwrap();
        assert_eq!(triggers,0);
    }
}
