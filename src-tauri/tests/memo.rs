use rusqlite::Connection;
use stt_app_lib::db::migrations::apply_migrations;
use stt_app_lib::db::queries::{interview, memo, segment, speaker, tagged_span};

fn fresh() -> Connection {
    let mut c = Connection::open_in_memory().unwrap();
    c.pragma_update(None, "foreign_keys", "ON").unwrap();
    apply_migrations(&mut c).unwrap();
    c
}

fn make_span(conn: &mut Connection) -> i64 {
    let i = interview::create(conn, "I").unwrap();
    let sp = speaker::create_or_get(conn, i.id, "A", None).unwrap();
    let seg_ids = segment::insert_batch(
        conn,
        i.id,
        &[segment::NewSegment {
            speaker_id: sp.id,
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
    span.id
}

#[test]
fn upsert_inserts_new_memo() {
    let mut conn = fresh();
    let sp = make_span(&mut conn);
    let m = memo::upsert(&conn, sp, "first body").unwrap();
    assert_eq!(m.body, "first body");
    let got = memo::get_for_span(&conn, sp).unwrap().unwrap();
    assert_eq!(got.body, "first body");
}

#[test]
fn upsert_updates_existing_memo() {
    let mut conn = fresh();
    let sp = make_span(&mut conn);
    memo::upsert(&conn, sp, "first").unwrap();
    memo::upsert(&conn, sp, "second").unwrap();
    let got = memo::get_for_span(&conn, sp).unwrap().unwrap();
    assert_eq!(got.body, "second");
}

#[test]
fn get_for_span_returns_none_when_absent() {
    let mut conn = fresh();
    let sp = make_span(&mut conn);
    let got = memo::get_for_span(&conn, sp).unwrap();
    assert!(got.is_none());
}

#[test]
fn span_delete_cascades_memo() {
    let mut conn = fresh();
    let sp = make_span(&mut conn);
    memo::upsert(&conn, sp, "x").unwrap();
    tagged_span::delete(&conn, sp).unwrap();
    let got = memo::get_for_span(&conn, sp).unwrap();
    assert!(got.is_none());
}
