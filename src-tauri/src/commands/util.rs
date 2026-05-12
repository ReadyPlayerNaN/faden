use crate::error::AppResult;
use rusqlite::Connection;
use tauri::Manager;

pub(crate) fn project_conn(app: &tauri::AppHandle) -> AppResult<Connection> {
    let state = app.state::<crate::app_state::AppState>();
    let dir = state.current_project()?;
    crate::db::open(&dir.join("project.sqlite"))
}
