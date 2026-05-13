use stt_app_lib::ai::cost;

#[test]
fn estimates_tokens_from_prompt_length() {
    let e = cost::estimate("gemini-3-flash-preview", "12345678", 100);
    assert_eq!(e.estimated_input_tokens, 2); // 8 chars / 4
    assert_eq!(e.estimated_output_tokens, 100);
    assert!(e.estimated_usd > 0.0);
}

#[test]
fn unknown_model_yields_zero_usd() {
    let e = cost::estimate("unknown-model", "hello world", 100);
    assert_eq!(e.estimated_usd, 0.0);
}

#[test]
fn larger_prompt_costs_more() {
    let a = cost::estimate("gemini-3-flash-preview", "x".repeat(100).as_str(), 100);
    let b = cost::estimate("gemini-3-flash-preview", "x".repeat(10000).as_str(), 100);
    assert!(b.estimated_usd > a.estimated_usd);
}
