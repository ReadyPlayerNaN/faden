use crate::commands::util::project_conn;
use crate::db;
use crate::db::queries::project_meta;
use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::path::PathBuf;
use tauri::Manager;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectInfo {
    pub path: String,
    pub name: String,
}

pub async fn project_create_impl(path: String, name: String) -> AppResult<ProjectInfo> {
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

pub async fn project_open_impl(path: String) -> AppResult<ProjectInfo> {
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

#[tauri::command]
pub async fn project_create(
    app: tauri::AppHandle,
    path: String,
    name: String,
) -> AppResult<ProjectInfo> {
    let info = project_create_impl(path.clone(), name).await?;
    app.state::<crate::app_state::AppState>()
        .set_current(PathBuf::from(&path));
    Ok(info)
}

#[tauri::command]
pub async fn project_open(app: tauri::AppHandle, path: String) -> AppResult<ProjectInfo> {
    let info = project_open_impl(path.clone()).await?;
    app.state::<crate::app_state::AppState>()
        .set_current(PathBuf::from(&path));
    Ok(info)
}

#[tauri::command]
pub async fn project_rename(app: tauri::AppHandle, name: String) -> AppResult<()> {
    let conn = project_conn(&app)?;
    project_meta::rename(&conn, &name)
}
