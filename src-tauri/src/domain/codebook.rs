use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodebookTree {
    pub clusters: Vec<ClusterNode>,
    pub standalone_categories: Vec<CategoryNode>,
    pub standalone_tags: Vec<TagNode>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClusterNode {
    pub id: i64,
    pub name: String,
    pub description: Option<String>,
    pub color: Option<String>,
    pub order_index: i64,
    pub count: i64,
    pub categories: Vec<CategoryNode>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CategoryNode {
    pub id: i64,
    pub cluster_id: Option<i64>,
    pub name: String,
    pub description: Option<String>,
    pub color: Option<String>,
    pub order_index: i64,
    pub count: i64,
    pub tags: Vec<TagNode>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TagNode {
    pub id: i64,
    pub category_id: Option<i64>,
    pub name: String,
    pub description: Option<String>,
    pub color: Option<String>,
    pub order_index: i64,
    pub count: i64,
}
