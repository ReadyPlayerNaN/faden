use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CostEstimate {
    pub model: String,
    pub estimated_input_tokens: u32,
    pub estimated_output_tokens: u32,
    pub estimated_usd: f64,
}

/// Price per 1K tokens, (input, output). Update against actual Gemini pricing.
const PRICING: &[(&str, f64, f64)] = &[
    ("gemini-3-flash-preview", 0.0001, 0.0004),
    ("gemini-2.5-pro", 0.00125, 0.005),
    ("gemini-2.5-flash", 0.00015, 0.0006),
];

pub fn estimate(model: &str, prompt: &str, max_output_tokens: u32) -> CostEstimate {
    let input_tokens = (prompt.len() / 4) as u32;
    let pricing = PRICING.iter().find(|(m, _, _)| *m == model);
    let usd = match pricing {
        Some((_, in_per_k, out_per_k)) => {
            (input_tokens as f64 / 1000.0) * in_per_k
                + (max_output_tokens as f64 / 1000.0) * out_per_k
        }
        None => 0.0,
    };
    CostEstimate {
        model: model.to_string(),
        estimated_input_tokens: input_tokens,
        estimated_output_tokens: max_output_tokens,
        estimated_usd: usd,
    }
}
