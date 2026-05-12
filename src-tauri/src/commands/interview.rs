use crate::commands::util::project_conn;
use crate::db;
use crate::db::queries::interview::{self, Interview};
use crate::error::{AppError, AppResult};
use std::path::{Path, PathBuf};

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

// Helper to compute a sanitized filename. Keeps alphanum, dashes, underscores.
fn sanitize_filename(name: &str) -> String {
    name.chars()
        .map(|c| if c.is_ascii_alphanumeric() || matches!(c, '-' | '_') { c } else { '_' })
        .collect::<String>()
        .trim_matches('_')
        .to_string()
}

pub async fn interview_create_with_audio_impl(
    project_dir: PathBuf,
    name: String,
    source_audio_path: String,
) -> AppResult<Interview> {
    let src = Path::new(&source_audio_path);
    if !src.exists() {
        return Err(AppError::NotFound(format!("audio file: {}", src.display())));
    }
    let ext = src.extension().and_then(|e| e.to_str()).unwrap_or("audio");
    let sanitized = sanitize_filename(&name);
    let short_uuid = uuid::Uuid::new_v4().simple().to_string()[..8].to_string();
    let target_name = format!("{sanitized}-{short_uuid}.{ext}");
    let media_dir = project_dir.join("media");
    std::fs::create_dir_all(&media_dir)?;
    let target_path = media_dir.join(&target_name);
    std::fs::copy(src, &target_path)?;

    let sqlite = project_dir.join("project.sqlite");
    let conn = db::open(&sqlite)?;
    let mut iv = interview::create(&conn, &name)?;
    let rel_path = format!("media/{target_name}");
    interview::set_audio_path(&conn, iv.id, Some(&rel_path))?;
    iv.audio_path = Some(rel_path);
    Ok(iv)
}

#[tauri::command]
pub async fn interview_create_with_audio(
    app: tauri::AppHandle,
    name: String,
    source_audio_path: String,
) -> AppResult<Interview> {
    use tauri::Manager;
    let state = app.state::<crate::app_state::AppState>();
    let project_dir = state.current_project()?;
    interview_create_with_audio_impl(project_dir, name, source_audio_path).await
}
