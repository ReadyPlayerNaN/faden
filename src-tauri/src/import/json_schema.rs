use crate::error::{AppError, AppResult};
use crate::import::plain_text::{ParsedSegment, ParsedSpeaker, ParsedTranscript};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
struct RawPayload {
    segments: Vec<RawSegment>,
}

#[derive(Debug, Deserialize)]
struct RawSegment {
    speaker: serde_json::Value,
    start: f64,
    end: f64,
    text: String,
}

pub fn parse_json(raw: &str) -> AppResult<ParsedTranscript> {
    let p: RawPayload = serde_json::from_str(raw)?;
    let mut speakers: Vec<String> = Vec::new();
    let mut segments = Vec::with_capacity(p.segments.len());
    for (i, s) in p.segments.iter().enumerate() {
        if s.end < s.start {
            return Err(AppError::Invalid(format!("segment {i}: end<start")));
        }
        if s.start < 0.0 {
            return Err(AppError::Invalid(format!("segment {i}: start<0")));
        }
        let label = match &s.speaker {
            serde_json::Value::String(s) => s.clone(),
            serde_json::Value::Number(n) => n.to_string(),
            _ => return Err(AppError::Invalid(format!("segment {i}: invalid speaker"))),
        };
        if !speakers.contains(&label) {
            speakers.push(label.clone());
        }
        segments.push(ParsedSegment {
            speaker_label: label,
            start_sec: s.start,
            end_sec: s.end,
            text: s.text.clone(),
        });
    }
    Ok(ParsedTranscript {
        speakers: speakers
            .into_iter()
            .map(|s| ParsedSpeaker {
                label_raw: s,
                display_name: None,
            })
            .collect(),
        segments,
        synthetic_timestamps: false,
    })
}
