use crate::error::{AppError, AppResult};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectMeta {
    pub name: String,
    pub created_at: String,
    pub schema_version: i64,
}

pub fn insert(conn: &Connection, name: &str) -> AppResult<()> {
    conn.execute(
        "INSERT INTO project_meta (id, name, created_at, schema_version) VALUES (1, ?1, ?2, 1)",
        params![name, chrono::Utc::now().to_rfc3339()],
    )?;
    Ok(())
}

pub fn read(conn: &Connection) -> AppResult<ProjectMeta> {
    conn.query_row(
        "SELECT name, created_at, schema_version FROM project_meta WHERE id = 1",
        [],
        |r| {
            Ok(ProjectMeta {
                name: r.get(0)?,
                created_at: r.get(1)?,
                schema_version: r.get(2)?,
            })
        },
    )
    .optional()?
    .ok_or_else(|| AppError::NotFound("project_meta".into()))
}
