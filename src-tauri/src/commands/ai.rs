use crate::ai::cost::{self, CostEstimate};
use crate::ai::{codebook_gen, find_more, pretag, SpanSuggestion, SpanSuggestions};
use crate::app_state::AppState;
use crate::commands::transcribe::start_transcription_run;
use crate::commands::util::project_conn;
use crate::db::queries::ai_run;
use crate::db::queries::ai_run_ops;
use crate::db::queries::interview;
use crate::db::queries::proposal::{self, ProposalKind, ProposalStatus};
use crate::db::queries::span_tag::SpanTagSource;
use crate::db::queries::{category, cluster, segment, span_tag, tag, tagged_span};
use crate::error::{AppError, AppResult};
use crate::secrets::resolve_gemini_api_key;
use crate::settings::project::ProjectSettings;
use crate::settings::{resolve_definitive_language, SettingsStore};
use crate::transcription::gemini::GeminiClient;
use crate::transcription::pipeline::PipelineConfig;
use crate::transcription::prompts;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::Manager;

const DEFAULT_MODEL: &str = "gemini-3-flash-preview";

fn make_client_from_settings(app: &tauri::AppHandle) -> AppResult<(GeminiClient, String)> {
    let store = SettingsStore::new(app.path().app_config_dir()?);
    let api_key = resolve_gemini_api_key(app, &store)?;
    if api_key.is_empty() {
        return Err(AppError::Invalid("no Gemini API key configured".into()));
    }
    let settings = store.load()?;
    let model = if settings.default_ai_model.trim().is_empty() {
        DEFAULT_MODEL.to_string()
    } else {
        settings.default_ai_model
    };
    Ok((GeminiClient::new(api_key), model))
}

fn effective_project_settings(
    app: &tauri::AppHandle,
    conn: &rusqlite::Connection,
) -> AppResult<ProjectSettings> {
    let mut settings = crate::db::queries::project_meta::read_settings(conn)?;
    if settings.language.is_none() {
        let global = SettingsStore::new(app.path().app_config_dir()?).load()?;
        settings.language = Some(resolve_definitive_language(global.ui_language.as_deref()));
    }
    Ok(settings)
}

#[tauri::command]
pub async fn ai_codebook_gen_start(
    app: tauri::AppHandle,
    interview_ids: Vec<i64>,
    include_existing_codebook: bool,
) -> AppResult<i64> {
    let (client, model) = make_client_from_settings(&app)?;
    let input = codebook_gen::CodebookGenInput {
        interview_ids,
        include_existing_codebook,
    };
    let (run_id, url, body) = {
        let conn = project_conn(&app)?;
        let project_settings = effective_project_settings(&app, &conn)?;
        codebook_gen::prepare(
            &conn,
            &input,
            &client,
            &model,
            project_settings.prompts.codebook_gen.as_deref(),
            project_settings.language.as_deref().unwrap_or("English"),
        )?
    };
    let api_result = client.post_generate(&url, &body).await;
    let conn = project_conn(&app)?;
    codebook_gen::finalize(&conn, run_id, api_result)?;
    Ok(run_id)
}

#[tauri::command]
pub async fn ai_pretag_start(app: tauri::AppHandle, interview_id: i64) -> AppResult<i64> {
    let (client, model) = make_client_from_settings(&app)?;
    let input = pretag::PretagInput { interview_id };
    let (run_id, url, body) = {
        let conn = project_conn(&app)?;
        let project_settings = effective_project_settings(&app, &conn)?;
        pretag::prepare(
            &conn,
            &input,
            &client,
            &model,
            project_settings.prompts.pretag.as_deref(),
            project_settings.language.as_deref().unwrap_or("English"),
        )?
    };
    let api_result = client.post_generate(&url, &body).await;
    let conn = project_conn(&app)?;
    pretag::finalize(&conn, run_id, interview_id, api_result)?;
    Ok(run_id)
}

