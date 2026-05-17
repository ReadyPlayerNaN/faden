use crate::ai::text;
use crate::ai::{prompts, CategorizeSuggestions, CATEGORIZE_SUGGESTIONS_SCHEMA};
use crate::db::queries::ai_run::{self, AiRunKind};
use crate::db::queries::proposal::{self, ProposalKind};
use crate::db::queries::tag;
use crate::error::{AppError, AppResult};
use crate::transcription::gemini::GeminiClient;
use rusqlite::Connection;
use std::collections::{HashMap, HashSet};

pub struct CategorizeInput;

pub fn build_prompt(
    conn: &Connection,
    _input: &CategorizeInput,
    override_template: Option<&str>,
    project_language: &str,
) -> AppResult<String> {
    let template = override_template.unwrap_or(prompts::DEFAULT_CATEGORIZE);
    let mut vars = HashMap::new();
    vars.insert("codebook", text::format_codebook(conn)?);
    vars.insert("tags", text::format_tags_for_categorizing(conn)?);
    Ok(prompts::with_project_language(
        &prompts::render(template, &vars),
        project_language,
    ))
}

fn build_request_body(prompt: &str) -> serde_json::Value {
    serde_json::json!({
        "contents": [{"role":"user","parts":[{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0,
            "responseMimeType": "application/json",
            "responseJsonSchema": serde_json::from_str::<serde_json::Value>(CATEGORIZE_SUGGESTIONS_SCHEMA).unwrap_or(serde_json::Value::Null),
            "maxOutputTokens": 16384
        }
    })
}

pub fn prepare(
    conn: &Connection,
    input: &CategorizeInput,
    client: &GeminiClient,
    model: &str,
    prompt_override: Option<&str>,
    project_language: &str,
) -> AppResult<(i64, String, serde_json::Value)> {
    let prompt = build_prompt(conn, input, prompt_override, project_language)?;
    let url = client.text_generate_url(model);
    let body = build_request_body(&prompt);
    let input_json = serde_json::to_string(&body)?;
    let run_id = ai_run::start(
        conn,
        AiRunKind::Categorize,
        None,
        model,
        &prompt,
        Some(&input_json),
    )?;
    Ok((run_id, url, body))
}

pub fn finalize(
    conn: &Connection,
    run_id: i64,
    api_result: AppResult<String>,
) -> AppResult<Option<i64>> {
    let resp_text = match api_result {
        Ok(text) => text,
        Err(error) => {
            ai_run::fail(conn, run_id, &error.to_string(), None)?;
            return Err(error);
        }
    };

    let parsed: CategorizeSuggestions = match serde_json::from_str(&resp_text) {
        Ok(parsed) => parsed,
        Err(error) => {
            ai_run::fail(conn, run_id, &format!("parse: {error}"), Some(&resp_text))?;
            return Err(AppError::Invalid(format!("categorize parse: {error}")));
        }
    };

    let known_tags = tag::list_all(conn)?;
    let known_tag_ids: HashSet<i64> = known_tags.iter().map(|tag| tag.id).collect();
    let known_categories = crate::db::queries::category::list_all(conn)?;
    let known_category_ids: HashSet<i64> = known_categories.iter().map(|category| category.id).collect();
    let mut seen_tags = HashSet::new();
    let mut filtered = Vec::new();
    let mut skipped = 0usize;

    for mut proposal in parsed.proposals {
        let mut valid_tags = Vec::new();
        for tag in proposal.tags {
            if !known_tag_ids.contains(&tag.id) || !seen_tags.insert(tag.id) {
                skipped += 1;
                continue;
            }
            valid_tags.push(tag);
        }
        if valid_tags.is_empty() {
            skipped += 1;
            continue;
        }
        if proposal
            .category
            .existing_category_id
            .is_some_and(|id| !known_category_ids.contains(&id))
        {
            proposal.category.existing_category_id = None;
            skipped += 1;
        }
        filtered.push(crate::ai::CategorizeSuggestion {
            category: proposal.category,
            tags: valid_tags,
            rationale: proposal.rationale,
        });
    }

    if filtered.is_empty() {
        ai_run::complete(
            conn,
            run_id,
            None,
            Some(&format!(
                "No categorization suggestions found ({skipped} skipped)"
            )),
            Some(&resp_text),
        )?;
        return Ok(None);
    }

    let proposal_count = filtered.len();
    let pid = proposal::create(
        conn,
        run_id,
        ProposalKind::Categorize,
        &serde_json::to_value(crate::ai::CategorizeSuggestions {
            proposals: filtered,
        })?,
    )?;
    ai_run::complete(
        conn,
        run_id,
        None,
        Some(&format!(
            "{proposal_count} category suggestions ({skipped} skipped)"
        )),
        Some(&resp_text),
    )?;
    Ok(Some(pid))
}

pub async fn run(
    conn: &Connection,
    input: CategorizeInput,
    client: &GeminiClient,
    model: &str,
    prompt_override: Option<&str>,
    project_language: &str,
) -> AppResult<Option<i64>> {
    let (run_id, url, body) = prepare(
        conn,
        &input,
        client,
        model,
        prompt_override,
        project_language,
    )?;
    let api_result = client.post_generate(&url, &body).await;
    finalize(conn, run_id, api_result)
}
