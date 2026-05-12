use stt_app_lib::transcription::schema::*;

#[test]
fn parses_two_segment_response() {
    let json = r#"{"segments":[
        {"speaker":"A","start":0.0,"end":5.0,"text":"hi"},
        {"speaker":"B","start":5.0,"end":10.0,"text":"there"}
    ]}"#;
    let segs = parse_response(json, 60.0).unwrap();
    assert_eq!(segs.len(), 2);
    assert_eq!(segs[0].speaker, "A");
}

#[test]
fn rejects_missing_speaker() {
    let json = r#"{"segments":[
        {"speaker":"","start":0.0,"end":5.0,"text":"hi"}
    ]}"#;
    let err = parse_response(json, 60.0).unwrap_err();
    assert!(matches!(err, stt_app_lib::error::AppError::Invalid(_)));
}

#[test]
fn rejects_end_before_start() {
    let json = r#"{"segments":[
        {"speaker":"A","start":5.0,"end":1.0,"text":"hi"}
    ]}"#;
    let err = parse_response(json, 60.0).unwrap_err();
    assert!(matches!(err, stt_app_lib::error::AppError::Invalid(_)));
}

#[test]
fn rescales_minute_fractions() {
    // 60 words across 1.0s of "stated" duration in a 30s chunk → ~60 wps → rescale × 60
    let json = r#"{"segments":[
        {"speaker":"A","start":0.0,"end":0.5,"text":"one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty"},
        {"speaker":"A","start":0.5,"end":1.0,"text":"one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty"}
    ]}"#;
    let segs = parse_response(json, 60.0).unwrap();
    // After rescaling, end should be ~30.0 (capped at window_duration=60.0), not 0.5/1.0
    assert!(segs[0].end > 1.2);
}

#[test]
fn does_not_rescale_normal_speech() {
    // Normal pace, several seconds — should NOT trigger rescale
    let json = r#"{"segments":[
        {"speaker":"A","start":0.0,"end":5.0,"text":"hello world how are you"}
    ]}"#;
    let segs = parse_response(json, 60.0).unwrap();
    assert!((segs[0].end - 5.0).abs() < 0.001);
}

#[test]
fn canonicalizes_speaker_prefix() {
    let json = r#"{"segments":[
        {"speaker":"Speaker A:","start":0.0,"end":1.0,"text":"hi"}
    ]}"#;
    let segs = parse_response(json, 60.0).unwrap();
    assert_eq!(segs[0].speaker, "A");
}

#[test]
fn sorts_by_start_then_end() {
    let json = r#"{"segments":[
        {"speaker":"B","start":5.0,"end":10.0,"text":"later"},
        {"speaker":"A","start":0.0,"end":3.0,"text":"earlier"}
    ]}"#;
    let segs = parse_response(json, 60.0).unwrap();
    assert_eq!(segs[0].text, "earlier");
}