#[tauri::command]
pub async fn ai_find_more_start(
    app: tauri::AppHandle,
    tag_id: i64,
    interview_id: i64,
) -> AppResult<i64> {
    let (client, model) = make_client_from_settings(&app)?;
    let input = find_more::FindMoreInput {
        tag_id,
        interview_id,
    };
    let (run_id, url, body) = {
        let conn = project_conn(&app)?;
        let project_settings = effective_project_settings(&app, &conn)?;
        find_more::prepare(
            &conn,
            &input,
            &client,
            &model,
            project_settings.prompts.find_more.as_deref(),
            project_settings.language.as_deref().unwrap_or("English"),
        )?
    };
    let api_result = client.post_generate(&url, &body).await;
    let conn = project_conn(&app)?;
    find_more::finalize(&conn, run_id, &input, api_result)?;
    Ok(run_id)
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProposalDTO {
    pub id: i64,
    pub ai_run_id: i64,
    pub kind: String,
    pub payload: Value,
    pub status: String,
    pub created_at: String,
    pub decided_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiRunStageDTO {
    pub id: i64,
    pub ai_run_id: i64,
    pub key: String,
    pub order: i64,
    pub status: String,
    pub total_count: Option<i64>,
    pub completed_count: Option<i64>,
    pub failed_count: Option<i64>,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiRunTaskDTO {
    pub id: i64,
    pub ai_run_stage_id: i64,
    pub ai_run_id: i64,
    pub kind: String,
    pub chunk_index: i64,
    pub status: String,
    pub attempt: i64,
    pub max_attempts: i64,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiRunDTO {
    pub id: i64,
    pub kind: String,
    pub interview_id: Option<i64>,
    pub model: String,
    pub prompt: String,
    pub input_json: Option<String>,
    pub started_at: String,
    pub completed_at: Option<String>,
    pub status: String,
    pub error: Option<String>,
    pub token_usage_json: Option<String>,
    pub result_summary: Option<String>,
    pub raw_output: Option<String>,
    pub stages: Vec<AiRunStageDTO>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiRunDetailDTO {
    #[serde(flatten)]
    pub run: AiRunDTO,
    pub tasks: Vec<AiRunTaskDTO>,
}

fn ai_run_stage_to_dto(stage: ai_run_ops::AiRunStage) -> AiRunStageDTO {
    AiRunStageDTO {
        id: stage.id,
        ai_run_id: stage.ai_run_id,
        key: stage.stage_key.as_str().to_string(),
        order: stage.order_index,
        status: stage.status.as_str().to_string(),
        total_count: stage.total_count,
        completed_count: stage.completed_count,
        failed_count: stage.failed_count,
        started_at: stage.started_at,
        completed_at: stage.completed_at,
        error: stage.error,
    }
}

fn ai_run_task_to_dto(task: ai_run_ops::AiRunTask) -> AiRunTaskDTO {
    AiRunTaskDTO {
        id: task.id,
        ai_run_stage_id: task.ai_run_stage_id,
        ai_run_id: task.ai_run_id,
        kind: task.kind.as_str().to_string(),
        chunk_index: task.chunk_index,
        status: task.status.as_str().to_string(),
        attempt: task.attempt,
        max_attempts: task.max_attempts,
        started_at: task.started_at,
        completed_at: task.completed_at,
        error: task.error,
    }
}

fn ai_run_to_dto(conn: &rusqlite::Connection, run: ai_run::AiRun) -> AiRunDTO {
    let stages = ai_run_ops::list_stages(conn, run.id)
        .unwrap_or_default()
        .into_iter()
        .map(ai_run_stage_to_dto)
        .collect();
    AiRunDTO {
        id: run.id,
        kind: run.kind.as_str().to_string(),
        interview_id: run.interview_id,
        model: run.model,
        prompt: run.prompt,
        input_json: run.input_json,
        started_at: run.started_at,
        completed_at: run.completed_at,
        status: run.status.as_str().to_string(),
        error: run.error,
        token_usage_json: run.token_usage_json,
        result_summary: run.result_summary,
        raw_output: run.raw_output,
        stages,
    }
}

#[tauri::command]
pub async fn ai_run_list(app: tauri::AppHandle) -> AppResult<Vec<AiRunDTO>> {
    let conn = project_conn(&app)?;
    Ok(ai_run::list_all(&conn)?
        .into_iter()
        .map(|run| ai_run_to_dto(&conn, run))
        .collect())
}

#[tauri::command]
pub async fn ai_run_get(app: tauri::AppHandle, run_id: i64) -> AppResult<AiRunDTO> {
    let conn = project_conn(&app)?;
    Ok(ai_run_to_dto(&conn, ai_run::get(&conn, run_id)?))
}

#[tauri::command]
pub async fn ai_run_detail(app: tauri::AppHandle, run_id: i64) -> AppResult<AiRunDetailDTO> {
    let conn = project_conn(&app)?;
    let run = ai_run::get(&conn, run_id)?;
    let tasks = ai_run_ops::list_tasks(&conn, run_id)?
        .into_iter()
        .map(ai_run_task_to_dto)
        .collect();
    Ok(AiRunDetailDTO {
        run: ai_run_to_dto(&conn, run),
        tasks,
    })
}

#[tauri::command]
pub async fn ai_run_retry(app: tauri::AppHandle, run_id: i64) -> AppResult<()> {
    let conn = project_conn(&app)?;
    let run = ai_run::get(&conn, run_id)?;
    if run.kind != ai_run::AiRunKind::Transcribe {
        return Err(AppError::Invalid(
            "retry is only implemented for transcription runs".into(),
        ));
    }
    if !matches!(
        run.status,
        ai_run::AiRunStatus::Failed | ai_run::AiRunStatus::Cancelled
    ) {
        return Err(AppError::Invalid(
            "only failed or cancelled runs can be retried".into(),
        ));
    }
    let interview_id = run
        .interview_id
        .ok_or_else(|| AppError::Invalid("transcription run is missing interview id".into()))?;
    drop(conn);
    start_transcription_run(app, interview_id)
}

#[tauri::command]
pub async fn ai_proposal_get(app: tauri::AppHandle, proposal_id: i64) -> AppResult<ProposalDTO> {
    let conn = project_conn(&app)?;
    let p = proposal::get(&conn, proposal_id)?;
    Ok(ProposalDTO {
        id: p.id,
        ai_run_id: p.ai_run_id,
        kind: p.kind.as_str().to_string(),
        payload: p.payload,
        status: p.status.as_str().to_string(),
        created_at: p.created_at,
        decided_at: p.decided_at,
    })
}

#[tauri::command]
pub async fn ai_proposal_list(
    app: tauri::AppHandle,
    statuses: Option<Vec<String>>,
    ai_run_id: Option<i64>,
) -> AppResult<Vec<ProposalDTO>> {
    let conn = project_conn(&app)?;
    let parsed_statuses = match statuses {
        Some(statuses) if !statuses.is_empty() => statuses
            .into_iter()
            .map(|status| ProposalStatus::parse(&status))
            .collect::<AppResult<Vec<_>>>()?,
        _ => vec![
            ProposalStatus::Pending,
            ProposalStatus::Accepted,
            ProposalStatus::Rejected,
        ],
    };
    let list = match ai_run_id {
        Some(ai_run_id) => proposal::list_for_run(&conn, ai_run_id, None, &parsed_statuses)?,
        None => proposal::list(&conn, None, &parsed_statuses)?,
    };
    Ok(list
        .into_iter()
        .map(|p| ProposalDTO {
            id: p.id,
            ai_run_id: p.ai_run_id,
            kind: p.kind.as_str().to_string(),
            payload: p.payload,
            status: p.status.as_str().to_string(),
            created_at: p.created_at,
            decided_at: p.decided_at,
        })
        .collect())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AcceptResult {
    pub created_count: usize,
    pub skipped: Vec<String>,
}

#[tauri::command]
pub async fn ai_proposal_reject(app: tauri::AppHandle, proposal_id: i64) -> AppResult<()> {
    let conn = project_conn(&app)?;
    proposal::mark_rejected(&conn, proposal_id)
}

#[tauri::command]
pub async fn ai_proposal_accept(
    app: tauri::AppHandle,
    proposal_id: i64,
    selection: Value,
) -> AppResult<AcceptResult> {
    let conn = project_conn(&app)?;
    let p = proposal::get(&conn, proposal_id)?;
    let mut created = 0usize;
    let mut skipped: Vec<String> = Vec::new();
    match p.kind {
        ProposalKind::CodebookGen => {
            if let Some(tags) = selection.get("tags").and_then(|v| v.as_array()) {
                for tg in tags {
                    if !tg.get("accept").and_then(|v| v.as_bool()).unwrap_or(false) {
                        continue;
                    }
                    let tg_name = tg.get("name").and_then(|v| v.as_str()).unwrap_or("");
                    match tag::create(
                        &conn,
                        None,
                        tg_name,
                        tg.get("description").and_then(|v| v.as_str()),
                        None,
                    ) {
                        Ok(_) => created += 1,
                        Err(AppError::Conflict(_)) => {
                            skipped.push(format!("tag '{tg_name}' (exists)"))
                        }
                        Err(e) => return Err(e),
                    }
                }
            } else if let Some(clusters) = selection.get("clusters").and_then(|v| v.as_array()) {
                for cl in clusters {
                    if !cl.get("accept").and_then(|v| v.as_bool()).unwrap_or(false) {
                        continue;
                    }
                    let cl_name = cl.get("name").and_then(|v| v.as_str()).unwrap_or("");
                    let cl_id = match cluster::create(
                        &conn,
                        cl_name,
                        cl.get("description").and_then(|v| v.as_str()),
                        None,
                    ) {
                        Ok(c) => c.id,
                        Err(AppError::Conflict(_)) => {
                            skipped.push(format!("cluster '{cl_name}' (exists)"));
                            continue;
                        }
                        Err(e) => return Err(e),
                    };
                    created += 1;
                    if let Some(cats) = cl.get("categories").and_then(|v| v.as_array()) {
                        for cat in cats {
                            if !cat.get("accept").and_then(|v| v.as_bool()).unwrap_or(false) {
                                continue;
                            }
                            let cat_name = cat.get("name").and_then(|v| v.as_str()).unwrap_or("");
                            let cat_id = match category::create(
                                &conn,
                                Some(cl_id),
                                cat_name,
                                cat.get("description").and_then(|v| v.as_str()),
                                None,
                            ) {
                                Ok(c) => c.id,
                                Err(AppError::Conflict(_)) => {
                                    skipped.push(format!("category '{cat_name}' (exists)"));
                                    continue;
                                }
                                Err(e) => return Err(e),
                            };
                            created += 1;
                            if let Some(tags) = cat.get("tags").and_then(|v| v.as_array()) {
                                for tg in tags {
                                    if !tg.get("accept").and_then(|v| v.as_bool()).unwrap_or(false)
                                    {
                                        continue;
                                    }
                                    let tg_name =
                                        tg.get("name").and_then(|v| v.as_str()).unwrap_or("");
                                    match tag::create(
                                        &conn,
                                        Some(cat_id),
                                        tg_name,
                                        tg.get("description").and_then(|v| v.as_str()),
                                        None,
                                    ) {
                                        Ok(_) => created += 1,
                                        Err(AppError::Conflict(_)) => {
                                            skipped.push(format!("tag '{tg_name}' (exists)"))
                                        }
                                        Err(e) => return Err(e),
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        ProposalKind::Pretag | ProposalKind::FindMore => {
            let indices: Vec<usize> = selection
                .get("span_indices")
                .and_then(|v| v.as_array())
                .map(|a| {
                    a.iter()
                        .filter_map(|x| x.as_u64().map(|n| n as usize))
                        .collect()
                })
                .unwrap_or_default();
            let suggestions: Vec<SpanSuggestion> =
                serde_json::from_value::<SpanSuggestions>(p.payload.clone())
                    .map_err(|e| AppError::Invalid(format!("payload parse: {e}")))?
                    .suggestions;
            for &idx in &indices {
                let s = match suggestions.get(idx) {
                    Some(x) => x,
                    None => {
                        skipped.push(format!("index {idx} out of range"));
                        continue;
                    }
                };
                let mut tag_ids = Vec::new();
                let mut had_unknown = false;
                let all_tags = tag::list_all(&conn)?;
                for name in &s.tag_names {
                    match all_tags.iter().find(|t| &t.name == name) {
                        Some(t) => tag_ids.push(t.id),
                        None => had_unknown = true,
                    }
                }
                if had_unknown && tag_ids.is_empty() {
                    skipped.push(format!("index {idx}: unknown tag"));
                    continue;
                }
                let seg = match segment::get(&conn, s.segment_id) {
                    Ok(seg) => seg,
                    Err(_) => {
                        skipped.push(format!("index {idx}: segment missing"));
                        continue;
                    }
                };
                let existing_spans = tagged_span::list_for_interview(&conn, seg.interview_id)?;
                if let Some(existing_span) = existing_spans.into_iter().find(|span| {
                    span.segment_id == s.segment_id
                        && span.start_offset == s.start_offset
                        && span.end_offset == s.end_offset
                }) {
                    let existing_tag_ids: std::collections::HashSet<i64> =
                        span_tag::list_for_span(&conn, existing_span.id)?
                            .into_iter()
                            .map(|st| st.0)
                            .collect();
                    let mut attached_any = false;
                    for tid in tag_ids {
                        if existing_tag_ids.contains(&tid) {
                            continue;
                        }
                        span_tag::attach(&conn, existing_span.id, tid, SpanTagSource::AiAccepted)?;
                        attached_any = true;
                    }
                    if attached_any {
                        created += 1;
                    } else {
                        skipped.push(format!(
                            "index {idx}: duplicate existing span/tag assignment"
                        ));
                    }
                    continue;
                }
                let text_len = seg.text.chars().count();
                let snapshot: String = seg
                    .text
                    .chars()
                    .skip(s.start_offset as usize)
                    .take((s.end_offset - s.start_offset) as usize)
                    .collect();
                let (a_start, a_end) = tagged_span::interpolate_audio_range(
                    seg.start_sec,
                    seg.end_sec,
                    text_len,
                    s.start_offset,
                    s.end_offset,
                );
                let span = tagged_span::create(
                    &conn,
                    &tagged_span::NewSpan {
                        interview_id: seg.interview_id,
                        segment_id: s.segment_id,
                        start_offset: s.start_offset,
                        end_offset: s.end_offset,
                        text_snapshot: &snapshot,
                        audio_start_sec: a_start,
                        audio_end_sec: a_end,
                    },
                )?;
                for tid in tag_ids {
                    span_tag::attach(&conn, span.id, tid, SpanTagSource::AiAccepted)?;
                }
                created += 1;
            }
        }
    }
    proposal::mark_accepted(&conn, proposal_id)?;
    Ok(AcceptResult {
        created_count: created,
        skipped,
    })
}

#[tauri::command]
pub async fn ai_cost_estimate(
    app: tauri::AppHandle,
    kind: String,
    args: Value,
) -> AppResult<CostEstimate> {
    let conn = project_conn(&app)?;
    let (_client, mut model) = make_client_from_settings(&app)?;
    let prompt = match kind.as_str() {
        "codebook_gen" => {
            let interview_ids: Vec<i64> = args
                .get("interview_ids")
                .and_then(|v| v.as_array())
                .map(|a| a.iter().filter_map(|x| x.as_i64()).collect())
                .unwrap_or_default();
            let include = args
                .get("include_existing_codebook")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let project_settings = effective_project_settings(&app, &conn)?;
            codebook_gen::build_prompt(
                &conn,
                &codebook_gen::CodebookGenInput {
                    interview_ids,
                    include_existing_codebook: include,
                },
                project_settings.prompts.codebook_gen.as_deref(),
                project_settings.language.as_deref().unwrap_or("English"),
            )?
        }
        "pretag" => {
            let iid = args
                .get("interview_id")
                .and_then(|v| v.as_i64())
                .unwrap_or(-1);
            let project_settings = effective_project_settings(&app, &conn)?;
            pretag::build_prompt(
                &conn,
                &pretag::PretagInput { interview_id: iid },
                project_settings.prompts.pretag.as_deref(),
                project_settings.language.as_deref().unwrap_or("English"),
            )?
        }
        "find_more" => {
            let tag_id = args.get("tag_id").and_then(|v| v.as_i64()).unwrap_or(-1);
            let iid = args
                .get("interview_id")
                .and_then(|v| v.as_i64())
                .unwrap_or(-1);
            let project_settings = effective_project_settings(&app, &conn)?;
            find_more::build_prompt(
                &conn,
                &find_more::FindMoreInput {
                    tag_id,
                    interview_id: iid,
                },
                project_settings.prompts.find_more.as_deref(),
                project_settings.language.as_deref().unwrap_or("English"),
            )?
        }
        "transcribe" => {
            let interview_id = args
                .get("interview_id")
                .and_then(|v| v.as_i64())
                .ok_or_else(|| AppError::Invalid("missing interview_id".into()))?;
            let settings = SettingsStore::new(app.path().app_config_dir()?).load()?;
            let project_settings = crate::db::queries::project_meta::read_settings(&conn)?;
            model = settings.default_transcription_model;
            let config = PipelineConfig {
                model: model.clone(),
                chunk_seconds: project_settings.transcription.chunk_seconds,
                normalize: crate::transcription::ffmpeg::NormalizeParams {
                    channels: project_settings.transcription.channels,
                    sample_rate: project_settings.transcription.sample_rate,
                    bitrate: project_settings.transcription.bitrate.clone(),
                },
                system_instruction: project_settings
                    .prompts
                    .transcription_system
                    .unwrap_or_else(|| prompts::SYSTEM_INSTRUCTION.to_string()),
                user_prompt: project_settings
                    .prompts
                    .transcription_user
                    .unwrap_or_else(|| prompts::PROMPT_TEMPLATE.to_string()),
                ..PipelineConfig::default()
            };
            let project_dir = app.state::<AppState>().current_project()?;
            let iv = interview::get(&conn, interview_id)?;
            let audio_rel = iv
                .audio_path
                .clone()
                .ok_or_else(|| AppError::Invalid("no audio attached".into()))?;
            let audio_path = project_dir.join(audio_rel);
            let audio_seconds =
                crate::transcription::ffmpeg::probe_duration(&app, &audio_path).await?;
            return Ok(cost::estimate_transcription(
                &model,
                &config.system_instruction,
                &config.user_prompt,
                prompts::RESPONSE_SCHEMA_JSON,
                audio_seconds,
                config.chunk_seconds,
                8192,
            ));
        }
        _ => return Err(AppError::Invalid(format!("unknown kind: {kind}"))),
    };
    Ok(cost::estimate(&model, &prompt, 8192))
}
