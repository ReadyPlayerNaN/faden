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
    if total_duration <= 0.0 {
        return vec![];
    }
    let chunk = chunk_seconds as f64;
    let count = (total_duration / chunk).ceil() as usize;
    let mut out = Vec::with_capacity(count);
    for i in 0..count {
        let offset = i as f64 * chunk;
        let duration = (chunk).min(total_duration - offset);
        out.push(ChunkPlan {
            index: i,
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
