use crate::db;
use crate::db::queries::project_meta;
use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectInfo {
    pub path: String,
    pub name: String,
}

#[tauri::command]
pub async fn project_create(path: String, name: String) -> AppResult<ProjectInfo> {
    let dir: PathBuf = PathBuf::from(&path);
    let sqlite = dir.join("project.sqlite");
    if sqlite.exists() {
        return Err(AppError::Invalid(format!(
            "project already exists at {}",
            dir.display()
        )));
    }
    std::fs::create_dir_all(dir.join("media"))?;
    std::fs::create_dir_all(dir.join("cache"))?;
    let conn = db::open(&sqlite)?;
    project_meta::insert(&conn, &name)?;
    Ok(ProjectInfo { path, name })
}

#[tauri::command]
pub async fn project_open(path: String) -> AppResult<ProjectInfo> {
    let dir = Path::new(&path);
    let sqlite = dir.join("project.sqlite");
    if !sqlite.exists() {
        return Err(AppError::NotFound(format!(
            "no project at {}",
            dir.display()
        )));
    }
    let conn = db::open(&sqlite)?;
    let meta = project_meta::read(&conn)?;
    Ok(ProjectInfo {
        path,
        name: meta.name,
    })
}
