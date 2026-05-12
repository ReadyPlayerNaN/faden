use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ParsedSegment {
    pub speaker: String,
    pub start: f64,
    pub end: f64,
    pub text: String,
}

#[derive(Debug, Deserialize)]
struct RawResponse {
    segments: Vec<RawSegment>,
}

#[derive(Debug, Deserialize)]
struct RawSegment {
    speaker: serde_json::Value, // can be string or integer
    start: f64,
    end: f64,
    text: String,
}

fn canonicalize_speaker(raw: &serde_json::Value) -> String {
    let s = match raw {
        serde_json::Value::String(s) => s.trim().to_string(),
        serde_json::Value::Number(n) => n.to_string(),
        _ => String::new(),
    };
    let s = s.replace("Speaker", "").replace("speaker", "").trim().to_string();
    let s = s.trim_end_matches(':').trim().to_string();
    if s.len() == 1 && s.chars().next().unwrap().is_ascii_alphabetic() {
        return s.to_uppercase();
    }
    s
}

fn maybe_rescale_timestamps(segments: &mut [ParsedSegment], window_duration: f64) {
    if segments.is_empty() || window_duration <= 10.0 {
        return;
    }
    let max_end = segments.iter().fold(0.0_f64, |a, s| a.max(s.end));
    if max_end > 1.2 {
        return;
    }
    let total_words: usize = segments.iter().map(|s| s.text.split_whitespace().count()).sum();
    let min_start = segments.iter().fold(f64::INFINITY, |a, s| a.min(s.start));
    let covered = (max_end - min_start).max(0.001);
    let wps = total_words as f64 / covered;
    if wps <= 12.0 {
        return;
    }
    for s in segments {
        s.start = (s.start * 60.0).min(window_duration);
        s.end = (s.end * 60.0).min(window_duration);
    }
}

pub fn parse_response(json_str: &str, chunk_duration: f64) -> AppResult<Vec<ParsedSegment>> {
    let raw: RawResponse = serde_json::from_str(json_str)
        .map_err(|e| AppError::Invalid(format!("gemini json: {e}")))?;

    let mut out = Vec::with_capacity(raw.segments.len());
    for (i, seg) in raw.segments.iter().enumerate() {
        let speaker = canonicalize_speaker(&seg.speaker);
        if speaker.is_empty() {
            return Err(AppError::Invalid(format!("segment {i} has empty speaker")));
        }
        let start = seg.start.max(0.0).min(chunk_duration);
        let end = seg.end.max(0.0).min(chunk_duration);
        if end < start {
            return Err(AppError::Invalid(format!(
                "segment {i} end<start: {start} > {end}"
            )));
        }
        out.push(ParsedSegment {
            speaker,
            start,
            end,
            text: seg.text.trim().to_string(),
        });
    }
    maybe_rescale_timestamps(&mut out, chunk_duration);
    out.sort_by(|a, b| {
        a.start.partial_cmp(&b.start).unwrap_or(std::cmp::Ordering::Equal)
            .then(a.end.partial_cmp(&b.end).unwrap_or(std::cmp::Ordering::Equal))
    });
    Ok(out)
}
