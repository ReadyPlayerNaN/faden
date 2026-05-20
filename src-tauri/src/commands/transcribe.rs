use crate::app_state::AppState;
use crate::commands::util::project_conn;
use crate::db;
use crate::db::queries::ai_run::{self, AiRunKind};
use crate::db::queries::ai_run_ops::{self, AiRunStageKey, AiRunTaskKind};
use crate::db::queries::interview::{self, TranscriptStatus};
use crate::db::queries::project_meta;
use crate::db::queries::{segment, speaker};
use crate::error::{AppError, AppResult};
use crate::secrets::hydrate_global_settings;
use crate::settings::{LlmProvider, SettingsStore};
use crate::transcription::pipeline::{run_pipeline, PipelineConfig};
use crate::transcription::progress::{TranscriptionProgress, EVENT_NAME};
use crate::transcription::schema::ParsedSegment;
use crate::transcription::{ffmpeg, openai, prompts};
use tauri::{Emitter, Manager};
use tokio_util::sync::CancellationToken;

struct OpenAiTranscriptionConfig {
    model: String,
    model_ref: String,
    api_key: String,
    base_url: String,
    normalize: ffmpeg::NormalizeParams,
}

enum TranscriptionConfig {
    Gemini(PipelineConfig),
    OpenAi(OpenAiTranscriptionConfig),
}

fn emit(app: &tauri::AppHandle, progress: &TranscriptionProgress) {
    let _ = app.emit(EVENT_NAME, progress);
}

fn transcription_selection(
    app: &tauri::AppHandle,
) -> AppResult<crate::settings::TaskModelSelection> {
    let store = SettingsStore::new(app.path().app_config_dir()?);
    let settings = hydrate_global_settings(app, &store)?;
    Ok(settings.transcription)
}

fn build_config(app: &tauri::AppHandle) -> AppResult<TranscriptionConfig> {
    let store = SettingsStore::new(app.path().app_config_dir()?);
    let settings = hydrate_global_settings(app, &store)?;
    let conn = project_conn(app)?;
    let project_settings = project_meta::read_settings(&conn)?;
    let selection = settings.transcription.clone();

    let normalize = ffmpeg::NormalizeParams {
        channels: project_settings.transcription.channels,
        sample_rate: project_settings.transcription.sample_rate,
        bitrate: project_settings.transcription.bitrate.clone(),
    };

    match selection.provider {
        LlmProvider::Gemini => {
            let api_key = settings.providers.gemini.api_key;
            if api_key.is_empty() {
                return Err(AppError::Invalid("no Gemini API key configured".into()));
            }
            Ok(TranscriptionConfig::Gemini(PipelineConfig {
                model: selection.model,
                chunk_seconds: project_settings.transcription.chunk_seconds,
                normalize,
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
            }))
        }
        LlmProvider::OpenAi => {
            let api_key = settings.providers.openai.api_key;
            if api_key.is_empty() {
                return Err(AppError::Invalid("no OpenAI API key configured".into()));
            }
            Ok(TranscriptionConfig::OpenAi(OpenAiTranscriptionConfig {
                model: selection.model.clone(),
                model_ref: selection.model_ref(),
                api_key,
                base_url: settings.providers.openai.base_url,
                normalize,
            }))
        }
        LlmProvider::Anthropic | LlmProvider::Ollama => Err(AppError::Invalid(format!(
            "transcription is not supported for provider {}",
            selection.provider.as_str()
        ))),
    }
}

fn record_failed_transcription_start(
    app: &tauri::AppHandle,
    interview_id: i64,
    message: &str,
) -> AppResult<()> {
    let conn = project_conn(app)?;
    let selection = transcription_selection(app)?;
    let project_settings = project_meta::read_settings(&conn)?;
    let prompt = project_settings
        .prompts
        .transcription_user
        .unwrap_or_else(|| prompts::PROMPT_TEMPLATE.to_string());
    let input_json = serde_json::json!({
        "provider": selection.provider.as_str(),
        "model": selection.model,
        "mode": "failed_before_start"
    })
    .to_string();
    let run_id = ai_run::start(
        &conn,
        AiRunKind::Transcribe,
        Some(interview_id),
        &selection.model_ref(),
        &prompt,
        Some(&input_json),
    )?;
    ai_run::fail(&conn, run_id, message, None)
}

