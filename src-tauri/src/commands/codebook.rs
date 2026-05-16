use crate::commands::util::project_conn;
use crate::db::queries::{category, cluster, stats, tag};
use crate::domain::codebook::{CategoryNode, ClusterNode, CodebookTree, TagNode};
use crate::error::AppResult;
use rusqlite::Connection;
use std::collections::HashMap;

pub fn build_tree(conn: &Connection) -> AppResult<CodebookTree> {
    let counts = stats::codebook_counts(conn)?;
    let clusters = cluster::list(conn)?;
    let categories = category::list_all(conn)?;
    let tags = tag::list_all(conn)?;

    let mut by_cat: HashMap<i64, Vec<TagNode>> = HashMap::new();
    let mut standalone_tags: Vec<TagNode> = Vec::new();
    for t in tags {
        let count = counts.by_tag.get(&t.id).copied().unwrap_or(0);
        let node = TagNode {
            id: t.id,
            category_id: t.category_id,
            name: t.name,
            description: t.description,
            color: t.color,
            order_index: t.order_index,
            count,
        };
        match t.category_id {
            Some(cid) => by_cat.entry(cid).or_default().push(node),
            None => standalone_tags.push(node),
        }
    }

    let mut by_cluster: HashMap<i64, Vec<CategoryNode>> = HashMap::new();
    let mut standalone_categories: Vec<CategoryNode> = Vec::new();
    for c in categories {
        let count = counts.by_category.get(&c.id).copied().unwrap_or(0);
        let node = CategoryNode {
            id: c.id,
            cluster_id: c.cluster_id,
            name: c.name,
            description: c.description,
            color: c.color,
            order_index: c.order_index,
            count,
            tags: by_cat.remove(&c.id).unwrap_or_default(),
        };
        match c.cluster_id {
            Some(cluster_id) => by_cluster.entry(cluster_id).or_default().push(node),
            None => standalone_categories.push(node),
        }
    }

    let mut out_clusters = Vec::new();
    for c in clusters {
        let count = counts.by_cluster.get(&c.id).copied().unwrap_or(0);
        let cats = by_cluster.remove(&c.id).unwrap_or_default();
        out_clusters.push(ClusterNode {
            id: c.id,
            name: c.name,
            description: c.description,
            color: c.color,
            order_index: c.order_index,
            count,
            categories: cats,
        });
    }

    Ok(CodebookTree {
        clusters: out_clusters,
        standalone_categories,
        standalone_tags,
    })
}

#[tauri::command]
pub async fn codebook_tree(app: tauri::AppHandle) -> AppResult<CodebookTree> {
    let conn = project_conn(&app)?;
    build_tree(&conn)
}

// -- cluster commands -------------------------------------------------------

#[tauri::command]
pub async fn cluster_create(
    app: tauri::AppHandle,
    name: String,
    description: Option<String>,
    color: Option<String>,
) -> AppResult<cluster::Cluster> {
    let conn = project_conn(&app)?;
    cluster::create(&conn, &name, description.as_deref(), color.as_deref())
}

#[tauri::command]
pub async fn cluster_rename(app: tauri::AppHandle, id: i64, name: String) -> AppResult<()> {
    let conn = project_conn(&app)?;
    cluster::rename(&conn, id, &name)
}

#[tauri::command]
pub async fn cluster_set_description(
    app: tauri::AppHandle,
    id: i64,
    description: Option<String>,
) -> AppResult<()> {
    let conn = project_conn(&app)?;
    cluster::set_description(&conn, id, description.as_deref())
}

#[tauri::command]
pub async fn cluster_set_color(
    app: tauri::AppHandle,
    id: i64,
    color: Option<String>,
) -> AppResult<()> {
    let conn = project_conn(&app)?;
    cluster::set_color(&conn, id, color.as_deref())
}

#[tauri::command]
pub async fn cluster_delete(app: tauri::AppHandle, id: i64) -> AppResult<()> {
    let conn = project_conn(&app)?;
    cluster::delete(&conn, id)
}

