use faden_app_lib::db::migrations::apply_migrations;
use faden_app_lib::db::queries::{
    category, cluster, interview, memo, segment, span_tag, speaker, tag, tagged_span,
};
use faden_app_lib::history::{self, HistoryPayload, MemoSnapshot, SpanTagSnapshot};
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
    tag_id: i64,
}

fn setup(conn: &mut Connection) -> Setup {
    let interview = interview::create(conn, "Interview").unwrap();
    let speaker = speaker::create_or_get(conn, interview.id, "S1", None, None).unwrap();
    let seg_ids = segment::insert_batch(
        conn,
        interview.id,
        &[segment::NewSegment {
            speaker_id: Some(speaker.id),
            start_sec: 0.0,
            end_sec: 10.0,
            text: "hello world".into(),
        }],
    )
    .unwrap();
    let cluster = cluster::create(conn, "Cluster", None, None).unwrap();
    let category = category::create(conn, Some(cluster.id), "Category", None, None).unwrap();
    let tag = tag::create(conn, Some(category.id), "Tag", None, None).unwrap();
    Setup {
        interview_id: interview.id,
        segment_id: seg_ids[0],
        tag_id: tag.id,
    }
}

#[test]
fn undo_redo_segment_text_restores_span_snapshots() {
    let mut conn = fresh();
    let setup = setup(&mut conn);
    let span = tagged_span::create(
        &conn,
        &tagged_span::NewSpan {
            interview_id: setup.interview_id,
            segment_id: setup.segment_id,
            start_offset: 6,
            end_offset: 11,
            text_snapshot: "world",
            audio_start_sec: 6.0,
            audio_end_sec: 10.0,
        },
    )
    .unwrap();

    let old_text = segment::get(&conn, setup.segment_id).unwrap().text;
    let old_spans = tagged_span::list_for_segment(&conn, setup.segment_id).unwrap();

    let new_text = "hello";
    segment::update_text(&conn, setup.segment_id, new_text).unwrap();
    tagged_span::update_offsets_and_snapshot(&conn, span.id, 5, 5, "").unwrap();
    history::record_undo(
        &conn,
        &HistoryPayload::SegmentUpdateText {
            segment_id: setup.segment_id,
            text: old_text,
            spans: old_spans,
        },
    )
    .unwrap();

    history::undo(&mut conn).unwrap();
    let restored_segment = segment::get(&conn, setup.segment_id).unwrap();
    let restored_span = tagged_span::get(&conn, span.id).unwrap();
    assert_eq!(restored_segment.text, "hello world");
    assert_eq!(restored_span.start_offset, 6);
    assert_eq!(restored_span.end_offset, 11);
    assert_eq!(restored_span.text_snapshot, "world");

    history::redo(&mut conn).unwrap();
    let redone_segment = segment::get(&conn, setup.segment_id).unwrap();
    let redone_span = tagged_span::get(&conn, span.id).unwrap();
    assert_eq!(redone_segment.text, "hello");
    assert_eq!(redone_span.start_offset, 5);
    assert_eq!(redone_span.end_offset, 5);
    assert_eq!(redone_span.text_snapshot, "");
}

#[test]
fn undo_redo_span_delete_restores_tags_and_memo() {
    let mut conn = fresh();
    let setup = setup(&mut conn);
    let span = tagged_span::create(
        &conn,
        &tagged_span::NewSpan {
            interview_id: setup.interview_id,
            segment_id: setup.segment_id,
            start_offset: 0,
            end_offset: 5,
            text_snapshot: "hello",
            audio_start_sec: 0.0,
            audio_end_sec: 5.0,
        },
    )
    .unwrap();
    span_tag::attach(
        &conn,
        span.id,
        setup.tag_id,
        span_tag::SpanTagSource::Manual,
    )
    .unwrap();
    memo::upsert(&conn, span.id, "note").unwrap();

    let snapshot = history::capture_span_with_relations(&conn, span.id).unwrap();
    tagged_span::delete(&conn, span.id).unwrap();
    history::record_undo(&conn, &HistoryPayload::SpanDelete { snapshot }).unwrap();

    history::undo(&mut conn).unwrap();
    let restored = history::capture_span_with_relations(&conn, span.id).unwrap();
    assert_eq!(restored.span.text_snapshot, "hello");
    assert_eq!(restored.tags.len(), 1);
    assert_eq!(restored.tags[0].tag_id, setup.tag_id);
    assert_eq!(
        restored.memo.as_ref().map(|item| item.body.as_str()),
        Some("note")
    );

    history::redo(&mut conn).unwrap();
    assert!(tagged_span::get(&conn, span.id).is_err());
}

#[test]
fn record_undo_clears_redo_stack() {
    let mut conn = fresh();
    let setup = setup(&mut conn);
    let span = tagged_span::create(
        &conn,
        &tagged_span::NewSpan {
            interview_id: setup.interview_id,
            segment_id: setup.segment_id,
            start_offset: 0,
            end_offset: 5,
            text_snapshot: "hello",
            audio_start_sec: 0.0,
            audio_end_sec: 5.0,
        },
    )
    .unwrap();

    history::record_undo(&conn, &HistoryPayload::SpanCreate { span_id: span.id }).unwrap();
    history::undo(&mut conn).unwrap();
    assert!(history::status(&conn).unwrap().can_redo);

    history::record_undo(
        &conn,
        &HistoryPayload::MemoUpsert {
            span_id: span.id,
            memo: Some(MemoSnapshot {
                id: 1,
                span_id: span.id,
                body: "before".into(),
                created_at: "t1".into(),
                updated_at: "t1".into(),
            }),
        },
    )
    .unwrap();

    let status = history::status(&conn).unwrap();
    assert!(status.can_undo);
    assert!(!status.can_redo);
}

#[test]
fn undo_redo_tag_changes_preserve_sources() {
    let mut conn = fresh();
    let setup = setup(&mut conn);
    let span = tagged_span::create(
        &conn,
        &tagged_span::NewSpan {
            interview_id: setup.interview_id,
            segment_id: setup.segment_id,
            start_offset: 0,
            end_offset: 5,
            text_snapshot: "hello",
            audio_start_sec: 0.0,
            audio_end_sec: 5.0,
        },
    )
    .unwrap();
    span_tag::attach(
        &conn,
        span.id,
        setup.tag_id,
        span_tag::SpanTagSource::AiAccepted,
    )
    .unwrap();

    history::record_undo(
        &conn,
        &HistoryPayload::SpanUpdateTags {
            span_id: span.id,
            tags: vec![SpanTagSnapshot {
                tag_id: setup.tag_id,
                source: span_tag::SpanTagSource::AiAccepted,
            }],
        },
    )
    .unwrap();
    span_tag::replace_for_span(&conn, span.id, &[]).unwrap();

    history::undo(&mut conn).unwrap();
    let restored = span_tag::list_for_span(&conn, span.id).unwrap();
    assert_eq!(restored.len(), 1);
    assert_eq!(restored[0].0, setup.tag_id);
    assert_eq!(restored[0].1, span_tag::SpanTagSource::AiAccepted);

    history::redo(&mut conn).unwrap();
    assert!(span_tag::list_for_span(&conn, span.id).unwrap().is_empty());
}
