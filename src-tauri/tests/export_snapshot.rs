use rusqlite::Connection;
use stt_app_lib::db::migrations::apply_migrations;
use stt_app_lib::db::queries::span_tag::SpanTagSource;
use stt_app_lib::db::queries::{
    category, cluster, interview, project_meta, segment, span_tag, speaker, tag, tagged_span,
};
use stt_app_lib::export::{compose, ExportScope};

fn fresh() -> Connection {
    let mut c = Connection::open_in_memory().unwrap();
    c.pragma_update(None, "foreign_keys", "ON").unwrap();
    apply_migrations(&mut c).unwrap();
    project_meta::insert(&c, "Test").unwrap();
    c
}

fn make_tagged_interview(conn: &mut Connection, name: &str, text: &str, tag_id: i64) -> (i64, i64) {
    let i = interview::create(conn, name).unwrap();
    let sp = speaker::create_or_get(conn, i.id, "A", None).unwrap();
    let seg_ids = segment::insert_batch(
        conn,
        i.id,
        &[segment::NewSegment {
            speaker_id: sp.id,
            start_sec: 0.0,
            end_sec: 5.0,
            text: text.into(),
        }],
    )
    .unwrap();
    let span = tagged_span::create(
        conn,
        &tagged_span::NewSpan {
            interview_id: i.id,
            segment_id: seg_ids[0],
            start_offset: 0,
            end_offset: text.len() as i32,
            text_snapshot: text,
            audio_start_sec: 0.0,
            audio_end_sec: 5.0,
        },
    )
    .unwrap();
    span_tag::attach(conn, span.id, tag_id, SpanTagSource::Manual).unwrap();
    (i.id, span.id)
}

#[test]
fn compose_empty_project_has_no_interviews() {
    let conn = fresh();
    let data = compose(&conn, &ExportScope::default()).unwrap();
    assert_eq!(data.interviews.len(), 0);
}

#[test]
fn compose_full_project() {
    let mut conn = fresh();
    let cl = cluster::create(&conn, "C", None, None).unwrap();
    let cat = category::create(&conn, Some(cl.id), "Cat", None, None).unwrap();
    let t = tag::create(&conn, Some(cat.id), "T", None, None).unwrap();
    make_tagged_interview(&mut conn, "I1", "hello", t.id);
    let data = compose(&conn, &ExportScope::default()).unwrap();
    assert_eq!(data.interviews.len(), 1);
    assert_eq!(data.interviews[0].spans.len(), 1);
    assert_eq!(data.clusters.len(), 1);
}

#[test]
fn compose_scoped_to_interview_id() {
    let mut conn = fresh();
    let cl = cluster::create(&conn, "C", None, None).unwrap();
    let cat = category::create(&conn, Some(cl.id), "Cat", None, None).unwrap();
    let t = tag::create(&conn, Some(cat.id), "T", None, None).unwrap();
    let (i1, _) = make_tagged_interview(&mut conn, "I1", "hello", t.id);
    let (_i2, _) = make_tagged_interview(&mut conn, "I2", "world", t.id);
    let data = compose(
        &conn,
        &ExportScope {
            interview_ids: Some(vec![i1]),
            tag_ids: None,
        },
    )
    .unwrap();
    assert_eq!(data.interviews.len(), 1);
}

#[test]
fn compose_scoped_to_tag_filters_spans() {
    let mut conn = fresh();
    let cl = cluster::create(&conn, "C", None, None).unwrap();
    let cat = category::create(&conn, Some(cl.id), "Cat", None, None).unwrap();
    let t1 = tag::create(&conn, Some(cat.id), "T1", None, None).unwrap();
    let t2 = tag::create(&conn, Some(cat.id), "T2", None, None).unwrap();
    make_tagged_interview(&mut conn, "I1", "hello", t1.id);
    make_tagged_interview(&mut conn, "I2", "world", t2.id);
    let data = compose(
        &conn,
        &ExportScope {
            interview_ids: None,
            tag_ids: Some(vec![t1.id]),
        },
    )
    .unwrap();
    assert!(data.interviews.iter().any(|iv| iv.spans.len() == 1));
    let total_spans: usize = data.interviews.iter().map(|iv| iv.spans.len()).sum();
    assert_eq!(total_spans, 1);
}
