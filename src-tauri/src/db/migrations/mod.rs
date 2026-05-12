use crate::error::{AppError, AppResult};
use rusqlite::{params, Connection};

const MIGRATIONS: &[(i64, &str)] = &[(1, include_str!("m001_init.sql"))];

pub fn apply_migrations(conn: &mut Connection) -> AppResult<()> {
    let owned: Vec<(i64, String)> = MIGRATIONS
        .iter()
        .map(|(v, s)| (*v, (*s).to_string()))
        .collect();
    apply_migrations_with(conn, &owned)
}

pub fn apply_migrations_with(
    conn: &mut Connection,
    migrations: &[(i64, String)],
) -> AppResult<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_version (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL
        )",
    )?;

    let applied = applied_versions(conn)?;
    for (version, sql) in migrations {
        if applied.contains(version) {
            continue;
        }
        let tx = conn.transaction()?;
        tx.execute_batch(sql)
            .map_err(|e| AppError::Invalid(format!("migration {version} failed: {e}")))?;
        tx.execute(
            "INSERT INTO schema_version (version, applied_at) VALUES (?1, ?2)",
            params![version, chrono::Utc::now().to_rfc3339()],
        )?;
        tx.commit()?;
    }
    Ok(())
}

pub fn applied_versions(conn: &Connection) -> AppResult<Vec<i64>> {
    let exists: i64 = conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='schema_version'",
        [],
        |r| r.get(0),
    )?;
    if exists == 0 {
        return Ok(vec![]);
    }
    let mut stmt = conn.prepare("SELECT version FROM schema_version ORDER BY version")?;
    let rows: Result<Vec<i64>, _> = stmt.query_map([], |r| r.get::<_, i64>(0))?.collect();
    Ok(rows?)
}
