use crate::error::{AppError, AppResult};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaggedSpan {
    pub id: i64,
    pub interview_id: i64,
    pub segment_id: i64,
    pub start_offset: i32,
    pub end_offset: i32,
    pub text_snapshot: String,
    pub audio_start_sec: f64,
    pub audio_end_sec: f64,
    pub created_at: String,
}

#[derive(Debug, Clone)]
pub struct NewSpan<'a> {
    pub interview_id: i64,
    pub segment_id: i64,
    pub start_offset: i32,
    pub end_offset: i32,
    pub text_snapshot: &'a str,
    pub audio_start_sec: f64,
    pub audio_end_sec: f64,
}

pub fn interpolate_audio_range(
    segment_start: f64,
    segment_end: f64,
    segment_text_len: usize,
    char_start: i32,
    char_end: i32,
) -> (f64, f64) {
    if segment_text_len == 0 {
        return (segment_start, segment_start);
    }
    let duration = (segment_end - segment_start).max(0.0);
    let len = segment_text_len as f64;
    let s_frac = ((char_start as f64) / len).clamp(0.0, 1.0);
    let e_frac = ((char_end as f64) / len).clamp(0.0, 1.0);
    let s = segment_start + duration * s_frac;
    let e = segment_start + duration * e_frac;
    (s.min(segment_end), e.min(segment_end))
}

pub fn create(conn: &Connection, new: &NewSpan) -> AppResult<TaggedSpan> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO tagged_span (interview_id, segment_id, start_offset, end_offset, text_snapshot, audio_start_sec, audio_end_sec, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            new.interview_id,
            new.segment_id,
            new.start_offset,
            new.end_offset,
            new.text_snapshot,
            new.audio_start_sec,
            new.audio_end_sec,
            now
        ],
    )?;
    let id = conn.last_insert_rowid();
    Ok(TaggedSpan {
        id,
        interview_id: new.interview_id,
        segment_id: new.segment_id,
        start_offset: new.start_offset,
        end_offset: new.end_offset,
        text_snapshot: new.text_snapshot.into(),
        audio_start_sec: new.audio_start_sec,
        audio_end_sec: new.audio_end_sec,
        created_at: now,
    })
}

pub fn create_with_id(conn: &Connection, span: &TaggedSpan) -> AppResult<()> {
    conn.execute(
        "INSERT INTO tagged_span (id, interview_id, segment_id, start_offset, end_offset, text_snapshot, audio_start_sec, audio_end_sec, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            span.id,
            span.interview_id,
            span.segment_id,
            span.start_offset,
            span.end_offset,
            span.text_snapshot,
            span.audio_start_sec,
            span.audio_end_sec,
            span.created_at,
        ],
    )?;
    Ok(())
}

pub fn update_offsets(
    conn: &Connection,
    id: i64,
    start_offset: i32,
    end_offset: i32,
    text_snapshot: &str,
    audio_start_sec: f64,
    audio_end_sec: f64,
) -> AppResult<()> {
    let affected = conn.execute(
        "UPDATE tagged_span SET start_offset = ?1, end_offset = ?2, text_snapshot = ?3, audio_start_sec = ?4, audio_end_sec = ?5 WHERE id = ?6",
        params![start_offset, end_offset, text_snapshot, audio_start_sec, audio_end_sec, id],
    )?;
    if affected == 0 {
        return Err(AppError::NotFound(format!("tagged_span {id}")));
    }
    Ok(())
}

pub fn update_offsets_and_snapshot(
    conn: &Connection,
    id: i64,
    start_offset: i32,
    end_offset: i32,
    text_snapshot: &str,
) -> AppResult<()> {
    let affected = conn.execute(
        "UPDATE tagged_span SET start_offset = ?1, end_offset = ?2, text_snapshot = ?3 WHERE id = ?4",
        params![start_offset, end_offset, text_snapshot, id],
    )?;
    if affected == 0 {
        return Err(AppError::NotFound(format!("tagged_span {id}")));
    }
    Ok(())
}

