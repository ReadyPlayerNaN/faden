use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "stage")]
pub enum TranscriptionProgress {
    #[serde(rename = "starting")]
    Starting { interview_id: i64, run_id: i64 },
    #[serde(rename = "normalizing")]
    Normalizing { interview_id: i64 },
    #[serde(rename = "chunking")]
    Chunking { interview_id: i64, total_chunks: usize },
    #[serde(rename = "transcribing_chunk")]
    TranscribingChunk { interview_id: i64, index: usize, total: usize, attempt: u32 },
    #[serde(rename = "chunk_complete")]
    ChunkComplete { interview_id: i64, index: usize, segments_added: usize },
    #[serde(rename = "complete")]
    Complete { interview_id: i64, total_segments: usize },
    #[serde(rename = "failed")]
    Failed { interview_id: i64, message: String },
    #[serde(rename = "cancelled")]
    Cancelled { interview_id: i64 },
}

pub const EVENT_NAME: &str = "transcription:progress";
