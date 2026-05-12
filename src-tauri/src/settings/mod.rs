use crate::error::AppResult;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

const RECENT_LIMIT: usize = 10;
const FILE_NAME: &str = "settings.json";

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct GlobalSettings {
    #[serde(default)]
    pub gemini_api_key: String,
    #[serde(default)]
    pub recent_projects: Vec<String>,
    #[serde(default)]
    pub ui_language: Option<String>,
}

impl GlobalSettings {
    pub fn add_recent(&mut self, path: String) {
        self.recent_projects.retain(|p| p != &path);
        self.recent_projects.insert(0, path);
        if self.recent_projects.len() > RECENT_LIMIT {
            self.recent_projects.truncate(RECENT_LIMIT);
        }
    }
}

pub struct SettingsStore {
    dir: PathBuf,
}

impl SettingsStore {
    pub fn new(dir: PathBuf) -> Self {
        Self { dir }
    }

    fn file(&self) -> PathBuf {
        self.dir.join(FILE_NAME)
    }

    pub fn load(&self) -> AppResult<GlobalSettings> {
        let f = self.file();
        if !f.exists() {
            return Ok(GlobalSettings::default());
        }
        let raw = std::fs::read_to_string(&f)?;
        Ok(serde_json::from_str(&raw)?)
    }

    pub fn save(&self, settings: &GlobalSettings) -> AppResult<()> {
        std::fs::create_dir_all(&self.dir)?;
        let raw = serde_json::to_string_pretty(settings)?;
        std::fs::write(self.file(), raw)?;
        Ok(())
    }
}
