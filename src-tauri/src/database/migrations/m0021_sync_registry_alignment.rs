use rusqlite::Transaction;

use crate::database::migration_runner::{
    Migration, MigrationContext, MigrationError, MigrationReport,
};

/// Aligns the Desktop sync outbox with the entity types currently accepted by
/// LifeTrace Cloud. Execution Memo stays a local Desktop feature; removed
/// Travel entities also stay local/history-only and must never be uploaded.
pub struct M0021SyncRegistryAlignment;

impl Migration for M0021SyncRegistryAlignment {
    fn version(&self) -> i64 { 21 }

    fn name(&self) -> &'static str { "sync-registry-alignment" }

    fn checksum(&self) -> &'static str { "m0021-sync-registry-alignment-v1" }

    fn up(
        &self,
        tx: &Transaction,
        _context: &MigrationContext,
    ) -> Result<MigrationReport, MigrationError> {
        const LOCAL_ONLY_TABLES: &[&str] = &[
            "execution_memos",
            "execution_memo_tags",
            "execution_memo_tag_relations",
            "travel_trips",
            "travel_places",
            "travel_visits",
            "travel_photo_links",
        ];
        const LOCAL_ONLY_TYPES: &[&str] = &[
            "execution.memo",
            "execution.memo_tag",
            "execution.memo_tag_relation",
            "travel.trip",
            "travel.place",
            "travel.visit",
            "travel.photo_link",
        ];

        let mut removed_triggers = 0i64;
        for table in LOCAL_ONLY_TABLES {
            for suffix in ["insert", "update", "delete"] {
                let trigger = format!("trg_sync_{table}_{suffix}");
                let existed: i64 = tx
                    .query_row(
                        "SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name=?1",
                        [&trigger],
                        |row| row.get(0),
                    )
                    .map_err(|error| MigrationError {
                        version: 21,
                        message: error.to_string(),
                    })?;
                tx.execute_batch(&format!("DROP TRIGGER IF EXISTS {trigger};"))
                    .map_err(|error| MigrationError {
                        version: 21,
                        message: format!("drop {trigger}: {error}"),
                    })?;
                removed_triggers += existed;
            }
        }

        let placeholders = LOCAL_ONLY_TYPES
            .iter()
            .map(|value| format!("'{}'", value.replace('\'', "''")))
            .collect::<Vec<_>>()
            .join(",");
        let mut removed_rows = 0i64;
        for table in ["sync_outbox", "sync_conflicts", "sync_metadata"] {
            let sql = format!("DELETE FROM {table} WHERE entity_type IN ({placeholders})");
            removed_rows += tx.execute(&sql, []).map_err(|error| MigrationError {
                version: 21,
                message: format!("clean {table}: {error}"),
            })? as i64;
        }

        // A previous unsupported-entity rejection can leave a permanent error
        // banner/backoff even after the bad rows are gone. Only clear errors
        // that explicitly mention one of the retired local-only entity types.
        let patterns = LOCAL_ONLY_TYPES
            .iter()
            .map(|value| format!("last_error_message LIKE '%{}%'", value.replace('\'', "''")))
            .collect::<Vec<_>>()
            .join(" OR ");
        let reset_sql = format!(
            "UPDATE sync_state
             SET phase=CASE WHEN phase='error' OR phase='backoff' THEN 'idle' ELSE phase END,
                 next_retry_at=NULL,
                 last_error_code=NULL,
                 last_error_message=NULL
             WHERE {patterns}"
        );
        let reset_states = tx.execute(&reset_sql, []).map_err(|error| MigrationError {
            version: 21,
            message: format!("reset obsolete sync errors: {error}"),
        })? as i64;

        let mut report = MigrationReport::default();
        report.metrics.insert("sync_triggers_removed".to_owned(), removed_triggers);
        report.metrics.insert("sync_rows_removed".to_owned(), removed_rows);
        report.metrics.insert("sync_states_reset".to_owned(), reset_states);
        report.migrated = (removed_triggers + removed_rows + reset_states).max(0) as usize;
        Ok(report)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;
    use std::path::PathBuf;

    #[test]
    fn removes_local_only_sync_artifacts_without_touching_business_rows() {
        let mut connection = Connection::open_in_memory().unwrap();
        connection.execute_batch(
            "
            CREATE TABLE execution_memos(id TEXT PRIMARY KEY, content TEXT);
            CREATE TABLE sync_outbox(entity_type TEXT NOT NULL);
            CREATE TABLE sync_conflicts(entity_type TEXT NOT NULL);
            CREATE TABLE sync_metadata(entity_type TEXT NOT NULL);
            CREATE TABLE sync_state(
              phase TEXT NOT NULL,
              next_retry_at TEXT,
              last_error_code TEXT,
              last_error_message TEXT
            );
            CREATE TRIGGER trg_sync_execution_memos_insert
              AFTER INSERT ON execution_memos BEGIN
                INSERT INTO sync_outbox(entity_type) VALUES('execution.memo');
              END;
            INSERT INTO execution_memos VALUES('memo-1','keep me');
            INSERT INTO sync_outbox VALUES('travel.trip');
            INSERT INTO sync_conflicts VALUES('execution.memo_tag');
            INSERT INTO sync_metadata VALUES('travel.photo_link');
            INSERT INTO sync_state VALUES(
              'error','2099-01-01T00:00:00Z','UNKNOWN_ENTITY_TYPE',
              'entity type is not authorized for sync: execution.memo'
            );
            ",
        ).unwrap();

        let tx = connection.transaction().unwrap();
        M0021SyncRegistryAlignment
            .up(&tx, &MigrationContext::new(PathBuf::from(".")))
            .unwrap();
        tx.commit().unwrap();

        let memo_rows: i64 = connection
            .query_row("SELECT COUNT(*) FROM execution_memos", [], |row| row.get(0))
            .unwrap();
        assert_eq!(memo_rows, 1);

        for table in ["sync_outbox", "sync_conflicts", "sync_metadata"] {
            let count: i64 = connection
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| row.get(0))
                .unwrap();
            assert_eq!(count, 0, "{table} should not retain retired sync entities");
        }

        let trigger_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master
                 WHERE type='trigger' AND name='trg_sync_execution_memos_insert'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(trigger_count, 0);

        let state: (String, Option<String>, Option<String>) = connection
            .query_row(
                "SELECT phase,last_error_code,last_error_message FROM sync_state",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(state.0, "idle");
        assert!(state.1.is_none());
        assert!(state.2.is_none());
    }
}
