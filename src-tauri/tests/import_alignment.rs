use stt_app_lib::import::alignment::{validate_alignment, AlignmentResult};
use stt_app_lib::import::plain_text::{ParsedSegment, ParsedSpeaker, ParsedTranscript};

fn make(segments: Vec<(f64, f64)>) -> ParsedTranscript {
    ParsedTranscript {
        speakers: vec![ParsedSpeaker {
            label_raw: "A".into(),
            display_name: None,
        }],
        segments: segments
            .into_iter()
            .map(|(s, e)| ParsedSegment {
                speaker_label: "A".into(),
                start_sec: s,
                end_sec: e,
                text: "x".into(),
            })
            .collect(),
        synthetic_timestamps: false,
    }
}

#[test]
fn ok_when_last_segment_close_to_duration() {
    let pt = make(vec![(0.0, 10.0), (10.0, 60.0)]);
    assert_eq!(validate_alignment(&pt, 62.0), AlignmentResult::Ok);
}

#[test]
fn approximate_when_short_compared_to_audio() {
    let pt = make(vec![(0.0, 10.0)]);
    let res = validate_alignment(&pt, 100.0);
    match res {
        AlignmentResult::Approximate { last_segment_end, audio_duration } => {
            assert_eq!(last_segment_end, 10.0);
            assert_eq!(audio_duration, 100.0);
        }
        other => panic!("expected Approximate, got {:?}", other),
    }
}

#[test]
fn approximate_when_slightly_over_within_5s() {
    let pt = make(vec![(0.0, 103.0)]);
    let res = validate_alignment(&pt, 100.0);
    match res {
        AlignmentResult::Approximate { .. } => {}
        other => panic!("expected Approximate, got {:?}", other),
    }
}

#[test]
fn out_of_range_when_segment_too_far_beyond_audio() {
    let pt = make(vec![(0.0, 10.0), (200.0, 250.0)]);
    let res = validate_alignment(&pt, 100.0);
    match res {
        AlignmentResult::OutOfRange { offending_segment_index } => {
            assert_eq!(offending_segment_index, 1);
        }
        other => panic!("expected OutOfRange, got {:?}", other),
    }
}
