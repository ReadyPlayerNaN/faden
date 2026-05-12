use crate::error::AppResult;
use rusqlite::Connection;
use std::collections::HashMap;

#[derive(Debug, Default, Clone)]
pub struct CodebookCounts {
    pub by_cluster: HashMap<i64, i64>,
    pub by_category: HashMap<i64, i64>,
    pub by_tag: HashMap<i64, i64>,
}

pub fn codebook_counts(conn: &Connection) -> AppResult<CodebookCounts> {
    let mut counts = CodebookCounts::default();

    let mut stmt = conn.prepare(
        "SELECT tag.id, COUNT(span_tag.span_id) \
         FROM tag LEFT JOIN span_tag ON span_tag.tag_id = tag.id \
         GROUP BY tag.id",
    )?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)))?;
    for row in rows {
        let (id, n) = row?;
        counts.by_tag.insert(id, n);
    }

    let mut stmt = conn.prepare(
        "SELECT category.id, COUNT(span_tag.span_id) \
         FROM category \
         LEFT JOIN tag ON tag.category_id = category.id \
         LEFT JOIN span_tag ON span_tag.tag_id = tag.id \
         GROUP BY category.id",
    )?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)))?;
    for row in rows {
        let (id, n) = row?;
        counts.by_category.insert(id, n);
    }

    let mut stmt = conn.prepare(
        "SELECT cluster.id, COUNT(span_tag.span_id) \
         FROM cluster \
         LEFT JOIN category ON category.cluster_id = cluster.id \
         LEFT JOIN tag ON tag.category_id = category.id \
         LEFT JOIN span_tag ON span_tag.tag_id = tag.id \
         GROUP BY cluster.id",
    )?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)))?;
    for row in rows {
        let (id, n) = row?;
        counts.by_cluster.insert(id, n);
    }

    Ok(counts)
}
