use crate::error::{AppError, AppResult};
use crate::settings::{GlobalSettings, LlmProvider, TaskModelSelection};
use reqwest::Client;
use serde::Deserialize;
use serde_json::{json, Value};

const JSON_INSTRUCTION: &str =
    "Return only valid JSON. Do not wrap it in markdown or add explanations.";

fn join_url(base: &str, path: &str) -> String {
    format!(
        "{}/{}",
        base.trim_end_matches('/'),
        path.trim_start_matches('/')
    )
}

fn wrap_prompt(prompt: &str, schema: Option<&str>) -> String {
    match schema {
        Some(schema) => format!(
            "{JSON_INSTRUCTION}\n\nMatch this JSON schema exactly:\n{schema}\n\nTask:\n{prompt}"
        ),
        None => format!("{JSON_INSTRUCTION}\n\n{prompt}"),
    }
}

fn provider_api_key<'a>(settings: &'a GlobalSettings, provider: LlmProvider) -> Option<&'a str> {
    match provider {
        LlmProvider::Gemini => Some(settings.providers.gemini.api_key.as_str()),
        LlmProvider::OpenAi => Some(settings.providers.openai.api_key.as_str()),
        LlmProvider::Anthropic => Some(settings.providers.anthropic.api_key.as_str()),
        LlmProvider::Ollama => None,
    }
}

pub fn validate_task_selection(
    settings: &GlobalSettings,
    selection: &TaskModelSelection,
) -> AppResult<()> {
    if selection.model.trim().is_empty() {
        return Err(AppError::Invalid(format!(
            "no model configured for {}",
            selection.provider.as_str()
        )));
    }
    if selection.provider.requires_api_key() {
        let api_key = provider_api_key(settings, selection.provider).unwrap_or_default();
        if api_key.trim().is_empty() {
            return Err(AppError::Invalid(format!(
                "no {} API key configured",
                selection.provider.as_str()
            )));
        }
    }
    Ok(())
}

pub async fn generate_text_json(
    settings: &GlobalSettings,
    selection: &TaskModelSelection,
    prompt: &str,
    response_schema: Option<&str>,
    max_output_tokens: u32,
) -> AppResult<String> {
    validate_task_selection(settings, selection)?;
    match selection.provider {
        LlmProvider::Gemini => {
            let client = crate::transcription::gemini::GeminiClient::new(
                settings.providers.gemini.api_key.clone(),
            );
            let url = client.text_generate_url(&selection.model);
            let body = json!({
                "contents": [{
                    "role": "user",
                    "parts": [{ "text": prompt }]
                }],
                "generationConfig": {
                    "temperature": 0,
                    "responseMimeType": "application/json",
                    "responseJsonSchema": response_schema
                        .and_then(|s| serde_json::from_str::<Value>(s).ok())
                        .unwrap_or(Value::Null),
                    "maxOutputTokens": max_output_tokens,
                }
            });
            client.post_generate(&url, &body).await
        }
        LlmProvider::OpenAi => {
            let body = json!({
                "model": selection.model,
                "messages": [{
                    "role": "user",
                    "content": wrap_prompt(prompt, response_schema)
                }],
                "temperature": 0,
                "response_format": { "type": "json_object" },
                "max_completion_tokens": max_output_tokens,
            });
            let value = post_json(
                &join_url(&settings.providers.openai.base_url, "/chat/completions"),
                Some((&settings.providers.openai.api_key, "Bearer")),
                None,
                None,
                &body,
            )
            .await?;
            extract_openai_text(&value)
        }
        LlmProvider::Anthropic => {
            let body = json!({
                "model": selection.model,
                "max_tokens": max_output_tokens,
                "temperature": 0,
                "system": JSON_INSTRUCTION,
                "messages": [{
                    "role": "user",
                    "content": wrap_prompt(prompt, response_schema)
                }]
            });
            let value = post_json(
                &join_url(&settings.providers.anthropic.base_url, "/v1/messages"),
                Some((&settings.providers.anthropic.api_key, "x-api-key")),
                Some(("anthropic-version", "2023-06-01")),
                None,
                &body,
            )
            .await?;
            extract_anthropic_text(&value)
        }
        LlmProvider::Ollama => {
            let body = json!({
                "model": selection.model,
                "prompt": wrap_prompt(prompt, response_schema),
                "stream": false,
                "format": "json",
                "options": {
                    "temperature": 0,
                    "num_predict": max_output_tokens,
                }
            });
            let value = post_json(
                &join_url(&settings.providers.ollama.base_url, "/api/generate"),
                None,
                None,
                (!settings.providers.ollama.username.trim().is_empty()).then_some((
                    settings.providers.ollama.username.as_str(),
                    settings.providers.ollama.password.as_str(),
                )),
                &body,
            )
            .await?;
            value
                .get("response")
                .and_then(|v| v.as_str())
                .map(ToOwned::to_owned)
                .ok_or_else(|| AppError::Invalid("ollama response missing text".into()))
        }
    }
}

async fn post_json(
    url: &str,
    auth: Option<(&str, &str)>,
    extra_header: Option<(&str, &str)>,
    basic_auth: Option<(&str, &str)>,
    body: &Value,
) -> AppResult<Value> {
    let client = Client::new();
    let mut request = client.post(url).json(body);
    if let Some((value, kind)) = auth {
        request = if kind == "Bearer" {
            request.bearer_auth(value)
        } else {
            request.header(kind, value)
        };
    }
    if let Some((name, value)) = extra_header {
        request = request.header(name, value);
    }
    if let Some((username, password)) = basic_auth {
        request = request.basic_auth(username, Some(password));
    }
    let response = request
        .send()
        .await
        .map_err(|e| AppError::Invalid(format!("request failed: {e}")))?;
    let status = response.status();
    let text = response.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(AppError::Invalid(format!(
            "provider request failed with status {}: {}",
            status.as_u16(),
            text
        )));
    }
    serde_json::from_str(&text)
        .map_err(|e| AppError::Invalid(format!("provider json parse failed: {e}")))
}

fn extract_openai_text(value: &Value) -> AppResult<String> {
    if let Some(text) = value
        .pointer("/choices/0/message/content")
        .and_then(|v| v.as_str())
    {
        return Ok(text.to_string());
    }
    if let Some(items) = value
        .pointer("/choices/0/message/content")
        .and_then(|v| v.as_array())
    {
        let out = items
            .iter()
            .filter_map(|item| item.get("text").and_then(|v| v.as_str()))
            .collect::<String>();
        if !out.is_empty() {
            return Ok(out);
        }
    }
    Err(AppError::Invalid("openai response missing text".into()))
}

fn extract_anthropic_text(value: &Value) -> AppResult<String> {
    let items = value
        .get("content")
        .and_then(|v| v.as_array())
        .ok_or_else(|| AppError::Invalid("anthropic response missing content".into()))?;
    let out = items
        .iter()
        .filter(|item| item.get("type").and_then(|v| v.as_str()) == Some("text"))
        .filter_map(|item| item.get("text").and_then(|v| v.as_str()))
        .collect::<String>();
    if out.is_empty() {
        return Err(AppError::Invalid("anthropic response missing text".into()));
    }
    Ok(out)
}

#[derive(Debug, Deserialize)]
pub struct OpenAiDiarizedTranscription {
    pub segments: Vec<OpenAiDiarizedSegment>,
}

#[derive(Debug, Deserialize)]
pub struct OpenAiDiarizedSegment {
    pub speaker: String,
    pub start: f64,
    pub end: f64,
    pub text: String,
}
