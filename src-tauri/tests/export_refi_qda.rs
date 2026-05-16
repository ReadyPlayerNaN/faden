use rusqlite::Connection;
use faden_app_lib::db::migrations::apply_migrations;
use faden_app_lib::db::queries::span_tag::SpanTagSource;
use faden_app_lib::db::queries::{
    category, cluster, interview, project_meta, segment, span_tag, speaker, tag, tagged_span,
};
use faden_app_lib::export::refi_qda::write_refi_qda;
use faden_app_lib::export::{compose, ExportScope};

fn fresh() -> Connection {
    let mut c = Connection::open_in_memory().unwrap();
    c.pragma_update(None, "foreign_keys", "ON").unwrap();
    apply_migrations(&mut c).unwrap();
    project_meta::insert(&c, "Test").unwrap();
    c
}

#[test]
fn refi_qda_writes_well_formed_xml_with_project() {
    let conn = fresh();
    let data = compose(&conn, &ExportScope::default()).unwrap();
    let mut out = Vec::new();
    write_refi_qda(&data, &mut out).unwrap();
    let s = String::from_utf8(out).unwrap();
    assert!(s.starts_with("<?xml"));
    assert!(s.contains("<Project"));
    assert!(s.contains("name=\"Test\""));
    assert!(s.contains("<CodeBook>"));
    assert!(s.contains("</Project>"));
}

#[test]
fn refi_qda_contains_codes_and_coded_segments() {
    let mut conn = fresh();
    let cl = cluster::create(&conn, "C", None, None).unwrap();
    let cat = category::create(&conn, Some(cl.id), "Cat", None, None).unwrap();
    let t = tag::create(&conn, Some(cat.id), "T1", None, None).unwrap();
    let iv = interview::create(&conn, "I1").unwrap();
    let sp = speaker::create_or_get(&conn, iv.id, "A", None, None).unwrap();
    let seg_ids = segment::insert_batch(
        &mut conn,
        iv.id,
        &[segment::NewSegment {
            speaker_id: Some(sp.id),
            start_sec: 0.0,
            end_sec: 5.0,
            text: "hello world".into(),
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
            audio_end_sec: 2.5,
        },
    )
    .unwrap();
    span_tag::attach(&conn, span.id, t.id, SpanTagSource::Manual).unwrap();

    let data = compose(&conn, &ExportScope::default()).unwrap();
    let mut out = Vec::new();
    write_refi_qda(&data, &mut out).unwrap();
    let s = String::from_utf8(out).unwrap();
    assert!(s.contains("name=\"C\""));
    assert!(s.contains("name=\"Cat\""));
    assert!(s.contains("name=\"T1\""));
    assert!(s.contains("name=\"I1\""));
    assert!(s.contains("<PlainTextContent>"));
    assert!(s.contains("hello world"));
    assert!(s.contains("<PlainTextSelection"));
    assert!(s.contains("<CodeRef"));
}
