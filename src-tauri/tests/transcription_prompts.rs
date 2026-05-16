use faden_app_lib::transcription::prompts::*;
use faden_app_lib::transcription::schema::ParsedSegment;

#[test]
fn empty_context_returns_base_prompt() {
    assert_eq!(build_prompt(&[]), PROMPT_TEMPLATE);
}

#[test]
fn context_block_contains_last_six() {
    let segs: Vec<ParsedSegment> = (0..10)
        .map(|i| ParsedSegment {
            speaker: "A".into(),
            start: i as f64,
            end: (i + 1) as f64,
            text: format!("line {i}"),
        })
        .collect();
    let prompt = build_prompt(&segs);
    // Should contain line 4..9 (last 6)
    assert!(prompt.contains("line 4"));
    assert!(prompt.contains("line 9"));
    // Should NOT contain line 0..3
    assert!(!prompt.contains("line 0"));
    assert!(!prompt.contains("line 3"));
}

#[test]
fn context_line_format() {
    let segs = vec![ParsedSegment {
        speaker: "B".into(),
        start: 12.0,
        end: 47.0,
        text: "abych byl upřímný".into(),
    }];
    let prompt = build_prompt(&segs);
    assert!(prompt.contains("[00:12.000 - 00:47.000] B: abych byl upřímný"));
}
