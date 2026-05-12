use crate::error::{AppError, AppResult};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Cluster {
    pub id: i64,
    pub name: String,
    pub description: Option<String>,
    pub color: Option<String>,
    pub order_index: i64,
}

fn map_unique(err: rusqlite::Error, label: &str) -> AppError {
    if let rusqlite::Error::SqliteFailure(_, Some(msg)) = &err {
        if msg.contains("UNIQUE") {
            return AppError::Conflict(format!("{label} name already exists"));
        }
    }
    AppError::Sqlite(err)
}

fn next_order(conn: &Connection) -> AppResult<i64> {
    let next: i64 = conn.query_row(
        "SELECT COALESCE(MAX(order_index), -1) + 1 FROM cluster",
        [],
        |r| r.get(0),
    )?;
    Ok(next)
}

pub fn create(
    conn: &Connection,
    name: &str,
    description: Option<&str>,
    color: Option<&str>,
) -> AppResult<Cluster> {
    let order_index = next_order(conn)?;
    conn.execute(
        "INSERT INTO cluster (name, description, color, order_index) VALUES (?1, ?2, ?3, ?4)",
        params![name, description, color, order_index],
    )
    .map_err(|e| map_unique(e, "cluster"))?;
    let id = conn.last_insert_rowid();
    Ok(Cluster {
        id,
        name: name.into(),
        description: description.map(String::from),
        color: color.map(String::from),
        order_index,
    })
}

pub fn list(conn: &Connection) -> AppResult<Vec<Cluster>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, description, color, order_index FROM cluster ORDER BY order_index, id",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(Cluster {
            id: r.get(0)?,
            name: r.get(1)?,
            description: r.get(2)?,
            color: r.get(3)?,
            order_index: r.get(4)?,
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
            "UPDATE cluster SET name = ?1 WHERE id = ?2",
            params![name, id],
        )
        .map_err(|e| map_unique(e, "cluster"))?;
    if affected == 0 {
        return Err(AppError::NotFound(format!("cluster {id}")));
    }
    Ok(())
}

pub fn set_description(conn: &Connection, id: i64, description: Option<&str>) -> AppResult<()> {
    let affected = conn.execute(
        "UPDATE cluster SET description = ?1 WHERE id = ?2",
        params![description, id],
    )?;
    if affected == 0 {
        return Err(AppError::NotFound(format!("cluster {id}")));
    }
    Ok(())
}

pub fn set_color(conn: &Connection, id: i64, color: Option<&str>) -> AppResult<()> {
    let affected = conn.execute(
        "UPDATE cluster SET color = ?1 WHERE id = ?2",
        params![color, id],
    )?;
    if affected == 0 {
        return Err(AppError::NotFound(format!("cluster {id}")));
    }
    Ok(())
}

pub fn delete(conn: &Connection, id: i64) -> AppResult<()> {
    let affected = conn.execute("DELETE FROM cluster WHERE id = ?1", params![id])?;
    if affected == 0 {
        return Err(AppError::NotFound(format!("cluster {id}")));
    }
    Ok(())
}

pub fn reorder(conn: &mut Connection, ids_in_order: &[i64]) -> AppResult<()> {
    let tx = conn.transaction()?;
    for (idx, id) in ids_in_order.iter().enumerate() {
        let affected = tx.execute(
            "UPDATE cluster SET order_index = ?1 WHERE id = ?2",
            params![idx as i64, id],
        )?;
        if affected == 0 {
            return Err(AppError::NotFound(format!("cluster {id}")));
        }
    }
    tx.commit()?;
    Ok(())
}

pub fn get(conn: &Connection, id: i64) -> AppResult<Cluster> {
    conn.query_row(
        "SELECT id, name, description, color, order_index FROM cluster WHERE id = ?1",
        params![id],
        |r| {
            Ok(Cluster {
                id: r.get(0)?,
                name: r.get(1)?,
                description: r.get(2)?,
                color: r.get(3)?,
                order_index: r.get(4)?,
            })
        },
    )
    .optional()?
    .ok_or_else(|| AppError::NotFound(format!("cluster {id}")))
}
