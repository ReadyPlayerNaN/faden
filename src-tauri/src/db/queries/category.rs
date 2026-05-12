use crate::db::queries::cluster;
use crate::error::{AppError, AppResult};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Category {
    pub id: i64,
    pub cluster_id: i64,
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
            return AppError::Conflict("category has tags".into());
        }
    }
    AppError::Sqlite(err)
}

fn next_order(conn: &Connection, cluster_id: i64) -> AppResult<i64> {
    let next: i64 = conn.query_row(
        "SELECT COALESCE(MAX(order_index), -1) + 1 FROM category WHERE cluster_id = ?1",
        params![cluster_id],
        |r| r.get(0),
    )?;
    Ok(next)
}

pub fn create(
    conn: &Connection,
    cluster_id: i64,
    name: &str,
    description: Option<&str>,
    color: Option<&str>,
) -> AppResult<Category> {
    // Validate parent exists.
    cluster::get(conn, cluster_id)?;
    let order_index = next_order(conn, cluster_id)?;
    conn.execute(
        "INSERT INTO category (cluster_id, name, description, color, order_index) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![cluster_id, name, description, color, order_index],
    )
    .map_err(|e| map_constraint(e, "category"))?;
    let id = conn.last_insert_rowid();
    Ok(Category {
        id,
        cluster_id,
        name: name.into(),
        description: description.map(String::from),
        color: color.map(String::from),
        order_index,
    })
}

pub fn list_all(conn: &Connection) -> AppResult<Vec<Category>> {
    let mut stmt = conn.prepare(
        "SELECT id, cluster_id, name, description, color, order_index \
         FROM category ORDER BY cluster_id, order_index, id",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(Category {
            id: r.get(0)?,
            cluster_id: r.get(1)?,
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

pub fn list_for_cluster(conn: &Connection, cluster_id: i64) -> AppResult<Vec<Category>> {
    let mut stmt = conn.prepare(
        "SELECT id, cluster_id, name, description, color, order_index \
         FROM category WHERE cluster_id = ?1 ORDER BY order_index, id",
    )?;
    let rows = stmt.query_map(params![cluster_id], |r| {
        Ok(Category {
            id: r.get(0)?,
            cluster_id: r.get(1)?,
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
        .execute(
            "UPDATE category SET name = ?1 WHERE id = ?2",
            params![name, id],
        )
        .map_err(|e| map_constraint(e, "category"))?;
    if affected == 0 {
        return Err(AppError::NotFound(format!("category {id}")));
    }
    Ok(())
}

pub fn set_description(conn: &Connection, id: i64, description: Option<&str>) -> AppResult<()> {
    let affected = conn.execute(
        "UPDATE category SET description = ?1 WHERE id = ?2",
        params![description, id],
    )?;
    if affected == 0 {
        return Err(AppError::NotFound(format!("category {id}")));
    }
    Ok(())
}

pub fn set_color(conn: &Connection, id: i64, color: Option<&str>) -> AppResult<()> {
    let affected = conn.execute(
        "UPDATE category SET color = ?1 WHERE id = ?2",
        params![color, id],
    )?;
    if affected == 0 {
        return Err(AppError::NotFound(format!("category {id}")));
    }
    Ok(())
}

pub fn get(conn: &Connection, id: i64) -> AppResult<Category> {
    conn.query_row(
        "SELECT id, cluster_id, name, description, color, order_index FROM category WHERE id = ?1",
        params![id],
        |r| {
            Ok(Category {
                id: r.get(0)?,
                cluster_id: r.get(1)?,
                name: r.get(2)?,
                description: r.get(3)?,
                color: r.get(4)?,
                order_index: r.get(5)?,
            })
        },
    )
    .optional()?
    .ok_or_else(|| AppError::NotFound(format!("category {id}")))
}

pub fn delete(conn: &Connection, id: i64) -> AppResult<()> {
    let affected = conn
        .execute("DELETE FROM category WHERE id = ?1", params![id])
        .map_err(map_delete_constraint)?;
    if affected == 0 {
        return Err(AppError::NotFound(format!("category {id}")));
    }
    Ok(())
}

pub fn move_to_cluster(conn: &Connection, id: i64, new_cluster_id: i64) -> AppResult<()> {
    // Validate target cluster exists.
    cluster::get(conn, new_cluster_id)?;
    // Validate this category exists.
    let _ = get(conn, id)?;
    let order_index = next_order(conn, new_cluster_id)?;
    let affected = conn.execute(
        "UPDATE category SET cluster_id = ?1, order_index = ?2 WHERE id = ?3",
        params![new_cluster_id, order_index, id],
    )?;
    if affected == 0 {
        return Err(AppError::NotFound(format!("category {id}")));
    }
    Ok(())
}

pub fn reorder(
    conn: &mut Connection,
    cluster_id: i64,
    ids_in_order: &[i64],
) -> AppResult<()> {
    let tx = conn.transaction()?;
    for (idx, id) in ids_in_order.iter().enumerate() {
        let affected = tx.execute(
            "UPDATE category SET order_index = ?1 WHERE id = ?2 AND cluster_id = ?3",
            params![idx as i64, id, cluster_id],
        )?;
        if affected == 0 {
            return Err(AppError::NotFound(format!(
                "category {id} in cluster {cluster_id}"
            )));
        }
    }
    tx.commit()?;
    Ok(())
}
