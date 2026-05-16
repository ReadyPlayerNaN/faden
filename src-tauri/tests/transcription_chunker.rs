use faden_app_lib::transcription::chunker::*;

#[test]
fn plans_two_full_chunks_for_840s() {
    let plans = plan_chunks(840.0, 420);
    assert_eq!(plans.len(), 2);
    assert_eq!(plans[0].duration_seconds, 420.0);
    assert_eq!(plans[1].duration_seconds, 420.0);
}

#[test]
fn plans_three_chunks_for_900s_last_short() {
    let plans = plan_chunks(900.0, 420);
    assert_eq!(plans.len(), 3);
    assert_eq!(plans[2].duration_seconds, 60.0);
}

#[test]
fn plans_one_short_chunk_for_10s() {
    let plans = plan_chunks(10.0, 420);
    assert_eq!(plans.len(), 1);
    assert_eq!(plans[0].duration_seconds, 10.0);
}

#[test]
fn plans_no_chunks_for_zero_duration() {
    assert!(plan_chunks(0.0, 420).is_empty());
}

#[test]
fn subchunks_splits_in_half() {
    let plans = plan_subchunks(420.0, 45.0).unwrap();
    assert_eq!(plans.len(), 2);
    assert_eq!(plans[0].duration_seconds, 210.0);
}

#[test]
fn subchunks_rejects_below_minimum() {
    let err = plan_subchunks(50.0, 45.0).unwrap_err();
    assert!(matches!(err, faden_app_lib::error::AppError::Invalid(_)));
}

#[test]
fn subchunks_handles_uneven_split() {
    let plans = plan_subchunks(100.0, 45.0).unwrap();
    // sub_duration = max(50.0, 45.0) = 50.0; two chunks of 50/50
    assert_eq!(plans.len(), 2);
    assert!((plans[0].duration_seconds - 50.0).abs() < 0.001);
    assert!((plans[1].duration_seconds - 50.0).abs() < 0.001);
}
