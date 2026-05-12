use rand::Rng;
use std::time::Duration;
use thiserror::Error;

pub const MAX_RETRY_ATTEMPTS: u32 = 6;
pub const INITIAL_RETRY_DELAY: Duration = Duration::from_secs(3);
pub const MAX_RETRY_DELAY: Duration = Duration::from_secs(60);

#[derive(Debug, Error)]
pub enum TranscriptionError {
    #[error("network: {0}")]
    Network(String),
    #[error("server error: status {status}")]
    Server { status: u16 },
    #[error("rate limit")]
    RateLimit,
    #[error("invalid json: {0}")]
    InvalidJson(String),
    #[error("max tokens")]
    MaxTokens,
    #[error("permanent: {0}")]
    Permanent(String),
}

pub fn should_retry(err: &TranscriptionError) -> bool {
    match err {
        TranscriptionError::Network(_) => true,
        TranscriptionError::Server { status } => matches!(status, 500 | 502 | 503 | 504),
        TranscriptionError::RateLimit => true,
        TranscriptionError::InvalidJson(_) => true,
        TranscriptionError::MaxTokens => false,
        TranscriptionError::Permanent(_) => false,
    }
}

pub fn delay_for_attempt(attempt: u32) -> Duration {
    let exp = INITIAL_RETRY_DELAY
        .checked_mul(1u32 << (attempt.saturating_sub(1)).min(10))
        .unwrap_or(MAX_RETRY_DELAY);
    let base = exp.min(MAX_RETRY_DELAY);
    let mut rng = rand::thread_rng();
    let jitter_ms: u64 = rng.gen_range(0..1000);
    base + Duration::from_millis(jitter_ms)
}
