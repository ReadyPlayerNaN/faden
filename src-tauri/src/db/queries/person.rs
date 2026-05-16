use crate::error::{AppError, AppResult};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Person {
    pub id: i64,
    pub name: String,
    pub linked_speaker_count: i64,
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

fn get_with_query(conn: &Connection, sql: &str, id: i64) -> AppResult<Person> {
    conn.query_row(sql, params![id], |r| {
        Ok(Person {
            id: r.get(0)?,
            name: r.get(1)?,
            linked_speaker_count: r.get(2)?,
        })
    })
    .optional()?
    .ok_or_else(|| AppError::NotFound(format!("person {id}")))
}

pub fn create(conn: &Connection, name: &str) -> AppResult<Person> {
    conn.execute("INSERT INTO person (name) VALUES (?1)", params![name])
        .map_err(|e| map_constraint(e, "person"))?;
    get(conn, conn.last_insert_rowid())
}

pub fn list(conn: &Connection) -> AppResult<Vec<Person>> {
    let mut stmt = conn.prepare(
        "SELECT p.id, p.name, COUNT(s.id) AS linked_speaker_count
         FROM person p
         LEFT JOIN speaker s ON s.person_id = p.id
         GROUP BY p.id, p.name
         ORDER BY LOWER(p.name) ASC, p.id ASC",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(Person {
            id: r.get(0)?,
            name: r.get(1)?,
            linked_speaker_count: r.get(2)?,
        })
    })?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

pub fn get(conn: &Connection, id: i64) -> AppResult<Person> {
    get_with_query(
        conn,
        "SELECT p.id, p.name, COUNT(s.id) AS linked_speaker_count
         FROM person p
         LEFT JOIN speaker s ON s.person_id = p.id
         WHERE p.id = ?1
         GROUP BY p.id, p.name",
        id,
    )
}

pub fn rename(conn: &Connection, id: i64, name: &str) -> AppResult<()> {
    let affected = conn
        .execute(
            "UPDATE person SET name = ?1 WHERE id = ?2",
            params![name, id],
        )
        .map_err(|e| map_constraint(e, "person"))?;
    if affected == 0 {
        return Err(AppError::NotFound(format!("person {id}")));
    }
    Ok(())
}

pub fn delete(conn: &mut Connection, id: i64) -> AppResult<()> {
    get(conn, id)?;
    let tx = conn.transaction()?;
    tx.execute(
        "UPDATE speaker SET person_id = NULL WHERE person_id = ?1",
        params![id],
    )?;
    let deleted = tx.execute("DELETE FROM person WHERE id = ?1", params![id])?;
    if deleted == 0 {
        return Err(AppError::NotFound(format!("person {id}")));
    }
    tx.commit()?;
    Ok(())
}
