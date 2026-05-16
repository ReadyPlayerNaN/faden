use crate::ai::text;
use crate::ai::{prompts, SpanSuggestion, SpanSuggestions, SPAN_SUGGESTIONS_SCHEMA};
use crate::db::queries::ai_run::{self, AiRunKind};
use crate::db::queries::proposal::{self, ProposalKind};
use crate::db::queries::{segment, tag, tagged_span};
use crate::error::{AppError, AppResult};
use crate::transcription::gemini::GeminiClient;
use rusqlite::Connection;
use std::collections::HashMap;
use std::fmt::Write;

pub struct FindMoreInput {
    pub tag_id: i64,
    pub interview_id: i64,
}

pub fn build_prompt(
    conn: &Connection,
    input: &FindMoreInput,
    override_template: Option<&str>,
) -> AppResult<String> {
    let template = override_template.unwrap_or(prompts::DEFAULT_FIND_MORE);
    let t = tag::get(conn, input.tag_id)?;
    let transcript = text::format_transcript(conn, input.interview_id)?;
    let example_spans = {
        let spans = tagged_span::list_for_tag(conn, input.tag_id)?;
        let mut out = String::new();
        for s in spans.iter().take(5) {
            writeln!(out, "- \"{}\"", s.text_snapshot).ok();
        }
        if out.is_empty() {
            out.push_str("(no prior examples)\n");
        }
        out
    };
    let mut vars = HashMap::new();
    vars.insert("tag_name", t.name);
    vars.insert("tag_description", t.description.unwrap_or_default());
    vars.insert("example_spans", example_spans);
    vars.insert("transcript", transcript);
    Ok(prompts::render(template, &vars))
}

fn build_request_body(prompt: &str) -> serde_json::Value {
    serde_json::json!({
        "contents": [{"role":"user","parts":[{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0,
            "responseMimeType": "application/json",
            "responseJsonSchema": serde_json::from_str::<serde_json::Value>(SPAN_SUGGESTIONS_SCHEMA).unwrap_or(serde_json::Value::Null),
            "maxOutputTokens": 8192
        }
    })
}

pub fn prepare(
    conn: &Connection,
    input: &FindMoreInput,
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
        AiRunKind::FindMore,
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
    input: &FindMoreInput,
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
            return Err(AppError::Invalid(format!("find_more parse: {e}")));
        }
    };
    let t_obj = tag::get(conn, input.tag_id)?;
    let mut valid = Vec::new();
    for s in parsed.suggestions {
        let seg = match segment::get(conn, s.segment_id) {
            Ok(seg) if seg.interview_id == input.interview_id => seg,
            _ => continue,
        };
        let text_len = seg.text.chars().count() as i32;
        if s.start_offset < 0 || s.end_offset <= s.start_offset || s.end_offset > text_len {
            continue;
        }
        valid.push(SpanSuggestion {
            segment_id: s.segment_id,
            start_offset: s.start_offset,
            end_offset: s.end_offset,
            tag_names: vec![t_obj.name.clone()],
            rationale: s.rationale,
        });
    }
    let filtered = SpanSuggestions { suggestions: valid };
    if filtered.suggestions.is_empty() {
        ai_run::complete(
            conn,
            run_id,
            None,
            Some("No suggestions found"),
            Some(&resp_text),
        )?;
        return Ok(None);
    }

    let pid = proposal::create(
        conn,
        run_id,
        ProposalKind::FindMore,
        &serde_json::to_value(&filtered)?,
    )?;
    ai_run::complete(
        conn,
        run_id,
        None,
        Some(&format!("{} suggestions", filtered.suggestions.len())),
        Some(&resp_text),
    )?;
    Ok(Some(pid))
}

pub async fn run(
    conn: &Connection,
    input: FindMoreInput,
    client: &GeminiClient,
    model: &str,
    prompt_override: Option<&str>,
) -> AppResult<Option<i64>> {
    let (run_id, url, body) = prepare(conn, &input, client, model, prompt_override)?;
    let api_result = client.post_generate(&url, &body).await;
    finalize(conn, run_id, &input, api_result)
}
