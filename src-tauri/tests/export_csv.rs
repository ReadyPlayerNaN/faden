use rusqlite::Connection;
use stt_app_lib::db::migrations::apply_migrations;
use stt_app_lib::db::queries::span_tag::SpanTagSource;
use stt_app_lib::db::queries::{
    category, cluster, interview, project_meta, segment, span_tag, speaker, tag, tagged_span,
};
use stt_app_lib::export::csv_export::write_csv;
use stt_app_lib::export::{compose, ExportScope};

fn fresh() -> Connection {
    let mut c = Connection::open_in_memory().unwrap();
    c.pragma_update(None, "foreign_keys", "ON").unwrap();
    apply_migrations(&mut c).unwrap();
    project_meta::insert(&c, "Test").unwrap();
    c
}

#[test]
fn csv_empty_project_writes_only_headers() {
    let conn = fresh();
    let data = compose(&conn, &ExportScope::default()).unwrap();
    let mut out = Vec::new();
    write_csv(&data, &mut out).unwrap();
    let s = String::from_utf8(out).unwrap();
    let lines: Vec<&str> = s.lines().collect();
    assert_eq!(lines.len(), 1);
    assert!(lines[0].starts_with("interview_name,"));
    assert!(lines[0].contains("quote"));
}

#[test]
fn csv_headers_present() {
    let conn = fresh();
    let data = compose(&conn, &ExportScope::default()).unwrap();
    let mut out = Vec::new();
    write_csv(&data, &mut out).unwrap();
    let s = String::from_utf8(out).unwrap();
    assert!(s.contains("interview_name"));
    assert!(s.contains("speaker_label"));
    assert!(s.contains("cluster_name"));
    assert!(s.contains("tag_name"));
    assert!(s.contains("memo"));
}

#[test]
fn csv_one_row_per_span_tag_pair() {
    let mut conn = fresh();
    let cl = cluster::create(&conn, "C", None, None).unwrap();
    let cat = category::create(&conn, Some(cl.id), "Cat", None, None).unwrap();
    let t1 = tag::create(&conn, Some(cat.id), "T1", None, None).unwrap();
    let t2 = tag::create(&conn, Some(cat.id), "T2", None, None).unwrap();
    let iv = interview::create(&conn, "I1").unwrap();
    let sp = speaker::create_or_get(&conn, iv.id, "A", None).unwrap();
    let seg_ids = segment::insert_batch(
        &mut conn,
        iv.id,
        &[segment::NewSegment {
            speaker_id: sp.id,
            start_sec: 0.0,
            end_sec: 5.0,
            text: "hello".into(),
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
            audio_start_sec: 0.0,
            audio_end_sec: 5.0,
        },
    )
    .unwrap();
    span_tag::attach(&conn, span.id, t1.id, SpanTagSource::Manual).unwrap();
    span_tag::attach(&conn, span.id, t2.id, SpanTagSource::Manual).unwrap();

    let data = compose(&conn, &ExportScope::default()).unwrap();
    let mut out = Vec::new();
    write_csv(&data, &mut out).unwrap();
    let s = String::from_utf8(out).unwrap();
    let lines: Vec<&str> = s.lines().collect();
    // 1 header + 2 rows (one per tag)
    assert_eq!(lines.len(), 3);
    assert!(s.contains("T1"));
    assert!(s.contains("T2"));
    assert!(s.contains("hello"));
}
