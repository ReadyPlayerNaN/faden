use crate::transcription::schema::ParsedSegment;

pub const SYSTEM_INSTRUCTION: &str = "You are a transcription engine.\n\nYou must return only valid JSON that matches the response schema.\nDo not add markdown, code fences, notes, explanations, or extra keys.\nTreat numeric timestamps as literal seconds, never normalized values.\n";

pub const PROMPT_TEMPLATE: &str = "Transcribe this audio chunk into structured segments.\n\nRequirements:\n- The audio may contain multiple speakers.\n- Use speaker labels like A, B, C and keep them consistent within this chunk.\n- `start` and `end` must be literal seconds from the beginning of this chunk.\n- Timestamps must stay within the chunk duration.\n- Do not normalize timestamps or return fractions of a minute.\n- Valid timestamp examples: 0.0, 2.4, 10.9, 18.1, 29.7.\n- Keep the transcribed text verbatim when possible.\n- Omit non-speech noise and omit empty segments.\n- Prefer fewer, longer segments when the same speaker continues naturally.\n- Split segments on speaker changes, long pauses, or clear topic/utterance boundaries.\n- Do not create extra short segments unless timing would otherwise become misleading.\n\nIf there is no speech, return an object with an empty `segments` array.\n";

pub const RESPONSE_SCHEMA_JSON: &str = r#"{
  "type": "object",
  "required": ["segments"],
  "properties": {
    "segments": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["speaker", "start", "end", "text"],
        "properties": {
          "speaker": { "type": ["string", "integer"] },
          "start": { "type": "number" },
          "end": { "type": "number" },
          "text": { "type": "string" }
        },
        "additionalProperties": false
      }
    }
  },
  "additionalProperties": false
}"#;

pub const SPEAKER_CONTEXT_SEGMENTS: usize = 6;

fn format_timestamp(seconds: f64) -> String {
    let total_ms = (seconds * 1000.0).round() as i64;
    let (s, ms) = (total_ms / 1000, total_ms % 1000);
    let (h, rem) = (s / 3600, s % 3600);
    let (m, sec) = (rem / 60, rem % 60);
    if h > 0 {
        format!("{:02}:{:02}:{:02}.{:03}", h, m, sec, ms)
    } else {
        format!("{:02}:{:02}.{:03}", m, sec, ms)
    }
}

pub fn build_prompt(previous_segments: &[ParsedSegment]) -> String {
    if previous_segments.is_empty() {
        return PROMPT_TEMPLATE.to_string();
    }
    let recent = if previous_segments.len() > SPEAKER_CONTEXT_SEGMENTS {
        &previous_segments[previous_segments.len() - SPEAKER_CONTEXT_SEGMENTS..]
    } else {
        previous_segments
    };
    let mut ctx = String::new();
    for s in recent {
        ctx.push_str(&format!(
            "[{} - {}] Speaker {}: {}\n",
            format_timestamp(s.start),
            format_timestamp(s.end),
            s.speaker,
            s.text.trim()
        ));
    }
    format!(
        "{}Speaker consistency context from the immediately preceding audio. \
These lines are already labeled correctly.\n\
Use them only to keep speaker identities consistent across chunks.\n\
Do not repeat or retranscribe this context in the JSON output.\n\n\
{}\n",
        PROMPT_TEMPLATE, ctx
    )
}
