use crate::commands::util::project_conn;
use crate::error::AppResult;
use crate::history::{self, HistoryStatus};

#[tauri::command]
pub async fn history_undo(app: tauri::AppHandle) -> AppResult<()> {
    let mut conn = project_conn(&app)?;
    history::undo(&mut conn)
}

#[tauri::command]
pub async fn history_redo(app: tauri::AppHandle) -> AppResult<()> {
    let mut conn = project_conn(&app)?;
    history::redo(&mut conn)
}

#[tauri::command]
pub async fn history_status(app: tauri::AppHandle) -> AppResult<HistoryStatus> {
    let conn = project_conn(&app)?;
    history::status(&conn)
}
