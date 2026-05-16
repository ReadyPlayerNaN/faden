use faden_app_lib::transcription::retry::*;

#[test]
fn retries_network_errors() {
    assert!(should_retry(&TranscriptionError::Network(
        "conn refused".into()
    )));
}

#[test]
fn retries_5xx_server_errors() {
    for status in [500, 502, 503, 504] {
        assert!(should_retry(&TranscriptionError::Server { status }));
    }
}

#[test]
fn does_not_retry_4xx_other_than_429() {
    assert!(!should_retry(&TranscriptionError::Server { status: 400 }));
    assert!(!should_retry(&TranscriptionError::Server { status: 404 }));
}

#[test]
fn retries_rate_limit() {
    assert!(should_retry(&TranscriptionError::RateLimit));
}

#[test]
fn retries_invalid_json() {
    assert!(should_retry(&TranscriptionError::InvalidJson("bad".into())));
}

#[test]
fn does_not_retry_max_tokens() {
    assert!(!should_retry(&TranscriptionError::MaxTokens));
}

#[test]
fn does_not_retry_permanent() {
    assert!(!should_retry(&TranscriptionError::Permanent("nope".into())));
}

#[test]
fn delay_grows_exponentially_up_to_max() {
    let d1 = delay_for_attempt(1);
    let d3 = delay_for_attempt(3);
    let d10 = delay_for_attempt(10);
    assert!(d3 > d1);
    assert!(d10 <= std::time::Duration::from_secs(61)); // max 60 + up to 1s jitter
}
