use rusqlite::Transaction;

use crate::database::migration_runner::{
    Migration, MigrationContext, MigrationError, MigrationReport,
};

pub struct M0019FootprintsSync;

#[derive(Clone, Copy)]
struct TriggerSpec {
    table: &'static str,
    entity_type: &'static str,
    id_new: &'static str,
    id_old: &'static str,
    profile_new: &'static str,
    profile_old: &'static str,
    delete_new: &'static str,
    dependencies_new: &'static str,
    dependencies_old: &'static str,
}

impl Migration for M0019FootprintsSync {
    fn version(&self) -> i64 { 19 }

    fn name(&self) -> &'static str { "footprints-sync" }

    fn checksum(&self) -> &'static str { "m0019-footprints-sync-v1" }

    fn up(
        &self,
        tx: &Transaction,
        _context: &MigrationContext,
    ) -> Result<MigrationReport, MigrationError> {
        tx.execute_batch(
            "CREATE TABLE IF NOT EXISTS footprint_sync_pending(
               entity_type TEXT NOT NULL,
               entity_id TEXT NOT NULL,
               entry_id TEXT NOT NULL,
               payload_json TEXT NOT NULL,
               updated_at TEXT NOT NULL,
               PRIMARY KEY(entity_type,entity_id)
             );
             CREATE INDEX IF NOT EXISTS idx_footprint_sync_pending_entry
               ON footprint_sync_pending(entry_id,entity_type);",
        )
        .map_err(|error| MigrationError {
            version: 19,
            message: error.to_string(),
        })?;

        let specs = [
            TriggerSpec {
                table: "footprint_locations",
                entity_type: "travel.place",
                id_new: "NEW.id",
                id_old: "OLD.id",
                profile_new: "NEW.user_id",
                profile_old: "OLD.user_id",
                delete_new: "0",
                dependencies_new: "'[]'",
                dependencies_old: "'[]'",
            },
            TriggerSpec {
                table: "footprint_entries",
                entity_type: "travel.visit",
                id_new: "NEW.id",
                id_old: "OLD.id",
                profile_new: "NEW.user_id",
                profile_old: "OLD.user_id",
                delete_new: "NEW.deleted_at IS NOT NULL",
                dependencies_new: r#"'[{"entityType":"travel.place","entityId":"' || NEW.location_id || '"}]'"#,
                dependencies_old: r#"'[{"entityType":"travel.place","entityId":"' || OLD.location_id || '"}]'"#,
            },
            TriggerSpec {
                table: "footprint_entry_photos",
                entity_type: "travel.photo_link",
                id_new: "NEW.entry_id || ':' || NEW.photo_id",
                id_old: "OLD.entry_id || ':' || OLD.photo_id",
                profile_new: "(SELECT user_id FROM footprint_entries WHERE id=NEW.entry_id)",
                profile_old: "(SELECT user_id FROM footprint_entries WHERE id=OLD.entry_id)",
                delete_new: "0",
                dependencies_new: r#"'[{"entityType":"travel.visit","entityId":"' || NEW.entry_id || '"}]'"#,
                dependencies_old: r#"'[{"entityType":"travel.visit","entityId":"' || OLD.entry_id || '"}]'"#,
            },
            TriggerSpec {
                table: "footprint_entry_links",
                entity_type: "entity.link",
                id_new: "NEW.id",
                id_old: "OLD.id",
                profile_new: "(SELECT user_id FROM footprint_entries WHERE id=NEW.entry_id)",
                profile_old: "(SELECT user_id FROM footprint_entries WHERE id=OLD.entry_id)",
                delete_new: "0",
                dependencies_new: r#"'[{"entityType":"travel.visit","entityId":"' || NEW.entry_id || '"}]'"#,
                dependencies_old: r#"'[{"entityType":"travel.visit","entityId":"' || OLD.entry_id || '"}]'"#,
            },
        ];

