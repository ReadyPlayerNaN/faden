use faden_app_lib::commands::tagging::{
    build_span_dto, span_create_impl, span_list_for_interview_impl, span_update_tags_impl,
    CreateSpanArgs,
};
use faden_app_lib::db::migrations::apply_migrations;
use faden_app_lib::db::queries::{
    category, cluster, interview, memo, segment, speaker, tag, tagged_span,
};
use faden_app_lib::error::AppError;
use rusqlite::Connection;

fn fresh() -> Connection {
    let mut c = Connection::open_in_memory().unwrap();
    c.pragma_update(None, "foreign_keys", "ON").unwrap();
    apply_migrations(&mut c).unwrap();
    c
}

struct Setup {
    interview_id: i64,
    segment_id: i64,
    tag_a: i64,
    tag_b: i64,
}

fn setup(conn: &mut Connection) -> Setup {
    let i = interview::create(conn, "I").unwrap();
    let sp = speaker::create_or_get(conn, i.id, "A", None, None).unwrap();
    let seg_ids = segment::insert_batch(
        conn,
        i.id,
        &[segment::NewSegment {
            speaker_id: Some(sp.id),
            start_sec: 0.0,
            end_sec: 10.0,
            text: "hello world".into(),
        }],
    )
    .unwrap();
    let cl = cluster::create(conn, "C", None, None).unwrap();
    let cat = category::create(conn, Some(cl.id), "Cat", None, None).unwrap();
    let tag_a = tag::create(conn, Some(cat.id), "A", None, None).unwrap();
    let tag_b = tag::create(conn, Some(cat.id), "B", None, None).unwrap();
    Setup {
        interview_id: i.id,
        segment_id: seg_ids[0],
        tag_a: tag_a.id,
        tag_b: tag_b.id,
    }
}

#[test]
fn create_span_attaches_tags() {
    let mut conn = fresh();
    let s = setup(&mut conn);
    let dto = span_create_impl(
        &conn,
        &CreateSpanArgs {
            interview_id: s.interview_id,
            segment_id: s.segment_id,
            start_offset: 0,
            end_offset: 5,
            tag_ids: vec![s.tag_a, s.tag_b],
        },
    )
    .unwrap();
    assert_eq!(dto.text_snapshot, "hello");
    assert_eq!(dto.tags.len(), 2);
    let tag_ids: Vec<i64> = dto.tags.iter().map(|t| t.tag_id).collect();
    assert!(tag_ids.contains(&s.tag_a));
    assert!(tag_ids.contains(&s.tag_b));
}

#[test]
fn create_span_rejects_out_of_bounds() {
    let mut conn = fresh();
    let s = setup(&mut conn);
    let err = span_create_impl(
        &conn,
        &CreateSpanArgs {
            interview_id: s.interview_id,
            segment_id: s.segment_id,
            start_offset: 0,
            end_offset: 999,
            tag_ids: vec![],
        },
    )
    .unwrap_err();
    assert!(matches!(err, AppError::Invalid(_)));
}

#[test]
fn update_tags_is_idempotent() {
    let mut conn = fresh();
    let s = setup(&mut conn);
    let dto = span_create_impl(
        &conn,
        &CreateSpanArgs {
            interview_id: s.interview_id,
            segment_id: s.segment_id,
            start_offset: 0,
            end_offset: 5,
            tag_ids: vec![s.tag_a],
        },
    )
    .unwrap();
    let after1 = span_update_tags_impl(&conn, dto.id, &[s.tag_b]).unwrap();
    let after2 = span_update_tags_impl(&conn, dto.id, &[s.tag_b]).unwrap();
    assert_eq!(after1.tags.len(), 1);
    assert_eq!(after2.tags.len(), 1);
    assert_eq!(after1.tags[0].tag_id, s.tag_b);
    assert_eq!(after2.tags[0].tag_id, s.tag_b);
}

#[test]
fn delete_cascades_span_tag_and_memo() {
    let mut conn = fresh();
    let s = setup(&mut conn);
    let dto = span_create_impl(
        &conn,
        &CreateSpanArgs {
            interview_id: s.interview_id,
            segment_id: s.segment_id,
            start_offset: 0,
            end_offset: 5,
            tag_ids: vec![s.tag_a],
        },
    )
    .unwrap();
    memo::upsert(&conn, dto.id, "note").unwrap();
    tagged_span::delete(&conn, dto.id).unwrap();
    assert!(memo::get_for_span(&conn, dto.id).unwrap().is_none());
    assert!(
        faden_app_lib::db::queries::span_tag::list_for_span(&conn, dto.id)
            .unwrap()
            .is_empty()
    );
}

#[test]
fn get_returns_memo_body() {
    let mut conn = fresh();
    let s = setup(&mut conn);
    let dto = span_create_impl(
        &conn,
        &CreateSpanArgs {
            interview_id: s.interview_id,
            segment_id: s.segment_id,
            start_offset: 0,
            end_offset: 5,
            tag_ids: vec![],
        },
    )
    .unwrap();
    memo::upsert(&conn, dto.id, "remember this").unwrap();
    let got = build_span_dto(&conn, dto.id).unwrap();
    assert_eq!(got.memo.as_deref(), Some("remember this"));
}

#[test]
fn list_for_interview_returns_spans_with_tags() {
    let mut conn = fresh();
    let s = setup(&mut conn);
    span_create_impl(
        &conn,
        &CreateSpanArgs {
            interview_id: s.interview_id,
            segment_id: s.segment_id,
            start_offset: 0,
            end_offset: 5,
            tag_ids: vec![s.tag_a],
        },
    )
    .unwrap();
    span_create_impl(
        &conn,
        &CreateSpanArgs {
            interview_id: s.interview_id,
            segment_id: s.segment_id,
            start_offset: 6,
            end_offset: 11,
            tag_ids: vec![s.tag_b],
        },
    )
    .unwrap();
    let list = span_list_for_interview_impl(&conn, s.interview_id).unwrap();
    assert_eq!(list.len(), 2);
    assert!(list.iter().all(|d| d.tags.len() == 1));
}
