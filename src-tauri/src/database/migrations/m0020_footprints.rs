use rusqlite::Transaction;

use crate::database::migration_runner::{
    Migration, MigrationContext, MigrationError, MigrationReport,
};

/// Adds the local-first Footprints domain.
///
/// Versions 18 and 19 were previously used by the removed Travel feature and
/// must never be reused. This migration is intentionally idempotent so
/// databases that briefly applied the old v18 Footprints migration can also
/// advance safely to the canonical v20 record.
pub struct M0020Footprints;

impl Migration for M0020Footprints {
    fn version(&self) -> i64 {
        20
    }

    fn name(&self) -> &'static str {
        "footprints"
    }

    fn checksum(&self) -> &'static str {
        "m0020-footprints-v1"
    }

    fn up(
        &self,
        transaction: &Transaction,
        _context: &MigrationContext,
    ) -> Result<MigrationReport, MigrationError> {
        transaction.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS footprint_locations (
              id TEXT PRIMARY KEY,
              user_id TEXT NOT NULL REFERENCES local_profiles(id) ON DELETE CASCADE,
              country_code TEXT NOT NULL DEFAULT 'CN',
              country_name TEXT NOT NULL DEFAULT '中国',
              province_code TEXT NOT NULL,
              province_name TEXT NOT NULL,
              city_code TEXT,
              city_name TEXT,
              district_code TEXT,
              district_name TEXT,
              place_name TEXT,
              latitude REAL CHECK(latitude IS NULL OR (latitude >= -90 AND latitude <= 90)),
              longitude REAL CHECK(longitude IS NULL OR (longitude >= -180 AND longitude <= 180)),
              source TEXT NOT NULL DEFAULT 'manual',
              created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
              updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_footprint_locations_natural
              ON footprint_locations(
                user_id,
                country_code,
                province_code,
                IFNULL(city_code,''),
                IFNULL(city_name,''),
                IFNULL(district_code,''),
                IFNULL(place_name,'')
              );
            CREATE INDEX IF NOT EXISTS idx_footprint_locations_region
              ON footprint_locations(user_id,province_code,city_code,city_name);

            CREATE TABLE IF NOT EXISTS footprint_entries (
              id TEXT PRIMARY KEY,
              user_id TEXT NOT NULL REFERENCES local_profiles(id) ON DELETE CASCADE,
              location_id TEXT NOT NULL REFERENCES footprint_locations(id) ON DELETE RESTRICT,
              title TEXT NOT NULL,
              description TEXT,
              started_at TEXT NOT NULL,
              ended_at TEXT,
              visit_type TEXT NOT NULL DEFAULT 'trip',
              rating INTEGER CHECK(rating IS NULL OR (rating >= 0 AND rating <= 5)),
              favorite INTEGER NOT NULL DEFAULT 0 CHECK(favorite IN (0,1)),
              created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
              updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
              deleted_at TEXT,
              CHECK(ended_at IS NULL OR ended_at >= started_at)
            );
            CREATE INDEX IF NOT EXISTS idx_footprint_entries_user_started
              ON footprint_entries(user_id,started_at DESC)
              WHERE deleted_at IS NULL;
            CREATE INDEX IF NOT EXISTS idx_footprint_entries_location
              ON footprint_entries(location_id,started_at DESC)
              WHERE deleted_at IS NULL;

            CREATE TABLE IF NOT EXISTS footprint_entry_photos (
              entry_id TEXT NOT NULL REFERENCES footprint_entries(id) ON DELETE CASCADE,
              photo_id TEXT NOT NULL,
              sort_order INTEGER NOT NULL DEFAULT 0,
              is_cover INTEGER NOT NULL DEFAULT 0 CHECK(is_cover IN (0,1)),
              created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
              PRIMARY KEY(entry_id,photo_id)
            );
            CREATE INDEX IF NOT EXISTS idx_footprint_entry_photos_entry
              ON footprint_entry_photos(entry_id,sort_order,photo_id);
            CREATE INDEX IF NOT EXISTS idx_footprint_entry_photos_photo
              ON footprint_entry_photos(photo_id,entry_id);

            CREATE TABLE IF NOT EXISTS footprint_entry_links (
              id TEXT PRIMARY KEY,
              entry_id TEXT NOT NULL REFERENCES footprint_entries(id) ON DELETE CASCADE,
              entity_type TEXT NOT NULL,
              entity_id TEXT NOT NULL,
              relation_type TEXT NOT NULL DEFAULT 'related',
              created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
              UNIQUE(entry_id,entity_type,entity_id,relation_type)
            );
            CREATE INDEX IF NOT EXISTS idx_footprint_entry_links_entry
              ON footprint_entry_links(entry_id,entity_type);
            "#,
        )
        .map_err(|error| MigrationError {
            version: 20,
            message: error.to_string(),
        })?;

        let mut report = MigrationReport::default();
        report.metrics.insert("footprint_tables".to_owned(), 4);
        report.migrated = 4;
        Ok(report)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::migration_runner::{bootstrap, run};
    use rusqlite::Connection;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn prepare_profile(connection: &Connection) {
        connection
            .execute_batch(
                "PRAGMA foreign_keys=ON;
                 CREATE TABLE local_profiles(
                   id TEXT PRIMARY KEY,
                   display_name TEXT NOT NULL,
                   cloud_binding_state TEXT NOT NULL,
                   created_at TEXT NOT NULL,
                   updated_at TEXT NOT NULL
                 );
                 INSERT INTO local_profiles VALUES('profile-1','Test','local_only','now','now');",
            )
            .unwrap();
    }

    #[test]
    fn creates_footprint_schema_and_constraints() {
        let mut connection = Connection::open_in_memory().unwrap();
        prepare_profile(&connection);

        let tx = connection.transaction().unwrap();
        let report = M0020Footprints
            .up(&tx, &MigrationContext::new(PathBuf::from(".")))
            .unwrap();
        assert_eq!(report.migrated, 4);
        tx.commit().unwrap();

        for table in [
            "footprint_locations",
            "footprint_entries",
            "footprint_entry_photos",
            "footprint_entry_links",
        ] {
            let exists: i64 = connection
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
                    [table],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(exists, 1, "missing {table}");
        }

        connection
            .execute(
                "INSERT INTO footprint_locations(
                   id,user_id,province_code,province_name,city_name
                 ) VALUES('loc-1','profile-1','510000','四川省','成都市')",
                [],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO footprint_entries(
                   id,user_id,location_id,title,started_at,ended_at
                 ) VALUES('entry-1','profile-1','loc-1','成都','2026-05-01','2026-05-04')",
                [],
            )
            .unwrap();

        let invalid = connection.execute(
            "INSERT INTO footprint_entries(
               id,user_id,location_id,title,started_at,ended_at
             ) VALUES('entry-2','profile-1','loc-1','invalid','2026-05-04','2026-05-01')",
            [],
        );
        assert!(invalid.is_err());
    }

    #[test]
    fn runner_accepts_legacy_travel_migration_versions() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let data_dir = std::env::temp_dir().join(format!("lifetrace-footprints-v20-{unique}"));
        std::fs::create_dir_all(&data_dir).unwrap();

        let mut connection = Connection::open(data_dir.join("test.db")).unwrap();
        prepare_profile(&connection);
        bootstrap(&connection).unwrap();
        connection
            .execute(
                "INSERT INTO schema_migrations(version,name,checksum,applied_at,app_version)
                 VALUES(18,'travel-mvp','m0018-travel-mvp-v1','now','0.3.3')",
                [],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO schema_migrations(version,name,checksum,applied_at,app_version)
                 VALUES(19,'travel-sync','m0019-travel-sync-v1','now','0.3.3')",
                [],
            )
            .unwrap();

        let migrations: Vec<Box<dyn Migration>> = vec![Box::new(M0020Footprints)];
        let summary = run(
            &mut connection,
            &MigrationContext::new(data_dir.clone()),
            &migrations,
        )
        .unwrap();

        assert_eq!(summary.applied.len(), 1);
        assert_eq!(summary.applied[0].version, 20);
        let checksum: String = connection
            .query_row(
                "SELECT checksum FROM schema_migrations WHERE version=20",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(checksum, "m0020-footprints-v1");

        std::fs::remove_dir_all(data_dir).ok();
    }

    #[test]
    fn migration_is_idempotent_for_old_v18_footprints_schema() {
        let mut connection = Connection::open_in_memory().unwrap();
        prepare_profile(&connection);

        for _ in 0..2 {
            let tx = connection.transaction().unwrap();
            M0020Footprints
                .up(&tx, &MigrationContext::new(PathBuf::from(".")))
                .unwrap();
            tx.commit().unwrap();
        }

        let table_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master
                 WHERE type='table' AND name LIKE 'footprint_%'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(table_count, 4);
    }
}
