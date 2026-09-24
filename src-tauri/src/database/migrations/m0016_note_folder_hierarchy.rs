use rusqlite::Transaction;

use crate::database::migration_runner::{
    Migration, MigrationContext, MigrationError, MigrationReport,
};

/// Adds hierarchical Notes folders while keeping legacy flat folders valid.
///
/// `parent_folder_id` is intentionally nullable and not enforced with a
/// self-referencing foreign key so remote sync can apply child/parent changes
/// in either order. Local APIs still preserve the relationship when present.
pub struct M0016NoteFolderHierarchy;

impl Migration for M0016NoteFolderHierarchy {
    fn version(&self) -> i64 {
        16
    }

    fn name(&self) -> &'static str {
        "note-folder-hierarchy"
    }

    fn checksum(&self) -> &'static str {
        "m0016-note-folder-hierarchy-v1"
    }

    fn up(
        &self,
        transaction: &Transaction,
        _context: &MigrationContext,
    ) -> Result<MigrationReport, MigrationError> {
        transaction
            .execute_batch(
                r#"
                ALTER TABLE note_folders ADD COLUMN parent_folder_id TEXT;
                CREATE INDEX idx_note_folders_parent
                  ON note_folders(user_id,parent_folder_id,sort_order,name);
                "#,
            )
            .map_err(|error| MigrationError {
                version: 16,
                message: format!("add note folder hierarchy: {error}"),
            })?;

        let mut report = MigrationReport::default();
        report
            .metrics
            .insert("note_folder_parent_column".to_owned(), 1);
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
    fn folders_can_reference_a_parent() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let data_dir = std::env::temp_dir().join(format!("lifetrace-m0016-{unique}"));
        std::fs::create_dir_all(&data_dir).unwrap();

        let mut connection = Connection::open_in_memory().unwrap();
        connection.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        run(&mut connection, &MigrationContext::new(data_dir), &all()).unwrap();

        let profile = crate::database::profile::active_profile_id(&connection).unwrap();
        connection
            .execute(
                "INSERT INTO note_folders(id,user_id,name,icon,color,sort_order,created_at,updated_at)
                 VALUES('root',?1,'Root','folder','#fff',0,'2026-09-24T00:00:00Z','2026-09-24T00:00:00Z')",
                [&profile],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO note_folders(id,user_id,name,icon,color,parent_folder_id,sort_order,created_at,updated_at)
                 VALUES('child',?1,'Child','folder','#fff','root',0,'2026-09-24T00:00:00Z','2026-09-24T00:00:00Z')",
                [&profile],
            )
            .unwrap();

        let parent: Option<String> = connection
            .query_row(
                "SELECT parent_folder_id FROM note_folders WHERE id='child'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(parent.as_deref(), Some("root"));
    }
}
