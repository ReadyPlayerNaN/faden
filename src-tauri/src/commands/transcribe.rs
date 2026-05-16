use crate::app_state::AppState;
use crate::commands::util::project_conn;
use crate::db::queries::interview::{self, TranscriptStatus};
use crate::db::queries::project_meta;
use crate::error::{AppError, AppResult};
use crate::settings::SettingsStore;
use crate::transcription::pipeline::{run_pipeline, PipelineConfig};
use crate::transcription::{ffmpeg, prompts};
use tauri::Manager;
use tokio_util::sync::CancellationToken;

fn build_config(app: &tauri::AppHandle) -> AppResult<PipelineConfig> {
    let settings = SettingsStore::new(app.path().app_config_dir()?).load()?;
    let api_key = settings.gemini_api_key;
    if api_key.is_empty() {
        return Err(AppError::Invalid("no Gemini API key configured".into()));
    }
    let conn = project_conn(app)?;
    let project_settings = project_meta::read_settings(&conn)?;
    Ok(PipelineConfig {
        model: settings.default_transcription_model,
        chunk_seconds: project_settings.transcription.chunk_seconds,
        normalize: ffmpeg::NormalizeParams {
            channels: project_settings.transcription.channels,
            sample_rate: project_settings.transcription.sample_rate,
            bitrate: project_settings.transcription.bitrate.clone(),
        },
        api_key,
        system_instruction: project_settings
            .prompts
            .transcription_system
            .unwrap_or_else(|| prompts::SYSTEM_INSTRUCTION.to_string()),
        user_prompt: project_settings
            .prompts
            .transcription_user
            .unwrap_or_else(|| prompts::PROMPT_TEMPLATE.to_string()),
        ..PipelineConfig::default()
    })
}

pub fn start_transcription_run(app: tauri::AppHandle, interview_id: i64) -> AppResult<()> {
    if app.state::<AppState>().has_run_for_interview(interview_id) {
        return Err(AppError::Conflict(format!(
            "transcription already running for interview {interview_id}"
        )));
    }

    let config = build_config(&app)?;
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
pub async fn transcribe_start(app: tauri::AppHandle, interview_id: i64) -> AppResult<()> {
    start_transcription_run(app, interview_id)
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
