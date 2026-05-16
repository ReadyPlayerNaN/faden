use serde::{Deserialize, Serialize};
use tiktoken_rs::o200k_base_singleton;

const AUDIO_TOKENS_PER_SECOND: f64 = 25.0;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CostEstimate {
    pub model: String,
    pub estimated_input_tokens: u32,
    pub estimated_output_tokens: u32,
    pub estimated_usd: f64,
}

#[derive(Debug, Clone, Copy)]
struct Pricing {
    text_input_per_million: f64,
    audio_input_per_million: f64,
    output_per_million: f64,
}

/// Paid-tier Gemini Developer API pricing in USD per 1M tokens.
/// Audio token conversion uses Google's published 25 tokens / second guidance.
const PRICING: &[(&str, Pricing)] = &[
    (
        "gemini-3-flash-preview",
        Pricing {
            text_input_per_million: 0.10,
            audio_input_per_million: 0.30,
            output_per_million: 0.40,
        },
    ),
    (
        "gemini-2.5-pro",
        Pricing {
            text_input_per_million: 1.25,
            audio_input_per_million: 1.25,
            output_per_million: 10.0,
        },
    ),
    (
        "gemini-2.5-flash",
        Pricing {
            text_input_per_million: 0.30,
            audio_input_per_million: 1.00,
            output_per_million: 2.50,
        },
    ),
];

pub fn count_text_tokens(text: &str) -> u32 {
    o200k_base_singleton()
        .encode_with_special_tokens(text)
        .len()
        .min(u32::MAX as usize) as u32
}

pub fn estimate(model: &str, prompt: &str, max_output_tokens: u32) -> CostEstimate {
    estimate_with_input_tokens(model, count_text_tokens(prompt), 0, max_output_tokens)
}

pub fn estimate_transcription(
    model: &str,
    system_instruction: &str,
    user_prompt: &str,
    response_schema_json: &str,
    audio_seconds: f64,
    chunk_seconds: u32,
    estimated_output_tokens_per_chunk: u32,
) -> CostEstimate {
    let chunk_count = if audio_seconds <= 0.0 {
        0
    } else {
        (audio_seconds / chunk_seconds as f64).ceil() as u32
    };
    let text_tokens_per_chunk = count_text_tokens(&format!(
        "{}\n\n{}\n\n{}",
        system_instruction, user_prompt, response_schema_json
    ));
    let estimated_text_input_tokens = text_tokens_per_chunk.saturating_mul(chunk_count);
    let estimated_audio_input_tokens = estimate_audio_input_tokens(audio_seconds);
    let estimated_output_tokens = estimated_output_tokens_per_chunk.saturating_mul(chunk_count);
    estimate_with_input_tokens(
        model,
        estimated_text_input_tokens,
        estimated_audio_input_tokens,
        estimated_output_tokens,
    )
}

fn estimate_audio_input_tokens(audio_seconds: f64) -> u32 {
    if !audio_seconds.is_finite() || audio_seconds <= 0.0 {
        return 0;
    }
    (audio_seconds * AUDIO_TOKENS_PER_SECOND)
        .round()
        .clamp(0.0, u32::MAX as f64) as u32
}

fn estimate_with_input_tokens(
    model: &str,
    text_input_tokens: u32,
    audio_input_tokens: u32,
    estimated_output_tokens: u32,
) -> CostEstimate {
    let pricing = PRICING.iter().find(|(m, _)| *m == model).map(|(_, p)| *p);
    let estimated_input_tokens = text_input_tokens.saturating_add(audio_input_tokens);
    let estimated_usd = match pricing {
        Some(pricing) => {
            (text_input_tokens as f64 / 1_000_000.0) * pricing.text_input_per_million
                + (audio_input_tokens as f64 / 1_000_000.0) * pricing.audio_input_per_million
                + (estimated_output_tokens as f64 / 1_000_000.0) * pricing.output_per_million
        }
        None => 0.0,
    };
    CostEstimate {
        model: model.to_string(),
        estimated_input_tokens,
        estimated_output_tokens,
        estimated_usd,
    }
}
