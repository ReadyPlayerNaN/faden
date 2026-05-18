use crate::error::{AppError, AppResult};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AiRunNodeStatus {
    Pending,
    Running,
    Complete,
    Failed,
    Cancelled,
    Retrying,
    Skipped,
}

impl AiRunNodeStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Running => "running",
            Self::Complete => "complete",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
            Self::Retrying => "retrying",
            Self::Skipped => "skipped",
        }
    }

    pub fn parse(value: &str) -> AppResult<Self> {
        match value {
            "pending" => Ok(Self::Pending),
            "running" => Ok(Self::Running),
            "complete" => Ok(Self::Complete),
            "failed" => Ok(Self::Failed),
            "cancelled" => Ok(Self::Cancelled),
            "retrying" => Ok(Self::Retrying),
            "skipped" => Ok(Self::Skipped),
            other => Err(AppError::Invalid(format!("ai_run node status: {other}"))),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AiRunStageKey {
    AnalyzeSource,
    PrepareChunks,
    EncodeChunks,
    TranscribeChunks,
    ComposeTranscript,
    Finalize,
}

impl AiRunStageKey {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::AnalyzeSource => "analyze_source",
            Self::PrepareChunks => "prepare_chunks",
            Self::EncodeChunks => "encode_chunks",
            Self::TranscribeChunks => "transcribe_chunks",
            Self::ComposeTranscript => "compose_transcript",
            Self::Finalize => "finalize",
        }
    }

    pub fn parse(value: &str) -> AppResult<Self> {
        match value {
            "analyze_source" => Ok(Self::AnalyzeSource),
            "prepare_chunks" => Ok(Self::PrepareChunks),
            "encode_chunks" => Ok(Self::EncodeChunks),
            "transcribe_chunks" => Ok(Self::TranscribeChunks),
            "compose_transcript" => Ok(Self::ComposeTranscript),
            "finalize" => Ok(Self::Finalize),
            other => Err(AppError::Invalid(format!("ai_run stage key: {other}"))),
        }
    }

    pub fn order(&self) -> i64 {
        match self {
            Self::AnalyzeSource => 0,
            Self::PrepareChunks => 1,
            Self::EncodeChunks => 2,
            Self::TranscribeChunks => 3,
            Self::ComposeTranscript => 4,
            Self::Finalize => 5,
        }
    }

    pub fn all_for_transcription() -> &'static [Self] {
        const STAGES: &[AiRunStageKey] = &[
            AiRunStageKey::AnalyzeSource,
            AiRunStageKey::PrepareChunks,
            AiRunStageKey::EncodeChunks,
            AiRunStageKey::TranscribeChunks,
            AiRunStageKey::ComposeTranscript,
            AiRunStageKey::Finalize,
        ];
        STAGES
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AiRunTaskKind {
    EncodeChunk,
    TranscribeChunk,
}

impl AiRunTaskKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::EncodeChunk => "encode_chunk",
            Self::TranscribeChunk => "transcribe_chunk",
        }
    }

    pub fn parse(value: &str) -> AppResult<Self> {
        match value {
            "encode_chunk" => Ok(Self::EncodeChunk),
            "transcribe_chunk" => Ok(Self::TranscribeChunk),
            other => Err(AppError::Invalid(format!("ai_run task kind: {other}"))),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiRunStage {
    pub id: i64,
    pub ai_run_id: i64,
    pub stage_key: AiRunStageKey,
    pub order_index: i64,
    pub status: AiRunNodeStatus,
    pub total_count: Option<i64>,
    pub completed_count: Option<i64>,
    pub failed_count: Option<i64>,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiRunTask {
    pub id: i64,
    pub ai_run_stage_id: i64,
    pub ai_run_id: i64,
    pub kind: AiRunTaskKind,
    pub chunk_index: i64,
    pub status: AiRunNodeStatus,
    pub attempt: i64,
    pub max_attempts: i64,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub error: Option<String>,
}

pub fn create_transcription_stages(conn: &Connection, ai_run_id: i64) -> AppResult<()> {
    let now = chrono::Utc::now().to_rfc3339();
    for stage_key in AiRunStageKey::all_for_transcription() {
        conn.execute(
            "INSERT INTO ai_run_stage (ai_run_id, stage_key, order_index, status, created_at) VALUES (?1, ?2, ?3, 'pending', ?4)",
            params![ai_run_id, stage_key.as_str(), stage_key.order(), now],
        )?;
    }
    Ok(())
}

fn map_stage_row(r: &rusqlite::Row) -> rusqlite::Result<AiRunStage> {
    let key_str: String = r.get(2)?;
    let status_str: String = r.get(4)?;
    Ok(AiRunStage {
        id: r.get(0)?,
        ai_run_id: r.get(1)?,
        stage_key: AiRunStageKey::parse(&key_str).map_err(|_| {
            rusqlite::Error::FromSqlConversionFailure(
                2,
                rusqlite::types::Type::Text,
                "bad ai_run stage key".into(),
            )
        })?,
        order_index: r.get(3)?,
        status: AiRunNodeStatus::parse(&status_str).map_err(|_| {
            rusqlite::Error::FromSqlConversionFailure(
                4,
                rusqlite::types::Type::Text,
                "bad ai_run stage status".into(),
            )
        })?,
        total_count: r.get(5)?,
        completed_count: r.get(6)?,
        failed_count: r.get(7)?,
        started_at: r.get(8)?,
        completed_at: r.get(9)?,
        error: r.get(10)?,
    })
}

fn map_task_row(r: &rusqlite::Row) -> rusqlite::Result<AiRunTask> {
    let kind_str: String = r.get(3)?;
    let status_str: String = r.get(5)?;
    Ok(AiRunTask {
        id: r.get(0)?,
        ai_run_stage_id: r.get(1)?,
        ai_run_id: r.get(2)?,
        kind: AiRunTaskKind::parse(&kind_str).map_err(|_| {
            rusqlite::Error::FromSqlConversionFailure(
                3,
                rusqlite::types::Type::Text,
                "bad ai_run task kind".into(),
            )
        })?,
        chunk_index: r.get(4)?,
        status: AiRunNodeStatus::parse(&status_str).map_err(|_| {
            rusqlite::Error::FromSqlConversionFailure(
                5,
                rusqlite::types::Type::Text,
                "bad ai_run task status".into(),
            )
        })?,
        attempt: r.get(6)?,
        max_attempts: r.get(7)?,
        started_at: r.get(8)?,
        completed_at: r.get(9)?,
        error: r.get(10)?,
    })
}

fn stage_id(conn: &Connection, ai_run_id: i64, stage_key: AiRunStageKey) -> AppResult<i64> {
    conn.query_row(
        "SELECT id FROM ai_run_stage WHERE ai_run_id = ?1 AND stage_key = ?2",
        params![ai_run_id, stage_key.as_str()],
        |r| r.get(0),
    )
    .optional()?
    .ok_or_else(|| AppError::NotFound(format!("ai_run_stage {}:{}", ai_run_id, stage_key.as_str())))
}

pub fn list_stages(conn: &Connection, ai_run_id: i64) -> AppResult<Vec<AiRunStage>> {
    let mut stmt = conn.prepare(
        "SELECT id, ai_run_id, stage_key, order_index, status, total_count, completed_count, failed_count, started_at, completed_at, error
         FROM ai_run_stage WHERE ai_run_id = ?1 ORDER BY order_index ASC, id ASC",
    )?;
    let rows = stmt.query_map(params![ai_run_id], map_stage_row)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

pub fn list_tasks(conn: &Connection, ai_run_id: i64) -> AppResult<Vec<AiRunTask>> {
    let mut stmt = conn.prepare(
        "SELECT t.id, t.ai_run_stage_id, s.ai_run_id, t.kind, t.chunk_index, t.status, t.attempt, t.max_attempts, t.started_at, t.completed_at, t.error
         FROM ai_run_task t
         INNER JOIN ai_run_stage s ON s.id = t.ai_run_stage_id
         WHERE s.ai_run_id = ?1
         ORDER BY s.order_index ASC, t.chunk_index ASC, t.id ASC",
    )?;
    let rows = stmt.query_map(params![ai_run_id], map_task_row)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

pub fn mark_stage_running(
    conn: &Connection,
    ai_run_id: i64,
    stage_key: AiRunStageKey,
) -> AppResult<()> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE ai_run_stage SET status = 'running', started_at = COALESCE(started_at, ?1), completed_at = NULL, error = NULL WHERE ai_run_id = ?2 AND stage_key = ?3",
        params![now, ai_run_id, stage_key.as_str()],
    )?;
    Ok(())
}

pub fn mark_stage_complete(
    conn: &Connection,
    ai_run_id: i64,
    stage_key: AiRunStageKey,
) -> AppResult<()> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE ai_run_stage SET status = 'complete', started_at = COALESCE(started_at, ?1), completed_at = ?1, error = NULL WHERE ai_run_id = ?2 AND stage_key = ?3",
        params![now, ai_run_id, stage_key.as_str()],
    )?;
    Ok(())
}

pub fn mark_stage_failed(
    conn: &Connection,
    ai_run_id: i64,
    stage_key: AiRunStageKey,
    error: &str,
) -> AppResult<()> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE ai_run_stage SET status = 'failed', started_at = COALESCE(started_at, ?1), completed_at = ?1, error = ?2 WHERE ai_run_id = ?3 AND stage_key = ?4",
        params![now, error, ai_run_id, stage_key.as_str()],
    )?;
    Ok(())
}

