use rusqlite::Transaction;
use crate::database::migration_runner::{Migration, MigrationContext, MigrationError, MigrationReport};

/// Keeps every AI-assisted update reviewable without modifying the uploaded source files.
pub struct M0023MedicalReportRevisions;

impl Migration for M0023MedicalReportRevisions {
    fn version(&self) -> i64 { 23 }
    fn name(&self) -> &'static str { "medical-report-revisions" }
    fn checksum(&self) -> &'static str { "m0023-medical-report-revisions-v1" }
    fn up(&self, tx: &Transaction, _ctx: &MigrationContext) -> Result<MigrationReport, MigrationError> {
        tx.execute_batch(r#"
          CREATE TABLE IF NOT EXISTS medical_report_revisions(
            id TEXT PRIMARY KEY,
            report_id TEXT NOT NULL REFERENCES medical_reports(id) ON DELETE CASCADE,
            request_key TEXT NOT NULL,
            old_content_json TEXT NOT NULL,
            new_content_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            UNIQUE(report_id,request_key)
          );
          CREATE INDEX IF NOT EXISTS medical_revisions_by_report ON medical_report_revisions(report_id,created_at);
        "#).map_err(|e| MigrationError{ version:23,message:e.to_string() })?;
        let mut report=MigrationReport::default();
        report.migrated=1;
        report.metrics.insert("medical_revision_tables".into(),1);
        Ok(report)
    }
}
