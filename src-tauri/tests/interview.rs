use rusqlite::Connection;
use stt_app_lib::db::migrations::apply_migrations;
use stt_app_lib::db::queries::interview::{self, TranscriptStatus};
use stt_app_lib::db::queries::{segment, speaker};

fn fresh_conn() -> Connection {
    let mut c = Connection::open_in_memory().unwrap();
    c.pragma_update(None, "foreign_keys", "ON").unwrap();
    apply_migrations(&mut c).unwrap();
    c
}

#[test]
fn create_and_list() {
    let conn = fresh_conn();
    let a = interview::create(&conn, "Father 1").unwrap();
    let b = interview::create(&conn, "Father 2").unwrap();
    assert_ne!(a.id, b.id);
    assert_eq!(a.transcript_status, TranscriptStatus::None);
    assert!(a.audio_path.is_none());
    let all = interview::list(&conn).unwrap();
    assert_eq!(all.len(), 2);
}

#[test]
fn rename_persists() {
    let conn = fresh_conn();
    let i = interview::create(&conn, "Old").unwrap();
    interview::rename(&conn, i.id, "New").unwrap();
    assert_eq!(interview::get(&conn, i.id).unwrap().name, "New");
}

#[test]
fn set_status_round_trip() {
    let conn = fresh_conn();
    let i = interview::create(&conn, "X").unwrap();
    interview::set_status(&conn, i.id, TranscriptStatus::InProgress).unwrap();
    let reloaded = interview::get(&conn, i.id).unwrap();
    assert_eq!(reloaded.transcript_status, TranscriptStatus::InProgress);
}

#[test]
fn set_audio_path_round_trip() {
    let conn = fresh_conn();
    let i = interview::create(&conn, "X").unwrap();
    interview::set_audio_path(&conn, i.id, Some("media/foo.mp3")).unwrap();
    assert_eq!(
        interview::get(&conn, i.id).unwrap().audio_path.as_deref(),
        Some("media/foo.mp3")
    );
    interview::set_audio_path(&conn, i.id, None).unwrap();
    assert!(interview::get(&conn, i.id).unwrap().audio_path.is_none());
}

#[test]
fn delete_cascades_speakers_and_segments() {
    let conn = fresh_conn();
    let i = interview::create(&conn, "X").unwrap();
    conn.execute(
        "INSERT INTO speaker (interview_id, label_raw) VALUES (?1, 'A')",
        rusqlite::params![i.id],
    )
    .unwrap();
    let sid: i64 = conn.last_insert_rowid();
    conn.execute(
        "INSERT INTO segment (interview_id, speaker_id, start_sec, end_sec, text, order_index) VALUES (?1, ?2, 0.0, 1.0, 'hi', 0)",
        rusqlite::params![i.id, sid],
    )
    .unwrap();
    interview::delete(&conn, i.id).unwrap();
    let speakers: i64 = conn
        .query_row("SELECT COUNT(*) FROM speaker", [], |r| r.get(0))
        .unwrap();
    let segments: i64 = conn
        .query_row("SELECT COUNT(*) FROM segment", [], |r| r.get(0))
        .unwrap();
    assert_eq!(speakers, 0);
    assert_eq!(segments, 0);
}

#[test]
fn speaker_create_or_get_idempotent() {
    let conn = fresh_conn();
    let i = interview::create(&conn, "I").unwrap();
    let a = speaker::create_or_get(&conn, i.id, "A", None).unwrap();
    let b = speaker::create_or_get(&conn, i.id, "A", None).unwrap();
    assert_eq!(a.id, b.id);
}

#[test]
fn speaker_list_for_interview() {
    let conn = fresh_conn();
    let i = interview::create(&conn, "I").unwrap();
    speaker::create_or_get(&conn, i.id, "A", None).unwrap();
    speaker::create_or_get(&conn, i.id, "B", None).unwrap();
    assert_eq!(speaker::list_for_interview(&conn, i.id).unwrap().len(), 2);
}

