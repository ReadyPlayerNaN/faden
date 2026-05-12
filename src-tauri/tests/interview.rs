use rusqlite::Connection;
use stt_app_lib::db::migrations::apply_migrations;
use stt_app_lib::db::queries::interview::{self, TranscriptStatus};

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
