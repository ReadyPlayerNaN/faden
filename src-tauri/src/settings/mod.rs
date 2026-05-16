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

    pub fn new(path: String, display_name: Option<String>) -> Self {
        let mut entry = Self::from_path(path);
        if let Some(display_name) = display_name {
            entry.display_name = display_name;
        }
        entry
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
            One::Obj { path, display_name } => RecentProject::new(path, display_name),
        })
        .collect())
}

fn default_transcription_model() -> String {
    "gemini-3-flash-preview".into()
}

fn default_ai_model() -> String {
    "gemini-3-flash-preview".into()
}

pub const PROJECT_LANGUAGES: &[(&str, &str)] = &[
    ("ar", "Arabic"),
    ("bg", "Bulgarian"),
    ("bn", "Bengali"),
    ("ca", "Catalan"),
    ("cs", "Czech"),
    ("da", "Danish"),
    ("de", "German"),
    ("el", "Greek"),
    ("en", "English"),
    ("es", "Spanish"),
    ("et", "Estonian"),
    ("fa", "Persian"),
    ("fi", "Finnish"),
    ("fr", "French"),
    ("he", "Hebrew"),
    ("hi", "Hindi"),
    ("hr", "Croatian"),
    ("hu", "Hungarian"),
    ("id", "Indonesian"),
    ("it", "Italian"),
    ("ja", "Japanese"),
    ("ko", "Korean"),
    ("lt", "Lithuanian"),
    ("lv", "Latvian"),
    ("nl", "Dutch"),
    ("no", "Norwegian"),
    ("pl", "Polish"),
    ("pt", "Portuguese"),
    ("ro", "Romanian"),
    ("ru", "Russian"),
    ("sk", "Slovak"),
    ("sl", "Slovenian"),
    ("sr", "Serbian"),
    ("sv", "Swedish"),
    ("ta", "Tamil"),
    ("th", "Thai"),
    ("tr", "Turkish"),
    ("uk", "Ukrainian"),
    ("ur", "Urdu"),
    ("vi", "Vietnamese"),
    ("zh", "Chinese"),
];

pub fn project_language_name(code: &str) -> Option<&'static str> {
    PROJECT_LANGUAGES
        .iter()
        .find(|(candidate, _)| *candidate == code)
        .map(|(_, name)| *name)
}

pub fn canonical_project_language(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }
    let normalized = trimmed.to_ascii_lowercase();
    let primary = normalized
        .split(['-', '_', '.'])
        .next()
        .unwrap_or_default()
        .trim();
    PROJECT_LANGUAGES
        .iter()
        .find(|(code, name)| {
            *code == primary || name.to_ascii_lowercase() == normalized || (*code == "cs" && primary == "cz")
        })
        .map(|(code, _)| (*code).to_string())
}

pub fn resolve_definitive_language(preferred: Option<&str>) -> String {
    preferred
        .and_then(canonical_project_language)
        .or_else(|| {
            std::env::var("LANG")
                .ok()
                .as_deref()
                .and_then(canonical_project_language)
        })
        .unwrap_or_else(|| "en".into())
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

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredSettings {
    #[serde(default, deserialize_with = "deserialize_recents")]
    recent_projects: Vec<RecentProject>,
    #[serde(default)]
    ui_language: Option<String>,
    #[serde(default = "default_transcription_model")]
    default_transcription_model: String,
    #[serde(default = "default_ai_model")]
    default_ai_model: String,
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

impl Default for StoredSettings {
    fn default() -> Self {
        Self {
            recent_projects: Vec::new(),
            ui_language: None,
            default_transcription_model: default_transcription_model(),
            default_ai_model: default_ai_model(),
        }
    }
}

impl From<StoredSettings> for GlobalSettings {
    fn from(value: StoredSettings) -> Self {
        Self {
            gemini_api_key: String::new(),
            recent_projects: value.recent_projects,
            ui_language: value.ui_language,
            default_transcription_model: value.default_transcription_model,
            default_ai_model: value.default_ai_model,
        }
    }
}

impl From<&GlobalSettings> for StoredSettings {
    fn from(value: &GlobalSettings) -> Self {
        Self {
            recent_projects: value.recent_projects.clone(),
            ui_language: value.ui_language.clone(),
            default_transcription_model: value.default_transcription_model.clone(),
            default_ai_model: value.default_ai_model.clone(),
        }
    }
}

impl GlobalSettings {
    pub fn add_recent(&mut self, path: String, display_name: Option<String>) {
        let entry = RecentProject::new(path, display_name);
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
        Ok(serde_json::from_str::<StoredSettings>(&raw)?.into())
    }

    pub fn save(&self, settings: &GlobalSettings) -> AppResult<()> {
        std::fs::create_dir_all(&self.dir)?;
        let raw = serde_json::to_string_pretty(&StoredSettings::from(settings))?;
        std::fs::write(self.file(), raw)?;
        Ok(())
    }

    pub fn legacy_gemini_api_key(&self) -> AppResult<Option<String>> {
        let f = self.file();
        if !f.exists() {
            return Ok(None);
        }
        let raw = std::fs::read_to_string(&f)?;
        let value: serde_json::Value = serde_json::from_str(&raw)?;
        Ok(value
            .get("gemini_api_key")
            .and_then(|v| v.as_str())
            .map(ToOwned::to_owned))
    }
}
