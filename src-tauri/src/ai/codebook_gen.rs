use crate::ai::text;
use crate::ai::{prompts, CodebookProposal, CODEBOOK_RESPONSE_SCHEMA};
use crate::db::queries::ai_run::{self, AiRunKind};
use crate::db::queries::proposal::{self, ProposalKind};
use crate::error::{AppError, AppResult};
use crate::transcription::gemini::GeminiClient;
use rusqlite::Connection;
use std::collections::HashMap;

pub struct CodebookGenInput {
    pub interview_ids: Vec<i64>,
    pub include_existing_codebook: bool,
}

pub fn build_prompt(
    conn: &Connection,
    input: &CodebookGenInput,
    override_template: Option<&str>,
) -> AppResult<String> {
    let template = override_template.unwrap_or(prompts::DEFAULT_CODEBOOK_GEN);
    let transcripts = text::format_transcripts(conn, &input.interview_ids)?;
    let existing = if input.include_existing_codebook {
        text::format_codebook(conn)?
    } else {
        String::new()
    };
    let mut vars = HashMap::new();
    vars.insert("transcripts", transcripts);
    vars.insert("existing_codebook", existing);
    Ok(prompts::render(template, &vars))
}

fn build_request_body(prompt: &str) -> serde_json::Value {
    serde_json::json!({
        "contents": [{
            "role": "user",
            "parts": [{ "text": prompt }]
        }],
        "generationConfig": {
            "temperature": 0,
            "responseMimeType": "application/json",
            "responseJsonSchema": serde_json::from_str::<serde_json::Value>(CODEBOOK_RESPONSE_SCHEMA).unwrap_or(serde_json::Value::Null),
            "maxOutputTokens": 32768
        }
    })
}

/// Sync prep step: build the prompt, register the ai_run row, return the
/// request URL+body. The caller drops the &Connection before .await.
pub fn prepare(
    conn: &Connection,
    input: &CodebookGenInput,
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
        AiRunKind::CodebookGen,
        None,
        model,
        &prompt,
        Some(&input_json),
    )?;
    Ok((run_id, url, body))
}

/// Sync finalize step: persist results to db. Call after awaiting api_result.
pub fn finalize(
    conn: &Connection,
    run_id: i64,
    api_result: AppResult<String>,
) -> AppResult<Option<i64>> {
    let resp_text = match api_result {
        Ok(t) => t,
        Err(e) => {
            ai_run::fail(conn, run_id, &e.to_string(), None)?;
            return Err(e);
        }
    };

    let parsed: CodebookProposal = match serde_json::from_str(&resp_text) {
        Ok(p) => p,
        Err(e) => {
            ai_run::fail(conn, run_id, &format!("parse: {e}"), Some(&resp_text))?;
            return Err(AppError::Invalid(format!("codebook gen parse: {e}")));
        }
    };

    if parsed.proposals.is_empty() {
        ai_run::complete(
            conn,
            run_id,
            None,
            Some("No codebook suggestions found"),
            Some(&resp_text),
        )?;
        return Ok(None);
    }

    let proposal_id = proposal::create(
        conn,
        run_id,
        ProposalKind::CodebookGen,
        &serde_json::to_value(&parsed)?,
    )?;
    ai_run::complete(
        conn,
        run_id,
        None,
        Some(&format!("{} tags proposed", parsed.proposals.len())),
        Some(&resp_text),
    )?;
    Ok(Some(proposal_id))
}

/// Convenience: do everything when the caller is OK with `&Connection` being
/// borrowed across `.await`. Suitable for tests where the future is not
/// required to be `Send`. Tauri commands should use `prepare` + `finalize`
/// directly to avoid holding the borrow across the await.
pub async fn run(
    conn: &Connection,
    input: CodebookGenInput,
    client: &GeminiClient,
    model: &str,
    prompt_override: Option<&str>,
) -> AppResult<Option<i64>> {
    let (run_id, url, body) = prepare(conn, &input, client, model, prompt_override)?;
    let api_result = client.post_generate(&url, &body).await;
    finalize(conn, run_id, api_result)
}