pub fn mark_pending_stages_cancelled_from(
    conn: &Connection,
    ai_run_id: i64,
    first_stage: AiRunStageKey,
) -> AppResult<()> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE ai_run_stage SET status = 'cancelled', completed_at = COALESCE(completed_at, ?1)
         WHERE ai_run_id = ?2 AND order_index >= ?3 AND status IN ('pending', 'running', 'retrying')",
        params![now, ai_run_id, first_stage.order()],
    )?;
    Ok(())
}

pub fn set_stage_counts(
    conn: &Connection,
    ai_run_id: i64,
    stage_key: AiRunStageKey,
    total_count: Option<i64>,
    completed_count: Option<i64>,
    failed_count: Option<i64>,
) -> AppResult<()> {
    conn.execute(
        "UPDATE ai_run_stage SET total_count = ?1, completed_count = ?2, failed_count = ?3 WHERE ai_run_id = ?4 AND stage_key = ?5",
        params![total_count, completed_count, failed_count, ai_run_id, stage_key.as_str()],
    )?;
    Ok(())
}

pub fn create_chunk_tasks(
    conn: &Connection,
    ai_run_id: i64,
    stage_key: AiRunStageKey,
    kind: AiRunTaskKind,
    total: usize,
    max_attempts: u32,
) -> AppResult<()> {
    let stage_id = stage_id(conn, ai_run_id, stage_key)?;
    let now = chrono::Utc::now().to_rfc3339();
    for chunk_index in 0..total as i64 {
        conn.execute(
            "INSERT OR IGNORE INTO ai_run_task (ai_run_stage_id, kind, chunk_index, status, attempt, max_attempts, created_at)
             VALUES (?1, ?2, ?3, 'pending', 0, ?4, ?5)",
            params![stage_id, kind.as_str(), chunk_index, max_attempts as i64, now],
        )?;
    }
    Ok(())
}

