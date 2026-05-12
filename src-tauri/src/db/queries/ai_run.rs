use crate::error::{AppError, AppResult};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AiRunKind {
    Transcribe,
    Pretag,
    CodebookGen,
    FindMore,
}

impl AiRunKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Transcribe => "transcribe",
            Self::Pretag => "pretag",
            Self::CodebookGen => "codebook_gen",
            Self::FindMore => "find_more",
        }
    }
    pub fn parse(s: &str) -> AppResult<Self> {
        match s {
            "transcribe" => Ok(Self::Transcribe),
            "pretag" => Ok(Self::Pretag),
            "codebook_gen" => Ok(Self::CodebookGen),
            "find_more" => Ok(Self::FindMore),
            other => Err(AppError::Invalid(format!("ai_run kind: {other}"))),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AiRunStatus {
    Running,
    Complete,
    Failed,
    Cancelled,
}

impl AiRunStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Running => "running",
            Self::Complete => "complete",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
        }
    }
    pub fn parse(s: &str) -> AppResult<Self> {
        match s {
            "running" => Ok(Self::Running),
            "complete" => Ok(Self::Complete),
            "failed" => Ok(Self::Failed),
            "cancelled" => Ok(Self::Cancelled),
            other => Err(AppError::Invalid(format!("ai_run status: {other}"))),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiRun {
    pub id: i64,
    pub kind: AiRunKind,
    pub interview_id: Option<i64>,
    pub model: String,
    pub prompt: String,
    pub started_at: String,
    pub completed_at: Option<String>,
    pub status: AiRunStatus,
    pub error: Option<String>,
    pub token_usage_json: Option<String>,
    pub result_summary: Option<String>,
}

pub fn start(
    conn: &Connection,
    kind: AiRunKind,
    interview_id: Option<i64>,
    model: &str,
    prompt: &str,
) -> AppResult<i64> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO ai_run (kind, interview_id, model, prompt, started_at, status) VALUES (?1, ?2, ?3, ?4, ?5, 'running')",
        params![kind.as_str(), interview_id, model, prompt, now],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn complete(
    conn: &Connection,
    id: i64,
    token_usage_json: Option<&str>,
    result_summary: Option<&str>,
) -> AppResult<()> {
    let now = chrono::Utc::now().to_rfc3339();
    let affected = conn.execute(
        "UPDATE ai_run SET status = 'complete', completed_at = ?1, token_usage_json = ?2, result_summary = ?3 WHERE id = ?4",
        params![now, token_usage_json, result_summary, id],
    )?;
    if affected == 0 {
        return Err(AppError::NotFound(format!("ai_run {id}")));
    }
    Ok(())
}

pub fn fail(conn: &Connection, id: i64, error: &str) -> AppResult<()> {
    let now = chrono::Utc::now().to_rfc3339();
    let affected = conn.execute(
        "UPDATE ai_run SET status = 'failed', completed_at = ?1, error = ?2 WHERE id = ?3",
        params![now, error, id],
    )?;
    if affected == 0 {
        return Err(AppError::NotFound(format!("ai_run {id}")));
    }
    Ok(())
}

pub fn cancel(conn: &Connection, id: i64) -> AppResult<()> {
    let now = chrono::Utc::now().to_rfc3339();
    let affected = conn.execute(
        "UPDATE ai_run SET status = 'cancelled', completed_at = ?1 WHERE id = ?2 AND status = 'running'",
        params![now, id],
    )?;
    if affected == 0 {
        return Err(AppError::NotFound(format!("ai_run {id} (not running)")));
    }
    Ok(())
}

fn map_row(r: &rusqlite::Row) -> rusqlite::Result<AiRun> {
    let kind_str: String = r.get(1)?;
    let status_str: String = r.get(7)?;
    Ok(AiRun {
        id: r.get(0)?,
        kind: AiRunKind::parse(&kind_str).map_err(|_| {
            rusqlite::Error::FromSqlConversionFailure(
                1,
                rusqlite::types::Type::Text,
                "bad kind".into(),
            )
        })?,
        interview_id: r.get(2)?,
        model: r.get(3)?,
        prompt: r.get(4)?,
        started_at: r.get(5)?,
        completed_at: r.get(6)?,
        status: AiRunStatus::parse(&status_str).map_err(|_| {
            rusqlite::Error::FromSqlConversionFailure(
                7,
                rusqlite::types::Type::Text,
                "bad status".into(),
            )
        })?,
        error: r.get(8)?,
        token_usage_json: r.get(9)?,
        result_summary: r.get(10)?,
    })
}

pub fn get(conn: &Connection, id: i64) -> AppResult<AiRun> {
    conn.query_row(
        "SELECT id, kind, interview_id, model, prompt, started_at, completed_at, status, error, token_usage_json, result_summary FROM ai_run WHERE id = ?1",
        params![id],
        map_row,
    )
    .optional()?
    .ok_or_else(|| AppError::NotFound(format!("ai_run {id}")))
}

pub fn list_for_interview(conn: &Connection, interview_id: i64) -> AppResult<Vec<AiRun>> {
    let mut stmt = conn.prepare(
        "SELECT id, kind, interview_id, model, prompt, started_at, completed_at, status, error, token_usage_json, result_summary FROM ai_run WHERE interview_id = ?1 ORDER BY started_at DESC, id DESC",
    )?;
    let rows = stmt.query_map(params![interview_id], map_row)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}
