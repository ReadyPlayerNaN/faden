use crate::error::AppResult;
use crate::history::MemoSnapshot;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Memo {
    pub id: i64,
    pub span_id: i64,
    pub body: String,
    pub created_at: String,
    pub updated_at: String,
}

pub fn upsert(conn: &Connection, span_id: i64, body: &str) -> AppResult<Memo> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO memo (span_id, body, created_at, updated_at) VALUES (?1, ?2, ?3, ?3) ON CONFLICT(span_id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at",
        params![span_id, body, now],
    )?;
    let now_for_fallback = now.clone();
    Ok(get_for_span(conn, span_id)?.unwrap_or_else(|| Memo {
        id: 0,
        span_id,
        body: body.into(),
        created_at: now_for_fallback.clone(),
        updated_at: now_for_fallback,
    }))
}

pub fn get_for_span(conn: &Connection, span_id: i64) -> AppResult<Option<Memo>> {
    Ok(conn
        .query_row(
            "SELECT id, span_id, body, created_at, updated_at FROM memo WHERE span_id = ?1",
            params![span_id],
            |r| {
                Ok(Memo {
                    id: r.get(0)?,
                    span_id: r.get(1)?,
                    body: r.get(2)?,
                    created_at: r.get(3)?,
                    updated_at: r.get(4)?,
                })
            },
        )
        .optional()?)
}

pub fn delete_for_span(conn: &Connection, span_id: i64) -> AppResult<()> {
    conn.execute("DELETE FROM memo WHERE span_id = ?1", params![span_id])?;
    Ok(())
}

pub fn restore_for_span(conn: &Connection, memo: Option<&MemoSnapshot>) -> AppResult<()> {
    let span_id = memo.map(|item| item.span_id);
    if let Some(span_id) = span_id {
        delete_for_span(conn, span_id)?;
    }
    if let Some(item) = memo {
        conn.execute(
            "INSERT INTO memo (id, span_id, body, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![item.id, item.span_id, item.body, item.created_at, item.updated_at],
        )?;
    }
    Ok(())
}
