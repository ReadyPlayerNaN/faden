pub mod project;

use crate::error::AppResult;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

const RECENT_LIMIT: usize = 10;
const FILE_NAME: &str = "settings.json";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RecentProject {
    pub path: String,
    pub display_name: String,
}

impl RecentProject {
    pub fn from_path(path: String) -> Self {
        let display_name = std::path::Path::new(&path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or(&path)
            .to_string();
        Self { path, display_name }
    }
}

fn deserialize_recents<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> Result<Vec<RecentProject>, D::Error> {
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum One {
        Str(String),
        Obj {
            path: String,
            #[serde(default)]
            display_name: Option<String>,
        },
    }
    let items: Vec<One> = Vec::deserialize(d)?;
    Ok(items
        .into_iter()
        .map(|o| match o {
            One::Str(path) => RecentProject::from_path(path),
            One::Obj { path, display_name } => {
                let display_name = display_name.unwrap_or_else(|| {
                    std::path::Path::new(&path)
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or(&path)
                        .to_string()
                });
                RecentProject { path, display_name }
            }
        })
        .collect())
}

fn default_transcription_model() -> String {
    "gemini-3-flash-preview".into()
}

fn default_ai_model() -> String {
    "gemini-3-flash-preview".into()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GlobalSettings {
    #[serde(default)]
    pub gemini_api_key: String,
    #[serde(default, deserialize_with = "deserialize_recents")]
    pub recent_projects: Vec<RecentProject>,
    #[serde(default)]
    pub ui_language: Option<String>,
    #[serde(default = "default_transcription_model")]
    pub default_transcription_model: String,
    #[serde(default = "default_ai_model")]
    pub default_ai_model: String,
}

impl Default for GlobalSettings {
    fn default() -> Self {
        Self {
            gemini_api_key: String::new(),
            recent_projects: Vec::new(),
            ui_language: None,
            default_transcription_model: default_transcription_model(),
            default_ai_model: default_ai_model(),
        }
    }
}

impl GlobalSettings {
    pub fn add_recent(&mut self, path: String) {
        let entry = RecentProject::from_path(path);
        self.recent_projects.retain(|p| p.path != entry.path);
        self.recent_projects.insert(0, entry);
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
