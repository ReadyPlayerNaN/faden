use rusqlite::Connection;
use stt_app_lib::db::migrations::apply_migrations;
use stt_app_lib::db::queries::ai_run::{self, AiRunKind};
use stt_app_lib::db::queries::ai_run_ops::{self, AiRunNodeStatus, AiRunStageKey, AiRunTaskKind};

fn fresh_conn() -> Connection {
    let mut c = Connection::open_in_memory().unwrap();
    c.pragma_update(None, "foreign_keys", "ON").unwrap();
    apply_migrations(&mut c).unwrap();
    c
}

#[test]
fn transcription_stages_and_tasks_can_be_tracked() {
    let conn = fresh_conn();
    let run_id = ai_run::start(&conn, AiRunKind::Transcribe, None, "m", "p", None).unwrap();

    ai_run_ops::create_transcription_stages(&conn, run_id).unwrap();
    ai_run_ops::mark_stage_running(&conn, run_id, AiRunStageKey::PrepareChunks).unwrap();
    ai_run_ops::create_chunk_tasks(
        &conn,
        run_id,
        AiRunStageKey::EncodeChunks,
        AiRunTaskKind::EncodeChunk,
        3,
        1,
    )
    .unwrap();
    ai_run_ops::mark_task_running(&conn, run_id, AiRunStageKey::EncodeChunks, 0, 1, 1).unwrap();
    ai_run_ops::mark_task_complete(&conn, run_id, AiRunStageKey::EncodeChunks, 0, 1, 1).unwrap();
    ai_run_ops::set_stage_counts(
        &conn,
        run_id,
        AiRunStageKey::EncodeChunks,
        Some(3),
        Some(1),
        Some(0),
    )
    .unwrap();

    let stages = ai_run_ops::list_stages(&conn, run_id).unwrap();
    let tasks = ai_run_ops::list_tasks(&conn, run_id).unwrap();

    assert_eq!(stages.len(), 6);
    assert_eq!(tasks.len(), 3);
    assert_eq!(tasks[0].status, AiRunNodeStatus::Complete);
    assert_eq!(tasks[0].kind, AiRunTaskKind::EncodeChunk);
    assert_eq!(stages[2].stage_key, AiRunStageKey::EncodeChunks);
    assert_eq!(stages[2].total_count, Some(3));
    assert_eq!(stages[2].completed_count, Some(1));
}
