use crate::import::plain_text::ParsedTranscript;

#[derive(Debug, Clone, PartialEq)]
pub enum AlignmentResult {
    Ok,
    Approximate {
        last_segment_end: f64,
        audio_duration: f64,
    },
    OutOfRange {
        offending_segment_index: usize,
    },
}

pub fn validate_alignment(parsed: &ParsedTranscript, audio_duration: f64) -> AlignmentResult {
    for (i, s) in parsed.segments.iter().enumerate() {
        if s.end_sec > audio_duration + 5.0 {
            return AlignmentResult::OutOfRange {
                offending_segment_index: i,
            };
        }
    }
    let last = parsed.segments.last().map(|s| s.end_sec).unwrap_or(0.0);
    let diff = (last - audio_duration).abs();
    if last + 30.0 < audio_duration || (last > audio_duration && diff <= 5.0) {
        return AlignmentResult::Approximate {
            last_segment_end: last,
            audio_duration,
        };
    }
    AlignmentResult::Ok
}
