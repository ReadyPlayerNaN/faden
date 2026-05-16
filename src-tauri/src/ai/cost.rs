use serde::{Deserialize, Serialize};
use tiktoken_rs::o200k_base_singleton;

const AUDIO_TOKENS_PER_SECOND: f64 = 25.0;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CostEstimate {
    pub provider: String,
    pub model: String,
    pub model_ref: String,
    pub pricing_known: bool,
    pub text_input_usd_per_million: f64,
    pub audio_input_usd_per_million: f64,
    pub output_usd_per_million: f64,
    pub estimated_input_tokens: u32,
    pub estimated_output_tokens: u32,
    pub estimated_usd: f64,
}

#[derive(Debug, Clone, Copy)]
pub struct Pricing {
    pub text_input_per_million: f64,
    pub audio_input_per_million: f64,
    pub output_per_million: f64,
}

const PRICING: &[(&str, &str, Pricing)] = &[
    (
        "gemini",
        "gemini-3-flash-preview",
        Pricing {
            text_input_per_million: 0.10,
            audio_input_per_million: 0.30,
            output_per_million: 0.40,
        },
    ),
    (
        "gemini",
        "gemini-2.5-pro",
        Pricing {
            text_input_per_million: 1.25,
            audio_input_per_million: 1.25,
            output_per_million: 10.0,
        },
    ),
    (
        "gemini",
        "gemini-2.5-flash",
        Pricing {
            text_input_per_million: 0.30,
            audio_input_per_million: 1.00,
            output_per_million: 2.50,
        },
    ),
    (
        "openai",
        "gpt-4.1-mini",
        Pricing {
            text_input_per_million: 0.40,
            audio_input_per_million: 0.0,
            output_per_million: 1.60,
        },
    ),
    (
        "openai",
        "gpt-4.1",
        Pricing {
            text_input_per_million: 2.00,
            audio_input_per_million: 0.0,
            output_per_million: 8.00,
        },
    ),
    (
        "openai",
        "gpt-4o-transcribe-diarize",
        Pricing {
            text_input_per_million: 0.0,
            audio_input_per_million: 6.00,
            output_per_million: 0.0,
        },
    ),
    (
        "anthropic",
        "claude-sonnet-4-20250514",
        Pricing {
            text_input_per_million: 3.00,
            audio_input_per_million: 0.0,
            output_per_million: 15.00,
        },
    ),
    (
        "anthropic",
        "claude-opus-4-20250514",
        Pricing {
            text_input_per_million: 15.00,
            audio_input_per_million: 0.0,
            output_per_million: 75.00,
        },
    ),
];

pub fn pricing_for(provider: &str, model: &str) -> Option<Pricing> {
    PRICING
        .iter()
        .find(|(p, m, _)| *p == provider && *m == model)
        .map(|(_, _, pricing)| *pricing)
}

pub fn count_text_tokens(text: &str) -> u32 {
    o200k_base_singleton()
        .encode_with_special_tokens(text)
        .len()
        .min(u32::MAX as usize) as u32
}

pub fn estimate(provider: &str, model: &str, prompt: &str, max_output_tokens: u32) -> CostEstimate {
    estimate_with_input_tokens(
        provider,
        model,
        count_text_tokens(prompt),
        0,
        max_output_tokens,
    )
}

pub fn estimate_transcription(
    provider: &str,
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
        provider,
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
    provider: &str,
    model: &str,
    text_input_tokens: u32,
    audio_input_tokens: u32,
    estimated_output_tokens: u32,
) -> CostEstimate {
    let pricing = pricing_for(provider, model);
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
        provider: provider.to_string(),
        model: model.to_string(),
        model_ref: format!("{provider}/{model}"),
        pricing_known: pricing.is_some(),
        text_input_usd_per_million: pricing.map(|p| p.text_input_per_million).unwrap_or(0.0),
        audio_input_usd_per_million: pricing.map(|p| p.audio_input_per_million).unwrap_or(0.0),
        output_usd_per_million: pricing.map(|p| p.output_per_million).unwrap_or(0.0),
        estimated_input_tokens,
        estimated_output_tokens,
        estimated_usd,
    }
}
