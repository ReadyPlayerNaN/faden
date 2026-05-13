use rusqlite::Connection;
use stt_app_lib::db::migrations::apply_migrations;
use stt_app_lib::db::queries::project_meta;
use stt_app_lib::settings::project::ProjectSettings;

fn fresh() -> Connection {
    let mut c = Connection::open_in_memory().unwrap();
    c.pragma_update(None, "foreign_keys", "ON").unwrap();
    apply_migrations(&mut c).unwrap();
    project_meta::insert(&c, "Test").unwrap();
    c
}

#[test]
fn default_when_unset() {
    let conn = fresh();
    let s = project_meta::read_settings(&conn).unwrap();
    assert_eq!(s.transcription.chunk_seconds, 420);
    assert!(s.prompts.codebook_gen.is_none());
}

#[test]
fn round_trip() {
    let conn = fresh();
    let mut s = ProjectSettings::default();
    s.prompts.codebook_gen = Some("custom prompt".into());
    s.transcription.chunk_seconds = 600;
    project_meta::write_settings(&conn, &s).unwrap();
    let loaded = project_meta::read_settings(&conn).unwrap();
    assert_eq!(loaded.prompts.codebook_gen.as_deref(), Some("custom prompt"));
    assert_eq!(loaded.transcription.chunk_seconds, 600);
}

#[test]
fn partial_overrides_preserve_defaults() {
    let conn = fresh();
    let mut s = ProjectSettings::default();
    s.prompts.pretag = Some("p".into());
    project_meta::write_settings(&conn, &s).unwrap();
    let loaded = project_meta::read_settings(&conn).unwrap();
    assert_eq!(loaded.transcription.chunk_seconds, 420);
    assert!(loaded.prompts.codebook_gen.is_none());
    assert_eq!(loaded.prompts.pretag.as_deref(), Some("p"));
}
