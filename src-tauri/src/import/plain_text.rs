use crate::error::AppResult;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedTranscript {
    pub speakers: Vec<ParsedSpeaker>,
    pub segments: Vec<ParsedSegment>,
    pub synthetic_timestamps: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedSpeaker {
    pub label_raw: String,
    pub display_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedSegment {
    pub speaker_label: String,
    pub start_sec: f64,
    pub end_sec: f64,
    pub text: String,
}

/// Recognize lines like `Speaker A: text`, `Mluvčí A: text`, `Interviewer: text`, `A: text`.
/// Pattern: starts with non-whitespace, up to 30 chars before ':', then whitespace.
fn split_speaker_prefix(line: &str) -> Option<(String, String)> {
    if let Some(colon_idx) = line.find(':') {
        if colon_idx > 30 {
            return None;
        }
        let prefix = &line[..colon_idx];
        if !prefix.starts_with(|c: char| !c.is_whitespace()) {
            return None;
        }
        if prefix.contains('\n') {
            return None;
        }
        let rest = line[colon_idx + 1..].trim_start();
        return Some((prefix.trim().to_string(), rest.to_string()));
    }
    None
}

pub fn parse(raw: &str) -> AppResult<ParsedTranscript> {
    let mut speakers_seen: Vec<String> = Vec::new();
    let mut segments: Vec<ParsedSegment> = Vec::new();
    let mut current_speaker: Option<String> = None;
    let mut buffer: String = String::new();

    let flush = |segments: &mut Vec<ParsedSegment>,
                 current_speaker: &Option<String>,
                 buffer: &mut String| {
        let txt = buffer.trim();
        if !txt.is_empty() {
            let label = current_speaker.clone().unwrap_or_else(|| "Speaker".into());
            // Synthetic timestamps: 5s per segment, 0.5s/word minimum 2s
            let idx = segments.len();
            let start = idx as f64 * 5.0;
            let words = txt.split_whitespace().count();
            let dur = ((words as f64) * 0.5).max(2.0);
            segments.push(ParsedSegment {
                speaker_label: label,
                start_sec: start,
                end_sec: start + dur,
                text: txt.to_string(),
            });
        }
        buffer.clear();
    };

    for line in raw.lines() {
        if line.trim().is_empty() {
            flush(&mut segments, &current_speaker, &mut buffer);
            current_speaker = None;
            continue;
        }
        if let Some((prefix, rest)) = split_speaker_prefix(line) {
            flush(&mut segments, &current_speaker, &mut buffer);
            // canonicalize speaker label: strip known speaker prefixes
            let mut label = prefix
                .replace("Speaker", "")
                .replace("speaker", "")
                .replace("Mluvčí", "")
                .replace("mluvčí", "")
                .trim()
                .to_string();
            label = label.trim_end_matches(':').trim().to_string();
            if label.is_empty() {
                label = prefix.clone();
            }
            if !speakers_seen.contains(&label) {
                speakers_seen.push(label.clone());
            }
            current_speaker = Some(label);
            buffer.push_str(&rest);
        } else {
            if !buffer.is_empty() {
                buffer.push(' ');
            }
            buffer.push_str(line.trim());
        }
    }
    flush(&mut segments, &current_speaker, &mut buffer);

    // If no speakers detected at all but there's text, create a default "Speaker"
    if speakers_seen.is_empty() && !segments.is_empty() {
        speakers_seen.push("Speaker".to_string());
        for seg in segments.iter_mut() {
            if seg.speaker_label.is_empty() {
                seg.speaker_label = "Speaker".to_string();
            }
        }
    }

    let speakers = speakers_seen
        .into_iter()
        .map(|s| ParsedSpeaker {
            label_raw: s,
            display_name: None,
        })
        .collect();

    Ok(ParsedTranscript {
        speakers,
        segments,
        synthetic_timestamps: true,
    })
}
