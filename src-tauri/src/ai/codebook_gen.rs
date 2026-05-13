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

pub async fn run(
    conn: &Connection,
    input: CodebookGenInput,
    client: &GeminiClient,
    model: &str,
    prompt_override: Option<&str>,
) -> AppResult<i64> {
    let prompt = build_prompt(conn, &input, prompt_override)?;
    let run_id = ai_run::start(conn, AiRunKind::CodebookGen, None, model, &prompt)?;

    let url = client.text_generate_url(model);
    let body = serde_json::json!({
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
    });

    let resp_text = match client.post_generate(&url, &body).await {
        Ok(t) => t,
        Err(e) => {
            ai_run::fail(conn, run_id, &e.to_string())?;
            return Err(e);
        }
    };

    let parsed: CodebookProposal = match serde_json::from_str(&resp_text) {
        Ok(p) => p,
        Err(e) => {
            ai_run::fail(conn, run_id, &format!("parse: {e}"))?;
            return Err(AppError::Invalid(format!("codebook gen parse: {e}")));
        }
    };

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
        Some(&format!("{} clusters proposed", parsed.proposals.len())),
    )?;
    Ok(proposal_id)
}
