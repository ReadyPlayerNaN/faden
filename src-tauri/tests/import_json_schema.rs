use faden_app_lib::import::json_schema::parse_json;

#[test]
fn valid_payload_round_trip() {
    let raw = r#"{
        "segments": [
            {"speaker": "A", "start": 0.0, "end": 2.5, "text": "hello"},
            {"speaker": "B", "start": 2.5, "end": 5.0, "text": "hi there"},
            {"speaker": "A", "start": 5.0, "end": 7.0, "text": "yeah"}
        ]
    }"#;
    let p = parse_json(raw).unwrap();
    assert_eq!(p.speakers.len(), 2);
    assert_eq!(p.segments.len(), 3);
    assert_eq!(p.segments[0].text, "hello");
    assert_eq!(p.segments[1].speaker_label, "B");
    assert!(!p.synthetic_timestamps);
}

#[test]
fn missing_required_field_fails() {
    let raw = r#"{ "segments": [ { "speaker": "A", "start": 0.0, "end": 1.0 } ] }"#;
    let err = parse_json(raw).unwrap_err();
    assert!(matches!(err, faden_app_lib::error::AppError::Json(_)));
}

#[test]
fn end_before_start_fails() {
    let raw = r#"{ "segments": [ {"speaker": "A", "start": 5.0, "end": 2.0, "text": "bad"} ] }"#;
    let err = parse_json(raw).unwrap_err();
    assert!(matches!(err, faden_app_lib::error::AppError::Invalid(_)));
}
