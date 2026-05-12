use stt_app_lib::commands::interview::interview_create_with_audio_impl;
use std::io::Write;
use tempfile::{tempdir, NamedTempFile};

#[tokio::test]
async fn copies_audio_into_media() {
    let project = tempdir().unwrap();
    let project_dir = project.path().to_path_buf();
    std::fs::create_dir_all(project_dir.join("media")).unwrap();
    // bootstrap empty project.sqlite via migrations
    let conn = rusqlite::Connection::open(project_dir.join("project.sqlite")).unwrap();
    let mut conn = conn;
    stt_app_lib::db::migrations::apply_migrations(&mut conn).unwrap();
    drop(conn);

    let mut tmp = NamedTempFile::new().unwrap();
    tmp.write_all(b"fake audio").unwrap();
    let src_path = tmp.path().to_string_lossy().to_string();

    let iv = interview_create_with_audio_impl(project_dir.clone(), "Test One".into(), src_path)
        .await.unwrap();

    assert_eq!(iv.name, "Test One");
    let audio_rel = iv.audio_path.expect("audio_path should be set");
    assert!(audio_rel.starts_with("media/Test_One-"));
    assert!(project_dir.join(&audio_rel).exists());
}

#[tokio::test]
async fn rejects_missing_source_file() {
    let project = tempdir().unwrap();
    let project_dir = project.path().to_path_buf();
    let err = interview_create_with_audio_impl(project_dir, "X".into(), "/no/such/file.mp3".into())
        .await.unwrap_err();
    assert!(matches!(err, stt_app_lib::error::AppError::NotFound(_)));
}

#[tokio::test]
async fn stores_relative_path() {
    let project = tempdir().unwrap();
    let project_dir = project.path().to_path_buf();
    std::fs::create_dir_all(project_dir.join("media")).unwrap();
    let conn = rusqlite::Connection::open(project_dir.join("project.sqlite")).unwrap();
    let mut conn = conn;
    stt_app_lib::db::migrations::apply_migrations(&mut conn).unwrap();
    drop(conn);

    let mut tmp = NamedTempFile::new().unwrap();
    tmp.write_all(b"x").unwrap();
    let src = tmp.path().to_string_lossy().to_string();

    let iv = interview_create_with_audio_impl(project_dir, "A".into(), src).await.unwrap();
    let path = iv.audio_path.unwrap();
    // Must be relative; should not contain the temp dir prefix
    assert!(!path.starts_with('/'));
    assert!(path.starts_with("media/"));
}
