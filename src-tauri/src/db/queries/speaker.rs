use crate::db::queries::person;
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
    pub person_id: Option<i64>,
    pub person_name: Option<String>,
}

impl Speaker {
    pub fn effective_display_name(&self) -> Option<&str> {
        self.display_name.as_deref().or(self.person_name.as_deref())
    }
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

fn select_sql() -> &'static str {
    "SELECT s.id, s.interview_id, s.label_raw, s.display_name, s.person_id, p.name
     FROM speaker s
     LEFT JOIN person p ON p.id = s.person_id"
}

fn map_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<Speaker> {
    Ok(Speaker {
        id: r.get(0)?,
        interview_id: r.get(1)?,
        label_raw: r.get(2)?,
        display_name: r.get(3)?,
        person_id: r.get(4)?,
        person_name: r.get(5)?,
    })
}

fn unique_label_for_person(conn: &Connection, interview_id: i64, base: &str) -> AppResult<String> {
    let trimmed = base.trim();
    let seed = if trimmed.is_empty() {
        "Speaker"
    } else {
        trimmed
    };
    let mut candidate = seed.to_string();
    let mut suffix = 2;
    loop {
        let exists: Option<i64> = conn
            .query_row(
                "SELECT id FROM speaker WHERE interview_id = ?1 AND label_raw = ?2",
                params![interview_id, candidate],
                |r| r.get(0),
            )
            .optional()?;
        if exists.is_none() {
            return Ok(candidate);
        }
        candidate = format!("{seed} {suffix}");
        suffix += 1;
    }
}

/// INSERT OR IGNORE; returns the existing or new row for (interview_id, label_raw).
pub fn create_or_get(
    conn: &Connection,
    interview_id: i64,
    label_raw: &str,
    display_name: Option<&str>,
    person_id: Option<i64>,
) -> AppResult<Speaker> {
    if let Some(pid) = person_id {
        person::get(conn, pid)?;
    }
    conn.execute(
        "INSERT INTO speaker (interview_id, label_raw, display_name, person_id) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(interview_id, label_raw) DO NOTHING",
        params![interview_id, label_raw, display_name, person_id],
    )?;
    let row = conn.query_row(
        &format!(
            "{} WHERE s.interview_id = ?1 AND s.label_raw = ?2",
            select_sql()
        ),
        params![interview_id, label_raw],
        map_row,
    )?;
    Ok(row)
}

pub fn create(
    conn: &Connection,
    interview_id: i64,
    label_raw: &str,
    display_name: Option<&str>,
    person_id: Option<i64>,
) -> AppResult<Speaker> {
    if let Some(pid) = person_id {
        person::get(conn, pid)?;
    }
    conn.execute(
        "INSERT INTO speaker (interview_id, label_raw, display_name, person_id) VALUES (?1, ?2, ?3, ?4)",
        params![interview_id, label_raw, display_name, person_id],
    )
    .map_err(|e| map_constraint(e, "speaker"))?;
    get(conn, conn.last_insert_rowid())
}

pub fn create_for_person(
    conn: &Connection,
    interview_id: i64,
    person_id: i64,
    label_raw: Option<&str>,
    display_name: Option<&str>,
) -> AppResult<Speaker> {
    let person = person::get(conn, person_id)?;
    let label = unique_label_for_person(conn, interview_id, label_raw.unwrap_or(&person.name))?;
    create(conn, interview_id, &label, display_name, Some(person_id))
}

pub fn list_for_interview(conn: &Connection, interview_id: i64) -> AppResult<Vec<Speaker>> {
    let mut stmt = conn.prepare(&format!(
        "{} WHERE s.interview_id = ?1 ORDER BY s.id ASC",
        select_sql()
    ))?;
    let rows = stmt.query_map(params![interview_id], map_row)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

pub fn delete_all_for_interview(conn: &Connection, interview_id: i64) -> AppResult<usize> {
    let affected = conn.execute(
        "DELETE FROM speaker WHERE interview_id = ?1",
        params![interview_id],
    )?;
    Ok(affected)
}

pub fn get(conn: &Connection, id: i64) -> AppResult<Speaker> {
    conn.query_row(
        &format!("{} WHERE s.id = ?1", select_sql()),
        params![id],
        map_row,
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

pub fn set_person(conn: &Connection, id: i64, person_id: Option<i64>) -> AppResult<()> {
    if let Some(pid) = person_id {
        person::get(conn, pid)?;
    }
    let affected = conn.execute(
        "UPDATE speaker SET person_id = ?1 WHERE id = ?2",
        params![person_id, id],
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
    let mut merged_person_id: Option<i64> = None;
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
        if let Some(pid) = source.person_id {
            if let Some(existing) = merged_person_id {
                if existing != pid {
                    return Err(AppError::Invalid(
                        "cannot merge speakers linked to different people".into(),
                    ));
                }
            } else {
                merged_person_id = Some(pid);
            }
        }
    }

    let tx = conn.transaction()?;
    let inherited_display_name = if merged_person_id.is_some() {
        None
    } else {
        Some(new_name)
    };
    let new_id = if let Some(target_id) = reusable_target_id {
        tx.execute(
            "UPDATE speaker SET display_name = ?1, person_id = ?2 WHERE id = ?3",
            params![inherited_display_name, merged_person_id, target_id],
        )?;
        target_id
    } else {
        tx.execute(
            "INSERT INTO speaker (interview_id, label_raw, display_name, person_id) VALUES (?1, ?2, ?3, ?4)",
            params![interview_id, new_name, inherited_display_name, merged_person_id],
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
