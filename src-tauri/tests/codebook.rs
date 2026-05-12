use rusqlite::Connection;
use stt_app_lib::db::migrations::apply_migrations;
use stt_app_lib::db::queries::{category, cluster};

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

#[test]
fn category_create_requires_existing_cluster() {
    let conn = fresh_conn();
    let err = category::create(&conn, 999, "X", None, None).unwrap_err();
    assert!(matches!(err, stt_app_lib::error::AppError::NotFound(_)));
}

#[test]
fn category_create_appends_within_cluster() {
    let conn = fresh_conn();
    let cl = cluster::create(&conn, "Identity", None, None).unwrap();
    let a = category::create(&conn, cl.id, "A", None, None).unwrap();
    let b = category::create(&conn, cl.id, "B", None, None).unwrap();
    assert_eq!(b.order_index, a.order_index + 1);
}

#[test]
fn category_name_unique_across_project() {
    let conn = fresh_conn();
    let c1 = cluster::create(&conn, "C1", None, None).unwrap();
    let c2 = cluster::create(&conn, "C2", None, None).unwrap();
    category::create(&conn, c1.id, "Same", None, None).unwrap();
    let err = category::create(&conn, c2.id, "Same", None, None).unwrap_err();
    assert!(matches!(err, stt_app_lib::error::AppError::Conflict(_)));
}

#[test]
fn category_list_for_cluster_filters() {
    let conn = fresh_conn();
    let c1 = cluster::create(&conn, "C1", None, None).unwrap();
    let c2 = cluster::create(&conn, "C2", None, None).unwrap();
    category::create(&conn, c1.id, "A1", None, None).unwrap();
    category::create(&conn, c2.id, "A2", None, None).unwrap();
    assert_eq!(category::list_for_cluster(&conn, c1.id).unwrap().len(), 1);
}

#[test]
fn category_move_to_cluster_works() {
    let conn = fresh_conn();
    let c1 = cluster::create(&conn, "C1", None, None).unwrap();
    let c2 = cluster::create(&conn, "C2", None, None).unwrap();
    let cat = category::create(&conn, c1.id, "Moveme", None, None).unwrap();
    category::move_to_cluster(&conn, cat.id, c2.id).unwrap();
    let moved = category::get(&conn, cat.id).unwrap();
    assert_eq!(moved.cluster_id, c2.id);
}

#[test]
fn category_reorder_within_cluster() {
    let mut conn = fresh_conn();
    let cl = cluster::create(&conn, "C", None, None).unwrap();
    let a = category::create(&conn, cl.id, "A", None, None).unwrap();
    let b = category::create(&conn, cl.id, "B", None, None).unwrap();
    let cc = category::create(&conn, cl.id, "C2", None, None).unwrap();
    category::reorder(&mut conn, cl.id, &[cc.id, a.id, b.id]).unwrap();
    let listed = category::list_for_cluster(&conn, cl.id).unwrap();
    let names: Vec<_> = listed.iter().map(|c| c.name.as_str()).collect();
    assert_eq!(names, vec!["C2", "A", "B"]);
}

#[test]
fn category_delete_empty_works() {
    let conn = fresh_conn();
    let cl = cluster::create(&conn, "C", None, None).unwrap();
    let cat = category::create(&conn, cl.id, "X", None, None).unwrap();
    category::delete(&conn, cat.id).unwrap();
    assert!(category::list_all(&conn).unwrap().is_empty());
}
