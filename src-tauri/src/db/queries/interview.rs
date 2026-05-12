use crate::error::{AppError, AppResult};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TranscriptStatus {
    None,
    InProgress,
    Complete,
    Failed,
}

impl TranscriptStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::None => "none",
            Self::InProgress => "in_progress",
            Self::Complete => "complete",
            Self::Failed => "failed",
        }
    }

    pub fn parse(s: &str) -> AppResult<Self> {
        match s {
            "none" => Ok(Self::None),
            "in_progress" => Ok(Self::InProgress),
            "complete" => Ok(Self::Complete),
            "failed" => Ok(Self::Failed),
            other => Err(AppError::Invalid(format!("transcript_status: {other}"))),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Interview {
    pub id: i64,
    pub name: String,
    pub recorded_at: Option<String>,
    pub audio_path: Option<String>,
    pub notes: Option<String>,
    pub transcript_status: TranscriptStatus,
    pub created_at: String,
    pub updated_at: String,
}

fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn map_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<Interview> {
    let status_str: String = r.get(5)?;
    let transcript_status = TranscriptStatus::parse(&status_str).map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(
            5,
            rusqlite::types::Type::Text,
            Box::new(std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string())),
        )
    })?;
    Ok(Interview {
        id: r.get(0)?,
        name: r.get(1)?,
        recorded_at: r.get(2)?,
        audio_path: r.get(3)?,
        notes: r.get(4)?,
        transcript_status,
        created_at: r.get(6)?,
        updated_at: r.get(7)?,
    })
}

pub fn create(conn: &Connection, name: &str) -> AppResult<Interview> {
    let now_str = now();
    conn.execute(
        "INSERT INTO interview (name, recorded_at, audio_path, notes, transcript_status, created_at, updated_at) VALUES (?1, NULL, NULL, NULL, 'none', ?2, ?2)",
        params![name, now_str],
    )?;
    let id = conn.last_insert_rowid();
    Ok(Interview {
        id,
        name: name.into(),
        recorded_at: None,
        audio_path: None,
        notes: None,
        transcript_status: TranscriptStatus::None,
        created_at: now_str.clone(),
        updated_at: now_str,
    })
}

pub fn list(conn: &Connection) -> AppResult<Vec<Interview>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, recorded_at, audio_path, notes, transcript_status, created_at, updated_at FROM interview ORDER BY created_at ASC, id ASC",
    )?;
    let rows = stmt.query_map([], map_row)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

pub fn get(conn: &Connection, id: i64) -> AppResult<Interview> {
    conn.query_row(
        "SELECT id, name, recorded_at, audio_path, notes, transcript_status, created_at, updated_at FROM interview WHERE id = ?1",
        params![id],
        map_row,
    )
    .optional()?
    .ok_or_else(|| AppError::NotFound(format!("interview {id}")))
}

fn touch_update(conn: &Connection, id: i64, sql: &str, params: &[&dyn rusqlite::ToSql]) -> AppResult<()> {
    let affected = conn.execute(sql, params)?;
    if affected == 0 {
        return Err(AppError::NotFound(format!("interview {id}")));
    }
    Ok(())
}

pub fn rename(conn: &Connection, id: i64, name: &str) -> AppResult<()> {
    let now_str = now();
    touch_update(
        conn,
        id,
        "UPDATE interview SET name = ?1, updated_at = ?2 WHERE id = ?3",
        rusqlite::params![name, now_str, id],
    )
}

pub fn set_status(conn: &Connection, id: i64, status: TranscriptStatus) -> AppResult<()> {
    let now_str = now();
    touch_update(
        conn,
        id,
        "UPDATE interview SET transcript_status = ?1, updated_at = ?2 WHERE id = ?3",
        rusqlite::params![status.as_str(), now_str, id],
    )
}

pub fn set_audio_path(conn: &Connection, id: i64, path: Option<&str>) -> AppResult<()> {
    let now_str = now();
    touch_update(
        conn,
        id,
        "UPDATE interview SET audio_path = ?1, updated_at = ?2 WHERE id = ?3",
        rusqlite::params![path, now_str, id],
    )
}

pub fn set_recorded_at(conn: &Connection, id: i64, recorded_at: Option<&str>) -> AppResult<()> {
    let now_str = now();
    touch_update(
        conn,
        id,
        "UPDATE interview SET recorded_at = ?1, updated_at = ?2 WHERE id = ?3",
        rusqlite::params![recorded_at, now_str, id],
    )
}

pub fn set_notes(conn: &Connection, id: i64, notes: Option<&str>) -> AppResult<()> {
    let now_str = now();
    touch_update(
        conn,
        id,
        "UPDATE interview SET notes = ?1, updated_at = ?2 WHERE id = ?3",
        rusqlite::params![notes, now_str, id],
    )
}

pub fn delete(conn: &Connection, id: i64) -> AppResult<()> {
    let affected = conn.execute("DELETE FROM interview WHERE id = ?1", params![id])?;
    if affected == 0 {
        return Err(AppError::NotFound(format!("interview {id}")));
    }
    Ok(())
}