pub fn start_transcription_run(app: tauri::AppHandle, interview_id: i64) -> AppResult<()> {
    if app.state::<AppState>().has_run_for_interview(interview_id) {
        return Err(AppError::Conflict(format!(
            "transcription already running for interview {interview_id}"
        )));
    }

    let config = match build_config(&app) {
        Ok(config) => config,
        Err(AppError::Invalid(message)) => {
            let _ = record_failed_transcription_start(&app, interview_id, &message);
            return Ok(());
        }
        Err(error) => return Err(error),
    };
    let token = CancellationToken::new();
    app.state::<AppState>()
        .register_run_for_interview(interview_id, token.clone());

    let app_handle = app.clone();
    let app_cleanup = app.clone();
    tauri::async_runtime::spawn(async move {
        let _ = match config {
            TranscriptionConfig::Gemini(config) => {
                run_pipeline(app_handle, interview_id, token, config).await
            }
            TranscriptionConfig::OpenAi(config) => {
                run_openai_transcription(app_handle, interview_id, token, config).await
            }
        };
        app_cleanup
            .state::<AppState>()
            .deregister_run_for_interview(interview_id);
    });

    Ok(())
}

async fn run_openai_transcription(
    app: tauri::AppHandle,
    interview_id: i64,
    cancel: CancellationToken,
    config: OpenAiTranscriptionConfig,
) -> AppResult<()> {
    let state = app.state::<AppState>();
    let project_dir = state.current_project()?;
    let sqlite_path = project_dir.join("project.sqlite");
    let mut conn = db::open(&sqlite_path)?;
    let iv = interview::get(&conn, interview_id)?;
    let audio_rel = iv
        .audio_path
        .clone()
        .ok_or_else(|| AppError::Invalid("no audio attached".into()))?;
    let audio_path = project_dir.join(&audio_rel);
    if !audio_path.exists() {
        return Err(AppError::NotFound(format!(
            "audio: {}",
            audio_path.display()
        )));
    }

    let cache_dir = project_dir
        .join("cache")
        .join(format!("interview_{interview_id}"));
    let normalized_path = cache_dir.join("normalized.mp3");
    std::fs::create_dir_all(&cache_dir)?;

    let transcription_input_json = serde_json::json!({
        "provider": "openai",
        "mode": "single_file_diarized_transcription",
        "model": config.model.clone(),
    })
    .to_string();
    let run_id = ai_run::start(
        &conn,
        AiRunKind::Transcribe,
        Some(interview_id),
        &config.model_ref,
        prompts::PROMPT_TEMPLATE,
        Some(&transcription_input_json),
    )?;
    ai_run_ops::create_transcription_stages(&conn, run_id)?;
    interview::set_status(&conn, interview_id, TranscriptStatus::InProgress)?;
    emit(
        &app,
        &TranscriptionProgress::Starting {
            interview_id,
            run_id,
        },
    );

    let fail = |conn: &rusqlite::Connection,
                app: &tauri::AppHandle,
                stage_key: AiRunStageKey,
                msg: String| {
        let _ = ai_run_ops::mark_stage_failed(conn, run_id, stage_key, &msg);
        let _ = ai_run_ops::mark_pending_stages_cancelled_from(conn, run_id, stage_key);
        let _ = ai_run::fail(conn, run_id, &msg, None);
        let _ = interview::set_status(conn, interview_id, TranscriptStatus::Failed);
        emit(
            app,
            &TranscriptionProgress::Failed {
                interview_id,
                run_id,
                message: msg,
            },
        );
    };

    let cancel_run = |conn: &rusqlite::Connection,
                      app: &tauri::AppHandle,
                      stage_key: AiRunStageKey| {
        let _ = ai_run_ops::mark_pending_tasks_cancelled(conn, run_id, AiRunStageKey::EncodeChunks);
        let _ =
            ai_run_ops::mark_pending_tasks_cancelled(conn, run_id, AiRunStageKey::TranscribeChunks);
        let _ = ai_run_ops::mark_pending_stages_cancelled_from(conn, run_id, stage_key);
        let _ = ai_run::cancel(conn, run_id);
        let _ = interview::set_status(conn, interview_id, TranscriptStatus::Failed);
        emit(
            app,
            &TranscriptionProgress::Cancelled {
                interview_id,
                run_id,
            },
        );
    };

    ai_run_ops::mark_stage_running(&conn, run_id, AiRunStageKey::AnalyzeSource)?;
    emit(
        &app,
        &TranscriptionProgress::AnalyzingSource {
            interview_id,
            run_id,
        },
    );
    if let Err(e) = ffmpeg::normalize(&app, &audio_path, &normalized_path, &config.normalize).await
    {
        fail(
            &conn,
            &app,
            AiRunStageKey::AnalyzeSource,
            format!("normalize: {e}"),
        );
        return Err(e);
    }
    if cancel.is_cancelled() {
        cancel_run(&conn, &app, AiRunStageKey::AnalyzeSource);
        return Ok(());
    }
    ai_run_ops::set_stage_counts(
        &conn,
        run_id,
        AiRunStageKey::AnalyzeSource,
        Some(1),
        Some(1),
        Some(0),
    )?;
    ai_run_ops::mark_stage_complete(&conn, run_id, AiRunStageKey::AnalyzeSource)?;

    ai_run_ops::mark_stage_running(&conn, run_id, AiRunStageKey::PrepareChunks)?;
    ai_run_ops::set_stage_counts(
        &conn,
        run_id,
        AiRunStageKey::PrepareChunks,
        Some(1),
        Some(1),
        Some(0),
    )?;
    emit(
        &app,
        &TranscriptionProgress::PreparingChunks {
            interview_id,
            run_id,
            total_chunks: 1,
        },
    );
    ai_run_ops::mark_stage_complete(&conn, run_id, AiRunStageKey::PrepareChunks)?;

    ai_run_ops::mark_stage_running(&conn, run_id, AiRunStageKey::EncodeChunks)?;
    ai_run_ops::create_chunk_tasks(
        &conn,
        run_id,
        AiRunStageKey::EncodeChunks,
        AiRunTaskKind::EncodeChunk,
        1,
        1,
    )?;
    ai_run_ops::set_stage_counts(
        &conn,
        run_id,
        AiRunStageKey::EncodeChunks,
        Some(1),
        Some(0),
        Some(0),
    )?;
    emit(
        &app,
        &TranscriptionProgress::EncodingChunk {
            interview_id,
            run_id,
            index: 1,
            total: 1,
        },
    );
    ai_run_ops::mark_task_complete(&conn, run_id, AiRunStageKey::EncodeChunks, 0, 1, 1)?;
    ai_run_ops::set_stage_counts(
        &conn,
        run_id,
        AiRunStageKey::EncodeChunks,
        Some(1),
        Some(1),
        Some(0),
    )?;
    ai_run_ops::mark_stage_complete(&conn, run_id, AiRunStageKey::EncodeChunks)?;

    if cancel.is_cancelled() {
        cancel_run(&conn, &app, AiRunStageKey::TranscribeChunks);
        return Ok(());
    }

    ai_run_ops::mark_stage_running(&conn, run_id, AiRunStageKey::TranscribeChunks)?;
    ai_run_ops::create_chunk_tasks(
        &conn,
        run_id,
        AiRunStageKey::TranscribeChunks,
        AiRunTaskKind::TranscribeChunk,
        1,
        1,
    )?;
    ai_run_ops::set_stage_counts(
        &conn,
        run_id,
        AiRunStageKey::TranscribeChunks,
        Some(1),
        Some(0),
        Some(0),
    )?;
    emit(
        &app,
        &TranscriptionProgress::TranscribingChunk {
            interview_id,
            run_id,
            index: 1,
            total: 1,
            attempt: 1,
        },
    );

    let segments = match openai::transcribe_file(
        &config.api_key,
        &config.base_url,
        &config.model,
        &normalized_path,
    )
    .await
    {
        Ok(segments) => segments,
        Err(e) => {
            let _ = ai_run_ops::mark_task_failed(
                &conn,
                run_id,
                AiRunStageKey::TranscribeChunks,
                0,
                1,
                1,
                &e.to_string(),
            );
            fail(
                &conn,
                &app,
                AiRunStageKey::TranscribeChunks,
                format!("transcribe: {e}"),
            );
            return Err(e);
        }
    };

    persist_segments(&mut conn, interview_id, &segments)?;
    ai_run_ops::mark_task_complete(&conn, run_id, AiRunStageKey::TranscribeChunks, 0, 1, 1)?;
    ai_run_ops::set_stage_counts(
        &conn,
        run_id,
        AiRunStageKey::TranscribeChunks,
        Some(1),
        Some(1),
        Some(0),
    )?;
    ai_run_ops::mark_stage_complete(&conn, run_id, AiRunStageKey::TranscribeChunks)?;

    ai_run_ops::mark_stage_running(&conn, run_id, AiRunStageKey::ComposeTranscript)?;
    ai_run_ops::set_stage_counts(
        &conn,
        run_id,
        AiRunStageKey::ComposeTranscript,
        Some(1),
        Some(1),
        Some(0),
    )?;
    emit(
        &app,
        &TranscriptionProgress::ComposingTranscript {
            interview_id,
            run_id,
            completed_chunks: 1,
            total_chunks: 1,
        },
    );
    ai_run_ops::mark_stage_complete(&conn, run_id, AiRunStageKey::ComposeTranscript)?;

    ai_run_ops::mark_stage_running(&conn, run_id, AiRunStageKey::Finalize)?;
    ai_run_ops::set_stage_counts(
        &conn,
        run_id,
        AiRunStageKey::Finalize,
        Some(1),
        Some(0),
        Some(0),
    )?;
    interview::set_status(&conn, interview_id, TranscriptStatus::Complete)?;
    ai_run::complete(
        &conn,
        run_id,
        None,
        Some(&format!("1/1 chunks, {} segments", segments.len())),
        None,
    )?;
    ai_run_ops::set_stage_counts(
        &conn,
        run_id,
        AiRunStageKey::Finalize,
        Some(1),
        Some(1),
        Some(0),
    )?;
    ai_run_ops::mark_stage_complete(&conn, run_id, AiRunStageKey::Finalize)?;
    emit(
        &app,
        &TranscriptionProgress::Complete {
            interview_id,
            run_id,
            total_segments: segments.len(),
        },
    );

    Ok(())
}

fn persist_segments(
    conn: &mut rusqlite::Connection,
    interview_id: i64,
    segments_in: &[ParsedSegment],
) -> AppResult<()> {
    let new_segments: Vec<segment::NewSegment> = segments_in
        .iter()
        .map(|item| {
            let speaker = speaker::create_or_get(conn, interview_id, &item.speaker, None, None)?;
            Ok(segment::NewSegment {
                speaker_id: Some(speaker.id),
                start_sec: item.start,
                end_sec: item.end,
                text: item.text.clone(),
            })
        })
        .collect::<AppResult<Vec<_>>>()?;
    segment::insert_batch(conn, interview_id, &new_segments)?;
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
