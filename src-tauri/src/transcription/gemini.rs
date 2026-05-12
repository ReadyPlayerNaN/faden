use crate::error::{AppError, AppResult};
use crate::transcription::retry::TranscriptionError;
use bytes::Bytes;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::Path;

#[derive(Debug, Clone)]
pub struct GeminiClient {
    http: Client,
    api_key: String,
    base_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UploadedFile {
    pub name: String,
    pub uri: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenUsage {
    #[serde(rename = "promptTokenCount", default)]
    pub prompt_tokens: u32,
    #[serde(rename = "candidatesTokenCount", default)]
    pub candidates_tokens: u32,
    #[serde(rename = "totalTokenCount", default)]
    pub total_tokens: u32,
}

#[derive(Debug, Clone)]
pub struct GenerateResponse {
    pub text: String,
    pub usage: Option<TokenUsage>,
    pub finish_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
struct UploadResponseEnvelope {
    file: UploadResponseFile,
}

#[derive(Debug, Deserialize)]
struct UploadResponseFile {
    name: String,
    uri: String,
}

#[derive(Debug, Deserialize)]
struct GenerateContentResponse {
    candidates: Option<Vec<Candidate>>,
    #[serde(rename = "usageMetadata", default)]
    usage_metadata: Option<TokenUsage>,
}

#[derive(Debug, Deserialize, Clone)]
struct Candidate {
    content: Option<Content>,
    #[serde(rename = "finishReason", default)]
    finish_reason: Option<String>,
}

#[derive(Debug, Deserialize, Clone)]
struct Content {
    parts: Vec<Part>,
}

#[derive(Debug, Deserialize, Clone)]
struct Part {
    #[serde(default)]
    text: Option<String>,
}

impl GeminiClient {
    pub fn new(api_key: String) -> Self {
        Self {
            http: Client::new(),
            api_key,
            base_url: "https://generativelanguage.googleapis.com".to_string(),
        }
    }
    pub fn with_base_url(api_key: String, base_url: String) -> Self {
        Self {
            http: Client::new(),
            api_key,
            base_url,
        }
    }

    fn map_status(status: u16, body: &str) -> AppError {
        let te = match status {
            429 => TranscriptionError::RateLimit,
            500..=599 => TranscriptionError::Server { status },
            _ => TranscriptionError::Permanent(format!("status {status}: {body}")),
        };
        AppError::Invalid(te.to_string())
    }

    pub async fn upload_file(&self, path: &Path, mime_type: &str) -> AppResult<UploadedFile> {
        let bytes = std::fs::read(path)?;
        let display_name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("upload")
            .to_string();

        let metadata = json!({ "file": { "displayName": display_name } });

        let url = format!("{}/upload/v1beta/files?key={}", self.base_url, self.api_key);
        let body = Bytes::from(bytes);

        let form = reqwest::multipart::Form::new()
            .part(
                "metadata",
                reqwest::multipart::Part::text(metadata.to_string())
                    .mime_str("application/json")
                    .map_err(|e| AppError::Invalid(e.to_string()))?,
            )
            .part(
                "file",
                reqwest::multipart::Part::stream(body)
                    .file_name(display_name)
                    .mime_str(mime_type)
                    .map_err(|e| AppError::Invalid(e.to_string()))?,
            );

        let resp = self
            .http
            .post(&url)
            .multipart(form)
            .send()
            .await
            .map_err(|e| AppError::Invalid(format!("upload: {e}")))?;

        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        if !status.is_success() {
            return Err(Self::map_status(status.as_u16(), &text));
        }
        let env: UploadResponseEnvelope = serde_json::from_str(&text)
            .map_err(|e| AppError::Invalid(format!("upload json: {e}")))?;
        Ok(UploadedFile {
            name: env.file.name,
            uri: env.file.uri,
        })
    }

    pub async fn delete_file(&self, name: &str) -> AppResult<()> {
        let url = format!("{}/v1beta/{}?key={}", self.base_url, name, self.api_key);
        let resp = self
            .http
            .delete(&url)
            .send()
            .await
            .map_err(|e| AppError::Invalid(format!("delete: {e}")))?;
        if !resp.status().is_success() {
            let s = resp.status().as_u16();
            let t = resp.text().await.unwrap_or_default();
            return Err(Self::map_status(s, &t));
        }
        Ok(())
    }

    pub async fn generate_content(
        &self,
        model: &str,
        prompt: &str,
        file: &UploadedFile,
        system_instruction: &str,
        response_schema: Value,
        max_output_tokens: u32,
    ) -> AppResult<GenerateResponse> {
        let url = format!(
            "{}/v1beta/models/{}:generateContent?key={}",
            self.base_url, model, self.api_key
        );
        let body = json!({
            "contents": [{
                "role": "user",
                "parts": [
                    { "text": prompt },
                    { "fileData": { "fileUri": file.uri, "mimeType": "audio/mpeg" } }
                ]
            }],
            "systemInstruction": {
                "role": "system",
                "parts": [{ "text": system_instruction }]
            },
            "generationConfig": {
                "temperature": 0,
                "responseMimeType": "application/json",
                "responseJsonSchema": response_schema,
                "maxOutputTokens": max_output_tokens
            }
        });
        let resp = self
            .http
            .post(&url)
            .json(&body)
            .send()
            .await
            .map_err(|e| AppError::Invalid(format!("generate: {e}")))?;
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        if !status.is_success() {
            return Err(Self::map_status(status.as_u16(), &text));
        }
        let parsed: GenerateContentResponse = serde_json::from_str(&text)
            .map_err(|e| AppError::Invalid(format!("generate json: {e}")))?;
        let candidate = parsed
            .candidates
            .as_ref()
            .and_then(|c| c.first())
            .cloned()
            .ok_or_else(|| AppError::Invalid("no candidates in response".into()))?;
        let text_out = candidate
            .content
            .as_ref()
            .and_then(|c| c.parts.first())
            .and_then(|p| p.text.clone())
            .ok_or_else(|| AppError::Invalid("no text in candidate".into()))?;
        Ok(GenerateResponse {
            text: text_out,
            usage: parsed.usage_metadata,
            finish_reason: candidate.finish_reason.clone(),
        })
    }
}
