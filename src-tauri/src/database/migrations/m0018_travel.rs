use rusqlite::Transaction;

use crate::database::migration_runner::{
    Migration, MigrationContext, MigrationError, MigrationReport,
};

/// Travel MVP schema: trips, reusable places, repeated visits and photo links.
/// Photo ids intentionally stay as soft references because the photo vault has
/// its own lifecycle and storage tables.
pub struct M0018Travel;

impl Migration for M0018Travel {
    fn version(&self) -> i64 { 18 }

    fn name(&self) -> &'static str { "travel-mvp" }

    fn checksum(&self) -> &'static str { "m0018-travel-mvp-v1" }

    fn up(
        &self,
        transaction: &Transaction,
        _context: &MigrationContext,
    ) -> Result<MigrationReport, MigrationError> {
        transaction.execute_batch(
            r#"
            CREATE TABLE travel_trips (
              id TEXT PRIMARY KEY,
              user_id TEXT NOT NULL REFERENCES local_profiles(id) ON DELETE CASCADE,
              title TEXT NOT NULL,
              start_at TEXT,
              end_at TEXT,
              description TEXT,
              cover_photo_id TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              deleted_at TEXT,
              version INTEGER NOT NULL DEFAULT 1
            );
            CREATE INDEX idx_travel_trips_user_dates
              ON travel_trips(user_id,start_at,end_at,updated_at DESC);

            CREATE TABLE travel_places (
              id TEXT PRIMARY KEY,
              user_id TEXT NOT NULL REFERENCES local_profiles(id) ON DELETE CASCADE,
              name TEXT NOT NULL,
              country TEXT,
              country_code TEXT,
              province TEXT,
              city TEXT,
              latitude REAL,
              longitude REAL,
              place_type TEXT NOT NULL DEFAULT 'custom'
                CHECK(place_type IN ('country','city','attraction','restaurant','hotel','station','airport','custom')),
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              deleted_at TEXT,
              version INTEGER NOT NULL DEFAULT 1
            );
            CREATE INDEX idx_travel_places_user_city
              ON travel_places(user_id,country_code,province,city,name);
            CREATE INDEX idx_travel_places_coordinates
              ON travel_places(user_id,latitude,longitude);

            CREATE TABLE travel_visits (
              id TEXT PRIMARY KEY,
              user_id TEXT NOT NULL REFERENCES local_profiles(id) ON DELETE CASCADE,
              trip_id TEXT REFERENCES travel_trips(id) ON DELETE SET NULL,
              place_id TEXT NOT NULL REFERENCES travel_places(id) ON DELETE RESTRICT,
              arrived_at TEXT,
              left_at TEXT,
              note TEXT,
              sequence INTEGER,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              deleted_at TEXT,
              version INTEGER NOT NULL DEFAULT 1
            );
            CREATE INDEX idx_travel_visits_place
              ON travel_visits(user_id,place_id,arrived_at DESC);
            CREATE INDEX idx_travel_visits_trip
              ON travel_visits(user_id,trip_id,sequence,arrived_at);

            CREATE TABLE travel_photo_links (
              id TEXT PRIMARY KEY,
              user_id TEXT NOT NULL REFERENCES local_profiles(id) ON DELETE CASCADE,
              photo_id TEXT NOT NULL,
              trip_id TEXT REFERENCES travel_trips(id) ON DELETE SET NULL,
              visit_id TEXT REFERENCES travel_visits(id) ON DELETE SET NULL,
              place_id TEXT REFERENCES travel_places(id) ON DELETE SET NULL,
              latitude REAL,
              longitude REAL,
              captured_at TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              deleted_at TEXT,
              version INTEGER NOT NULL DEFAULT 1
            );
            CREATE UNIQUE INDEX idx_travel_photo_links_unique_visit
              ON travel_photo_links(user_id,photo_id,visit_id)
              WHERE visit_id IS NOT NULL AND deleted_at IS NULL;
            CREATE INDEX idx_travel_photo_links_place
              ON travel_photo_links(user_id,place_id,captured_at);
            CREATE INDEX idx_travel_photo_links_trip
              ON travel_photo_links(user_id,trip_id,captured_at);
            "#,
        ).map_err(|error| MigrationError {
            version: 18,
            message: format!("create travel MVP tables: {error}"),
        })?;

        let mut report = MigrationReport::default();
        report.metrics.insert("travel_tables".to_owned(), 4);
        report.metrics.insert("travel_indexes".to_owned(), 8);
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
    fn place_supports_repeated_visits_without_duplication() {
        let unique = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let data_dir = std::env::temp_dir().join(format!("lifetrace-m0018-{unique}"));
        std::fs::create_dir_all(&data_dir).unwrap();

        let mut connection = Connection::open_in_memory().unwrap();
        connection.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        run(&mut connection, &MigrationContext::new(data_dir), &all()).unwrap();
        let profile = crate::database::profile::active_profile_id(&connection).unwrap();

        connection.execute(
            "INSERT INTO travel_places(id,user_id,name,city,latitude,longitude,created_at,updated_at)
             VALUES('xiamen',?1,'厦门','厦门',24.4798,118.0894,'2026-10-02T00:00:00Z','2026-10-02T00:00:00Z')",
            [&profile],
        ).unwrap();
        for (id, arrived) in [("visit-1","2025-10-03T00:00:00Z"),("visit-2","2026-09-27T00:00:00Z")] {
            connection.execute(
                "INSERT INTO travel_visits(id,user_id,place_id,arrived_at,created_at,updated_at)
                 VALUES(?1,?2,'xiamen',?3,'2026-10-02T00:00:00Z','2026-10-02T00:00:00Z')",
                rusqlite::params![id, profile, arrived],
            ).unwrap();
        }
        let count: i64 = connection.query_row(
            "SELECT COUNT(*) FROM travel_visits WHERE place_id='xiamen'",
            [],
            |row| row.get(0),
        ).unwrap();
        assert_eq!(count, 2);
    }
}
