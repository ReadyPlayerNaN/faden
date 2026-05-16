use rusqlite::Connection;
use faden_app_lib::db::migrations::apply_migrations;
use faden_app_lib::db::queries::span_tag::SpanTagSource;
use faden_app_lib::db::queries::{
    category, cluster, interview, project_meta, segment, span_tag, speaker, tag, tagged_span,
};
use faden_app_lib::export::stats::{write_stats_csv, write_stats_markdown};
use faden_app_lib::export::{compose, ExportScope};

fn fresh() -> Connection {
    let mut c = Connection::open_in_memory().unwrap();
    c.pragma_update(None, "foreign_keys", "ON").unwrap();
    apply_migrations(&mut c).unwrap();
    project_meta::insert(&c, "Test").unwrap();
    c
}

fn setup_tagged(conn: &mut Connection) -> (i64, i64) {
    let cl = cluster::create(conn, "C", None, None).unwrap();
    let cat = category::create(conn, Some(cl.id), "Cat", None, None).unwrap();
    let t1 = tag::create(conn, Some(cat.id), "T1", None, None).unwrap();
    let t2 = tag::create(conn, Some(cat.id), "T2", None, None).unwrap();
    let iv = interview::create(conn, "I1").unwrap();
    let sp = speaker::create_or_get(conn, iv.id, "A", None).unwrap();
    let seg_ids = segment::insert_batch(
        conn,
        iv.id,
        &[segment::NewSegment {
            speaker_id: Some(sp.id),
            start_sec: 0.0,
            end_sec: 5.0,
            text: "hello".into(),
        }],
    )
    .unwrap();
    let span = tagged_span::create(
        conn,
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
    span_tag::attach(conn, span.id, t1.id, SpanTagSource::Manual).unwrap();
    span_tag::attach(conn, span.id, t2.id, SpanTagSource::Manual).unwrap();
    (t1.id, t2.id)
}

#[test]
fn stats_csv_includes_frequency_rows() {
    let mut conn = fresh();
    setup_tagged(&mut conn);
    let data = compose(&conn, &ExportScope::default()).unwrap();
    let mut out = Vec::new();
    write_stats_csv(&data, &mut out).unwrap();
    let s = String::from_utf8(out).unwrap();
    assert!(s.contains("frequency,,,C,Cat,T1,1"));
    assert!(s.contains("frequency,,,C,Cat,T2,1"));
}

#[test]
fn stats_csv_includes_by_interview_rows() {
    let mut conn = fresh();
    setup_tagged(&mut conn);
    let data = compose(&conn, &ExportScope::default()).unwrap();
    let mut out = Vec::new();
    write_stats_csv(&data, &mut out).unwrap();
    let s = String::from_utf8(out).unwrap();
    assert!(s.contains("by_interview,I1,,C,Cat,T1,1"));
    assert!(s.contains("by_speaker,I1,A,C,Cat,T1,1"));
}

#[test]
fn stats_csv_includes_cooccurrence_rows() {
    let mut conn = fresh();
    setup_tagged(&mut conn);
    let data = compose(&conn, &ExportScope::default()).unwrap();
    let mut out = Vec::new();
    write_stats_csv(&data, &mut out).unwrap();
    let s = String::from_utf8(out).unwrap();
    assert!(s.contains("co_occurrence"));
    assert!(s.contains("T1∧T2"));
}

#[test]
fn stats_markdown_renders_table() {
    let mut conn = fresh();
    setup_tagged(&mut conn);
    let data = compose(&conn, &ExportScope::default()).unwrap();
    let mut out = Vec::new();
    write_stats_markdown(&data, &mut out).unwrap();
    let s = String::from_utf8(out).unwrap();
    assert!(s.contains("# Stats: Test"));
    assert!(s.contains("| Cluster | Category | Tag | Count |"));
    assert!(s.contains("| C | Cat | T1 | 1 |"));
}
