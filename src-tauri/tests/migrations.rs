use faden_app_lib::db::migrations::{applied_versions, apply_migrations};
use rusqlite::Connection;

fn open_mem() -> Connection {
    Connection::open_in_memory().unwrap()
}

#[test]
fn applies_initial_migration_on_empty_db() {
    let mut conn = open_mem();
    apply_migrations(&mut conn).unwrap();
    let versions = applied_versions(&conn).unwrap();
    assert_eq!(versions, vec![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
}

#[test]
fn is_idempotent() {
    let mut conn = open_mem();
    apply_migrations(&mut conn).unwrap();
    apply_migrations(&mut conn).unwrap();
    let versions = applied_versions(&conn).unwrap();
    assert_eq!(versions, vec![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
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
fn applies_m002_main_schema() {
    let mut conn = open_mem();
    apply_migrations(&mut conn).unwrap();
    let versions = applied_versions(&conn).unwrap();
    assert_eq!(versions, vec![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);

    let expected_tables = [
        "interview",
        "speaker",
        "segment",
        "cluster",
        "category",
        "tag",
        "tagged_span",
        "span_tag",
        "memo",
        "ai_run",
        "ai_run_stage",
        "ai_run_task",
        "undo_event",
        "redo_event",
        "person",
    ];
    for table in expected_tables {
        let count: i64 = conn
            .query_row(
                &format!(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='{table}'"
                ),
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1, "table {table} missing");
    }
}

#[test]
fn applies_m003_proposal_table() {
    let mut conn = open_mem();
    apply_migrations(&mut conn).unwrap();
    let versions = applied_versions(&conn).unwrap();
    assert_eq!(versions, vec![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='proposal'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 1);
}

#[test]
fn applies_m005_category_cluster_can_be_null() {
    let mut conn = open_mem();
    apply_migrations(&mut conn).unwrap();
    conn.execute(
        "INSERT INTO category (cluster_id, name, description, color, order_index) VALUES (NULL, 'Loose', NULL, NULL, 0)",
        [],
    )
    .unwrap();
    let cluster_id: Option<i64> = conn
        .query_row(
            "SELECT cluster_id FROM category WHERE name = 'Loose'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(cluster_id, None);
}

#[test]
fn applies_in_transaction() {
    use faden_app_lib::db::migrations::apply_migrations_with;
    let mut conn = open_mem();
    let migrations: &[(i64, &str)] =
        &[(1i64, "CREATE TABLE good (id INTEGER); SELECT bad_syntax;")];
    let result = apply_migrations_with(&mut conn, migrations);
    assert!(result.is_err());
    let table_exists: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='good'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(table_exists, 0);
}
