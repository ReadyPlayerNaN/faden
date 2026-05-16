use crate::error::{AppError, AppResult};
use crate::llm::OpenAiDiarizedTranscription;
use crate::transcription::schema::ParsedSegment;
use reqwest::multipart;

const MAX_UPLOAD_BYTES: usize = 25 * 1024 * 1024;

fn canonicalize_speaker(raw: &str) -> String {
    let s = raw
        .replace("Speaker", "")
        .replace("speaker", "")
        .replace("Mluvčí", "")
        .replace("mluvčí", "")
        .trim()
        .trim_end_matches(':')
        .trim()
        .to_string();
    if s.len() == 1 && s.chars().next().unwrap_or('A').is_ascii_alphabetic() {
        return s.to_uppercase();
    }
    s
}

pub async fn transcribe_file(
    api_key: &str,
    base_url: &str,
    model: &str,
    file_path: &std::path::Path,
) -> AppResult<Vec<ParsedSegment>> {
    let bytes = std::fs::read(file_path)?;
    if bytes.len() > MAX_UPLOAD_BYTES {
        return Err(AppError::Invalid(format!(
            "OpenAI transcription upload limit is 25 MB; normalized file is {:.1} MB",
            bytes.len() as f64 / (1024.0 * 1024.0)
        )));
    }

    let file_name = file_path
        .file_name()
        .and_then(|v| v.to_str())
        .unwrap_or("audio.mp3")
        .to_string();

    let form = multipart::Form::new()
        .text("model", model.to_string())
        .text("response_format", "diarized_json")
        .text("chunking_strategy", "auto")
        .part(
            "file",
            multipart::Part::bytes(bytes)
                .file_name(file_name)
                .mime_str("audio/mpeg")
                .map_err(|e| AppError::Invalid(format!("mime: {e}")))?,
        );

    let url = format!("{}/audio/transcriptions", base_url.trim_end_matches('/'));
    let response = reqwest::Client::new()
        .post(url)
        .bearer_auth(api_key)
        .multipart(form)
        .send()
        .await
        .map_err(|e| AppError::Invalid(format!("openai transcription request failed: {e}")))?;
    let status = response.status();
    let text = response.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(AppError::Invalid(format!(
            "openai transcription failed with status {}: {}",
            status.as_u16(),
            text
        )));
    }

    let parsed: OpenAiDiarizedTranscription = serde_json::from_str(&text)
        .map_err(|e| AppError::Invalid(format!("openai transcription json: {e}")))?;

    let mut segments: Vec<ParsedSegment> = parsed
        .segments
        .into_iter()
        .filter_map(|segment| {
            let speaker = canonicalize_speaker(&segment.speaker);
            let text = segment.text.trim().to_string();
            if speaker.is_empty() || text.is_empty() || segment.end < segment.start {
                return None;
            }
            Some(ParsedSegment {
                speaker,
                start: segment.start.max(0.0),
                end: segment.end.max(segment.start),
                text,
            })
        })
        .collect();

    segments.sort_by(|a, b| {
        a.start
            .partial_cmp(&b.start)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(
                a.end
                    .partial_cmp(&b.end)
                    .unwrap_or(std::cmp::Ordering::Equal),
            )
    });

    if segments.is_empty() {
        return Err(AppError::Invalid(
            "openai transcription returned no usable segments".into(),
        ));
    }

    Ok(segments)
}
