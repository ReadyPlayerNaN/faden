use rusqlite::Connection;
use faden_app_lib::db::migrations::apply_migrations;
use faden_app_lib::db::queries::{interview, segment, speaker, tagged_span};

fn fresh() -> Connection {
    let mut c = Connection::open_in_memory().unwrap();
    c.pragma_update(None, "foreign_keys", "ON").unwrap();
    apply_migrations(&mut c).unwrap();
    c
}

fn setup_segment(conn: &mut Connection) -> (i64, i64) {
    let i = interview::create(conn, "I").unwrap();
    let sp = speaker::create_or_get(conn, i.id, "A", None, None).unwrap();
    let ids = segment::insert_batch(
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
    (i.id, ids[0])
}

// audio interpolation
#[test]
fn interp_full_text_matches_segment() {
    let (s, e) = tagged_span::interpolate_audio_range(0.0, 10.0, 11, 0, 11);
    assert!((s - 0.0).abs() < 0.001);
    assert!((e - 10.0).abs() < 0.001);
}

#[test]
fn interp_start_at_zero() {
    let (s, _) = tagged_span::interpolate_audio_range(0.0, 10.0, 10, 0, 5);
    assert!((s - 0.0).abs() < 0.001);
}

#[test]
fn interp_end_at_text_len() {
    let (_, e) = tagged_span::interpolate_audio_range(0.0, 10.0, 10, 5, 10);
    assert!((e - 10.0).abs() < 0.001);
}

#[test]
fn interp_empty_text() {
    let (s, e) = tagged_span::interpolate_audio_range(2.0, 5.0, 0, 0, 0);
    assert!((s - 2.0).abs() < 0.001);
    assert!((e - 2.0).abs() < 0.001);
}

#[test]
fn interp_clamped_to_segment_end() {
    let (_, e) = tagged_span::interpolate_audio_range(0.0, 10.0, 10, 0, 50);
    assert!((e - 10.0).abs() < 0.001);
}

// CRUD
#[test]
fn create_and_get() {
    let mut conn = fresh();
    let (i_id, seg_id) = setup_segment(&mut conn);
    let span = tagged_span::create(
        &conn,
        &tagged_span::NewSpan {
            interview_id: i_id,
            segment_id: seg_id,
            start_offset: 0,
            end_offset: 5,
            text_snapshot: "hello",
            audio_start_sec: 0.0,
            audio_end_sec: 4.5,
        },
    )
    .unwrap();
    let got = tagged_span::get(&conn, span.id).unwrap();
    assert_eq!(got.text_snapshot, "hello");
}

#[test]
fn list_for_interview_multiple_spans() {
    let mut conn = fresh();
    let (i_id, seg_id) = setup_segment(&mut conn);
    for off in &[0, 6] {
        tagged_span::create(
            &conn,
            &tagged_span::NewSpan {
                interview_id: i_id,
                segment_id: seg_id,
                start_offset: *off,
                end_offset: *off + 3,
                text_snapshot: "xyz",
                audio_start_sec: 0.0,
                audio_end_sec: 1.0,
            },
        )
        .unwrap();
    }
    let spans = tagged_span::list_for_interview(&conn, i_id).unwrap();
    assert_eq!(spans.len(), 2);
    assert_eq!(spans[0].start_offset, 0);
    assert_eq!(spans[1].start_offset, 6);
}

#[test]
fn update_offsets_persists() {
    let mut conn = fresh();
    let (i_id, seg_id) = setup_segment(&mut conn);
    let span = tagged_span::create(
        &conn,
        &tagged_span::NewSpan {
            interview_id: i_id,
            segment_id: seg_id,
            start_offset: 0,
            end_offset: 5,
            text_snapshot: "hello",
            audio_start_sec: 0.0,
            audio_end_sec: 4.5,
        },
    )
    .unwrap();
    tagged_span::update_offsets(&conn, span.id, 2, 7, "llo w", 1.8, 6.3).unwrap();
    let got = tagged_span::get(&conn, span.id).unwrap();
    assert_eq!(got.text_snapshot, "llo w");
    assert_eq!(got.start_offset, 2);
}

#[test]
fn delete_works() {
    let mut conn = fresh();
    let (i_id, seg_id) = setup_segment(&mut conn);
    let span = tagged_span::create(
        &conn,
        &tagged_span::NewSpan {
            interview_id: i_id,
            segment_id: seg_id,
            start_offset: 0,
            end_offset: 5,
            text_snapshot: "hello",
            audio_start_sec: 0.0,
            audio_end_sec: 4.5,
        },
    )
    .unwrap();
    tagged_span::delete(&conn, span.id).unwrap();
    assert!(tagged_span::list_for_interview(&conn, i_id)
        .unwrap()
        .is_empty());
}

#[test]
fn list_for_segment_isolates() {
    let mut conn = fresh();
    let (i_id, seg_id) = setup_segment(&mut conn);
    tagged_span::create(
        &conn,
        &tagged_span::NewSpan {
            interview_id: i_id,
            segment_id: seg_id,
            start_offset: 0,
            end_offset: 5,
            text_snapshot: "x",
            audio_start_sec: 0.0,
            audio_end_sec: 1.0,
        },
    )
    .unwrap();
    let spans = tagged_span::list_for_segment(&conn, seg_id).unwrap();
    assert_eq!(spans.len(), 1);
}
