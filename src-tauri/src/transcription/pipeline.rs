use crate::db;
use crate::db::queries::ai_run::{self, AiRunKind};
use crate::db::queries::ai_run_ops::{self, AiRunNodeStatus, AiRunStageKey, AiRunTaskKind};
use crate::db::queries::interview::{self, TranscriptStatus};
use crate::db::queries::{segment as segment_q, speaker as speaker_q};
use crate::error::{AppError, AppResult};
use crate::transcription::{
    cache::ChunkCache,
    chunker, ffmpeg,
    gemini::GeminiClient,
    progress::{TranscriptionProgress, EVENT_NAME},
    prompts, retry,
    schema::ParsedSegment,
};
use serde_json::Value;
use tauri::Emitter;
use tokio_util::sync::CancellationToken;

#[derive(Debug, Clone)]
pub struct PipelineConfig {
    pub model: String,
    pub chunk_seconds: u32,
    pub max_output_tokens: u32,
    pub normalize: ffmpeg::NormalizeParams,
    pub api_key: String,
    pub system_instruction: String,
    pub user_prompt: String,
    pub response_schema: Value,
    pub gemini_base_url: String,
}

impl Default for PipelineConfig {
    fn default() -> Self {
        Self {
            model: "gemini-3-flash-preview".into(),
            chunk_seconds: chunker::CHUNK_SECONDS,
            max_output_tokens: 65536,
            normalize: ffmpeg::NormalizeParams::default(),
            api_key: String::new(),
            system_instruction: prompts::SYSTEM_INSTRUCTION.into(),
            user_prompt: prompts::PROMPT_TEMPLATE.into(),
            response_schema: serde_json::from_str(prompts::RESPONSE_SCHEMA_JSON)
                .unwrap_or(Value::Null),
            gemini_base_url: "https://generativelanguage.googleapis.com".into(),
        }
    }
}

fn emit(app: &tauri::AppHandle, p: &TranscriptionProgress) {
    let _ = app.emit(EVENT_NAME, p);
}

fn stage_progress_counts(
    conn: &rusqlite::Connection,
    run_id: i64,
    stage_key: AiRunStageKey,
) -> AppResult<(i64, i64)> {
    let tasks = ai_run_ops::list_tasks(conn, run_id)?;
    let relevant: Vec<_> = tasks
        .into_iter()
        .filter(|task| {
            matches!(
                (stage_key, task.kind),
                (AiRunStageKey::EncodeChunks, AiRunTaskKind::EncodeChunk)
                    | (
                        AiRunStageKey::TranscribeChunks,
                        AiRunTaskKind::TranscribeChunk
                    )
            )
        })
        .collect();
    let total = relevant.len() as i64;
    let complete = relevant
        .iter()
        .filter(|task| task.status == AiRunNodeStatus::Complete)
        .count() as i64;
    Ok((total, complete))
}

fn sync_stage_counts(
    conn: &rusqlite::Connection,
    run_id: i64,
    stage_key: AiRunStageKey,
) -> AppResult<()> {
    let (total, complete) = stage_progress_counts(conn, run_id, stage_key)?;
    ai_run_ops::set_stage_counts(
        conn,
        run_id,
        stage_key,
        Some(total),
        Some(complete),
        Some(0),
    )
}

