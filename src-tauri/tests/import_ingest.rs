use std::io::Write;
use faden_app_lib::db;
use faden_app_lib::db::queries::interview::TranscriptStatus;
use faden_app_lib::db::queries::{segment, speaker};
use faden_app_lib::import::ingest::ingest_impl;
use faden_app_lib::import::json_schema::parse_json;
use faden_app_lib::import::plain_text::parse;
use tempfile::{tempdir, NamedTempFile};

fn bootstrap(project_dir: &std::path::Path) {
    let sqlite = project_dir.join("project.sqlite");
    let mut conn = rusqlite::Connection::open(&sqlite).unwrap();
    faden_app_lib::db::migrations::apply_migrations(&mut conn).unwrap();
}

#[tokio::test]
async fn text_only_ingest() {
    let project = tempdir().unwrap();
    let project_dir = project.path().to_path_buf();
    bootstrap(&project_dir);

    let pt = parse("A: hello\nB: world").unwrap();
    let iv = ingest_impl(project_dir.clone(), "T1".into(), None, Some(pt))
        .await
        .unwrap();
    assert_eq!(iv.transcript_status, TranscriptStatus::Complete);
    assert!(iv.audio_path.is_none());

    let conn = db::open(&project_dir.join("project.sqlite")).unwrap();
    let segs = segment::list_for_interview(&conn, iv.id).unwrap();
    assert_eq!(segs.len(), 2);
    let speakers = speaker::list_for_interview(&conn, iv.id).unwrap();
    assert_eq!(speakers.len(), 2);
}

#[tokio::test]
async fn json_only_ingest() {
    let project = tempdir().unwrap();
    let project_dir = project.path().to_path_buf();
    bootstrap(&project_dir);

    let raw = r#"{"segments":[
        {"speaker":"A","start":0.0,"end":1.0,"text":"hello"},
        {"speaker":"B","start":1.0,"end":2.0,"text":"hi"}
    ]}"#;
    let pt = parse_json(raw).unwrap();
    let iv = ingest_impl(project_dir.clone(), "T2".into(), None, Some(pt))
        .await
        .unwrap();
    assert_eq!(iv.transcript_status, TranscriptStatus::Complete);

    let conn = db::open(&project_dir.join("project.sqlite")).unwrap();
    let segs = segment::list_for_interview(&conn, iv.id).unwrap();
    assert_eq!(segs.len(), 2);
    let speakers = speaker::list_for_interview(&conn, iv.id).unwrap();
    assert_eq!(speakers.len(), 2);
}

#[tokio::test]
async fn audio_only_ingest() {
    let project = tempdir().unwrap();
    let project_dir = project.path().to_path_buf();
    bootstrap(&project_dir);

    let mut tmp = NamedTempFile::new().unwrap();
    tmp.write_all(b"fake").unwrap();
    let src = tmp.path().to_string_lossy().to_string();

    let iv = ingest_impl(project_dir.clone(), "AudOnly".into(), Some(src), None)
        .await
        .unwrap();
    assert!(iv.audio_path.is_some());
    assert_eq!(iv.transcript_status, TranscriptStatus::None);
}

#[tokio::test]
async fn audio_plus_transcript_ingest() {
    let project = tempdir().unwrap();
    let project_dir = project.path().to_path_buf();
    bootstrap(&project_dir);

    let mut tmp = NamedTempFile::new().unwrap();
    tmp.write_all(b"fake").unwrap();
    let src = tmp.path().to_string_lossy().to_string();

    let pt = parse("A: hello").unwrap();
    let iv = ingest_impl(project_dir.clone(), "Both".into(), Some(src), Some(pt))
        .await
        .unwrap();
    assert!(iv.audio_path.is_some());
    assert_eq!(iv.transcript_status, TranscriptStatus::Complete);

    let conn = db::open(&project_dir.join("project.sqlite")).unwrap();
    let segs = segment::list_for_interview(&conn, iv.id).unwrap();
    assert_eq!(segs.len(), 1);
}

#[tokio::test]
async fn empty_input_fails() {
    let project = tempdir().unwrap();
    let project_dir = project.path().to_path_buf();
    bootstrap(&project_dir);

    let err = ingest_impl(project_dir, "X".into(), None, None)
        .await
        .unwrap_err();
    assert!(matches!(err, faden_app_lib::error::AppError::Invalid(_)));
}

#[tokio::test]
async fn missing_audio_fails() {
    let project = tempdir().unwrap();
    let project_dir = project.path().to_path_buf();
    bootstrap(&project_dir);

    let err = ingest_impl(
        project_dir,
        "X".into(),
        Some("/no/such/file.mp3".into()),
        None,
    )
    .await
    .unwrap_err();
    assert!(matches!(err, faden_app_lib::error::AppError::NotFound(_)));
}
