use crate::error::{AppError, AppResult};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Speaker {
    pub id: i64,
    pub interview_id: i64,
    pub label_raw: String,
    pub display_name: Option<String>,
}

fn map_constraint(err: rusqlite::Error, label: &str) -> AppError {
    if let rusqlite::Error::SqliteFailure(sqlite_err, msg) = &err {
        if sqlite_err.code == rusqlite::ErrorCode::ConstraintViolation {
            if let Some(text) = msg {
                if text.contains("UNIQUE") {
                    return AppError::Conflict(format!("{label} name already exists"));
                }
            }
        }
    }
    AppError::Sqlite(err)
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

pub fn create(
    conn: &Connection,
    interview_id: i64,
    label_raw: &str,
    display_name: Option<&str>,
) -> AppResult<Speaker> {
    conn.execute(
        "INSERT INTO speaker (interview_id, label_raw, display_name) VALUES (?1, ?2, ?3)",
        params![interview_id, label_raw, display_name],
    )
    .map_err(|e| map_constraint(e, "speaker"))?;
    get(conn, conn.last_insert_rowid())
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

pub fn merge_many_into_new(
    conn: &mut Connection,
    interview_id: i64,
    source_ids: &[i64],
    new_name: &str,
) -> AppResult<Speaker> {
    let unique_ids: BTreeSet<i64> = source_ids.iter().copied().collect();
    if unique_ids.len() < 2 {
        return Err(AppError::Invalid(
            "select at least two speakers to merge".into(),
        ));
    }
    let new_name = new_name.trim();
    if new_name.is_empty() {
        return Err(AppError::Invalid("merged speaker name is required".into()));
    }

    let mut reusable_target_id: Option<i64> = None;
    for source_id in &unique_ids {
        let source = get(conn, *source_id)?;
        if source.interview_id != interview_id {
            return Err(AppError::Invalid(
                "speakers do not belong to the selected interview".into(),
            ));
        }
        if source.label_raw == new_name {
            reusable_target_id = Some(source.id);
        }
    }

    let tx = conn.transaction()?;
    let new_id = if let Some(target_id) = reusable_target_id {
        tx.execute(
            "UPDATE speaker SET display_name = ?1 WHERE id = ?2",
            params![Some(new_name), target_id],
        )?;
        target_id
    } else {
        tx.execute(
            "INSERT INTO speaker (interview_id, label_raw, display_name) VALUES (?1, ?2, ?3)",
            params![interview_id, new_name, Some(new_name)],
        )
        .map_err(|e| map_constraint(e, "speaker"))?;
        tx.last_insert_rowid()
    };

    for source_id in &unique_ids {
        if *source_id == new_id {
            continue;
        }
        tx.execute(
            "UPDATE segment SET speaker_id = ?1 WHERE speaker_id = ?2",
            params![new_id, source_id],
        )?;
        let deleted = tx.execute("DELETE FROM speaker WHERE id = ?1", params![source_id])?;
        if deleted == 0 {
            return Err(AppError::NotFound(format!("speaker {source_id}")));
        }
    }

    tx.commit()?;
    get(conn, new_id)
}

pub fn delete_and_unassign(conn: &mut Connection, speaker_id: i64) -> AppResult<()> {
    get(conn, speaker_id)?;

    let tx = conn.transaction()?;
    tx.execute(
        "UPDATE segment SET speaker_id = NULL WHERE speaker_id = ?1",
        params![speaker_id],
    )?;
    let deleted = tx.execute("DELETE FROM speaker WHERE id = ?1", params![speaker_id])?;
    if deleted == 0 {
        return Err(AppError::NotFound(format!("speaker {speaker_id}")));
    }
    tx.commit()?;
    Ok(())
}
