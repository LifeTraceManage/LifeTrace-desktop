use rusqlite::Transaction;

use crate::database::migration_runner::{
    Migration, MigrationContext, MigrationError, MigrationReport,
};

pub struct M0019TravelSync;

#[derive(Clone, Copy)]
struct TriggerSpec {
    table: &'static str,
    entity_type: &'static str,
}

impl Migration for M0019TravelSync {
    fn version(&self) -> i64 { 19 }

    fn name(&self) -> &'static str { "travel-sync-outbox" }

    fn checksum(&self) -> &'static str { "m0019-travel-sync-outbox-v1" }

    fn up(
        &self,
        tx: &Transaction,
        _context: &MigrationContext,
    ) -> Result<MigrationReport, MigrationError> {
        let specs = [
            TriggerSpec { table: "travel_trips", entity_type: "travel.trip" },
            TriggerSpec { table: "travel_places", entity_type: "travel.place" },
            TriggerSpec { table: "travel_visits", entity_type: "travel.visit" },
            TriggerSpec { table: "travel_photo_links", entity_type: "travel.photo_link" },
        ];

        let mut created = 0usize;
        for spec in specs {
            for (suffix, timing, row_prefix, operation_expr) in [
                (
                    "insert",
                    "AFTER INSERT",
                    "NEW",
                    "CASE WHEN NEW.deleted_at IS NOT NULL THEN 'delete' ELSE 'upsert' END",
                ),
                (
                    "update",
                    "AFTER UPDATE",
                    "NEW",
                    "CASE WHEN NEW.deleted_at IS NOT NULL THEN 'delete' ELSE 'upsert' END",
                ),
                ("delete", "AFTER DELETE", "OLD", "'delete'"),
            ] {
                let trigger_name = format!("trg_sync_{}_{}", spec.table, suffix);
                let profile_expr = format!(
                    "COALESCE(
                       (SELECT id FROM local_profiles WHERE id={row_prefix}.user_id),
                       (SELECT active_profile_id FROM app_profile_state WHERE singleton=1)
                     )"
                );
                let sql = format!(
                    "CREATE TRIGGER IF NOT EXISTS {trigger_name} {timing} ON {table}
                     WHEN (SELECT origin FROM sync_context WHERE singleton=1)='local'
                       AND ({profile_expr}) IS NOT NULL
                     BEGIN
                       DELETE FROM sync_outbox
                        WHERE profile_id=({profile_expr}) AND entity_type='{entity_type}'
                          AND entity_id={row_prefix}.id AND status='pending';
                       INSERT INTO sync_outbox(
                         change_id,profile_id,entity_type,entity_id,operation,base_server_version,
                         entity_schema_version,payload_json,dependencies_json,status,retry_count,
                         created_at,updated_at
                       ) VALUES(
                         lower(hex(randomblob(16))),({profile_expr}),'{entity_type}',{row_prefix}.id,
                         {operation_expr},
                         COALESCE((SELECT server_version FROM sync_metadata
                           WHERE profile_id=({profile_expr}) AND entity_type='{entity_type}'
                             AND entity_id={row_prefix}.id),'0'),
                         1,NULL,'[]','pending',0,
                         strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                         strftime('%Y-%m-%dT%H:%M:%fZ','now')
                       );
                     END;",
                    table = spec.table,
                    entity_type = spec.entity_type,
                );
                tx.execute_batch(&sql).map_err(|error| MigrationError {
                    version: 19,
                    message: format!("create {trigger_name}: {error}"),
                })?;
                created += 1;
            }
        }

        let mut report = MigrationReport::default();
        report
            .metrics
            .insert("travel_sync_triggers".to_owned(), created as i64);
        Ok(report)
    }
}

#[cfg(test)]
mod tests {
    use crate::database::migration_runner::{run, MigrationContext};
    use crate::database::migrations::all;
    use rusqlite::Connection;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn db() -> (Connection, String) {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let data_dir = std::env::temp_dir().join(format!("lifetrace-m0019-{unique}"));
        std::fs::create_dir_all(&data_dir).unwrap();
        let mut connection = Connection::open_in_memory().unwrap();
        connection.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        run(&mut connection, &MigrationContext::new(data_dir), &all()).unwrap();
        let profile = crate::database::profile::active_profile_id(&connection).unwrap();
        (connection, profile)
    }

    #[test]
    fn local_travel_writes_enqueue_and_remote_writes_are_suppressed() {
        let (connection, profile) = db();
        connection.execute(
            "INSERT INTO travel_places(
               id,user_id,name,place_type,created_at,updated_at
             ) VALUES(
               'p1',?1,'厦门','city','2026-10-03T00:00:00Z','2026-10-03T00:00:00Z'
             )",
            [&profile],
        ).unwrap();

        let count: i64 = connection.query_row(
            "SELECT COUNT(*) FROM sync_outbox
             WHERE entity_type='travel.place' AND entity_id='p1' AND operation='upsert'",
            [],
            |row| row.get(0),
        ).unwrap();
        assert_eq!(count, 1);

        connection.execute(
            "UPDATE sync_context SET origin='remote' WHERE singleton=1",
            [],
        ).unwrap();
        connection.execute(
            "INSERT INTO travel_trips(id,user_id,title,created_at,updated_at)
             VALUES('t-remote',?1,'Remote','2026-10-03T00:00:00Z','2026-10-03T00:00:00Z')",
            [&profile],
        ).unwrap();
        let remote_count: i64 = connection.query_row(
            "SELECT COUNT(*) FROM sync_outbox
             WHERE entity_type='travel.trip' AND entity_id='t-remote'",
            [],
            |row| row.get(0),
        ).unwrap();
        assert_eq!(remote_count, 0);
    }

    #[test]
    fn soft_delete_enqueues_delete_operation() {
        let (connection, profile) = db();
        connection.execute(
            "INSERT INTO travel_trips(id,user_id,title,created_at,updated_at)
             VALUES('t1',?1,'Trip','2026-10-03T00:00:00Z','2026-10-03T00:00:00Z')",
            [&profile],
        ).unwrap();
        connection.execute(
            "UPDATE travel_trips
             SET deleted_at='2026-10-03T01:00:00Z',updated_at='2026-10-03T01:00:00Z'
             WHERE id='t1'",
            [],
        ).unwrap();

        let operation: String = connection.query_row(
            "SELECT operation FROM sync_outbox
             WHERE entity_type='travel.trip' AND entity_id='t1' AND status='pending'
             ORDER BY created_at DESC LIMIT 1",
            [],
            |row| row.get(0),
        ).unwrap();
        assert_eq!(operation, "delete");
    }
}
