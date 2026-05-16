use faden_app_lib::db::migrations::apply_migrations;
use faden_app_lib::db::queries::span_tag::SpanTagSource;
use faden_app_lib::db::queries::{
    category, cluster, interview, memo, project_meta, segment, span_tag, speaker, tag, tagged_span,
};
use faden_app_lib::export::markdown::write_markdown;
use faden_app_lib::export::{compose, ExportScope};
use rusqlite::Connection;

fn fresh() -> Connection {
    let mut c = Connection::open_in_memory().unwrap();
    c.pragma_update(None, "foreign_keys", "ON").unwrap();
    apply_migrations(&mut c).unwrap();
    project_meta::insert(&c, "Test").unwrap();
    c
}

#[test]
fn md_empty_project_has_title_only() {
    let conn = fresh();
    let data = compose(&conn, &ExportScope::default()).unwrap();
    let mut out = Vec::new();
    write_markdown(&data, &mut out).unwrap();
    let s = String::from_utf8(out).unwrap();
    assert!(s.starts_with("# Project: Test"));
    assert!(!s.contains("## Interview:"));
}

#[test]
fn md_writes_segments_and_tags_and_memos() {
    let mut conn = fresh();
    let cl = cluster::create(&conn, "C", None, None).unwrap();
    let cat = category::create(&conn, Some(cl.id), "Cat", None, None).unwrap();
    let t = tag::create(&conn, Some(cat.id), "T1", None, None).unwrap();
    let iv = interview::create(&conn, "I1").unwrap();
    let sp = speaker::create_or_get(&conn, iv.id, "A", Some("Alice"), None).unwrap();
    let seg_ids = segment::insert_batch(
        &mut conn,
        iv.id,
        &[segment::NewSegment {
            speaker_id: Some(sp.id),
            start_sec: 65.0,
            end_sec: 70.0,
            text: "hello there".into(),
        }],
    )
    .unwrap();
    let span = tagged_span::create(
        &conn,
        &tagged_span::NewSpan {
            interview_id: iv.id,
            segment_id: seg_ids[0],
            start_offset: 0,
            end_offset: 5,
            text_snapshot: "hello",
            audio_start_sec: 65.0,
            audio_end_sec: 67.0,
        },
    )
    .unwrap();
    span_tag::attach(&conn, span.id, t.id, SpanTagSource::Manual).unwrap();
    memo::upsert(&conn, span.id, "a memo note").unwrap();

    let data = compose(&conn, &ExportScope::default()).unwrap();
    let mut out = Vec::new();
    write_markdown(&data, &mut out).unwrap();
    let s = String::from_utf8(out).unwrap();
    assert!(s.contains("## Interview: I1"));
    assert!(s.contains("A = Alice"));
    assert!(s.contains("[01:05]"));
    assert!(s.contains("hello there"));
    assert!(s.contains("<!-- tagged: T1 -->"));
    assert!(s.contains("> a memo note"));
}
