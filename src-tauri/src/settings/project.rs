use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ProjectSettings {
    #[serde(default)]
    pub language: Option<String>,
    #[serde(default)]
    pub prompts: PromptOverrides,
    #[serde(default)]
    pub transcription: TranscriptionParams,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PromptOverrides {
    #[serde(default)]
    pub transcription_system: Option<String>,
    #[serde(default)]
    pub transcription_user: Option<String>,
    #[serde(default)]
    pub codebook_gen: Option<String>,
    #[serde(default)]
    pub pretag: Option<String>,
    #[serde(default)]
    pub find_more: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptionParams {
    pub chunk_seconds: u32,
    pub channels: u32,
    pub sample_rate: u32,
    pub bitrate: String,
}

impl Default for TranscriptionParams {
    fn default() -> Self {
        Self {
            chunk_seconds: 420,
            channels: 1,
            sample_rate: 16000,
            bitrate: "64k".into(),
        }
    }
}
