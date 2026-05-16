use rusqlite::Connection;
use stt_app_lib::db::migrations::apply_migrations;
use stt_app_lib::db::queries::ai_run::{self, AiRunKind, AiRunStatus};
use stt_app_lib::db::queries::interview;

fn fresh_conn() -> Connection {
    let mut c = Connection::open_in_memory().unwrap();
    c.pragma_update(None, "foreign_keys", "ON").unwrap();
    apply_migrations(&mut c).unwrap();
    c
}

#[test]
fn start_creates_running_run() {
    let conn = fresh_conn();
    let i = interview::create(&conn, "I").unwrap();
    let id = ai_run::start(
        &conn,
        AiRunKind::Transcribe,
        Some(i.id),
        "model-x",
        "prompt",
        None,
    )
    .unwrap();
    let r = ai_run::get(&conn, id).unwrap();
    assert_eq!(r.status, AiRunStatus::Running);
    assert_eq!(r.kind, AiRunKind::Transcribe);
}

#[test]
fn complete_transitions_to_complete() {
    let conn = fresh_conn();
    let id = ai_run::start(&conn, AiRunKind::Pretag, None, "m", "p", None).unwrap();
    ai_run::complete(&conn, id, Some("{}"), Some("done"), Some("raw output")).unwrap();
    let r = ai_run::get(&conn, id).unwrap();
    assert_eq!(r.status, AiRunStatus::Complete);
    assert!(r.completed_at.is_some());
    assert_eq!(r.result_summary.as_deref(), Some("done"));
    assert_eq!(r.raw_output.as_deref(), Some("raw output"));
}

#[test]
fn fail_records_error() {
    let conn = fresh_conn();
    let id = ai_run::start(&conn, AiRunKind::Transcribe, None, "m", "p", None).unwrap();
    ai_run::fail(&conn, id, "boom", Some("partial raw output")).unwrap();
    let r = ai_run::get(&conn, id).unwrap();
    assert_eq!(r.status, AiRunStatus::Failed);
    assert_eq!(r.error.as_deref(), Some("boom"));
    assert_eq!(r.raw_output.as_deref(), Some("partial raw output"));
}

#[test]
fn cancel_only_when_running() {
    let conn = fresh_conn();
    let id = ai_run::start(&conn, AiRunKind::Transcribe, None, "m", "p", None).unwrap();
    ai_run::cancel(&conn, id).unwrap();
    let r = ai_run::get(&conn, id).unwrap();
    assert_eq!(r.status, AiRunStatus::Cancelled);
    // Calling cancel again should fail because not running anymore
    let err = ai_run::cancel(&conn, id).unwrap_err();
    assert!(matches!(err, stt_app_lib::error::AppError::NotFound(_)));
}

#[test]
fn list_for_interview_orders_by_started_desc() {
    let conn = fresh_conn();
    let i = interview::create(&conn, "I").unwrap();
    let first = ai_run::start(&conn, AiRunKind::Transcribe, Some(i.id), "m", "p1", None).unwrap();
    // Small sleep would make timestamps differ; instead just trust ordering by ID for same-instant inserts.
    let second = ai_run::start(&conn, AiRunKind::Pretag, Some(i.id), "m", "p2", None).unwrap();
    let runs = ai_run::list_for_interview(&conn, i.id).unwrap();
    assert_eq!(runs.len(), 2);
    // Most recent first
    assert_eq!(runs[0].id, second);
    assert_eq!(runs[1].id, first);
}
