use crate::error::{AppError, AppResult};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Speaker {
    pub id: i64,
    pub interview_id: i64,
    pub label_raw: String,
    pub display_name: Option<String>,
}

/// INSERT OR IGNORE; returns the existing or new row for (interview_id, label_raw).
pub fn create_or_get(
    conn: &Connection,
    interview_id: i64,
    label_raw: &str,
    display_name: Option<&str>,
) -> AppResult<Speaker> {
    conn.execute(
        "INSERT INTO speaker (interview_id, label_raw, display_name) VALUES (?1, ?2, ?3) ON CONFLICT(interview_id, label_raw) DO NOTHING",
        params![interview_id, label_raw, display_name],
    )?;
    let row = conn.query_row(
        "SELECT id, interview_id, label_raw, display_name FROM speaker WHERE interview_id = ?1 AND label_raw = ?2",
        params![interview_id, label_raw],
        |r| {
            Ok(Speaker {
                id: r.get(0)?,
                interview_id: r.get(1)?,
                label_raw: r.get(2)?,
                display_name: r.get(3)?,
            })
        },
    )?;
    Ok(row)
}

pub fn list_for_interview(conn: &Connection, interview_id: i64) -> AppResult<Vec<Speaker>> {
    let mut stmt = conn.prepare(
        "SELECT id, interview_id, label_raw, display_name FROM speaker WHERE interview_id = ?1 ORDER BY id ASC",
    )?;
    let rows = stmt.query_map(params![interview_id], |r| {
        Ok(Speaker {
            id: r.get(0)?,
            interview_id: r.get(1)?,
            label_raw: r.get(2)?,
            display_name: r.get(3)?,
        })
    })?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

pub fn get(conn: &Connection, id: i64) -> AppResult<Speaker> {
    conn.query_row(
        "SELECT id, interview_id, label_raw, display_name FROM speaker WHERE id = ?1",
        params![id],
        |r| {
            Ok(Speaker {
                id: r.get(0)?,
                interview_id: r.get(1)?,
                label_raw: r.get(2)?,
                display_name: r.get(3)?,
            })
        },
    )
    .optional()?
    .ok_or_else(|| AppError::NotFound(format!("speaker {id}")))
}

pub fn set_display_name(conn: &Connection, id: i64, display_name: Option<&str>) -> AppResult<()> {
    let affected = conn.execute(
        "UPDATE speaker SET display_name = ?1 WHERE id = ?2",
        params![display_name, id],
    )?;
    if affected == 0 {
        return Err(AppError::NotFound(format!("speaker {id}")));
    }
    Ok(())
}
