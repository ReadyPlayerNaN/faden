use crate::db::queries::category;
use crate::error::{AppError, AppResult};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tag {
    pub id: i64,
    pub category_id: Option<i64>,
    pub name: String,
    pub description: Option<String>,
    pub color: Option<String>,
    pub order_index: i64,
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

fn map_delete_constraint(err: rusqlite::Error) -> AppError {
    if let rusqlite::Error::SqliteFailure(sqlite_err, _) = &err {
        if sqlite_err.code == rusqlite::ErrorCode::ConstraintViolation {
            return AppError::Conflict("tag is in use".into());
        }
    }
    AppError::Sqlite(err)
}

fn next_order(conn: &Connection, category_id: Option<i64>) -> AppResult<i64> {
    let next: i64 = match category_id {
        Some(cid) => conn.query_row(
            "SELECT COALESCE(MAX(order_index), -1) + 1 FROM tag WHERE category_id = ?1",
            params![cid],
            |r| r.get(0),
        )?,
        None => conn.query_row(
            "SELECT COALESCE(MAX(order_index), -1) + 1 FROM tag WHERE category_id IS NULL",
            [],
            |r| r.get(0),
        )?,
    };
    Ok(next)
}

pub fn create(
    conn: &Connection,
    category_id: Option<i64>,
    name: &str,
    description: Option<&str>,
    color: Option<&str>,
) -> AppResult<Tag> {
    // Validate parent exists (when given).
    if let Some(cid) = category_id {
        category::get(conn, cid)?;
    }
    let order_index = next_order(conn, category_id)?;
    conn.execute(
        "INSERT INTO tag (category_id, name, description, color, order_index) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![category_id, name, description, color, order_index],
    )
    .map_err(|e| map_constraint(e, "tag"))?;
    let id = conn.last_insert_rowid();
    Ok(Tag {
        id,
        category_id,
        name: name.into(),
        description: description.map(String::from),
        color: color.map(String::from),
        order_index,
    })
}

pub fn list_all(conn: &Connection) -> AppResult<Vec<Tag>> {
    let mut stmt = conn.prepare(
        "SELECT id, category_id, name, description, color, order_index \
         FROM tag ORDER BY category_id, order_index, id",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(Tag {
            id: r.get(0)?,
            category_id: r.get(1)?,
            name: r.get(2)?,
            description: r.get(3)?,
            color: r.get(4)?,
            order_index: r.get(5)?,
        })
    })?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

pub fn list_for_category(conn: &Connection, category_id: i64) -> AppResult<Vec<Tag>> {
    let mut stmt = conn.prepare(
        "SELECT id, category_id, name, description, color, order_index \
         FROM tag WHERE category_id = ?1 ORDER BY order_index, id",
    )?;
    let rows = stmt.query_map(params![category_id], |r| {
        Ok(Tag {
            id: r.get(0)?,
            category_id: r.get(1)?,
            name: r.get(2)?,
            description: r.get(3)?,
            color: r.get(4)?,
            order_index: r.get(5)?,
        })
    })?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

pub fn list_standalone(conn: &Connection) -> AppResult<Vec<Tag>> {
    let mut stmt = conn.prepare(
        "SELECT id, category_id, name, description, color, order_index \
         FROM tag WHERE category_id IS NULL ORDER BY order_index, id",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(Tag {
            id: r.get(0)?,
            category_id: r.get(1)?,
            name: r.get(2)?,
            description: r.get(3)?,
            color: r.get(4)?,
            order_index: r.get(5)?,
        })
    })?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

pub fn rename(conn: &Connection, id: i64, name: &str) -> AppResult<()> {
    let affected = conn
        .execute("UPDATE tag SET name = ?1 WHERE id = ?2", params![name, id])
        .map_err(|e| map_constraint(e, "tag"))?;
    if affected == 0 {
        return Err(AppError::NotFound(format!("tag {id}")));
    }
    Ok(())
}

pub fn set_description(conn: &Connection, id: i64, description: Option<&str>) -> AppResult<()> {
    let affected = conn.execute(
        "UPDATE tag SET description = ?1 WHERE id = ?2",
        params![description, id],
    )?;
    if affected == 0 {
        return Err(AppError::NotFound(format!("tag {id}")));
    }
    Ok(())
}

pub fn set_color(conn: &Connection, id: i64, color: Option<&str>) -> AppResult<()> {
    let affected = conn.execute(
        "UPDATE tag SET color = ?1 WHERE id = ?2",
        params![color, id],
    )?;
    if affected == 0 {
        return Err(AppError::NotFound(format!("tag {id}")));
    }
    Ok(())
}

pub fn get(conn: &Connection, id: i64) -> AppResult<Tag> {
    conn.query_row(
        "SELECT id, category_id, name, description, color, order_index FROM tag WHERE id = ?1",
        params![id],
        |r| {
            Ok(Tag {
                id: r.get(0)?,
                category_id: r.get(1)?,
                name: r.get(2)?,
                description: r.get(3)?,
                color: r.get(4)?,
                order_index: r.get(5)?,
            })
        },
    )
    .optional()?
    .ok_or_else(|| AppError::NotFound(format!("tag {id}")))
}

pub fn delete(conn: &Connection, id: i64) -> AppResult<()> {
    let affected = conn
        .execute("DELETE FROM tag WHERE id = ?1", params![id])
        .map_err(map_delete_constraint)?;
    if affected == 0 {
        return Err(AppError::NotFound(format!("tag {id}")));
    }
    Ok(())
}

pub fn move_to_category(conn: &Connection, id: i64, new_category_id: Option<i64>) -> AppResult<()> {
    // Validate target category exists (when given).
    if let Some(cid) = new_category_id {
        category::get(conn, cid)?;
    }
    // Validate this tag exists.
    let _ = get(conn, id)?;
    let order_index = next_order(conn, new_category_id)?;
    let affected = conn.execute(
        "UPDATE tag SET category_id = ?1, order_index = ?2 WHERE id = ?3",
        params![new_category_id, order_index, id],
    )?;
    if affected == 0 {
        return Err(AppError::NotFound(format!("tag {id}")));
    }
    Ok(())
}

pub fn reorder(conn: &mut Connection, category_id: i64, ids_in_order: &[i64]) -> AppResult<()> {
    let tx = conn.transaction()?;
    for (idx, id) in ids_in_order.iter().enumerate() {
        let affected = tx.execute(
            "UPDATE tag SET order_index = ?1 WHERE id = ?2 AND category_id = ?3",
            params![idx as i64, id, category_id],
        )?;
        if affected == 0 {
            return Err(AppError::NotFound(format!(
                "tag {id} in category {category_id}"
            )));
        }
    }
    tx.commit()?;
    Ok(())
}
