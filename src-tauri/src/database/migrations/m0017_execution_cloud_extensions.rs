use rusqlite::Transaction;

use crate::database::migration_runner::{
    Migration, MigrationContext, MigrationError, MigrationReport,
};

/// Adds the Execute Android entities that were promoted to shared Cloud contracts:
/// `execution.important_date` and `execution.focus_session`.
///
/// Their public wire contracts use top-level `id/userId` rather than EntityMeta,
/// so these tables keep Desktop-only bookkeeping columns out of the wire mapping.
pub struct M0017ExecutionCloudExtensions;

impl Migration for M0017ExecutionCloudExtensions {
    fn version(&self) -> i64 {
        17
    }

    fn name(&self) -> &'static str {
        "execution-cloud-extensions"
    }

    fn checksum(&self) -> &'static str {
        "m0017-execution-cloud-extensions-v1"
    }

    fn up(
        &self,
        transaction: &Transaction,
        _context: &MigrationContext,
    ) -> Result<MigrationReport, MigrationError> {
        transaction
            .execute_batch(
                r#"
                CREATE TABLE execution_important_dates (
                  id TEXT PRIMARY KEY,
                  user_id TEXT NOT NULL REFERENCES local_profiles(id) ON DELETE CASCADE,
                  title TEXT NOT NULL,
                  date TEXT NOT NULL,
                  repeat TEXT NOT NULL CHECK(repeat IN ('once','yearly')),
                  kind TEXT NOT NULL CHECK(kind IN ('birthday','anniversary','milestone','other')),
                  calendar TEXT NOT NULL CHECK(calendar IN ('solar','lunar')),
                  lunar_year INTEGER,
                  lunar_month INTEGER,
                  lunar_day INTEGER,
                  lunar_leap_month INTEGER NOT NULL DEFAULT 0 CHECK(lunar_leap_month IN (0,1)),
                  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
                  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
                  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
                  version INTEGER NOT NULL DEFAULT 1
                );
                CREATE INDEX idx_execution_important_dates_user_date
                  ON execution_important_dates(user_id,enabled,date,title);

                CREATE TABLE execution_focus_sessions (
                  id TEXT PRIMARY KEY,
                  user_id TEXT NOT NULL REFERENCES local_profiles(id) ON DELETE CASCADE,
                  task_id TEXT,
                  mode TEXT NOT NULL CHECK(mode IN ('short','long')),
                  started_at TEXT NOT NULL,
                  ended_at TEXT NOT NULL,
                  focus_seconds INTEGER NOT NULL CHECK(focus_seconds >= 0),
                  completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN (0,1)),
                  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
                  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
                  version INTEGER NOT NULL DEFAULT 1
                );
                CREATE INDEX idx_execution_focus_sessions_user_started
                  ON execution_focus_sessions(user_id,started_at DESC);
                CREATE INDEX idx_execution_focus_sessions_task
                  ON execution_focus_sessions(user_id,task_id,started_at DESC);

                CREATE TRIGGER trg_sync_execution_important_dates_insert
                AFTER INSERT ON execution_important_dates
                WHEN (SELECT origin FROM sync_context WHERE singleton=1)='local'
                BEGIN
                  DELETE FROM sync_outbox
                   WHERE profile_id=NEW.user_id AND entity_type='execution.important_date'
                     AND entity_id=NEW.id AND status='pending';
                  INSERT INTO sync_outbox(
                    change_id,profile_id,entity_type,entity_id,operation,base_server_version,
                    entity_schema_version,payload_json,dependencies_json,status,retry_count,created_at,updated_at
                  ) VALUES(
                    lower(hex(randomblob(16))),NEW.user_id,'execution.important_date',NEW.id,'upsert',
                    COALESCE((SELECT server_version FROM sync_metadata
                      WHERE profile_id=NEW.user_id AND entity_type='execution.important_date'
                        AND entity_id=NEW.id),'0'),
                    1,NULL,'[]','pending',0,
                    strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')
                  );
                END;

                CREATE TRIGGER trg_sync_execution_important_dates_update
                AFTER UPDATE ON execution_important_dates
                WHEN (SELECT origin FROM sync_context WHERE singleton=1)='local'
                BEGIN
                  DELETE FROM sync_outbox
                   WHERE profile_id=NEW.user_id AND entity_type='execution.important_date'
                     AND entity_id=NEW.id AND status='pending';
                  INSERT INTO sync_outbox(
                    change_id,profile_id,entity_type,entity_id,operation,base_server_version,
                    entity_schema_version,payload_json,dependencies_json,status,retry_count,created_at,updated_at
                  ) VALUES(
                    lower(hex(randomblob(16))),NEW.user_id,'execution.important_date',NEW.id,'upsert',
                    COALESCE((SELECT server_version FROM sync_metadata
                      WHERE profile_id=NEW.user_id AND entity_type='execution.important_date'
                        AND entity_id=NEW.id),'0'),
                    1,NULL,'[]','pending',0,
                    strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')
                  );
                END;

                CREATE TRIGGER trg_sync_execution_important_dates_delete
                AFTER DELETE ON execution_important_dates
                WHEN (SELECT origin FROM sync_context WHERE singleton=1)='local'
                BEGIN
                  DELETE FROM sync_outbox
                   WHERE profile_id=OLD.user_id AND entity_type='execution.important_date'
                     AND entity_id=OLD.id AND status='pending';
                  INSERT INTO sync_outbox(
                    change_id,profile_id,entity_type,entity_id,operation,base_server_version,
                    entity_schema_version,payload_json,dependencies_json,status,retry_count,created_at,updated_at
                  ) VALUES(
                    lower(hex(randomblob(16))),OLD.user_id,'execution.important_date',OLD.id,'delete',
                    COALESCE((SELECT server_version FROM sync_metadata
                      WHERE profile_id=OLD.user_id AND entity_type='execution.important_date'
                        AND entity_id=OLD.id),'0'),
                    1,NULL,'[]','pending',0,
                    strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')
                  );
                END;

                CREATE TRIGGER trg_sync_execution_focus_sessions_insert
                AFTER INSERT ON execution_focus_sessions
                WHEN (SELECT origin FROM sync_context WHERE singleton=1)='local'
                BEGIN
                  DELETE FROM sync_outbox
                   WHERE profile_id=NEW.user_id AND entity_type='execution.focus_session'
                     AND entity_id=NEW.id AND status='pending';
                  INSERT INTO sync_outbox(
                    change_id,profile_id,entity_type,entity_id,operation,base_server_version,
                    entity_schema_version,payload_json,dependencies_json,status,retry_count,created_at,updated_at
                  ) VALUES(
                    lower(hex(randomblob(16))),NEW.user_id,'execution.focus_session',NEW.id,'upsert',
                    COALESCE((SELECT server_version FROM sync_metadata
                      WHERE profile_id=NEW.user_id AND entity_type='execution.focus_session'
                        AND entity_id=NEW.id),'0'),
                    1,NULL,'[]','pending',0,
                    strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')
                  );
                END;

                CREATE TRIGGER trg_sync_execution_focus_sessions_update
                AFTER UPDATE ON execution_focus_sessions
                WHEN (SELECT origin FROM sync_context WHERE singleton=1)='local'
                BEGIN
                  DELETE FROM sync_outbox
                   WHERE profile_id=NEW.user_id AND entity_type='execution.focus_session'
                     AND entity_id=NEW.id AND status='pending';
                  INSERT INTO sync_outbox(
                    change_id,profile_id,entity_type,entity_id,operation,base_server_version,
                    entity_schema_version,payload_json,dependencies_json,status,retry_count,created_at,updated_at
                  ) VALUES(
                    lower(hex(randomblob(16))),NEW.user_id,'execution.focus_session',NEW.id,'upsert',
                    COALESCE((SELECT server_version FROM sync_metadata
                      WHERE profile_id=NEW.user_id AND entity_type='execution.focus_session'
                        AND entity_id=NEW.id),'0'),
                    1,NULL,'[]','pending',0,
                    strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')
                  );
                END;

                CREATE TRIGGER trg_sync_execution_focus_sessions_delete
                AFTER DELETE ON execution_focus_sessions
                WHEN (SELECT origin FROM sync_context WHERE singleton=1)='local'
                BEGIN
                  DELETE FROM sync_outbox
                   WHERE profile_id=OLD.user_id AND entity_type='execution.focus_session'
                     AND entity_id=OLD.id AND status='pending';
                  INSERT INTO sync_outbox(
                    change_id,profile_id,entity_type,entity_id,operation,base_server_version,
                    entity_schema_version,payload_json,dependencies_json,status,retry_count,created_at,updated_at
                  ) VALUES(
                    lower(hex(randomblob(16))),OLD.user_id,'execution.focus_session',OLD.id,'delete',
                    COALESCE((SELECT server_version FROM sync_metadata
                      WHERE profile_id=OLD.user_id AND entity_type='execution.focus_session'
                        AND entity_id=OLD.id),'0'),
                    1,NULL,'[]','pending',0,
                    strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')
                  );
                END;
                "#,
            )
            .map_err(|error| MigrationError {
                version: 17,
                message: format!("create execution cloud extension tables: {error}"),
            })?;

        let mut report = MigrationReport::default();
        report.metrics.insert("execution_extension_tables".to_owned(), 2);
        report.metrics.insert("execution_extension_sync_triggers".to_owned(), 6);
        Ok(report)
    }
}

