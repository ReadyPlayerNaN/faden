use rusqlite::Connection;
use stt_app_lib::db::migrations::apply_migrations;
use stt_app_lib::db::queries::project_meta;

fn fresh_conn() -> Connection {
    let mut c = Connection::open_in_memory().unwrap();
    apply_migrations(&mut c).unwrap();
    c
}

#[test]
fn insert_and_read_project_meta() {
    let conn = fresh_conn();
    project_meta::insert(&conn, "My Study").unwrap();
    let m = project_meta::read(&conn).unwrap();
    assert_eq!(m.name, "My Study");
    assert_eq!(m.schema_version, 1);
}

#[test]
fn insert_is_unique() {
    let conn = fresh_conn();
    project_meta::insert(&conn, "First").unwrap();
    let err = project_meta::insert(&conn, "Second").unwrap_err();
    assert!(matches!(err, stt_app_lib::error::AppError::Sqlite(_)));
}

#[test]
fn read_missing_returns_not_found() {
    let conn = fresh_conn();
    let err = project_meta::read(&conn).unwrap_err();
    assert!(matches!(err, stt_app_lib::error::AppError::NotFound(_)));
}

use std::path::PathBuf;
use stt_app_lib::commands::project::{project_create_impl, project_open_impl, ProjectInfo};
use tempfile::tempdir;

#[tokio::test]
async fn project_create_initializes_files() {
    let dir = tempdir().unwrap();
    let info: ProjectInfo = project_create_impl(dir.path().to_path_buf(), "My Study".into())
        .await
        .unwrap();
    let path = PathBuf::from(&info.path);
    assert_eq!(info.name, "My Study");
    assert_eq!(path.file_name().and_then(|n| n.to_str()), Some("my-study"));
    assert!(path.join("project.sqlite").exists());
    assert!(path.join("project.json").exists());
    assert!(path.join("media").is_dir());
    assert!(path.join("cache").is_dir());
    assert!(info.path.starts_with(dir.path().to_string_lossy().as_ref()));
}

#[tokio::test]
async fn project_open_reads_name_from_metadata_file() {
    let dir = tempdir().unwrap();
    let info = project_create_impl(dir.path().to_path_buf(), "Žluťoučký kůň".into())
        .await
        .unwrap();
    let path = PathBuf::from(&info.path);
    std::fs::write(path.join("project.json"), r#"{"name":"Readable Name"}"#).unwrap();
    let opened = project_open_impl(path.to_string_lossy().to_string())
        .await
        .unwrap();
    assert_eq!(opened.name, "Readable Name");
}

#[tokio::test]
async fn project_create_rejects_existing_project() {
    let dir = tempdir().unwrap();
    project_create_impl(dir.path().to_path_buf(), "A".into())
        .await
        .unwrap();
    let err = project_create_impl(dir.path().to_path_buf(), "A".into())
        .await
        .unwrap_err();
    assert!(matches!(err, stt_app_lib::error::AppError::Conflict(_)));
}

#[tokio::test]
async fn project_open_missing_returns_error() {
    let path: PathBuf = tempdir().unwrap().path().join("does-not-exist");
    let err = project_open_impl(path.to_string_lossy().to_string())
        .await
        .unwrap_err();
    assert!(matches!(err, stt_app_lib::error::AppError::NotFound(_)));
}
