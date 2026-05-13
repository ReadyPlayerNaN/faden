use rusqlite::Connection;
use stt_app_lib::db::migrations::apply_migrations;
use stt_app_lib::db::queries::{category, cluster, project_meta, tag};
use stt_app_lib::export::codebook::{write_codebook_csv, write_codebook_json};
use stt_app_lib::export::{compose, ExportScope};

fn fresh() -> Connection {
    let mut c = Connection::open_in_memory().unwrap();
    c.pragma_update(None, "foreign_keys", "ON").unwrap();
    apply_migrations(&mut c).unwrap();
    project_meta::insert(&c, "Test").unwrap();
    c
}

#[test]
fn codebook_json_empty_project_has_empty_clusters() {
    let conn = fresh();
    let data = compose(&conn, &ExportScope::default()).unwrap();
    let mut out = Vec::new();
    write_codebook_json(&data, &mut out).unwrap();
    let s = String::from_utf8(out).unwrap();
    let v: serde_json::Value = serde_json::from_str(&s).unwrap();
    assert_eq!(v["clusters"].as_array().unwrap().len(), 0);
}

#[test]
fn codebook_json_serializes_full_hierarchy() {
    let conn = fresh();
    let cl = cluster::create(&conn, "C", Some("cluster-desc"), Some("#ff0000")).unwrap();
    let cat = category::create(&conn, cl.id, "Cat", None, None).unwrap();
    tag::create(&conn, cat.id, "T1", Some("tag-desc"), None).unwrap();
    let data = compose(&conn, &ExportScope::default()).unwrap();
    let mut out = Vec::new();
    write_codebook_json(&data, &mut out).unwrap();
    let s = String::from_utf8(out).unwrap();
    let v: serde_json::Value = serde_json::from_str(&s).unwrap();
    assert_eq!(v["clusters"][0]["name"], "C");
    assert_eq!(v["clusters"][0]["description"], "cluster-desc");
    assert_eq!(v["clusters"][0]["categories"][0]["name"], "Cat");
    assert_eq!(v["clusters"][0]["categories"][0]["tags"][0]["name"], "T1");
    assert_eq!(
        v["clusters"][0]["categories"][0]["tags"][0]["description"],
        "tag-desc"
    );
}

#[test]
fn codebook_csv_writes_header_and_rows() {
    let conn = fresh();
    let cl = cluster::create(&conn, "C", None, None).unwrap();
    let cat = category::create(&conn, cl.id, "Cat", None, None).unwrap();
    tag::create(&conn, cat.id, "T1", Some("desc1"), None).unwrap();
    tag::create(&conn, cat.id, "T2", None, None).unwrap();
    let data = compose(&conn, &ExportScope::default()).unwrap();
    let mut out = Vec::new();
    write_codebook_csv(&data, &mut out).unwrap();
    let s = String::from_utf8(out).unwrap();
    let lines: Vec<&str> = s.lines().collect();
    assert_eq!(lines[0], "cluster,category,tag,description");
    assert_eq!(lines.len(), 3);
    assert!(s.contains("C,Cat,T1,desc1"));
    assert!(s.contains("C,Cat,T2,"));
}