#[cfg(test)]
mod tests {
    use crate::database::migration_runner::{run, MigrationContext};
    use crate::database::migrations::all;
    use rusqlite::Connection;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn extension_entities_enter_the_outbox() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let data_dir = std::env::temp_dir().join(format!("lifetrace-m0017-{unique}"));
        std::fs::create_dir_all(&data_dir).unwrap();

        let mut connection = Connection::open_in_memory().unwrap();
        connection.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        run(&mut connection, &MigrationContext::new(data_dir), &all()).unwrap();
        let profile = crate::database::profile::active_profile_id(&connection).unwrap();

        connection.execute(
            "INSERT INTO execution_important_dates(id,user_id,title,date,repeat,kind,calendar)
             VALUES('date-1',?1,'Birthday','2026-10-15','yearly','birthday','solar')",
            [&profile],
        ).unwrap();
        connection.execute(
            "INSERT INTO execution_focus_sessions(
               id,user_id,mode,started_at,ended_at,focus_seconds,completed
             ) VALUES('focus-1',?1,'short','2026-09-24T10:00:00Z','2026-09-24T10:25:00Z',1500,1)",
            [&profile],
        ).unwrap();

        let count: i64 = connection.query_row(
            "SELECT COUNT(*) FROM sync_outbox
             WHERE profile_id=?1
               AND entity_type IN ('execution.important_date','execution.focus_session')
               AND status='pending'",
            [&profile],
            |row| row.get(0),
        ).unwrap();
        assert_eq!(count, 2);
    }
}
