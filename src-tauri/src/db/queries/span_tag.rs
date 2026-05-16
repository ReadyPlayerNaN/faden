use crate::error::{AppError, AppResult};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SpanTagSource {
    Manual,
    AiSuggested,
    AiAccepted,
}

impl SpanTagSource {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Manual => "manual",
            Self::AiSuggested => "ai_suggested",
            Self::AiAccepted => "ai_accepted",
        }
    }
    pub fn parse(s: &str) -> AppResult<Self> {
        match s {
            "manual" => Ok(Self::Manual),
            "ai_suggested" => Ok(Self::AiSuggested),
            "ai_accepted" => Ok(Self::AiAccepted),
            other => Err(AppError::Invalid(format!("source: {other}"))),
        }
    }
}

pub fn attach(
    conn: &Connection,
    span_id: i64,
    tag_id: i64,
    source: SpanTagSource,
) -> AppResult<()> {
    conn.execute(
        "INSERT INTO span_tag (span_id, tag_id, source) VALUES (?1, ?2, ?3) ON CONFLICT(span_id, tag_id) DO NOTHING",
        params![span_id, tag_id, source.as_str()],
    )?;
    Ok(())
}

pub fn detach(conn: &Connection, span_id: i64, tag_id: i64) -> AppResult<()> {
    conn.execute(
        "DELETE FROM span_tag WHERE span_id = ?1 AND tag_id = ?2",
        params![span_id, tag_id],
    )?;
    Ok(())
}

pub fn set_source(
    conn: &Connection,
    span_id: i64,
    tag_id: i64,
    source: SpanTagSource,
) -> AppResult<()> {
    let affected = conn.execute(
        "UPDATE span_tag SET source = ?1 WHERE span_id = ?2 AND tag_id = ?3",
        params![source.as_str(), span_id, tag_id],
    )?;
    if affected == 0 {
        return Err(AppError::NotFound(format!("span_tag {span_id}/{tag_id}")));
    }
    Ok(())
}

pub fn list_for_span(conn: &Connection, span_id: i64) -> AppResult<Vec<(i64, SpanTagSource)>> {
    let mut stmt =
        conn.prepare("SELECT tag_id, source FROM span_tag WHERE span_id = ?1 ORDER BY tag_id")?;
    let rows = stmt.query_map(params![span_id], |r| {
        let src: String = r.get(1)?;
        Ok((r.get::<_, i64>(0)?, src))
    })?;
    let mut out = Vec::new();
    for row in rows {
        let (tag_id, src) = row?;
        out.push((
            tag_id,
            SpanTagSource::parse(&src).map_err(|_| {
                rusqlite::Error::FromSqlConversionFailure(
                    1,
                    rusqlite::types::Type::Text,
                    "bad source".into(),
                )
            })?,
        ));
    }
    Ok(out)
}