pub fn restore(conn: &Connection, span: &TaggedSpan) -> AppResult<()> {
    let affected = conn.execute(
        "UPDATE tagged_span SET interview_id = ?1, segment_id = ?2, start_offset = ?3, end_offset = ?4, text_snapshot = ?5, audio_start_sec = ?6, audio_end_sec = ?7, created_at = ?8 WHERE id = ?9",
        params![
            span.interview_id,
            span.segment_id,
            span.start_offset,
            span.end_offset,
            span.text_snapshot,
            span.audio_start_sec,
            span.audio_end_sec,
            span.created_at,
            span.id,
        ],
    )?;
    if affected == 0 {
        return Err(AppError::NotFound(format!("tagged_span {}", span.id)));
    }
    Ok(())
}

pub fn reassign_to_segment(
    conn: &Connection,
    span_id: i64,
    new_segment_id: i64,
    start_offset_delta: i32,
) -> AppResult<()> {
    let affected = conn.execute(
        "UPDATE tagged_span SET segment_id = ?1, start_offset = start_offset + ?2, end_offset = end_offset + ?2 WHERE id = ?3",
        params![new_segment_id, start_offset_delta, span_id],
    )?;
    if affected == 0 {
        return Err(AppError::NotFound(format!("tagged_span {span_id}")));
    }
    Ok(())
}

pub fn delete(conn: &Connection, id: i64) -> AppResult<()> {
    let affected = conn.execute("DELETE FROM tagged_span WHERE id = ?1", params![id])?;
    if affected == 0 {
        return Err(AppError::NotFound(format!("tagged_span {id}")));
    }
    Ok(())
}

fn map_row(r: &rusqlite::Row) -> rusqlite::Result<TaggedSpan> {
    Ok(TaggedSpan {
        id: r.get(0)?,
        interview_id: r.get(1)?,
        segment_id: r.get(2)?,
        start_offset: r.get(3)?,
        end_offset: r.get(4)?,
        text_snapshot: r.get(5)?,
        audio_start_sec: r.get(6)?,
        audio_end_sec: r.get(7)?,
        created_at: r.get(8)?,
    })
}

pub fn get(conn: &Connection, id: i64) -> AppResult<TaggedSpan> {
    conn.query_row(
        "SELECT id, interview_id, segment_id, start_offset, end_offset, text_snapshot, audio_start_sec, audio_end_sec, created_at FROM tagged_span WHERE id = ?1",
        params![id],
        map_row,
    )
    .optional()?
    .ok_or_else(|| AppError::NotFound(format!("tagged_span {id}")))
}

pub fn list_for_interview(conn: &Connection, interview_id: i64) -> AppResult<Vec<TaggedSpan>> {
    let mut stmt = conn.prepare(
        "SELECT id, interview_id, segment_id, start_offset, end_offset, text_snapshot, audio_start_sec, audio_end_sec, created_at FROM tagged_span WHERE interview_id = ?1 ORDER BY segment_id, start_offset",
    )?;
    let rows = stmt.query_map(params![interview_id], map_row)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

pub fn list_for_segment(conn: &Connection, segment_id: i64) -> AppResult<Vec<TaggedSpan>> {
    let mut stmt = conn.prepare(
        "SELECT id, interview_id, segment_id, start_offset, end_offset, text_snapshot, audio_start_sec, audio_end_sec, created_at FROM tagged_span WHERE segment_id = ?1 ORDER BY start_offset",
    )?;
    let rows = stmt.query_map(params![segment_id], map_row)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

pub fn list_for_tag(conn: &Connection, tag_id: i64) -> AppResult<Vec<TaggedSpan>> {
    let mut stmt = conn.prepare(
        "SELECT ts.id, ts.interview_id, ts.segment_id, ts.start_offset, ts.end_offset, ts.text_snapshot, ts.audio_start_sec, ts.audio_end_sec, ts.created_at
         FROM tagged_span ts JOIN span_tag st ON st.span_id = ts.id WHERE st.tag_id = ?1 ORDER BY ts.interview_id, ts.segment_id, ts.start_offset",
    )?;
    let rows = stmt.query_map(params![tag_id], map_row)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}
