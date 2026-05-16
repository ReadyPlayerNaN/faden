use faden_app_lib::app_state::AppState;
use tokio_util::sync::CancellationToken;

#[test]
fn register_and_cancel_run() {
    let state = AppState::default();
    let token = CancellationToken::new();
    state.register_run_for_interview(42, token.clone());
    assert!(!token.is_cancelled());
    state.cancel_run_for_interview(42).unwrap();
    assert!(token.is_cancelled());
}

#[test]
fn cancel_unknown_returns_not_found() {
    let state = AppState::default();
    let err = state.cancel_run_for_interview(99).unwrap_err();
    assert!(matches!(err, faden_app_lib::error::AppError::NotFound(_)));
}

#[test]
fn deregister_clears() {
    let state = AppState::default();
    let token = CancellationToken::new();
    state.register_run_for_interview(1, token);
    state.deregister_run_for_interview(1);
    let err = state.cancel_run_for_interview(1).unwrap_err();
    assert!(matches!(err, faden_app_lib::error::AppError::NotFound(_)));
}
