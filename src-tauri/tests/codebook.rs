use rusqlite::Connection;
use stt_app_lib::db::migrations::apply_migrations;
use stt_app_lib::db::queries::cluster;

fn fresh_conn() -> Connection {
    let mut c = Connection::open_in_memory().unwrap();
    c.pragma_update(None, "foreign_keys", "ON").unwrap();
    apply_migrations(&mut c).unwrap();
    c
}

#[test]
fn cluster_create_assigns_id_and_appends() {
    let conn = fresh_conn();
    let a = cluster::create(&conn, "Identity", None, None).unwrap();
    let b = cluster::create(&conn, "Work", None, None).unwrap();
    assert!(b.id > a.id);
    assert_eq!(b.order_index, a.order_index + 1);
}

#[test]
fn cluster_create_rejects_duplicate_name() {
    let conn = fresh_conn();
    cluster::create(&conn, "Identity", None, None).unwrap();
    let err = cluster::create(&conn, "Identity", None, None).unwrap_err();
    assert!(matches!(err, stt_app_lib::error::AppError::Conflict(_)));
}

#[test]
fn cluster_list_returns_in_order() {
    let conn = fresh_conn();
    cluster::create(&conn, "A", None, None).unwrap();
    cluster::create(&conn, "B", None, None).unwrap();
    cluster::create(&conn, "C", None, None).unwrap();
    let all = cluster::list(&conn).unwrap();
    let names: Vec<_> = all.iter().map(|c| c.name.as_str()).collect();
    assert_eq!(names, vec!["A", "B", "C"]);
}

#[test]
fn cluster_rename_persists() {
    let conn = fresh_conn();
    let c = cluster::create(&conn, "Old", None, None).unwrap();
    cluster::rename(&conn, c.id, "New").unwrap();
    let all = cluster::list(&conn).unwrap();
    assert_eq!(all[0].name, "New");
}

#[test]
fn cluster_rename_rejects_duplicate() {
    let conn = fresh_conn();
    let a = cluster::create(&conn, "A", None, None).unwrap();
    cluster::create(&conn, "B", None, None).unwrap();
    let err = cluster::rename(&conn, a.id, "B").unwrap_err();
    assert!(matches!(err, stt_app_lib::error::AppError::Conflict(_)));
}

#[test]
fn cluster_delete_works_when_empty() {
    let conn = fresh_conn();
    let c = cluster::create(&conn, "A", None, None).unwrap();
    cluster::delete(&conn, c.id).unwrap();
    assert!(cluster::list(&conn).unwrap().is_empty());
}

#[test]
fn cluster_reorder_swaps_indexes() {
    let mut conn = fresh_conn();
    let a = cluster::create(&conn, "A", None, None).unwrap();
    let b = cluster::create(&conn, "B", None, None).unwrap();
    let c = cluster::create(&conn, "C", None, None).unwrap();
    cluster::reorder(&mut conn, &[c.id, a.id, b.id]).unwrap();
    let all = cluster::list(&conn).unwrap();
    let names: Vec<_> = all.iter().map(|c| c.name.as_str()).collect();
    assert_eq!(names, vec!["C", "A", "B"]);
}