#[test]
fn speaker_set_display_name() {
    let conn = fresh_conn();
    let i = interview::create(&conn, "I").unwrap();
    let s = speaker::create_or_get(&conn, i.id, "A", None).unwrap();
    speaker::set_display_name(&conn, s.id, Some("Interviewer")).unwrap();
    assert_eq!(
        speaker::get(&conn, s.id).unwrap().display_name.as_deref(),
        Some("Interviewer")
    );
}

#[test]
fn speaker_merge_reassigns_segments_and_deletes_sources() {
    let mut conn = fresh_conn();
    let i = interview::create(&conn, "I").unwrap();
    let a = speaker::create_or_get(&conn, i.id, "A", Some("Alice")).unwrap();
    let b = speaker::create_or_get(&conn, i.id, "B", Some("Bob")).unwrap();
    let c = speaker::create_or_get(&conn, i.id, "C", Some("Carol")).unwrap();
    segment::insert_batch(
        &mut conn,
        i.id,
        &[
            segment::NewSegment {
                speaker_id: Some(a.id),
                start_sec: 0.0,
                end_sec: 5.0,
                text: "first".into(),
            },
            segment::NewSegment {
                speaker_id: Some(b.id),
                start_sec: 5.0,
                end_sec: 10.0,
                text: "second".into(),
            },
            segment::NewSegment {
                speaker_id: Some(c.id),
                start_sec: 10.0,
                end_sec: 15.0,
                text: "third".into(),
            },
        ],
    )
    .unwrap();

    let merged = speaker::merge_many_into_new(&mut conn, i.id, &[a.id, b.id], "Merged").unwrap();

    assert_eq!(merged.label_raw, "Merged");
    assert_eq!(merged.display_name.as_deref(), Some("Merged"));
    assert!(speaker::get(&conn, a.id).is_err());
    assert!(speaker::get(&conn, b.id).is_err());
    let listed = segment::list_for_interview(&conn, i.id).unwrap();
    assert_eq!(
        listed
            .iter()
            .filter(|s| s.speaker_id == Some(merged.id))
            .count(),
        2
    );
    assert_eq!(
        listed.iter().filter(|s| s.speaker_id == Some(c.id)).count(),
        1
    );
}

#[test]
fn speaker_merge_can_reuse_selected_speaker_name() {
    let mut conn = fresh_conn();
    let i = interview::create(&conn, "I").unwrap();
    let main = speaker::create_or_get(&conn, i.id, "Main guy", Some("Main guy")).unwrap();
    let other = speaker::create_or_get(&conn, i.id, "B", Some("Bob")).unwrap();
    segment::insert_batch(
        &mut conn,
        i.id,
        &[
            segment::NewSegment {
                speaker_id: Some(main.id),
                start_sec: 0.0,
                end_sec: 5.0,
                text: "first".into(),
            },
            segment::NewSegment {
                speaker_id: Some(other.id),
                start_sec: 5.0,
                end_sec: 10.0,
                text: "second".into(),
            },
        ],
    )
    .unwrap();

    let merged =
        speaker::merge_many_into_new(&mut conn, i.id, &[main.id, other.id], "Main guy").unwrap();

    assert_eq!(merged.id, main.id);
    assert_eq!(merged.label_raw, "Main guy");
    assert_eq!(merged.display_name.as_deref(), Some("Main guy"));
    assert!(speaker::get(&conn, other.id).is_err());
    let listed = segment::list_for_interview(&conn, i.id).unwrap();
    assert!(listed.iter().all(|s| s.speaker_id == Some(main.id)));
}