pub fn mark_task_running(
    conn: &Connection,
    ai_run_id: i64,
    stage_key: AiRunStageKey,
    chunk_index: usize,
    attempt: u32,
    max_attempts: u32,
) -> AppResult<()> {
    let stage_id = stage_id(conn, ai_run_id, stage_key)?;
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE ai_run_task SET status = CASE WHEN attempt > 0 THEN 'retrying' ELSE 'running' END,
             attempt = ?1, max_attempts = ?2, started_at = COALESCE(started_at, ?3), completed_at = NULL, error = NULL
         WHERE ai_run_stage_id = ?4 AND chunk_index = ?5",
        params![attempt as i64, max_attempts as i64, now, stage_id, chunk_index as i64],
    )?;
    Ok(())
}

pub fn mark_task_complete(
    conn: &Connection,
    ai_run_id: i64,
    stage_key: AiRunStageKey,
    chunk_index: usize,
    attempt: u32,
    max_attempts: u32,
) -> AppResult<()> {
    let stage_id = stage_id(conn, ai_run_id, stage_key)?;
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE ai_run_task SET status = 'complete', attempt = ?1, max_attempts = ?2, started_at = COALESCE(started_at, ?3), completed_at = ?3, error = NULL
         WHERE ai_run_stage_id = ?4 AND chunk_index = ?5",
        params![attempt as i64, max_attempts as i64, now, stage_id, chunk_index as i64],
    )?;
    Ok(())
}

