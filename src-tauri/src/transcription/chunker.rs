use crate::error::{AppError, AppResult};

pub const CHUNK_SECONDS: u32 = 420;
pub const MIN_SPLIT_CHUNK_SECONDS: f64 = 45.0;

#[derive(Debug, Clone, PartialEq)]
pub struct ChunkPlan {
    pub index: usize,
    pub offset_seconds: f64,
    pub duration_seconds: f64,
}

pub fn plan_chunks(total_duration: f64, chunk_seconds: u32) -> Vec<ChunkPlan> {
    plan_chunks_from(0.0, total_duration, chunk_seconds as f64, 0)
}

pub fn plan_chunks_from(
    start_offset_seconds: f64,
    total_duration: f64,
    chunk_seconds: f64,
    start_index: usize,
) -> Vec<ChunkPlan> {
    if total_duration <= start_offset_seconds || chunk_seconds <= 0.0 {
        return vec![];
    }
    let remaining_duration = total_duration - start_offset_seconds;
    let count = (remaining_duration / chunk_seconds).ceil() as usize;
    let mut out = Vec::with_capacity(count);
    for i in 0..count {
        let offset = start_offset_seconds + i as f64 * chunk_seconds;
        let duration = chunk_seconds.min(total_duration - offset);
        out.push(ChunkPlan {
            index: start_index + i,
            offset_seconds: offset,
            duration_seconds: duration,
        });
    }
    out
}

pub fn plan_subchunks(chunk_duration: f64, min_split_seconds: f64) -> AppResult<Vec<ChunkPlan>> {
    if chunk_duration < 2.0 * min_split_seconds {
        return Err(AppError::Invalid(format!(
            "cannot split further: chunk={chunk_duration:.1}s, min={min_split_seconds:.1}s"
        )));
    }
    let sub_duration = (chunk_duration / 2.0).max(min_split_seconds);
    if sub_duration >= chunk_duration {
        return Err(AppError::Invalid(format!(
            "cannot create smaller subchunks (duration={chunk_duration:.1}s)"
        )));
    }
    let count = (chunk_duration / sub_duration).ceil() as usize;
    let mut out = Vec::with_capacity(count);
    for i in 0..count {
        let offset = i as f64 * sub_duration;
        let duration = sub_duration.min(chunk_duration - offset);
        out.push(ChunkPlan {
            index: i,
            offset_seconds: offset,
            duration_seconds: duration,
        });
    }
    Ok(out)
}
