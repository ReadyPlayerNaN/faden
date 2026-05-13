use crate::app_state::AppState;
use crate::commands::util::project_conn;
use crate::db::queries::interview::{self, TranscriptStatus};
use crate::error::{AppError, AppResult};
use crate::transcription::pipeline::{run_pipeline, PipelineConfig};
use tauri::Manager;
use tokio_util::sync::CancellationToken;

#[tauri::command]
pub async fn transcribe_start(app: tauri::AppHandle, interview_id: i64) -> AppResult<()> {
    let settings = crate::commands::settings::settings_get(app.clone()).await?;
    let api_key = settings.gemini_api_key;
    if api_key.is_empty() {
        return Err(AppError::Invalid("no Gemini API key configured".into()));
    }
    let mut config = PipelineConfig::default();
    config.api_key = api_key;

    let token = CancellationToken::new();
    app.state::<AppState>()
        .register_run_for_interview(interview_id, token.clone());

    let app_handle = app.clone();
    let app_cleanup = app.clone();
    tauri::async_runtime::spawn(async move {
        let _ = run_pipeline(app_handle, interview_id, token, config).await;
        app_cleanup
            .state::<AppState>()
            .deregister_run_for_interview(interview_id);
    });

    Ok(())
}

#[tauri::command]
pub async fn transcribe_cancel(app: tauri::AppHandle, interview_id: i64) -> AppResult<()> {
    app.state::<AppState>()
        .cancel_run_for_interview(interview_id)
}

#[tauri::command]
pub async fn transcribe_status(
    app: tauri::AppHandle,
    interview_id: i64,
) -> AppResult<TranscriptStatus> {
    let conn = project_conn(&app)?;
    let iv = interview::get(&conn, interview_id)?;
    Ok(iv.transcript_status)
}
