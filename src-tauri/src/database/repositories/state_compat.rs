//! Compatibility tests for the non-financial desktop state contract.
#[cfg(test)]
mod tests {
    use crate::database::migration_runner::{run, MigrationContext};
    use crate::database::migrations::all;
    use crate::database::repositories::habits;
    use rusqlite::Connection;
    use serde_json::json;

    #[test]
    fn state_reads_and_writes_habit_records() {
        let directory = std::env::temp_dir().join(format!("lifetrace-no-finance-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        let mut db = Connection::open(directory.join("test.db")).unwrap();
        run(&mut db, &MigrationContext::new(directory.clone()), &all()).unwrap();
        let stamp = "2026-07-01T00:00:00Z";
        habits::save_activity(&db, &json!({
            "id":"h1","userId":"local-user","name":"阅读","type":"count",
            "unit":"次","targetPeriod":"daily","isArchived":false,
            "createdAt":stamp,"updatedAt":stamp
        })).unwrap();
        assert_eq!(habits::list_activities(&db).unwrap().len(),1);
        std::fs::remove_dir_all(directory).ok();
    }
}