#[test]
fn speaker_merge_rejects_cross_interview_merge() {
    let mut conn = fresh_conn();
    let i1 = interview::create(&conn, "I1").unwrap();
    let i2 = interview::create(&conn, "I2").unwrap();
    let a = speaker::create_or_get(&conn, i1.id, "A", None).unwrap();
    let b = speaker::create_or_get(&conn, i2.id, "B", None).unwrap();

    let err = speaker::merge_many_into_new(&mut conn, i1.id, &[a.id, b.id], "Merged").unwrap_err();
    assert!(matches!(err, stt_app_lib::error::AppError::Invalid(_)));
}

#[test]
fn speaker_delete_unassigns_segments() {
    let mut conn = fresh_conn();
    let i = interview::create(&conn, "I").unwrap();
    let sp = speaker::create_or_get(&conn, i.id, "A", None).unwrap();
    segment::insert_batch(
        &mut conn,
        i.id,
        &[
            segment::NewSegment {
                speaker_id: Some(sp.id),
                start_sec: 0.0,
                end_sec: 5.0,
                text: "first".into(),
            },
            segment::NewSegment {
                speaker_id: Some(sp.id),
                start_sec: 5.0,
                end_sec: 10.0,
                text: "second".into(),
            },
        ],
    )
    .unwrap();

    speaker::delete_and_unassign(&mut conn, sp.id).unwrap();

    let listed = segment::list_for_interview(&conn, i.id).unwrap();
    assert!(listed.iter().all(|segment| segment.speaker_id.is_none()));
    assert!(speaker::list_for_interview(&conn, i.id).unwrap().is_empty());
}

#[test]
fn segment_insert_batch_and_list() {
    let mut conn = fresh_conn();
    let i = interview::create(&conn, "I").unwrap();
    let sp = speaker::create_or_get(&conn, i.id, "A", None).unwrap();
    let ids = segment::insert_batch(
        &mut conn,
        i.id,
        &[
            segment::NewSegment {
                speaker_id: Some(sp.id),
                start_sec: 0.0,
                end_sec: 5.0,
                text: "hi".into(),
            },
            segment::NewSegment {
                speaker_id: Some(sp.id),
                start_sec: 5.0,
                end_sec: 10.0,
                text: "there".into(),
            },
        ],
    )
    .unwrap();
    assert_eq!(ids.len(), 2);
    let listed = segment::list_for_interview(&conn, i.id).unwrap();
    assert_eq!(listed.len(), 2);
    assert!(listed[0].order_index < listed[1].order_index);
}

#[test]
fn segment_list_ordered_by_order_index() {
    let mut conn = fresh_conn();
    let i = interview::create(&conn, "I").unwrap();
    let sp = speaker::create_or_get(&conn, i.id, "A", None).unwrap();
    segment::insert_batch(
        &mut conn,
        i.id,
        &[
            segment::NewSegment {
                speaker_id: Some(sp.id),
                start_sec: 10.0,
                end_sec: 20.0,
                text: "later".into(),
            },
            segment::NewSegment {
                speaker_id: Some(sp.id),
                start_sec: 0.0,
                end_sec: 10.0,
                text: "earlier".into(),
            },
        ],
    )
    .unwrap();
    let listed = segment::list_for_interview(&conn, i.id).unwrap();
    assert_eq!(listed[0].text, "later");
    assert_eq!(listed[1].text, "earlier");
}

#[test]
fn segment_delete_all_for_interview() {
    let mut conn = fresh_conn();
    let i = interview::create(&conn, "I").unwrap();
    let sp = speaker::create_or_get(&conn, i.id, "A", None).unwrap();
    segment::insert_batch(
        &mut conn,
        i.id,
        &[segment::NewSegment {
            speaker_id: Some(sp.id),
            start_sec: 0.0,
            end_sec: 5.0,
            text: "x".into(),
        }],
    )
    .unwrap();
    let n = segment::delete_all_for_interview(&conn, i.id).unwrap();
    assert_eq!(n, 1);
    assert!(segment::list_for_interview(&conn, i.id).unwrap().is_empty());
}
