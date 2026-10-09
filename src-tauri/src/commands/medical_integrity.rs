//! Read-only integrity audit of ordinary local medical report files.
//! Never deletes a missing, corrupted or unreferenced original automatically.

use std::{
    collections::HashSet,
    fs,
    io::Read,
    path::{Path, PathBuf},
};

use rusqlite::params;
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::State;

use crate::{database, desktop::DesktopState};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MedicalArchiveIntegrity {
    pub checked_files: usize,
    pub missing_files: usize,
    pub corrupt_files: usize,
    pub orphan_files: usize,
    pub checked_reports: usize,
}

fn is_safe_archive_filename(name: &str) -> bool {
    let Some((stem, ext)) = name.rsplit_once('.') else {
        return false;
    };
    !stem.is_empty()
        && stem.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        && matches!(ext, "jpg" | "png" | "webp" | "pdf")
}

/// Streaming hashing keeps large backups and original PDFs out of memory.
fn matching_sha256(path: &Path, expected: &str) -> Result<bool, std::io::Error> {
    let mut file = fs::File::open(path)?;
    let mut hash = Sha256::new();
    let mut buffer = [0u8; 65536];
    loop {
        let n = file.read(&mut buffer)?;
        if n == 0 { break; }
        hash.update(&buffer[..n]);
    }
    Ok(format!("{:x}", hash.finalize()) == expected)
}

fn verify_archive(root: &Path) -> Result<MedicalArchiveIntegrity, String> {
    let db = database::connection::open(&root.join("lifetrace.db"))
        .map_err(|_| "无法读取医疗档案数据库".to_owned())?;
    let profile = database::profile::active_profile_id(&db)?;
    let directory = root.join("medical").join("originals");
    let count: i64 = db.query_row(
        "SELECT count(*) FROM medical_reports WHERE user_id=?1",
        [&profile], |row| row.get(0),
    ).map_err(|e| e.to_string())?;

    let mut report = MedicalArchiveIntegrity {
        checked_files: 0,
        missing_files: 0,
        corrupt_files: 0,
        orphan_files: 0,
        checked_reports: count as usize,
    };
    let mut stmt = db.prepare(
        "SELECT relative_path,sha256,bytes_size FROM medical_report_assets WHERE user_id=?1",
    ).map_err(|e| e.to_string())?;
    let files = stmt.query_map(params![profile], |r| {
        Ok((r.get::<_, String>(0)?,r.get::<_, String>(1)?,r.get::<_, i64>(2)?))
    }).map_err(|e| e.to_string())?;

    for file in files {
        let (name,expected_hash,bytes) = file.map_err(|e| e.to_string())?;
        report.checked_files += 1;
        if !is_safe_archive_filename(&name) {
            report.corrupt_files += 1;
            continue;
        }
        let location = directory.join(&name);
        let metadata = match fs::symlink_metadata(&location) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                report.missing_files += 1;
                continue;
            }
            Err(_) => return Err("无法检查本地医疗原始文件".to_owned()),
        };
        if !metadata.is_file() || metadata.file_type().is_symlink() || bytes < 0
            || metadata.len() != bytes as u64
            || !matching_sha256(&location, &expected_hash)
                .map_err(|_| "无法校验原始医疗报告".to_owned())?
        {
            report.corrupt_files += 1;
        }
    }

    // Orphan classification must include all profiles, not just the selected one.
    // Otherwise valid originals belonging to another local profile look orphaned.
    let mut known = HashSet::new();
    let mut stmt = db.prepare("SELECT relative_path FROM medical_report_assets")
        .map_err(|e|e.to_string())?;
    let all = stmt.query_map([], |r| r.get::<_,String>(0))
        .map_err(|e|e.to_string())?;
    for file in all { known.insert(file.map_err(|e|e.to_string())?); }

    if directory.exists() {
        for entry in fs::read_dir(directory).map_err(|_|"无法检查医疗附件目录")? {
            let entry = entry.map_err(|_|"无法枚举医疗附件目录")?;
            let name = entry.file_name().to_string_lossy().into_owned();
            if is_safe_archive_filename(&name) && !known.contains(&name)
                && entry.file_type().map_err(|_|"无法读取附件文件类型")?.is_file()
            {
                report.orphan_files += 1;
            }
        }
    }
    Ok(report)
}

#[tauri::command]
pub async fn medical_verify_archive(
    state: State<'_, DesktopState>,
) -> Result<MedicalArchiveIntegrity, String> {
    let root = state.data_dir.clone();
    tauri::async_runtime::spawn_blocking(move || verify_archive(&root))
        .await.map_err(|_| "医疗文件完整性检查被中断".to_owned())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::migration_runner::{Migration, MigrationContext};
    use crate::database::migrations::M0022MedicalReports;
    use uuid::Uuid;

    #[test]
    fn detects_missing_corrupt_and_orphaned_files_without_deleting_anything() {
        let root = std::env::temp_dir().join(format!("lifetrace-medical-integrity-{}", Uuid::new_v4()));
        let originals = root.join("medical/originals");
        fs::create_dir_all(&originals).unwrap();

        let mut db = database::connection::open(&root.join("lifetrace.db")).unwrap();
        db.execute_batch("PRAGMA foreign_keys=ON;CREATE TABLE local_profiles(id TEXT PRIMARY KEY);
            INSERT INTO local_profiles VALUES('local');
            INSERT INTO local_profiles VALUES('other');").unwrap();
        let tx = db.transaction().unwrap();
        M0022MedicalReports.up(&tx, &MigrationContext::new(root.clone())).unwrap();
        tx.commit().unwrap();
        db.execute(
            "INSERT INTO medical_import_batches VALUES('batch','local','request','now')", [],
        ).unwrap();
        db.execute(
            "INSERT INTO medical_import_batches VALUES('other-batch','other','request','now')", [],
        ).unwrap();
        let contents = [( "valid.jpg",b"valid".as_slice()),("damaged.jpg",b"expected".as_slice())];
        for (i, (filename, contents)) in contents.iter().enumerate() {
            let hash = format!("{:x}", Sha256::digest(contents));
            db.execute(
                "INSERT INTO medical_report_assets VALUES (?1,'local','batch',?2,?3,
                'image/jpeg',?4,?5,?6)",
                params![format!("asset-{i}"),format!("source-{i}"),filename,
                    contents.len() as i64,hash,filename],
            ).unwrap();
        }
        db.execute(
            "INSERT INTO medical_report_assets VALUES ('missing-id','local','batch','missing',
             'missing.jpg','image/jpeg',2,'abc','missing.jpg')",[],
        ).unwrap();
        db.execute(
            "INSERT INTO medical_report_assets VALUES ('other-id','other','other-batch','other',
             'other.jpg','image/jpeg',4,'abc','other.jpg')",[],
        ).unwrap();
        drop(db);
        fs::write(originals.join("valid.jpg"),b"valid").unwrap();
        fs::write(originals.join("damaged.jpg"),b"changed").unwrap();
        fs::write(originals.join("other.jpg"),b"other").unwrap();
        fs::write(originals.join("orphan.jpg"),b"orphan").unwrap();

        let report=verify_archive(&root).unwrap();
        assert_eq!(report.checked_files,3);
        assert_eq!(report.missing_files,1);
        assert_eq!(report.corrupt_files,1);
        assert_eq!(report.orphan_files,1);
        assert!(originals.join("orphan.jpg").exists());
        fs::remove_dir_all(root).unwrap();
    }
}
