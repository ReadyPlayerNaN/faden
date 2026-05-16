use rusqlite::Connection;
use faden_app_lib::db::migrations::apply_migrations;
use faden_app_lib::db::queries::ai_run::{self, AiRunKind, AiRunStatus};
use faden_app_lib::db::queries::ai_run_ops::{self, AiRunNodeStatus, AiRunStageKey, AiRunTaskKind};
use faden_app_lib::db::queries::interview::{self, TranscriptStatus};

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
    assert!(matches!(err, faden_app_lib::error::AppError::NotFound(_)));
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

#[test]
fn reconcile_interrupted_runs_marks_transcription_failed() {
    let conn = fresh_conn();
    let interview_row = interview::create(&conn, "I").unwrap();
    interview::set_status(&conn, interview_row.id, TranscriptStatus::InProgress).unwrap();
    let run_id = ai_run::start(
        &conn,
        AiRunKind::Transcribe,
        Some(interview_row.id),
        "model-x",
        "prompt",
        None,
    )
    .unwrap();
    ai_run_ops::create_transcription_stages(&conn, run_id).unwrap();
    ai_run_ops::mark_stage_complete(&conn, run_id, AiRunStageKey::AnalyzeSource).unwrap();
    ai_run_ops::mark_stage_running(&conn, run_id, AiRunStageKey::EncodeChunks).unwrap();
    ai_run_ops::create_chunk_tasks(
        &conn,
        run_id,
        AiRunStageKey::EncodeChunks,
        AiRunTaskKind::EncodeChunk,
        2,
        1,
    )
    .unwrap();
    ai_run_ops::mark_task_running(&conn, run_id, AiRunStageKey::EncodeChunks, 0, 1, 1).unwrap();

    let recovered = ai_run::reconcile_interrupted_runs(&conn).unwrap();
    assert_eq!(recovered, 1);

    let run = ai_run::get(&conn, run_id).unwrap();
    assert_eq!(run.status, AiRunStatus::Failed);
    assert!(run.error.unwrap().contains("app closed unexpectedly"));

    let updated_interview = interview::get(&conn, interview_row.id).unwrap();
    assert_eq!(updated_interview.transcript_status, TranscriptStatus::Failed);

    let stages = ai_run_ops::list_stages(&conn, run_id).unwrap();
    assert_eq!(stages[0].status, AiRunNodeStatus::Complete);
    assert_eq!(stages[2].status, AiRunNodeStatus::Failed);
    assert_eq!(stages[3].status, AiRunNodeStatus::Cancelled);

    let tasks = ai_run_ops::list_tasks(&conn, run_id).unwrap();
    assert_eq!(tasks[0].status, AiRunNodeStatus::Failed);
    assert_eq!(tasks[1].status, AiRunNodeStatus::Cancelled);
}
