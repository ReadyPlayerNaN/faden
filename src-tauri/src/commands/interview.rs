use crate::commands::util::project_conn;
use crate::db::queries::interview::{self, Interview};
use crate::error::AppResult;

#[tauri::command]
pub async fn interview_create(app: tauri::AppHandle, name: String) -> AppResult<Interview> {
    let conn = project_conn(&app)?;
    interview::create(&conn, &name)
}

#[tauri::command]
pub async fn interview_list(app: tauri::AppHandle) -> AppResult<Vec<Interview>> {
    let conn = project_conn(&app)?;
    interview::list(&conn)
}

#[tauri::command]
pub async fn interview_get(app: tauri::AppHandle, id: i64) -> AppResult<Interview> {
    let conn = project_conn(&app)?;
    interview::get(&conn, id)
}

#[tauri::command]
pub async fn interview_rename(app: tauri::AppHandle, id: i64, name: String) -> AppResult<()> {
    let conn = project_conn(&app)?;
    interview::rename(&conn, id, &name)
}

#[tauri::command]
pub async fn interview_delete(app: tauri::AppHandle, id: i64) -> AppResult<()> {
    let conn = project_conn(&app)?;
    interview::delete(&conn, id)
}
