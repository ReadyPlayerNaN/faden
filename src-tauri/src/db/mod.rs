pub mod migrations;
pub mod queries;

use crate::error::AppResult;
use rusqlite::Connection;
use std::path::Path;

pub fn open(path: &Path) -> AppResult<Connection> {
    let mut conn = Connection::open(path)?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    migrations::apply_migrations(&mut conn)?;
    Ok(conn)
}
