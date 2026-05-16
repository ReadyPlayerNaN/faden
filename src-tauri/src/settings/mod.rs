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

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum LlmProvider {
    #[serde(rename = "gemini")]
    Gemini,
    #[serde(rename = "openai")]
    OpenAi,
    #[serde(rename = "anthropic")]
    Anthropic,
    #[serde(rename = "ollama")]
    Ollama,
}

impl LlmProvider {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Gemini => "gemini",
            Self::OpenAi => "openai",
            Self::Anthropic => "anthropic",
            Self::Ollama => "ollama",
        }
    }

    pub fn requires_api_key(&self) -> bool {
        !matches!(self, Self::Ollama)
    }
}

fn default_openai_base_url() -> String {
    "https://api.openai.com/v1".into()
}

fn default_anthropic_base_url() -> String {
    "https://api.anthropic.com".into()
}

fn default_ollama_base_url() -> String {
    "http://127.0.0.1:11434".into()
}

fn default_transcription_selection() -> TaskModelSelection {
    TaskModelSelection {
        provider: LlmProvider::Gemini,
        model: "gemini-3-flash-preview".into(),
    }
}

fn default_general_ai_selection() -> TaskModelSelection {
    TaskModelSelection {
        provider: LlmProvider::Gemini,
        model: "gemini-3-flash-preview".into(),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TaskModelSelection {
    pub provider: LlmProvider,
    pub model: String,
}

impl TaskModelSelection {
    pub fn model_ref(&self) -> String {
        format!("{}/{}", self.provider.as_str(), self.model)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeminiProviderSettings {
    #[serde(default)]
    pub api_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenAiProviderSettings {
    #[serde(default)]
    pub api_key: String,
    #[serde(default = "default_openai_base_url")]
    pub base_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnthropicProviderSettings {
    #[serde(default)]
    pub api_key: String,
    #[serde(default = "default_anthropic_base_url")]
    pub base_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OllamaProviderSettings {
    #[serde(default = "default_ollama_base_url")]
    pub base_url: String,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub password: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderSettings {
    #[serde(default)]
    pub gemini: GeminiProviderSettings,
    #[serde(default)]
    pub openai: OpenAiProviderSettings,
    #[serde(default)]
    pub anthropic: AnthropicProviderSettings,
    #[serde(default)]
    pub ollama: OllamaProviderSettings,
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
            *code == primary
                || name.to_ascii_lowercase() == normalized
                || (*code == "cs" && primary == "cz")
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
    #[serde(default, deserialize_with = "deserialize_recents")]
    pub recent_projects: Vec<RecentProject>,
    #[serde(default)]
    pub ui_language: Option<String>,
    #[serde(default = "default_transcription_selection")]
    pub transcription: TaskModelSelection,
    #[serde(default = "default_general_ai_selection")]
    pub general_ai: TaskModelSelection,
    #[serde(default)]
    pub providers: ProviderSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredOpenAiProviderSettings {
    #[serde(default = "default_openai_base_url")]
    base_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredAnthropicProviderSettings {
    #[serde(default = "default_anthropic_base_url")]
    base_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredOllamaProviderSettings {
    #[serde(default = "default_ollama_base_url")]
    base_url: String,
    #[serde(default)]
    username: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredProviderSettings {
    #[serde(default)]
    gemini: StoredGeminiProviderSettings,
    #[serde(default)]
    openai: StoredOpenAiProviderSettings,
    #[serde(default)]
    anthropic: StoredAnthropicProviderSettings,
    #[serde(default)]
    ollama: StoredOllamaProviderSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct StoredGeminiProviderSettings {}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredSettings {
    #[serde(default, deserialize_with = "deserialize_recents")]
    recent_projects: Vec<RecentProject>,
    #[serde(default)]
    ui_language: Option<String>,
    #[serde(default = "default_transcription_selection")]
    transcription: TaskModelSelection,
    #[serde(default = "default_general_ai_selection")]
    general_ai: TaskModelSelection,
    #[serde(default)]
    providers: StoredProviderSettings,
}

impl Default for GeminiProviderSettings {
    fn default() -> Self {
        Self {
            api_key: String::new(),
        }
    }
}

impl Default for OpenAiProviderSettings {
    fn default() -> Self {
        Self {
            api_key: String::new(),
            base_url: default_openai_base_url(),
        }
    }
}

impl Default for AnthropicProviderSettings {
    fn default() -> Self {
        Self {
            api_key: String::new(),
            base_url: default_anthropic_base_url(),
        }
    }
}

impl Default for OllamaProviderSettings {
    fn default() -> Self {
        Self {
            base_url: default_ollama_base_url(),
            username: String::new(),
            password: String::new(),
        }
    }
}

impl Default for ProviderSettings {
    fn default() -> Self {
        Self {
            gemini: GeminiProviderSettings::default(),
            openai: OpenAiProviderSettings::default(),
            anthropic: AnthropicProviderSettings::default(),
            ollama: OllamaProviderSettings::default(),
        }
    }
}

impl Default for StoredOpenAiProviderSettings {
    fn default() -> Self {
        Self {
            base_url: default_openai_base_url(),
        }
    }
}

impl Default for StoredAnthropicProviderSettings {
    fn default() -> Self {
        Self {
            base_url: default_anthropic_base_url(),
        }
    }
}

impl Default for StoredOllamaProviderSettings {
    fn default() -> Self {
        Self {
            base_url: default_ollama_base_url(),
            username: String::new(),
        }
    }
}

impl Default for StoredProviderSettings {
    fn default() -> Self {
        Self {
            gemini: StoredGeminiProviderSettings::default(),
            openai: StoredOpenAiProviderSettings::default(),
            anthropic: StoredAnthropicProviderSettings::default(),
            ollama: StoredOllamaProviderSettings::default(),
        }
    }
}

impl Default for GlobalSettings {
    fn default() -> Self {
        Self {
            recent_projects: Vec::new(),
            ui_language: None,
            transcription: default_transcription_selection(),
            general_ai: default_general_ai_selection(),
            providers: ProviderSettings::default(),
        }
    }
}

impl Default for StoredSettings {
    fn default() -> Self {
        Self {
            recent_projects: Vec::new(),
            ui_language: None,
            transcription: default_transcription_selection(),
            general_ai: default_general_ai_selection(),
            providers: StoredProviderSettings::default(),
        }
    }
}

impl From<StoredSettings> for GlobalSettings {
    fn from(value: StoredSettings) -> Self {
        Self {
            recent_projects: value.recent_projects,
            ui_language: value.ui_language,
            transcription: value.transcription,
            general_ai: value.general_ai,
            providers: ProviderSettings {
                gemini: GeminiProviderSettings::default(),
                openai: OpenAiProviderSettings {
                    api_key: String::new(),
                    base_url: value.providers.openai.base_url,
                },
                anthropic: AnthropicProviderSettings {
                    api_key: String::new(),
                    base_url: value.providers.anthropic.base_url,
                },
                ollama: OllamaProviderSettings {
                    base_url: value.providers.ollama.base_url,
                    username: value.providers.ollama.username,
                    password: String::new(),
                },
            },
        }
    }
}

impl From<&GlobalSettings> for StoredSettings {
    fn from(value: &GlobalSettings) -> Self {
        Self {
            recent_projects: value.recent_projects.clone(),
            ui_language: value.ui_language.clone(),
            transcription: value.transcription.clone(),
            general_ai: value.general_ai.clone(),
            providers: StoredProviderSettings {
                gemini: StoredGeminiProviderSettings::default(),
                openai: StoredOpenAiProviderSettings {
                    base_url: value.providers.openai.base_url.clone(),
                },
                anthropic: StoredAnthropicProviderSettings {
                    base_url: value.providers.anthropic.base_url.clone(),
                },
                ollama: StoredOllamaProviderSettings {
                    base_url: value.providers.ollama.base_url.clone(),
                    username: value.providers.ollama.username.clone(),
                },
            },
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
        let mut value: serde_json::Value = serde_json::from_str(&raw)?;
        self.migrate_legacy_shape(&mut value);
        Ok(serde_json::from_value::<StoredSettings>(value)?.into())
    }

    fn migrate_legacy_shape(&self, value: &mut serde_json::Value) {
        let Some(root) = value.as_object_mut() else {
            return;
        };

        if !root.contains_key("transcription") {
            let model = root
                .get("default_transcription_model")
                .and_then(|v| v.as_str())
                .unwrap_or("gemini-3-flash-preview");
            root.insert(
                "transcription".into(),
                serde_json::json!({
                    "provider": "gemini",
                    "model": model,
                }),
            );
        }

        if !root.contains_key("general_ai") {
            let model = root
                .get("default_ai_model")
                .and_then(|v| v.as_str())
                .unwrap_or("gemini-3-flash-preview");
            root.insert(
                "general_ai".into(),
                serde_json::json!({
                    "provider": "gemini",
                    "model": model,
                }),
            );
        }

        if !root.contains_key("providers") {
            root.insert(
                "providers".into(),
                serde_json::json!({
                    "gemini": {},
                    "openai": { "base_url": default_openai_base_url() },
                    "anthropic": { "base_url": default_anthropic_base_url() },
                    "ollama": { "base_url": default_ollama_base_url() }
                }),
            );
        }
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
