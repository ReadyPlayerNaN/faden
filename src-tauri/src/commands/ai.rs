use crate::ai::cost::{self, CostEstimate};
use crate::ai::{codebook_gen, find_more, pretag, SpanSuggestion, SpanSuggestions};
use crate::commands::util::project_conn;
use crate::db::queries::proposal::{self, ProposalKind};
use crate::db::queries::span_tag::SpanTagSource;
use crate::db::queries::{category, cluster, segment, span_tag, tag, tagged_span};
use crate::error::{AppError, AppResult};
use crate::settings::SettingsStore;
use crate::transcription::gemini::GeminiClient;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::Manager;

const DEFAULT_MODEL: &str = "gemini-3-flash-preview";

fn make_client_from_settings(app: &tauri::AppHandle) -> AppResult<(GeminiClient, String)> {
    let store = SettingsStore::new(app.path().app_config_dir()?);
    let s = store.load()?;
    if s.gemini_api_key.is_empty() {
        return Err(AppError::Invalid("no Gemini API key configured".into()));
    }
    Ok((
        GeminiClient::new(s.gemini_api_key.clone()),
        DEFAULT_MODEL.to_string(),
    ))
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
        codebook_gen::prepare(&conn, &input, &client, &model, None)?
    };
    let api_result = client.post_generate(&url, &body).await;
    let conn = project_conn(&app)?;
    codebook_gen::finalize(&conn, run_id, api_result)
}

#[tauri::command]
pub async fn ai_pretag_start(app: tauri::AppHandle, interview_id: i64) -> AppResult<i64> {
    let (client, model) = make_client_from_settings(&app)?;
    let input = pretag::PretagInput { interview_id };
    let (run_id, url, body) = {
        let conn = project_conn(&app)?;
        pretag::prepare(&conn, &input, &client, &model, None)?
    };
    let api_result = client.post_generate(&url, &body).await;
    let conn = project_conn(&app)?;
    pretag::finalize(&conn, run_id, interview_id, api_result)
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
        find_more::prepare(&conn, &input, &client, &model, None)?
    };
    let api_result = client.post_generate(&url, &body).await;
    let conn = project_conn(&app)?;
    find_more::finalize(&conn, run_id, &input, api_result)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ProposalDTO {
    pub id: i64,
    pub kind: String,
    pub payload: Value,
}

#[tauri::command]
pub async fn ai_proposal_get(app: tauri::AppHandle, proposal_id: i64) -> AppResult<ProposalDTO> {
    let conn = project_conn(&app)?;
    let p = proposal::get(&conn, proposal_id)?;
    Ok(ProposalDTO {
        id: p.id,
        kind: p.kind.as_str().to_string(),
        payload: p.payload,
    })
}

#[tauri::command]
pub async fn ai_proposal_list(app: tauri::AppHandle) -> AppResult<Vec<ProposalDTO>> {
    let conn = project_conn(&app)?;
    let list = proposal::list_pending(&conn, None)?;
    Ok(list
        .into_iter()
        .map(|p| ProposalDTO {
            id: p.id,
            kind: p.kind.as_str().to_string(),
            payload: p.payload,
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
            if let Some(clusters) = selection.get("clusters").and_then(|v| v.as_array()) {
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
                            let cat_name =
                                cat.get("name").and_then(|v| v.as_str()).unwrap_or("");
                            let cat_id = match category::create(
                                &conn,
                                cl_id,
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
    let (_client, model) = make_client_from_settings(&app)?;
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
            codebook_gen::build_prompt(
                &conn,
                &codebook_gen::CodebookGenInput {
                    interview_ids,
                    include_existing_codebook: include,
                },
                None,
            )?
        }
        "pretag" => {
            let iid = args.get("interview_id").and_then(|v| v.as_i64()).unwrap_or(-1);
            pretag::build_prompt(&conn, &pretag::PretagInput { interview_id: iid }, None)?
        }
        "find_more" => {
            let tag_id = args.get("tag_id").and_then(|v| v.as_i64()).unwrap_or(-1);
            let iid = args.get("interview_id").and_then(|v| v.as_i64()).unwrap_or(-1);
            find_more::build_prompt(
                &conn,
                &find_more::FindMoreInput {
                    tag_id,
                    interview_id: iid,
                },
                None,
            )?
        }
        _ => return Err(AppError::Invalid(format!("unknown kind: {kind}"))),
    };
    Ok(cost::estimate(&model, &prompt, 8192))
}