pub async fn run_pipeline(
    app: tauri::AppHandle,
    interview_id: i64,
    cancel: CancellationToken,
    config: PipelineConfig,
) -> AppResult<()> {
    use tauri::Manager;
    let state = app.state::<crate::app_state::AppState>();
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
    let chunks_dir = cache_dir.join("chunks");
    let chunk_results_dir = cache_dir.join("chunk_results");
    std::fs::create_dir_all(&cache_dir)?;
    std::fs::create_dir_all(&chunks_dir)?;
    std::fs::create_dir_all(&chunk_results_dir)?;

    let cache = ChunkCache::new(chunk_results_dir.clone());

    let transcription_input_json = serde_json::json!({
        "provider": "gemini",
        "mode": "chunked_audio_transcription",
        "systemInstruction": {
            "role": "system",
            "parts": [{ "text": config.system_instruction }]
        },
        "userPromptTemplate": config.user_prompt,
        "responseSchema": config.response_schema,
        "chunkSeconds": config.chunk_seconds,
        "maxOutputTokens": config.max_output_tokens,
        "note": "Actual per-chunk user prompts are derived from this template and may include speaker-consistency context from earlier chunks."
    })
    .to_string();
    let run_id = ai_run::start(
        &conn,
        AiRunKind::Transcribe,
        Some(interview_id),
        &config.model,
        &config.user_prompt,
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

    if !normalized_path.exists() {
        if let Err(e) =
            ffmpeg::normalize(&app, &audio_path, &normalized_path, &config.normalize).await
        {
            fail(
                &conn,
                &app,
                AiRunStageKey::AnalyzeSource,
                format!("normalize: {e}"),
            );
            return Err(e);
        }
    }

    if cancel.is_cancelled() {
        cancel_run(&conn, &app, AiRunStageKey::AnalyzeSource);
        return Ok(());
    }

    let duration = match ffmpeg::probe_duration(&app, &normalized_path).await {
        Ok(value) => value,
        Err(e) => {
            fail(
                &conn,
                &app,
                AiRunStageKey::AnalyzeSource,
                format!("probe: {e}"),
            );
            return Err(e);
        }
    };
    let plans = chunker::plan_chunks(duration, config.chunk_seconds);
    let total = plans.len();
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
    emit(
        &app,
        &TranscriptionProgress::PreparingChunks {
            interview_id,
            run_id,
            total_chunks: total,
        },
    );
    ai_run_ops::create_chunk_tasks(
        &conn,
        run_id,
        AiRunStageKey::EncodeChunks,
        AiRunTaskKind::EncodeChunk,
        total,
        1,
    )?;
    ai_run_ops::create_chunk_tasks(
        &conn,
        run_id,
        AiRunStageKey::TranscribeChunks,
        AiRunTaskKind::TranscribeChunk,
        total,
        retry::MAX_RETRY_ATTEMPTS,
    )?;
    ai_run_ops::set_stage_counts(
        &conn,
        run_id,
        AiRunStageKey::PrepareChunks,
        Some(total as i64),
        Some(total as i64),
        Some(0),
    )?;
    ai_run_ops::set_stage_counts(
        &conn,
        run_id,
        AiRunStageKey::EncodeChunks,
        Some(total as i64),
        Some(0),
        Some(0),
    )?;
    ai_run_ops::set_stage_counts(
        &conn,
        run_id,
        AiRunStageKey::TranscribeChunks,
        Some(total as i64),
        Some(0),
        Some(0),
    )?;
    ai_run_ops::mark_stage_complete(&conn, run_id, AiRunStageKey::PrepareChunks)?;

    ai_run_ops::mark_stage_running(&conn, run_id, AiRunStageKey::EncodeChunks)?;
    for plan in &plans {
        if cancel.is_cancelled() {
            cancel_run(&conn, &app, AiRunStageKey::EncodeChunks);
            return Ok(());
        }

        let chunk_path = chunks_dir.join(format!("chunk_{:03}.mp3", plan.index));
        if chunk_path.exists() {
            ai_run_ops::mark_task_complete(
                &conn,
                run_id,
                AiRunStageKey::EncodeChunks,
                plan.index,
                1,
                1,
            )?;
            sync_stage_counts(&conn, run_id, AiRunStageKey::EncodeChunks)?;
            continue;
        }

        emit(
            &app,
            &TranscriptionProgress::EncodingChunk {
                interview_id,
                run_id,
                index: plan.index,
                total,
            },
        );
        ai_run_ops::mark_task_running(
            &conn,
            run_id,
            AiRunStageKey::EncodeChunks,
            plan.index,
            1,
            1,
        )?;
        if let Err(e) = ffmpeg::extract_subchunk(
            &app,
            &normalized_path,
            &chunk_path,
            plan.offset_seconds,
            plan.duration_seconds,
            &config.normalize,
        )
        .await
        {
            ai_run_ops::mark_task_failed(
                &conn,
                run_id,
                AiRunStageKey::EncodeChunks,
                plan.index,
                1,
                1,
                &e.to_string(),
            )?;
            fail(
                &conn,
                &app,
                AiRunStageKey::EncodeChunks,
                format!("encode chunk {}: {e}", plan.index),
            );
            return Err(e);
        }
        ai_run_ops::mark_task_complete(
            &conn,
            run_id,
            AiRunStageKey::EncodeChunks,
            plan.index,
            1,
            1,
        )?;
        sync_stage_counts(&conn, run_id, AiRunStageKey::EncodeChunks)?;
    }
    ai_run_ops::mark_stage_complete(&conn, run_id, AiRunStageKey::EncodeChunks)?;

    ai_run_ops::mark_stage_running(&conn, run_id, AiRunStageKey::TranscribeChunks)?;
    let client =
        GeminiClient::with_base_url(config.api_key.clone(), config.gemini_base_url.clone());

    let mut prior_segments_for_context: Vec<ParsedSegment> = match cache.load_all() {
        Ok(segments) => segments,
        Err(e) => {
            fail(
                &conn,
                &app,
                AiRunStageKey::TranscribeChunks,
                format!("load cache: {e}"),
            );
            return Err(e);
        }
    };
    let mut total_segments = prior_segments_for_context.len();

    for plan in &plans {
        if cancel.is_cancelled() {
            cancel_run(&conn, &app, AiRunStageKey::TranscribeChunks);
            return Ok(());
        }

        if cache.exists(plan.index) {
            ai_run_ops::mark_task_complete(
                &conn,
                run_id,
                AiRunStageKey::TranscribeChunks,
                plan.index,
                1,
                retry::MAX_RETRY_ATTEMPTS,
            )?;
            sync_stage_counts(&conn, run_id, AiRunStageKey::TranscribeChunks)?;
            continue;
        }

        let chunk_path = chunks_dir.join(format!("chunk_{:03}.mp3", plan.index));
        if !chunk_path.exists() {
            let error = AppError::NotFound(chunk_path.to_string_lossy().to_string());
            ai_run_ops::mark_task_failed(
                &conn,
                run_id,
                AiRunStageKey::TranscribeChunks,
                plan.index,
                1,
                retry::MAX_RETRY_ATTEMPTS,
                &error.to_string(),
            )?;
            fail(
                &conn,
                &app,
                AiRunStageKey::TranscribeChunks,
                format!("missing chunk file: {}", chunk_path.display()),
            );
            return Err(error);
        }

        let mut attempt: u32 = 0;
        let segments_for_chunk = loop {
            attempt += 1;
            ai_run_ops::mark_task_running(
                &conn,
                run_id,
                AiRunStageKey::TranscribeChunks,
                plan.index,
                attempt,
                retry::MAX_RETRY_ATTEMPTS,
            )?;
            emit(
                &app,
                &TranscriptionProgress::TranscribingChunk {
                    interview_id,
                    run_id,
                    index: plan.index,
                    total,
                    attempt,
                },
            );

            let prompt = prompts::build_prompt(&prior_segments_for_context);
            let upload_result = client.upload_file(&chunk_path, "audio/mpeg").await;
            let uploaded = match upload_result {
                Ok(file) => file,
                Err(e) => {
                    if attempt < retry::MAX_RETRY_ATTEMPTS {
                        tokio::time::sleep(retry::delay_for_attempt(attempt)).await;
                        continue;
                    }
                    ai_run_ops::mark_task_failed(
                        &conn,
                        run_id,
                        AiRunStageKey::TranscribeChunks,
                        plan.index,
                        attempt,
                        retry::MAX_RETRY_ATTEMPTS,
                        &e.to_string(),
                    )?;
                    fail(
                        &conn,
                        &app,
                        AiRunStageKey::TranscribeChunks,
                        format!("upload chunk {}: {e}", plan.index),
                    );
                    return Err(e);
                }
            };

            let gen_result = client
                .generate_content(
                    &config.model,
                    &prompt,
                    &uploaded,
                    &config.system_instruction,
                    config.response_schema.clone(),
                    config.max_output_tokens,
                )
                .await;

            let _ = client.delete_file(&uploaded.name).await;

            match gen_result {
                Ok(resp) => {
                    if resp.finish_reason.as_deref() == Some("MAX_TOKENS") {
                        let error = AppError::Invalid("MAX_TOKENS".into());
                        ai_run_ops::mark_task_failed(
                            &conn,
                            run_id,
                            AiRunStageKey::TranscribeChunks,
                            plan.index,
                            attempt,
                            retry::MAX_RETRY_ATTEMPTS,
                            &error.to_string(),
                        )?;
                        fail(
                            &conn,
                            &app,
                            AiRunStageKey::TranscribeChunks,
                            format!(
                                "chunk {} hit MAX_TOKENS (sub-chunking not yet implemented)",
                                plan.index
                            ),
                        );
                        return Err(error);
                    }
                    match crate::transcription::schema::parse_response(
                        &resp.text,
                        plan.duration_seconds,
                    ) {
                        Ok(parsed) => break parsed,
                        Err(_) if attempt < retry::MAX_RETRY_ATTEMPTS => {
                            tokio::time::sleep(retry::delay_for_attempt(attempt)).await;
                            continue;
                        }
                        Err(e) => {
                            ai_run_ops::mark_task_failed(
                                &conn,
                                run_id,
                                AiRunStageKey::TranscribeChunks,
                                plan.index,
                                attempt,
                                retry::MAX_RETRY_ATTEMPTS,
                                &e.to_string(),
                            )?;
                            fail(
                                &conn,
                                &app,
                                AiRunStageKey::TranscribeChunks,
                                format!("parse chunk {}: {e}", plan.index),
                            );
                            return Err(e);
                        }
                    }
                }
                Err(e) => {
                    if attempt < retry::MAX_RETRY_ATTEMPTS {
                        tokio::time::sleep(retry::delay_for_attempt(attempt)).await;
                        continue;
                    }
                    ai_run_ops::mark_task_failed(
                        &conn,
                        run_id,
                        AiRunStageKey::TranscribeChunks,
                        plan.index,
                        attempt,
                        retry::MAX_RETRY_ATTEMPTS,
                        &e.to_string(),
                    )?;
                    fail(
                        &conn,
                        &app,
                        AiRunStageKey::TranscribeChunks,
                        format!("generate chunk {}: {e}", plan.index),
                    );
                    return Err(e);
                }
            }
        };

        cache.save(plan.index, &segments_for_chunk)?;

        let new_segments: Vec<segment_q::NewSegment> = {
            let mut out = Vec::with_capacity(segments_for_chunk.len());
            for segment in &segments_for_chunk {
                let speaker = speaker_q::create_or_get(
                    &conn,
                    interview_id,
                    &segment.speaker,
                    None,
                    None,
                )?;
                out.push(segment_q::NewSegment {
                    speaker_id: Some(speaker.id),
                    start_sec: segment.start + plan.offset_seconds,
                    end_sec: segment.end + plan.offset_seconds,
                    text: segment.text.clone(),
                });
            }
            out
        };
        segment_q::insert_batch(&mut conn, interview_id, &new_segments)?;

        prior_segments_for_context.extend(segments_for_chunk.iter().cloned().map(|mut segment| {
            segment.start += plan.offset_seconds;
            segment.end += plan.offset_seconds;
            segment
        }));
        total_segments += segments_for_chunk.len();

        ai_run_ops::mark_task_complete(
            &conn,
            run_id,
            AiRunStageKey::TranscribeChunks,
            plan.index,
            attempt,
            retry::MAX_RETRY_ATTEMPTS,
        )?;
        sync_stage_counts(&conn, run_id, AiRunStageKey::TranscribeChunks)?;
    }
    ai_run_ops::mark_stage_complete(&conn, run_id, AiRunStageKey::TranscribeChunks)?;

    let (total_chunks, completed_chunks) =
        stage_progress_counts(&conn, run_id, AiRunStageKey::TranscribeChunks)?;
    ai_run_ops::mark_stage_running(&conn, run_id, AiRunStageKey::ComposeTranscript)?;
    ai_run_ops::set_stage_counts(
        &conn,
        run_id,
        AiRunStageKey::ComposeTranscript,
        Some(1),
        Some(0),
        Some(0),
    )?;
    emit(
        &app,
        &TranscriptionProgress::ComposingTranscript {
            interview_id,
            run_id,
            completed_chunks: completed_chunks as usize,
            total_chunks: total_chunks as usize,
        },
    );
    ai_run_ops::set_stage_counts(
        &conn,
        run_id,
        AiRunStageKey::ComposeTranscript,
        Some(1),
        Some(1),
        Some(0),
    )?;
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
    ai_run_ops::set_stage_counts(
        &conn,
        run_id,
        AiRunStageKey::Finalize,
        Some(1),
        Some(1),
        Some(0),
    )?;
    ai_run_ops::mark_stage_complete(&conn, run_id, AiRunStageKey::Finalize)?;
    ai_run_ops::finalize_run_as_complete(&conn, run_id)?;
    sync_stage_counts(&conn, run_id, AiRunStageKey::EncodeChunks)?;
    sync_stage_counts(&conn, run_id, AiRunStageKey::TranscribeChunks)?;
    ai_run::complete(
        &conn,
        run_id,
        None,
        Some(&format!("{total_chunks}/{total_chunks} chunks, {total_segments} segments")),
        None,
    )?;
    emit(
        &app,
        &TranscriptionProgress::Complete {
            interview_id,
            run_id,
            total_segments,
        },
    );

    Ok(())
}
