use crate::error::{AppError, AppResult};
use crate::settings::project::ProjectSettings;
use crate::settings::canonical_project_language;
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

pub fn rename(conn: &Connection, name: &str) -> AppResult<()> {
    let affected = conn.execute(
        "UPDATE project_meta SET name = ?1 WHERE id = 1",
        params![name],
    )?;
    if affected == 0 {
        return Err(AppError::NotFound("project_meta".into()));
    }
    Ok(())
}

pub fn read_settings(conn: &Connection) -> AppResult<ProjectSettings> {
    let raw: String = conn.query_row(
        "SELECT settings_json FROM project_meta WHERE id = 1",
        [],
        |r| r.get(0),
    )?;
    if raw.trim().is_empty() || raw.trim() == "{}" {
        return Ok(ProjectSettings::default());
    }
    let mut settings: ProjectSettings = serde_json::from_str(&raw)?;
    settings.language = settings
        .language
        .as_deref()
        .and_then(canonical_project_language);
    Ok(settings)
}

pub fn write_settings(conn: &Connection, settings: &ProjectSettings) -> AppResult<()> {
    let mut normalized = settings.clone();
    normalized.language = match settings.language.as_deref() {
        Some(language) => Some(canonical_project_language(language).ok_or_else(|| {
            AppError::Invalid(format!("unsupported project language: {language}"))
        })?),
        None => None,
    };
    let json = serde_json::to_string(&normalized)?;
    let affected = conn.execute(
        "UPDATE project_meta SET settings_json = ?1 WHERE id = 1",
        params![json],
    )?;
    if affected == 0 {
        return Err(AppError::NotFound("project_meta".into()));
    }
    Ok(())
}
