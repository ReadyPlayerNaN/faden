use rusqlite::Connection;
use stt_app_lib::db::migrations::apply_migrations;
use stt_app_lib::db::queries::span_tag::SpanTagSource;
use stt_app_lib::db::queries::{
    category, cluster, interview, segment, span_tag, speaker, tag, tagged_span,
};

fn fresh() -> Connection {
    let mut c = Connection::open_in_memory().unwrap();
    c.pragma_update(None, "foreign_keys", "ON").unwrap();
    apply_migrations(&mut c).unwrap();
    c
}

fn make_span_and_tag(conn: &mut Connection) -> (i64, i64) {
    let i = interview::create(conn, "I").unwrap();
    let sp = speaker::create_or_get(conn, i.id, "A", None).unwrap();
    let seg_ids = segment::insert_batch(
        conn,
        i.id,
        &[segment::NewSegment {
            speaker_id: Some(sp.id),
            start_sec: 0.0,
            end_sec: 1.0,
            text: "x".into(),
        }],
    )
    .unwrap();
    let span = tagged_span::create(
        conn,
        &tagged_span::NewSpan {
            interview_id: i.id,
            segment_id: seg_ids[0],
            start_offset: 0,
            end_offset: 1,
            text_snapshot: "x",
            audio_start_sec: 0.0,
            audio_end_sec: 1.0,
        },
    )
    .unwrap();
    let cl = cluster::create(conn, "C", None, None).unwrap();
    let cat = category::create(conn, Some(cl.id), "Cat", None, None).unwrap();
    let t = tag::create(conn, Some(cat.id), "T", None, None).unwrap();
    (span.id, t.id)
}

#[test]
fn attach_and_list() {
    let mut conn = fresh();
    let (sp, tg) = make_span_and_tag(&mut conn);
    span_tag::attach(&conn, sp, tg, SpanTagSource::Manual).unwrap();
    let list = span_tag::list_for_span(&conn, sp).unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].1, SpanTagSource::Manual);
}

#[test]
fn attach_is_idempotent() {
    let mut conn = fresh();
    let (sp, tg) = make_span_and_tag(&mut conn);
    span_tag::attach(&conn, sp, tg, SpanTagSource::Manual).unwrap();
    span_tag::attach(&conn, sp, tg, SpanTagSource::Manual).unwrap();
    let list = span_tag::list_for_span(&conn, sp).unwrap();
    assert_eq!(list.len(), 1);
}

#[test]
fn detach_works() {
    let mut conn = fresh();
    let (sp, tg) = make_span_and_tag(&mut conn);
    span_tag::attach(&conn, sp, tg, SpanTagSource::Manual).unwrap();
    span_tag::detach(&conn, sp, tg).unwrap();
    let list = span_tag::list_for_span(&conn, sp).unwrap();
    assert!(list.is_empty());
}

#[test]
fn set_source_flips() {
    let mut conn = fresh();
    let (sp, tg) = make_span_and_tag(&mut conn);
    span_tag::attach(&conn, sp, tg, SpanTagSource::AiSuggested).unwrap();
    span_tag::set_source(&conn, sp, tg, SpanTagSource::AiAccepted).unwrap();
    let list = span_tag::list_for_span(&conn, sp).unwrap();
    assert_eq!(list[0].1, SpanTagSource::AiAccepted);
}

#[test]
fn span_delete_cascades_span_tag() {
    let mut conn = fresh();
    let (sp, tg) = make_span_and_tag(&mut conn);
    span_tag::attach(&conn, sp, tg, SpanTagSource::Manual).unwrap();
    tagged_span::delete(&conn, sp).unwrap();
    let list = span_tag::list_for_span(&conn, sp).unwrap();
    assert!(list.is_empty());
}
