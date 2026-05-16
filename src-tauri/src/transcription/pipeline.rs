use crate::db;
use crate::db::queries::ai_run::{self, AiRunKind};
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

    // Step 1: load interview + verify audio
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

    // Paths
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

    // Step 2: ai_run + status
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
    interview::set_status(&conn, interview_id, TranscriptStatus::InProgress)?;
    emit(
        &app,
        &TranscriptionProgress::Starting {
            interview_id,
            run_id,
        },
    );

    // Helper to fail and return early
    let fail = |conn: &rusqlite::Connection, app: &tauri::AppHandle, msg: String| {
        let _ = ai_run::fail(conn, run_id, &msg, None);
        let _ = interview::set_status(conn, interview_id, TranscriptStatus::Failed);
        emit(
            app,
            &TranscriptionProgress::Failed {
                interview_id,
                message: msg,
            },
        );
    };

    // Step 3: normalize
    emit(&app, &TranscriptionProgress::Normalizing { interview_id });
    if !normalized_path.exists() {
        if let Err(e) =
            ffmpeg::normalize(&app, &audio_path, &normalized_path, &config.normalize).await
        {
            fail(&conn, &app, format!("normalize: {e}"));
            return Err(e);
        }
    }

    // Cancellation check after each long step
    if cancel.is_cancelled() {
        let _ = ai_run::cancel(&conn, run_id);
        let _ = interview::set_status(&conn, interview_id, TranscriptStatus::Failed);
        emit(&app, &TranscriptionProgress::Cancelled { interview_id });
        return Ok(());
    }

    // Step 4: probe duration + plan chunks
    let duration = match ffmpeg::probe_duration(&app, &normalized_path).await {
        Ok(d) => d,
        Err(e) => {
            fail(&conn, &app, format!("probe: {e}"));
            return Err(e);
        }
    };
    let plans = chunker::plan_chunks(duration, config.chunk_seconds);
    let total = plans.len();
    emit(
        &app,
        &TranscriptionProgress::Chunking {
            interview_id,
            total_chunks: total,
        },
    );

    // Step 5: split into chunk files (only if not already split)
    let chunk_files_match =
        (0..total).all(|i| chunks_dir.join(format!("chunk_{i:03}.mp3")).exists());
    if !chunk_files_match {
        if let Err(e) =
            ffmpeg::split_into_chunks(&app, &normalized_path, &chunks_dir, config.chunk_seconds)
                .await
        {
            fail(&conn, &app, format!("split: {e}"));
            return Err(e);
        }
    }

    // Step 6: per-chunk transcribe
    let client =
        GeminiClient::with_base_url(config.api_key.clone(), config.gemini_base_url.clone());

    let mut prior_segments_for_context: Vec<ParsedSegment> = cache.load_all().unwrap_or_default();
    let mut total_segments = prior_segments_for_context.len();

    for plan in &plans {
        if cancel.is_cancelled() {
            let _ = ai_run::cancel(&conn, run_id);
            let _ = interview::set_status(&conn, interview_id, TranscriptStatus::Failed);
            emit(&app, &TranscriptionProgress::Cancelled { interview_id });
            return Ok(());
        }

        if cache.exists(plan.index) {
            // already done
            continue;
        }

        let chunk_path = chunks_dir.join(format!("chunk_{:03}.mp3", plan.index));
        if !chunk_path.exists() {
            fail(
                &conn,
                &app,
                format!("missing chunk file: {}", chunk_path.display()),
            );
            return Err(AppError::NotFound(chunk_path.to_string_lossy().to_string()));
        }

        let mut attempt: u32 = 0;
        let segments_for_chunk = loop {
            attempt += 1;
            emit(
                &app,
                &TranscriptionProgress::TranscribingChunk {
                    interview_id,
                    index: plan.index,
                    total,
                    attempt,
                },
            );

            let prompt = prompts::build_prompt(&prior_segments_for_context);

            // upload, generate, parse
            let upload_result = client.upload_file(&chunk_path, "audio/mpeg").await;
            let uploaded = match upload_result {
                Ok(f) => f,
                Err(e) => {
                    if attempt < retry::MAX_RETRY_ATTEMPTS {
                        tokio::time::sleep(retry::delay_for_attempt(attempt)).await;
                        continue;
                    }
                    fail(&conn, &app, format!("upload chunk {}: {e}", plan.index));
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

            // Cleanup uploaded file (best effort)
            let _ = client.delete_file(&uploaded.name).await;

            match gen_result {
                Ok(resp) => {
                    // Detect MAX_TOKENS
                    if resp.finish_reason.as_deref() == Some("MAX_TOKENS") {
                        // Fall back to sub-chunking. For simplicity in this initial implementation,
                        // we mark the run as failed if sub-chunking can't help.
                        // (Full recursive sub-chunking is a follow-up.)
                        fail(
                            &conn,
                            &app,
                            format!(
                                "chunk {} hit MAX_TOKENS (sub-chunking not yet implemented)",
                                plan.index
                            ),
                        );
                        return Err(AppError::Invalid("MAX_TOKENS".into()));
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
                            fail(&conn, &app, format!("parse chunk {}: {e}", plan.index));
                            return Err(e);
                        }
                    }
                }
                Err(e) => {
                    if attempt < retry::MAX_RETRY_ATTEMPTS {
                        tokio::time::sleep(retry::delay_for_attempt(attempt)).await;
                        continue;
                    }
                    fail(&conn, &app, format!("generate chunk {}: {e}", plan.index));
                    return Err(e);
                }
            }
        };

        // Persist to cache + DB
        cache.save(plan.index, &segments_for_chunk)?;

        // Insert into DB with offset applied
        let new_segments: Vec<segment_q::NewSegment> = {
            let mut out = Vec::with_capacity(segments_for_chunk.len());
            for s in &segments_for_chunk {
                let sp = speaker_q::create_or_get(&conn, interview_id, &s.speaker, None)?;
                out.push(segment_q::NewSegment {
                    speaker_id: Some(sp.id),
                    start_sec: s.start + plan.offset_seconds,
                    end_sec: s.end + plan.offset_seconds,
                    text: s.text.clone(),
                });
            }
            out
        };
        segment_q::insert_batch(&mut conn, interview_id, &new_segments)?;

        prior_segments_for_context.extend(segments_for_chunk.iter().cloned().map(|mut s| {
            s.start += plan.offset_seconds;
            s.end += plan.offset_seconds;
            s
        }));
        total_segments += segments_for_chunk.len();

        emit(
            &app,
            &TranscriptionProgress::ChunkComplete {
                interview_id,
                index: plan.index,
                segments_added: segments_for_chunk.len(),
            },
        );
    }

    // Step 7: complete
    interview::set_status(&conn, interview_id, TranscriptStatus::Complete)?;
    ai_run::complete(
        &conn,
        run_id,
        None,
        Some(&format!("{total_segments} segments")),
        None,
    )?;
    emit(
        &app,
        &TranscriptionProgress::Complete {
            interview_id,
            total_segments,
        },
    );

    Ok(())
}
