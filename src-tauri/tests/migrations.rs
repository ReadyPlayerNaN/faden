use rusqlite::Connection;
use stt_app_lib::db::migrations::{apply_migrations, applied_versions};

fn open_mem() -> Connection {
    Connection::open_in_memory().unwrap()
}

#[test]
fn applies_initial_migration_on_empty_db() {
    let mut conn = open_mem();
    apply_migrations(&mut conn).unwrap();
    let versions = applied_versions(&conn).unwrap();
    assert_eq!(versions, vec![1]);
}

#[test]
fn is_idempotent() {
    let mut conn = open_mem();
    apply_migrations(&mut conn).unwrap();
    apply_migrations(&mut conn).unwrap();
    let versions = applied_versions(&conn).unwrap();
    assert_eq!(versions, vec![1]);
}

#[test]
fn creates_project_meta_table() {
    let mut conn = open_mem();
    apply_migrations(&mut conn).unwrap();
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='project_meta'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 1);
}

#[test]
fn applies_in_transaction() {
    // If a migration fails, schema_version row should NOT be inserted.
    use stt_app_lib::db::migrations::apply_migrations_with;
    let mut conn = open_mem();
    let migrations: &[(i64, &str)] = &[(1i64, "CREATE TABLE good (id INTEGER); SELECT bad_syntax;")];
    let result = apply_migrations_with(&mut conn, migrations);
    assert!(result.is_err());
    // Neither the table nor the schema_version row should exist.
    let table_exists: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='good'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(table_exists, 0);
}