        let mut created = 0usize;
        for spec in specs {
            for (suffix, timing, profile_raw, id_expr, operation, dependencies) in [
                (
                    "insert",
                    "AFTER INSERT",
                    spec.profile_new,
                    spec.id_new,
                    format!("CASE WHEN {} THEN 'delete' ELSE 'upsert' END", spec.delete_new),
                    spec.dependencies_new,
                ),
                (
                    "update",
                    "AFTER UPDATE",
                    spec.profile_new,
                    spec.id_new,
                    format!("CASE WHEN {} THEN 'delete' ELSE 'upsert' END", spec.delete_new),
                    spec.dependencies_new,
                ),
                (
                    "delete",
                    "AFTER DELETE",
                    spec.profile_old,
                    spec.id_old,
                    "'delete'".to_owned(),
                    spec.dependencies_old,
                ),
            ] {
                let trigger_name = format!("trg_sync_footprint_{}_{}", spec.table, suffix);
                let profile_expr = format!(
                    "COALESCE((SELECT id FROM local_profiles WHERE id=({profile_raw})),
                       (SELECT active_profile_id FROM app_profile_state WHERE singleton=1))"
                );
                let sql = format!(
                    "CREATE TRIGGER IF NOT EXISTS {trigger_name} {timing} ON {table}
                     WHEN (SELECT origin FROM sync_context WHERE singleton=1)='local'
                       AND ({profile_expr}) IS NOT NULL
                     BEGIN
                       DELETE FROM sync_outbox
                        WHERE profile_id=({profile_expr}) AND entity_type='{entity_type}'
                          AND entity_id=({id_expr}) AND status='pending';
                       INSERT INTO sync_outbox(
                         change_id,profile_id,entity_type,entity_id,operation,base_server_version,
                         entity_schema_version,payload_json,dependencies_json,status,retry_count,created_at,updated_at
                       ) VALUES(
                         lower(hex(randomblob(16))),({profile_expr}),'{entity_type}',({id_expr}),{operation},
                         COALESCE((SELECT server_version FROM sync_metadata
                           WHERE profile_id=({profile_expr}) AND entity_type='{entity_type}'
                             AND entity_id=({id_expr})),'0'),
                         1,NULL,{dependencies},'pending',0,
                         strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')
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
        report.metrics.insert("footprint_sync_triggers".to_owned(), created as i64);
        report.migrated = created + 1;
        Ok(report)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::migration_runner::{run, MigrationContext};
    use crate::database::migrations::all;
    use rusqlite::Connection;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn footprint_mutations_enqueue_shared_travel_entities() {
        let mut connection = Connection::open_in_memory().unwrap();
        connection.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        let unique = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let data_dir = std::env::temp_dir().join(format!("lifetrace-m0019-{unique}"));
        std::fs::create_dir_all(&data_dir).unwrap();
        run(&mut connection, &MigrationContext::new(data_dir), &all()).unwrap();
        let profile: String = connection.query_row(
            "SELECT active_profile_id FROM app_profile_state WHERE singleton=1",
            [],
            |row| row.get(0),
        ).unwrap();

        connection.execute(
            "INSERT INTO footprint_locations(
               id,user_id,province_code,province_name,created_at,updated_at
             ) VALUES('place-1',?1,'510000','四川省','2026-05-01T00:00:00Z','2026-05-01T00:00:00Z')",
            [&profile],
        ).unwrap();
        connection.execute(
            "INSERT INTO footprint_entries(
               id,user_id,location_id,title,started_at,created_at,updated_at
             ) VALUES('visit-1',?1,'place-1','成都','2026-05-01','2026-05-01T00:00:00Z','2026-05-01T00:00:00Z')",
            [&profile],
        ).unwrap();
        connection.execute(
            "INSERT INTO footprint_entry_photos(entry_id,photo_id,sort_order,is_cover,created_at)
             VALUES('visit-1','photo-1',0,1,'2026-05-01T00:00:00Z')",
            [],
        ).unwrap();
        connection.execute(
            "INSERT INTO footprint_entry_links(id,entry_id,entity_type,entity_id,relation_type,created_at)
             VALUES('link-1','visit-1','note.note','note-1','related','2026-05-01T00:00:00Z')",
            [],
        ).unwrap();

        for (entity_type, entity_id) in [
            ("travel.place", "place-1"),
            ("travel.visit", "visit-1"),
            ("travel.photo_link", "visit-1:photo-1"),
            ("entity.link", "link-1"),
        ] {
            let count: i64 = connection.query_row(
                "SELECT COUNT(*) FROM sync_outbox
                 WHERE entity_type=?1 AND entity_id=?2 AND operation='upsert'",
                [entity_type, entity_id],
                |row| row.get(0),
            ).unwrap();
            assert_eq!(count, 1, "missing outbox row for {entity_type}/{entity_id}");
        }

        let dependencies: String = connection.query_row(
            "SELECT dependencies_json FROM sync_outbox
             WHERE entity_type='travel.photo_link' AND entity_id='visit-1:photo-1'",
            [],
            |row| row.get(0),
        ).unwrap();
        assert!(dependencies.contains("travel.visit"));

        connection.execute("UPDATE sync_context SET origin='remote' WHERE singleton=1", []).unwrap();
        connection.execute(
            "UPDATE footprint_entries SET title='远端成都' WHERE id='visit-1'",
            [],
        ).unwrap();
        let visit_count: i64 = connection.query_row(
            "SELECT COUNT(*) FROM sync_outbox WHERE entity_type='travel.visit'",
            [],
            |row| row.get(0),
        ).unwrap();
        assert_eq!(visit_count, 1);
    }
}
