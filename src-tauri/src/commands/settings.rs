use crate::ai::cost;
use crate::commands::util::project_conn;
use crate::db::queries::project_meta;
use crate::error::{AppError, AppResult};
use crate::secrets::{hydrate_global_settings, set_ollama_password, set_provider_api_key};
use crate::settings::project::ProjectSettings;
use crate::settings::{
    canonical_project_language, resolve_definitive_language, GlobalSettings, LlmProvider,
    SettingsStore,
};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::Command;
use tauri::Manager;

fn store_for(app: &tauri::AppHandle) -> AppResult<SettingsStore> {
    let dir: PathBuf = app.path().app_config_dir()?;
    Ok(SettingsStore::new(dir))
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConnectionStep {
    pub label: String,
    pub status: String,
    pub detail: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConnectionTestResult {
    pub provider: String,
    pub base_url: Option<String>,
    pub checked_model: Option<String>,
    pub reachable: bool,
    pub authenticated: bool,
    pub model_available: Option<bool>,
    pub pricing_known: bool,
    pub ok: bool,
    pub message: String,
    pub steps: Vec<ProviderConnectionStep>,
}

#[tauri::command]
pub async fn settings_get(app: tauri::AppHandle) -> AppResult<GlobalSettings> {
    let store = store_for(&app)?;
    hydrate_global_settings(&app, &store)
}

fn command_stdout(program: &str, args: &[&str]) -> Option<String> {
    let output = Command::new(program).args(args).output().ok()?;
    if !output.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[cfg(target_os = "linux")]
fn detect_linux_portal_appearance() -> Option<String> {
    let value = command_stdout(
        "gdbus",
        &[
            "call",
            "--session",
            "--dest",
            "org.freedesktop.portal.Desktop",
            "--object-path",
            "/org/freedesktop/portal/desktop",
            "--method",
            "org.freedesktop.portal.Settings.Read",
            "org.freedesktop.appearance",
            "color-scheme",
        ],
    )?;

    if value.contains("uint32 1") {
        return Some("dark".into());
    }
    if value.contains("uint32 2") || value.contains("uint32 0") {
        return Some("light".into());
    }
    None
}

#[cfg(target_os = "linux")]
fn detect_linux_gsettings_appearance() -> Option<String> {
    if let Some(value) = command_stdout(
        "gsettings",
        &["get", "org.gnome.desktop.interface", "color-scheme"],
    ) {
        let normalized = value.trim_matches('"').trim_matches('\'').trim();
        if normalized.eq_ignore_ascii_case("prefer-dark") {
            return Some("dark".into());
        }
        if normalized.eq_ignore_ascii_case("prefer-light")
            || normalized.eq_ignore_ascii_case("default")
            || normalized.eq_ignore_ascii_case("no-preference")
        {
            return Some("light".into());
        }
    }

    if let Some(value) = command_stdout(
        "gsettings",
        &["get", "org.gnome.desktop.interface", "gtk-theme"],
    ) {
        let normalized = value.trim_matches('"').trim_matches('\'').trim();
        let lowered = normalized.to_ascii_lowercase();
        if lowered.ends_with("-dark") || lowered.ends_with(":dark") {
            return Some("dark".into());
        }
        return Some("light".into());
    }

    None
}

#[cfg(target_os = "linux")]
fn detect_linux_system_appearance() -> String {
    detect_linux_portal_appearance()
        .or_else(detect_linux_gsettings_appearance)
        .unwrap_or_else(|| "light".into())
}

#[cfg(not(target_os = "linux"))]
fn detect_linux_system_appearance() -> String {
    "dark".into()
}

#[tauri::command]
pub async fn settings_system_appearance() -> AppResult<String> {
    Ok(detect_linux_system_appearance())
}

#[tauri::command]
pub async fn settings_set(app: tauri::AppHandle, mut value: GlobalSettings) -> AppResult<()> {
    set_provider_api_key(&app, LlmProvider::Gemini, &value.providers.gemini.api_key)?;
    set_provider_api_key(&app, LlmProvider::OpenAi, &value.providers.openai.api_key)?;
    set_provider_api_key(
        &app,
        LlmProvider::Anthropic,
        &value.providers.anthropic.api_key,
    )?;
    set_ollama_password(&app, &value.providers.ollama.password)?;

    value.providers.gemini.api_key.clear();
    value.providers.openai.api_key.clear();
    value.providers.anthropic.api_key.clear();
    value.providers.ollama.password.clear();

    store_for(&app)?.save(&value)
}

#[tauri::command]
pub async fn settings_add_recent(
    app: tauri::AppHandle,
    path: String,
    display_name: Option<String>,
) -> AppResult<GlobalSettings> {
    let store = store_for(&app)?;
    let mut s = store.load()?;
    s.add_recent(path, display_name);
    store.save(&s)?;
    hydrate_global_settings(&app, &store)
}

#[tauri::command]
pub async fn settings_recent_rename(
    app: tauri::AppHandle,
    path: String,
    display_name: String,
) -> AppResult<GlobalSettings> {
    let store = store_for(&app)?;
    let mut s = store.load()?;
    for r in &mut s.recent_projects {
        if r.path == path {
            r.display_name = display_name.clone();
        }
    }
    store.save(&s)?;
    hydrate_global_settings(&app, &store)
}

#[tauri::command]
pub async fn settings_recent_remove(
    app: tauri::AppHandle,
    path: String,
) -> AppResult<GlobalSettings> {
    let store = store_for(&app)?;
    let mut s = store.load()?;
    s.recent_projects.retain(|r| r.path != path);
    store.save(&s)?;
    hydrate_global_settings(&app, &store)
}

async fn test_gemini(
    base_url: &str,
    api_key: &str,
    model: &str,
) -> AppResult<(bool, bool, Option<bool>, Vec<ProviderConnectionStep>)> {
    let mut steps = Vec::new();
    let url = format!(
        "{}/v1beta/models?key={}",
        base_url.trim_end_matches('/'),
        api_key
    );
    let response = reqwest::Client::new()
        .get(&url)
        .send()
        .await
        .map_err(|e| AppError::Invalid(format!("gemini connection failed: {e}")))?;
    let reachable = true;
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if !status.is_success() {
        steps.push(ProviderConnectionStep {
            label: "HTTP".into(),
            status: "error".into(),
            detail: format!("Gemini returned {}", status.as_u16()),
        });
        return Ok((reachable, false, None, steps));
    }
    steps.push(ProviderConnectionStep {
        label: "HTTP".into(),
        status: "ok".into(),
        detail: "Gemini API reachable".into(),
    });
    let model_available = serde_json::from_str::<serde_json::Value>(&body)
        .ok()
        .and_then(|json| json.get("models").and_then(|v| v.as_array()).cloned())
        .map(|models| {
            models.iter().any(|entry| {
                entry
                    .get("name")
                    .and_then(|v| v.as_str())
                    .map(|name| name.ends_with(&format!("/{model}")))
                    .unwrap_or(false)
            })
        });
    steps.push(ProviderConnectionStep {
        label: "Auth".into(),
        status: "ok".into(),
        detail: "API key accepted".into(),
    });
    steps.push(ProviderConnectionStep {
        label: "Model".into(),
        status: if model_available == Some(true) {
            "ok"
        } else {
            "warn"
        }
        .into(),
        detail: match model_available {
            Some(true) => format!("Model {model} is listed by Gemini"),
            Some(false) => format!("Model {model} was not found in Gemini model list"),
            None => "Could not verify model from Gemini response".into(),
        },
    });
    Ok((reachable, true, model_available, steps))
}

async fn test_openai(
    base_url: &str,
    api_key: &str,
    model: &str,
) -> AppResult<(bool, bool, Option<bool>, Vec<ProviderConnectionStep>)> {
    let mut steps = Vec::new();
    let url = format!("{}/models", base_url.trim_end_matches('/'));
    let response = reqwest::Client::new()
        .get(&url)
        .bearer_auth(api_key)
        .send()
        .await
        .map_err(|e| AppError::Invalid(format!("openai connection failed: {e}")))?;
    let reachable = true;
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if !status.is_success() {
        steps.push(ProviderConnectionStep {
            label: "HTTP".into(),
            status: "error".into(),
            detail: format!("OpenAI returned {}", status.as_u16()),
        });
        return Ok((reachable, false, None, steps));
    }
    steps.push(ProviderConnectionStep {
        label: "HTTP".into(),
        status: "ok".into(),
        detail: "OpenAI API reachable".into(),
    });
    let model_available = serde_json::from_str::<serde_json::Value>(&body)
        .ok()
        .and_then(|json| json.get("data").and_then(|v| v.as_array()).cloned())
        .map(|models| {
            models
                .iter()
                .any(|entry| entry.get("id").and_then(|v| v.as_str()) == Some(model))
        });
    steps.push(ProviderConnectionStep {
        label: "Auth".into(),
        status: "ok".into(),
        detail: "API key accepted".into(),
    });
    steps.push(ProviderConnectionStep {
        label: "Model".into(),
        status: if model_available == Some(true) {
            "ok"
        } else {
            "warn"
        }
        .into(),
        detail: match model_available {
            Some(true) => format!("Model {model} is listed by OpenAI"),
            Some(false) => format!("Model {model} was not found in OpenAI model list"),
            None => "Could not verify model from OpenAI response".into(),
        },
    });
    Ok((reachable, true, model_available, steps))
}

async fn test_anthropic(
    base_url: &str,
    api_key: &str,
    model: &str,
) -> AppResult<(bool, bool, Option<bool>, Vec<ProviderConnectionStep>)> {
    let mut steps = Vec::new();
    let url = format!("{}/v1/messages", base_url.trim_end_matches('/'));
    let response = reqwest::Client::new()
        .post(&url)
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .json(&serde_json::json!({
            "model": model,
            "max_tokens": 1,
            "messages": [{ "role": "user", "content": "ping" }]
        }))
        .send()
        .await
        .map_err(|e| AppError::Invalid(format!("anthropic connection failed: {e}")))?;
    let reachable = true;
    let status = response.status();
    let _body = response.text().await.unwrap_or_default();
    if !status.is_success() {
        steps.push(ProviderConnectionStep {
            label: "HTTP".into(),
            status: "error".into(),
            detail: format!("Anthropic returned {}", status.as_u16()),
        });
        return Ok((reachable, false, None, steps));
    }
    steps.push(ProviderConnectionStep {
        label: "HTTP".into(),
        status: "ok".into(),
        detail: "Anthropic API reachable".into(),
    });
    steps.push(ProviderConnectionStep {
        label: "Auth".into(),
        status: "ok".into(),
        detail: "API key accepted".into(),
    });
    steps.push(ProviderConnectionStep {
        label: "Model".into(),
        status: "ok".into(),
        detail: format!("Model {model} accepted a lightweight test request"),
    });
    Ok((reachable, true, Some(true), steps))
}

async fn test_ollama(
    base_url: &str,
    username: &str,
    password: &str,
    model: &str,
) -> AppResult<(bool, bool, Option<bool>, Vec<ProviderConnectionStep>)> {
    let mut steps = Vec::new();
    let url = format!("{}/api/tags", base_url.trim_end_matches('/'));
    let mut request = reqwest::Client::new().get(&url);
    if !username.trim().is_empty() {
        request = request.basic_auth(username, Some(password));
    }
    let response = request
        .send()
        .await
        .map_err(|e| AppError::Invalid(format!("ollama connection failed: {e}")))?;
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if !status.is_success() {
        steps.push(ProviderConnectionStep {
            label: "HTTP".into(),
            status: "error".into(),
            detail: format!("Ollama returned {}", status.as_u16()),
        });
        return Ok((true, false, None, steps));
    }
    steps.push(ProviderConnectionStep {
        label: "HTTP".into(),
        status: "ok".into(),
        detail: "Ollama server reachable".into(),
    });
    steps.push(ProviderConnectionStep {
        label: "Auth".into(),
        status: if username.trim().is_empty() {
            "warn"
        } else {
            "ok"
        }
        .into(),
        detail: if username.trim().is_empty() {
            "No Ollama auth configured; tested anonymous access".into()
        } else {
            "Ollama auth credentials accepted".into()
        },
    });
    let model_available = serde_json::from_str::<serde_json::Value>(&body)
        .ok()
        .and_then(|json| json.get("models").and_then(|v| v.as_array()).cloned())
        .map(|models| {
            models
                .iter()
                .any(|entry| entry.get("name").and_then(|v| v.as_str()) == Some(model))
        });
    steps.push(ProviderConnectionStep {
        label: "Model".into(),
        status: if model_available == Some(true) {
            "ok"
        } else {
            "warn"
        }
        .into(),
        detail: match model_available {
            Some(true) => format!("Model {model} is installed in Ollama"),
            Some(false) => format!("Model {model} is not installed in Ollama yet"),
            None => "Could not verify the Ollama model list".into(),
        },
    });
    Ok((true, true, model_available, steps))
}

#[tauri::command]
pub async fn settings_provider_test(
    app: tauri::AppHandle,
    provider: String,
    model: Option<String>,
) -> AppResult<ProviderConnectionTestResult> {
    let settings = settings_get(app.clone()).await?;
    let provider = match provider.as_str() {
        "gemini" => LlmProvider::Gemini,
        "openai" => LlmProvider::OpenAi,
        "anthropic" => LlmProvider::Anthropic,
        "ollama" => LlmProvider::Ollama,
        other => return Err(AppError::Invalid(format!("unknown provider: {other}"))),
    };
    let checked_model = model.or_else(|| match provider {
        LlmProvider::Gemini if settings.transcription.provider == LlmProvider::Gemini => {
            Some(settings.transcription.model.clone())
        }
        LlmProvider::Gemini if settings.general_ai.provider == LlmProvider::Gemini => {
            Some(settings.general_ai.model.clone())
        }
        LlmProvider::Gemini => Some("gemini-3-flash-preview".into()),
        LlmProvider::OpenAi if settings.transcription.provider == LlmProvider::OpenAi => {
            Some(settings.transcription.model.clone())
        }
        LlmProvider::OpenAi if settings.general_ai.provider == LlmProvider::OpenAi => {
            Some(settings.general_ai.model.clone())
        }
        LlmProvider::OpenAi => Some("gpt-4.1-mini".into()),
        LlmProvider::Anthropic if settings.general_ai.provider == LlmProvider::Anthropic => {
            Some(settings.general_ai.model.clone())
        }
        LlmProvider::Anthropic => Some("claude-sonnet-4-20250514".into()),
        LlmProvider::Ollama if settings.general_ai.provider == LlmProvider::Ollama => {
            Some(settings.general_ai.model.clone())
        }
        LlmProvider::Ollama => Some("qwen3:14b".into()),
    });
    let model_name = checked_model.clone().unwrap_or_default();
    let base_url = match provider {
        LlmProvider::Gemini => Some("https://generativelanguage.googleapis.com".to_string()),
        LlmProvider::OpenAi => Some(settings.providers.openai.base_url.clone()),
        LlmProvider::Anthropic => Some(settings.providers.anthropic.base_url.clone()),
        LlmProvider::Ollama => Some(settings.providers.ollama.base_url.clone()),
    };
    let api_key_missing = match provider {
        LlmProvider::Gemini => settings.providers.gemini.api_key.trim().is_empty(),
        LlmProvider::OpenAi => settings.providers.openai.api_key.trim().is_empty(),
        LlmProvider::Anthropic => settings.providers.anthropic.api_key.trim().is_empty(),
        LlmProvider::Ollama => false,
    };
    if api_key_missing {
        return Ok(ProviderConnectionTestResult {
            provider: provider.as_str().to_string(),
            base_url,
            checked_model,
            reachable: false,
            authenticated: false,
            model_available: None,
            pricing_known: false,
            ok: false,
            message: format!("{} API key is missing", provider.as_str()),
            steps: vec![ProviderConnectionStep {
                label: "Auth".into(),
                status: "error".into(),
                detail: "Missing API key in secure storage".into(),
            }],
        });
    }
    let (reachable, authenticated, model_available, mut steps) = match provider {
        LlmProvider::Gemini => {
            test_gemini(
                base_url.as_deref().unwrap_or_default(),
                &settings.providers.gemini.api_key,
                &model_name,
            )
            .await?
        }
        LlmProvider::OpenAi => {
            test_openai(
                base_url.as_deref().unwrap_or_default(),
                &settings.providers.openai.api_key,
                &model_name,
            )
            .await?
        }
        LlmProvider::Anthropic => {
            test_anthropic(
                base_url.as_deref().unwrap_or_default(),
                &settings.providers.anthropic.api_key,
                &model_name,
            )
            .await?
        }
        LlmProvider::Ollama => {
            test_ollama(
                base_url.as_deref().unwrap_or_default(),
                &settings.providers.ollama.username,
                &settings.providers.ollama.password,
                &model_name,
            )
            .await?
        }
    };
    let pricing_known = checked_model
        .as_deref()
        .and_then(|m| cost::pricing_for(provider.as_str(), m))
        .is_some();
    steps.push(ProviderConnectionStep {
        label: "Pricing".into(),
        status: if pricing_known { "ok" } else { "warn" }.into(),
        detail: if pricing_known {
            "Built-in pricing metadata available for this model".into()
        } else {
            "No built-in pricing metadata for this model yet".into()
        },
    });
    let ok = reachable && authenticated;
    let message = if ok {
        format!("{} connection looks healthy", provider.as_str())
    } else {
        format!("{} connection check failed", provider.as_str())
    };
    Ok(ProviderConnectionTestResult {
        provider: provider.as_str().to_string(),
        base_url,
        checked_model,
        reachable,
        authenticated,
        model_available,
        pricing_known,
        ok,
        message,
        steps,
    })
}

#[tauri::command]
pub async fn project_settings_get(app: tauri::AppHandle) -> AppResult<ProjectSettings> {
    let conn = project_conn(&app)?;
    let mut settings = project_meta::read_settings(&conn)?;
    if settings.language.is_none() {
        let global = store_for(&app)?.load()?;
        settings.language = Some(resolve_definitive_language(global.ui_language.as_deref()));
    }
    Ok(settings)
}

#[tauri::command]
pub async fn project_settings_set(
    app: tauri::AppHandle,
    mut value: ProjectSettings,
) -> AppResult<()> {
    let global = store_for(&app)?.load()?;
    value.language = Some(match value.language.as_deref() {
        Some(language) => canonical_project_language(language).ok_or_else(|| {
            crate::error::AppError::Invalid(format!("unsupported project language: {language}"))
        })?,
        None => resolve_definitive_language(global.ui_language.as_deref()),
    });
    let conn = project_conn(&app)?;
    project_meta::write_settings(&conn, &value)
}