#[tauri::command]
pub async fn cluster_reorder(app: tauri::AppHandle, ids: Vec<i64>) -> AppResult<()> {
    let mut conn = project_conn(&app)?;
    cluster::reorder(&mut conn, &ids)
}

// -- category commands ------------------------------------------------------

#[tauri::command]
pub async fn category_create(
    app: tauri::AppHandle,
    cluster_id: Option<i64>,
    name: String,
    description: Option<String>,
    color: Option<String>,
) -> AppResult<category::Category> {
    let conn = project_conn(&app)?;
    category::create(
        &conn,
        cluster_id,
        &name,
        description.as_deref(),
        color.as_deref(),
    )
}

#[tauri::command]
pub async fn category_rename(app: tauri::AppHandle, id: i64, name: String) -> AppResult<()> {
    let conn = project_conn(&app)?;
    category::rename(&conn, id, &name)
}

#[tauri::command]
pub async fn category_set_description(
    app: tauri::AppHandle,
    id: i64,
    description: Option<String>,
) -> AppResult<()> {
    let conn = project_conn(&app)?;
    category::set_description(&conn, id, description.as_deref())
}

#[tauri::command]
pub async fn category_set_color(
    app: tauri::AppHandle,
    id: i64,
    color: Option<String>,
) -> AppResult<()> {
    let conn = project_conn(&app)?;
    category::set_color(&conn, id, color.as_deref())
}

#[tauri::command]
pub async fn category_delete(app: tauri::AppHandle, id: i64) -> AppResult<()> {
    let conn = project_conn(&app)?;
    category::delete(&conn, id)
}

#[tauri::command]
pub async fn category_reorder(
    app: tauri::AppHandle,
    cluster_id: Option<i64>,
    ids: Vec<i64>,
) -> AppResult<()> {
    let mut conn = project_conn(&app)?;
    category::reorder(&mut conn, cluster_id, &ids)
}

#[tauri::command]
pub async fn category_move_to_cluster(
    app: tauri::AppHandle,
    id: i64,
    new_cluster_id: Option<i64>,
) -> AppResult<()> {
    let conn = project_conn(&app)?;
    category::move_to_cluster(&conn, id, new_cluster_id)
}

// -- tag commands -----------------------------------------------------------

#[tauri::command]
pub async fn tag_create(
    app: tauri::AppHandle,
    category_id: Option<i64>,
    name: String,
    description: Option<String>,
    color: Option<String>,
) -> AppResult<tag::Tag> {
    let conn = project_conn(&app)?;
    tag::create(
        &conn,
        category_id,
        &name,
        description.as_deref(),
        color.as_deref(),
    )
}

#[tauri::command]
pub async fn tag_rename(app: tauri::AppHandle, id: i64, name: String) -> AppResult<()> {
    let conn = project_conn(&app)?;
    tag::rename(&conn, id, &name)
}

#[tauri::command]
pub async fn tag_set_description(
    app: tauri::AppHandle,
    id: i64,
    description: Option<String>,
) -> AppResult<()> {
    let conn = project_conn(&app)?;
    tag::set_description(&conn, id, description.as_deref())
}

#[tauri::command]
pub async fn tag_set_color(
    app: tauri::AppHandle,
    id: i64,
    color: Option<String>,
) -> AppResult<()> {
    let conn = project_conn(&app)?;
    tag::set_color(&conn, id, color.as_deref())
}

#[tauri::command]
pub async fn tag_delete(app: tauri::AppHandle, id: i64) -> AppResult<()> {
    let conn = project_conn(&app)?;
    tag::delete(&conn, id)
}

#[tauri::command]
pub async fn tag_reorder(
    app: tauri::AppHandle,
    category_id: i64,
    ids: Vec<i64>,
) -> AppResult<()> {
    let mut conn = project_conn(&app)?;
    tag::reorder(&mut conn, category_id, &ids)
}

#[tauri::command]
pub async fn tag_move_to_category(
    app: tauri::AppHandle,
    id: i64,
    new_category_id: Option<i64>,
) -> AppResult<()> {
    let conn = project_conn(&app)?;
    tag::move_to_category(&conn, id, new_category_id)
}
