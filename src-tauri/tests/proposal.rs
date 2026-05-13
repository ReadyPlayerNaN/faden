use rusqlite::Connection;
use serde_json::json;
use stt_app_lib::db::migrations::apply_migrations;
use stt_app_lib::db::queries::ai_run::AiRunKind;
use stt_app_lib::db::queries::proposal::{ProposalKind, ProposalStatus};
use stt_app_lib::db::queries::{ai_run, proposal};

fn fresh() -> Connection {
    let mut c = Connection::open_in_memory().unwrap();
    c.pragma_update(None, "foreign_keys", "ON").unwrap();
    apply_migrations(&mut c).unwrap();
    c
}

fn make_run(conn: &Connection) -> i64 {
    ai_run::start(conn, AiRunKind::CodebookGen, None, "m", "p").unwrap()
}

#[test]
fn create_and_get() {
    let conn = fresh();
    let run_id = make_run(&conn);
    let id = proposal::create(&conn, run_id, ProposalKind::CodebookGen, &json!({"hi":1})).unwrap();
    let p = proposal::get(&conn, id).unwrap();
    assert_eq!(p.status, ProposalStatus::Pending);
    assert_eq!(p.payload["hi"], 1);
}

#[test]
fn list_pending_filters_by_kind() {
    let conn = fresh();
    let run_id = make_run(&conn);
    proposal::create(&conn, run_id, ProposalKind::Pretag, &json!({})).unwrap();
    proposal::create(&conn, run_id, ProposalKind::CodebookGen, &json!({})).unwrap();
    assert_eq!(
        proposal::list_pending(&conn, Some(ProposalKind::Pretag))
            .unwrap()
            .len(),
        1
    );
    assert_eq!(proposal::list_pending(&conn, None).unwrap().len(), 2);
}

#[test]
fn mark_accepted_transitions() {
    let conn = fresh();
    let run_id = make_run(&conn);
    let id = proposal::create(&conn, run_id, ProposalKind::Pretag, &json!({})).unwrap();
    proposal::mark_accepted(&conn, id).unwrap();
    let p = proposal::get(&conn, id).unwrap();
    assert_eq!(p.status, ProposalStatus::Accepted);
    assert!(p.decided_at.is_some());
}

#[test]
fn mark_rejected_transitions() {
    let conn = fresh();
    let run_id = make_run(&conn);
    let id = proposal::create(&conn, run_id, ProposalKind::FindMore, &json!({})).unwrap();
    proposal::mark_rejected(&conn, id).unwrap();
    let p = proposal::get(&conn, id).unwrap();
    assert_eq!(p.status, ProposalStatus::Rejected);
}

#[test]
fn unknown_proposal_returns_not_found() {
    let conn = fresh();
    let err = proposal::get(&conn, 999).unwrap_err();
    assert!(matches!(err, stt_app_lib::error::AppError::NotFound(_)));
}
