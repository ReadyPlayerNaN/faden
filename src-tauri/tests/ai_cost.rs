use faden_app_lib::ai::cost;

#[test]
fn estimates_text_tokens_with_tokenizer() {
    let prompt = "hello world";
    let expected_tokens = cost::count_text_tokens(prompt);
    let e = cost::estimate("gemini", "gemini-3-flash-preview", prompt, 100);
    assert_eq!(e.estimated_input_tokens, expected_tokens);
    assert_eq!(e.estimated_output_tokens, 100);
    assert!(e.estimated_usd > 0.0);
}

#[test]
fn unknown_model_yields_zero_usd() {
    let e = cost::estimate("unknown", "unknown-model", "hello world", 100);
    assert_eq!(e.estimated_usd, 0.0);
}

#[test]
fn larger_prompt_costs_more() {
    let a = cost::estimate("gemini", "gemini-3-flash-preview", "short", 100);
    let b = cost::estimate(
        "gemini",
        "gemini-3-flash-preview",
        "This is a substantially longer prompt that should tokenize into more tokens.",
        100,
    );
    assert!(b.estimated_input_tokens > a.estimated_input_tokens);
    assert!(b.estimated_usd > a.estimated_usd);
}

#[test]
fn transcription_estimate_includes_audio_and_chunk_repeated_prompt_cost() {
    let system = "system";
    let user = "user";
    let schema = r#"{"type":"object"}"#;
    let audio_seconds = 840.0;
    let chunk_seconds = 420;
    let output_per_chunk = 8192;

    let e = cost::estimate_transcription(
        "gemini",
        "gemini-2.5-flash",
        system,
        user,
        schema,
        audio_seconds,
        chunk_seconds,
        output_per_chunk,
    );

    let text_tokens_per_chunk =
        cost::count_text_tokens(&format!("{}\n\n{}\n\n{}", system, user, schema));
    let expected_audio_tokens = (audio_seconds * 25.0_f64).round() as u32;
    assert_eq!(
        e.estimated_input_tokens,
        text_tokens_per_chunk * 2 + expected_audio_tokens
    );
    assert_eq!(e.estimated_output_tokens, output_per_chunk * 2);
    assert!(e.estimated_usd > 0.0);
}
