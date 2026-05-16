use rusqlite::Connection;
use serde_json::json;
use faden_app_lib::db::migrations::apply_migrations;
use faden_app_lib::db::queries::ai_run::AiRunKind;
use faden_app_lib::db::queries::proposal::{ProposalKind, ProposalStatus};
use faden_app_lib::db::queries::{ai_run, proposal};

fn fresh() -> Connection {
    let mut c = Connection::open_in_memory().unwrap();
    c.pragma_update(None, "foreign_keys", "ON").unwrap();
    apply_migrations(&mut c).unwrap();
    c
}

fn make_run(conn: &Connection) -> i64 {
    ai_run::start(conn, AiRunKind::CodebookGen, None, "m", "p", None).unwrap()
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
fn list_for_run_filters_by_ai_run_id() {
    let conn = fresh();
    let first_run_id = make_run(&conn);
    let second_run_id = make_run(&conn);
    let first_proposal_id = proposal::create(
        &conn,
        first_run_id,
        ProposalKind::Pretag,
        &json!({"name":"first"}),
    )
    .unwrap();
    proposal::create(
        &conn,
        second_run_id,
        ProposalKind::Pretag,
        &json!({"name":"second"}),
    )
    .unwrap();

    let results =
        proposal::list_for_run(&conn, first_run_id, None, &[ProposalStatus::Pending]).unwrap();
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].id, first_proposal_id);
}

#[test]
fn list_filters_by_status() {
    let conn = fresh();
    let run_id = make_run(&conn);
    let pending_id = proposal::create(
        &conn,
        run_id,
        ProposalKind::Pretag,
        &json!({"name":"pending"}),
    )
    .unwrap();
    let accepted_id = proposal::create(
        &conn,
        run_id,
        ProposalKind::CodebookGen,
        &json!({"name":"accepted"}),
    )
    .unwrap();
    let rejected_id = proposal::create(
        &conn,
        run_id,
        ProposalKind::FindMore,
        &json!({"name":"rejected"}),
    )
    .unwrap();
    proposal::mark_accepted(&conn, accepted_id).unwrap();
    proposal::mark_rejected(&conn, rejected_id).unwrap();

    let pending_only = proposal::list(&conn, None, &[ProposalStatus::Pending]).unwrap();
    assert_eq!(pending_only.len(), 1);
    assert_eq!(pending_only[0].id, pending_id);

    let decided = proposal::list(
        &conn,
        None,
        &[ProposalStatus::Accepted, ProposalStatus::Rejected],
    )
    .unwrap();
    assert_eq!(decided.len(), 2);
    assert!(decided.iter().any(|proposal| proposal.id == accepted_id));
    assert!(decided.iter().any(|proposal| proposal.id == rejected_id));
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
    assert!(matches!(err, faden_app_lib::error::AppError::NotFound(_)));
}
