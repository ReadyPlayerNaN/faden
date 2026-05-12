use crate::error::AppResult;
use crate::transcription::schema::ParsedSegment;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub struct ChunkCache {
    dir: PathBuf,
}

#[derive(Serialize)]
struct CachePayload<'a> {
    segments: &'a [ParsedSegment],
}

#[derive(Deserialize)]
struct CacheReadPayload {
    segments: Vec<ParsedSegment>,
}

impl ChunkCache {
    pub fn new(dir: PathBuf) -> Self {
        Self { dir }
    }
    pub fn dir(&self) -> &Path {
        &self.dir
    }
    pub fn ensure_dirs(&self) -> AppResult<()> {
        std::fs::create_dir_all(&self.dir)?;
        Ok(())
    }
    pub fn path_for(&self, index: usize) -> PathBuf {
        self.dir.join(format!("chunk_{:03}.json", index))
    }
    pub fn exists(&self, index: usize) -> bool {
        self.path_for(index).exists()
    }
    pub fn save(&self, index: usize, segments: &[ParsedSegment]) -> AppResult<()> {
        self.ensure_dirs()?;
        let payload = CachePayload { segments };
        let raw = serde_json::to_string_pretty(&payload)?;
        std::fs::write(self.path_for(index), raw)?;
        Ok(())
    }
    pub fn load(&self, index: usize) -> AppResult<Vec<ParsedSegment>> {
        let raw = std::fs::read_to_string(self.path_for(index))?;
        let p: CacheReadPayload = serde_json::from_str(&raw)?;
        Ok(p.segments)
    }
    pub fn load_all(&self) -> AppResult<Vec<ParsedSegment>> {
        if !self.dir.exists() {
            return Ok(vec![]);
        }
        let mut entries: Vec<PathBuf> = std::fs::read_dir(&self.dir)?
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| {
                p.file_name()
                    .and_then(|n| n.to_str())
                    .map(|n| n.starts_with("chunk_") && n.ends_with(".json"))
                    .unwrap_or(false)
            })
            .collect();
        entries.sort();
        let mut out = Vec::new();
        for path in entries {
            let raw = std::fs::read_to_string(&path)?;
            let p: CacheReadPayload = serde_json::from_str(&raw)?;
            out.extend(p.segments);
        }
        Ok(out)
    }
}
