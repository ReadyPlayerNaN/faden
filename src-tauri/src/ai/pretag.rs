use crate::ai::text;
use crate::ai::{prompts, SpanSuggestion, SpanSuggestions, SPAN_SUGGESTIONS_SCHEMA};
use crate::db::queries::ai_run::{self, AiRunKind};
use crate::db::queries::proposal::{self, ProposalKind};
use crate::db::queries::{segment, tag};
use crate::error::{AppError, AppResult};
use crate::transcription::gemini::GeminiClient;
use rusqlite::Connection;
use std::collections::{HashMap, HashSet};

pub struct PretagInput {
    pub interview_id: i64,
}

pub fn build_prompt(
    conn: &Connection,
    input: &PretagInput,
    override_template: Option<&str>,
) -> AppResult<String> {
    let template = override_template.unwrap_or(prompts::DEFAULT_PRETAG);
    let transcript = text::format_transcript(conn, input.interview_id)?;
    let codebook = text::format_codebook(conn)?;
    let available_tags = text::format_available_tags(conn)?;
    let existing_tagged_spans = text::format_existing_tagged_spans(conn, input.interview_id)?;
    let mut vars = HashMap::new();
    vars.insert("transcript", transcript);
    vars.insert("codebook", codebook);
    vars.insert("available_tags", available_tags);
    vars.insert("existing_tagged_spans", existing_tagged_spans);
    Ok(prompts::render(template, &vars))
}

fn build_request_body(prompt: &str) -> serde_json::Value {
    serde_json::json!({
        "contents": [{"role":"user","parts":[{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0,
            "responseMimeType": "application/json",
            "responseJsonSchema": serde_json::from_str::<serde_json::Value>(SPAN_SUGGESTIONS_SCHEMA).unwrap_or(serde_json::Value::Null),
            "maxOutputTokens": 16384
        }
    })
}

pub fn prepare(
    conn: &Connection,
    input: &PretagInput,
    client: &GeminiClient,
    model: &str,
    prompt_override: Option<&str>,
) -> AppResult<(i64, String, serde_json::Value)> {
    let prompt = build_prompt(conn, input, prompt_override)?;
    let url = client.text_generate_url(model);
    let body = build_request_body(&prompt);
    let input_json = serde_json::to_string(&body)?;
    let run_id = ai_run::start(
        conn,
        AiRunKind::Pretag,
        Some(input.interview_id),
        model,
        &prompt,
        Some(&input_json),
    )?;
    Ok((run_id, url, body))
}

pub fn finalize(
    conn: &Connection,
    run_id: i64,
    interview_id: i64,
    api_result: AppResult<String>,
) -> AppResult<Option<i64>> {
    let resp_text = match api_result {
        Ok(t) => t,
        Err(e) => {
            ai_run::fail(conn, run_id, &e.to_string(), None)?;
            return Err(e);
        }
    };

    let parsed: SpanSuggestions = match serde_json::from_str(&resp_text) {
        Ok(p) => p,
        Err(e) => {
            ai_run::fail(conn, run_id, &format!("parse: {e}"), Some(&resp_text))?;
            return Err(AppError::Invalid(format!("pretag parse: {e}")));
        }
    };

    let known_tags: HashSet<String> = tag::list_all(conn)?.into_iter().map(|t| t.name).collect();
    let mut valid_suggestions: Vec<SpanSuggestion> = Vec::new();
    let mut seen = HashSet::new();
    let mut skipped = 0_usize;
    for s in parsed.suggestions {
        let seg = match segment::get(conn, s.segment_id) {
            Ok(seg) if seg.interview_id == interview_id => seg,
            _ => {
                skipped += 1;
                continue;
            }
        };
        let text_len = seg.text.chars().count() as i32;
        if s.start_offset < 0 || s.end_offset <= s.start_offset || s.end_offset > text_len {
            skipped += 1;
            continue;
        }
        let tag_names: Vec<String> = s
            .tag_names
            .into_iter()
            .filter(|n| known_tags.contains(n))
            .collect();
        if tag_names.is_empty() {
            skipped += 1;
            continue;
        }
        let mut dedup_key_tags = tag_names.clone();
        dedup_key_tags.sort();
        let dedup_key = format!(
            "{}:{}:{}:{}",
            s.segment_id,
            s.start_offset,
            s.end_offset,
            dedup_key_tags.join("|")
        );
        if !seen.insert(dedup_key) {
            skipped += 1;
            continue;
        }
        valid_suggestions.push(SpanSuggestion {
            segment_id: s.segment_id,
            start_offset: s.start_offset,
            end_offset: s.end_offset,
            tag_names,
            rationale: s.rationale,
        });
    }

    let filtered = SpanSuggestions {
        suggestions: valid_suggestions,
    };
    if filtered.suggestions.is_empty() {
        ai_run::complete(
            conn,
            run_id,
            None,
            Some(&format!("No suggestions found ({} skipped)", skipped)),
            Some(&resp_text),
        )?;
        return Ok(None);
    }

    let pid = proposal::create(
        conn,
        run_id,
        ProposalKind::Pretag,
        &serde_json::to_value(&filtered)?,
    )?;
    ai_run::complete(
        conn,
        run_id,
        None,
        Some(&format!(
            "{} suggestions ({} skipped)",
            filtered.suggestions.len(),
            skipped
        )),
        Some(&resp_text),
    )?;
    Ok(Some(pid))
}

pub async fn run(
    conn: &Connection,
    input: PretagInput,
    client: &GeminiClient,
    model: &str,
    prompt_override: Option<&str>,
) -> AppResult<Option<i64>> {
    let (run_id, url, body) = prepare(conn, &input, client, model, prompt_override)?;
    let api_result = client.post_generate(&url, &body).await;
    finalize(conn, run_id, input.interview_id, api_result)
}