pub fn mark_task_failed(
    conn: &Connection,
    ai_run_id: i64,
    stage_key: AiRunStageKey,
    chunk_index: usize,
    attempt: u32,
    max_attempts: u32,
    error: &str,
) -> AppResult<()> {
    let stage_id = stage_id(conn, ai_run_id, stage_key)?;
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE ai_run_task SET status = 'failed', attempt = ?1, max_attempts = ?2, started_at = COALESCE(started_at, ?3), completed_at = ?3, error = ?4
         WHERE ai_run_stage_id = ?5 AND chunk_index = ?6",
        params![attempt as i64, max_attempts as i64, now, error, stage_id, chunk_index as i64],
    )?;
    Ok(())
}

pub fn mark_pending_tasks_cancelled(
    conn: &Connection,
    ai_run_id: i64,
    stage_key: AiRunStageKey,
) -> AppResult<()> {
    let stage_id = stage_id(conn, ai_run_id, stage_key)?;
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE ai_run_task SET status = 'cancelled', completed_at = COALESCE(completed_at, ?1)
         WHERE ai_run_stage_id = ?2 AND status IN ('pending', 'running', 'retrying')",
        params![now, stage_id],
    )?;
    Ok(())
}

pub fn finalize_run_as_complete(conn: &Connection, ai_run_id: i64) -> AppResult<()> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE ai_run_task
         SET status = 'complete',
             started_at = COALESCE(started_at, ?1),
             completed_at = COALESCE(completed_at, ?1),
             error = NULL
         WHERE ai_run_stage_id IN (SELECT id FROM ai_run_stage WHERE ai_run_id = ?2)
           AND status IN ('pending', 'running', 'retrying')",
        params![now, ai_run_id],
    )?;
    conn.execute(
        "UPDATE ai_run_stage
         SET status = 'complete',
             started_at = COALESCE(started_at, ?1),
             completed_at = COALESCE(completed_at, ?1),
             error = NULL
         WHERE ai_run_id = ?2 AND status IN ('pending', 'running', 'retrying')",
        params![now, ai_run_id],
    )?;
    Ok(())
}

pub fn recover_interrupted_run(conn: &Connection, ai_run_id: i64, error: &str) -> AppResult<()> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE ai_run_task
         SET status = 'failed', completed_at = COALESCE(completed_at, ?1), error = COALESCE(error, ?2)
         WHERE ai_run_stage_id IN (SELECT id FROM ai_run_stage WHERE ai_run_id = ?3)
           AND status IN ('running', 'retrying')",
        params![now, error, ai_run_id],
    )?;
    conn.execute(
        "UPDATE ai_run_task
         SET status = 'cancelled', completed_at = COALESCE(completed_at, ?1)
         WHERE ai_run_stage_id IN (SELECT id FROM ai_run_stage WHERE ai_run_id = ?2)
           AND status = 'pending'",
        params![now, ai_run_id],
    )?;
    conn.execute(
        "UPDATE ai_run_stage
         SET status = 'failed', completed_at = COALESCE(completed_at, ?1), error = COALESCE(error, ?2)
         WHERE ai_run_id = ?3 AND status IN ('running', 'retrying')",
        params![now, error, ai_run_id],
    )?;
    conn.execute(
        "UPDATE ai_run_stage
         SET status = 'cancelled', completed_at = COALESCE(completed_at, ?1)
         WHERE ai_run_id = ?2 AND status = 'pending'",
        params![now, ai_run_id],
    )?;
    Ok(())
}
