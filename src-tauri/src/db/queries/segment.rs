use crate::error::{AppError, AppResult};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Segment {
    pub id: i64,
    pub interview_id: i64,
    pub speaker_id: i64,
    pub start_sec: f64,
    pub end_sec: f64,
    pub text: String,
    pub order_index: i64,
}

#[derive(Debug, Clone)]
pub struct NewSegment {
    pub speaker_id: i64,
    pub start_sec: f64,
    pub end_sec: f64,
    pub text: String,
}

fn next_order_for_interview(conn: &Connection, interview_id: i64) -> AppResult<i64> {
    let next: i64 = conn.query_row(
        "SELECT COALESCE(MAX(order_index), -1) + 1 FROM segment WHERE interview_id = ?1",
        params![interview_id],
        |r| r.get(0),
    )?;
    Ok(next)
}

pub fn insert_batch(
    conn: &mut Connection,
    interview_id: i64,
    segments: &[NewSegment],
) -> AppResult<Vec<i64>> {
    let mut next = next_order_for_interview(conn, interview_id)?;
    let tx = conn.transaction()?;
    let mut ids = Vec::with_capacity(segments.len());
    for seg in segments {
        tx.execute(
            "INSERT INTO segment (interview_id, speaker_id, start_sec, end_sec, text, order_index) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![interview_id, seg.speaker_id, seg.start_sec, seg.end_sec, seg.text, next],
        )?;
        ids.push(tx.last_insert_rowid());
        next += 1;
    }
    tx.commit()?;
    Ok(ids)
}

pub fn list_for_interview(conn: &Connection, interview_id: i64) -> AppResult<Vec<Segment>> {
    let mut stmt = conn.prepare(
        "SELECT id, interview_id, speaker_id, start_sec, end_sec, text, order_index FROM segment WHERE interview_id = ?1 ORDER BY order_index ASC, id ASC",
    )?;
    let rows = stmt.query_map(params![interview_id], |r| {
        Ok(Segment {
            id: r.get(0)?,
            interview_id: r.get(1)?,
            speaker_id: r.get(2)?,
            start_sec: r.get(3)?,
            end_sec: r.get(4)?,
            text: r.get(5)?,
            order_index: r.get(6)?,
        })
    })?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

pub fn delete_all_for_interview(conn: &Connection, interview_id: i64) -> AppResult<usize> {
    let affected = conn.execute(
        "DELETE FROM segment WHERE interview_id = ?1",
        params![interview_id],
    )?;
    Ok(affected)
}

pub fn update_text(conn: &Connection, id: i64, text: &str) -> AppResult<()> {
    let affected = conn.execute(
        "UPDATE segment SET text = ?1 WHERE id = ?2",
        params![text, id],
    )?;
    if affected == 0 {
        return Err(AppError::NotFound(format!("segment {id}")));
    }
    Ok(())
}

pub fn set_speaker(conn: &Connection, id: i64, speaker_id: i64) -> AppResult<()> {
    let affected = conn.execute(
        "UPDATE segment SET speaker_id = ?1 WHERE id = ?2",
        params![speaker_id, id],
    )?;
    if affected == 0 {
        return Err(AppError::NotFound(format!("segment {id}")));
    }
    Ok(())
}

pub fn delete(conn: &Connection, id: i64) -> AppResult<()> {
    let affected = conn.execute("DELETE FROM segment WHERE id = ?1", params![id])?;
    if affected == 0 {
        return Err(AppError::NotFound(format!("segment {id}")));
    }
    Ok(())
}

pub fn shift_order_indices_from(
    conn: &Connection,
    interview_id: i64,
    from_order: i64,
    delta: i64,
) -> AppResult<()> {
    conn.execute(
        "UPDATE segment SET order_index = order_index + ?1 WHERE interview_id = ?2 AND order_index >= ?3",
        params![delta, interview_id, from_order],
    )?;
    Ok(())
}

pub fn renumber_order_indices(
    conn: &mut Connection,
    interview_id: i64,
) -> AppResult<()> {
    let tx = conn.transaction()?;
    let ids: Vec<i64> = {
        let mut stmt = tx.prepare(
            "SELECT id FROM segment WHERE interview_id = ?1 ORDER BY order_index ASC, id ASC",
        )?;
        let rows = stmt.query_map(params![interview_id], |r| r.get::<_, i64>(0))?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        out
    };
    for (idx, id) in ids.iter().enumerate() {
        tx.execute(
            "UPDATE segment SET order_index = ?1 WHERE id = ?2",
            params![idx as i64, id],
        )?;
    }
    tx.commit()?;
    Ok(())
}

pub fn insert_at_order(
    conn: &Connection,
    interview_id: i64,
    order_index: i64,
    new: &NewSegment,
) -> AppResult<i64> {
    conn.execute(
        "INSERT INTO segment (interview_id, speaker_id, start_sec, end_sec, text, order_index) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![interview_id, new.speaker_id, new.start_sec, new.end_sec, new.text, order_index],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn get(conn: &Connection, id: i64) -> AppResult<Segment> {
    conn.query_row(
        "SELECT id, interview_id, speaker_id, start_sec, end_sec, text, order_index FROM segment WHERE id = ?1",
        params![id],
        |r| {
            Ok(Segment {
                id: r.get(0)?,
                interview_id: r.get(1)?,
                speaker_id: r.get(2)?,
                start_sec: r.get(3)?,
                end_sec: r.get(4)?,
                text: r.get(5)?,
                order_index: r.get(6)?,
            })
        },
    )
    .optional()?
    .ok_or_else(|| AppError::NotFound(format!("segment {id}")))
}
