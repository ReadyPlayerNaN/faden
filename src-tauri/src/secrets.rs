use crate::error::{AppError, AppResult};
use crate::settings::{GlobalSettings, LlmProvider, SettingsStore};
use keyring::{Entry, Error as KeyringError};
use tauri::AppHandle;

const GEMINI_API_KEY_ACCOUNT: &str = "gemini_api_key";
const OPENAI_API_KEY_ACCOUNT: &str = "openai_api_key";
const ANTHROPIC_API_KEY_ACCOUNT: &str = "anthropic_api_key";
const OLLAMA_PASSWORD_ACCOUNT: &str = "ollama_password";

fn entry(app: &AppHandle, account: &str) -> AppResult<Entry> {
    Entry::new(&app.config().identifier, account)
        .map_err(|e| AppError::Invalid(format!("secure storage setup failed: {e}")))
}

fn account_for(provider: LlmProvider) -> Option<&'static str> {
    match provider {
        LlmProvider::Gemini => Some(GEMINI_API_KEY_ACCOUNT),
        LlmProvider::OpenAi => Some(OPENAI_API_KEY_ACCOUNT),
        LlmProvider::Anthropic => Some(ANTHROPIC_API_KEY_ACCOUNT),
        LlmProvider::Ollama => None,
    }
}

fn label_for(provider: LlmProvider) -> &'static str {
    match provider {
        LlmProvider::Gemini => "gemini API key",
        LlmProvider::OpenAi => "openai API key",
        LlmProvider::Anthropic => "anthropic API key",
        LlmProvider::Ollama => "ollama password",
    }
}

fn get_secret(app: &AppHandle, account: &str, label: &str) -> AppResult<Option<String>> {
    match entry(app, account)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(e) => Err(AppError::Invalid(format!(
            "failed to read {label} from secure storage: {e}"
        ))),
    }
}

fn set_secret(app: &AppHandle, account: &str, label: &str, value: &str) -> AppResult<()> {
    let secret_entry = entry(app, account)?;
    if value.is_empty() {
        match secret_entry.delete_password() {
            Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
            Err(e) => Err(AppError::Invalid(format!(
                "failed to remove {label} from secure storage: {e}"
            ))),
        }
    } else {
        secret_entry.set_password(value).map_err(|e| {
            AppError::Invalid(format!("failed to store {label} in secure storage: {e}"))
        })
    }
}

pub fn resolve_provider_api_key(
    app: &AppHandle,
    store: &SettingsStore,
    provider: LlmProvider,
) -> AppResult<String> {
    let Some(account) = account_for(provider) else {
        return Ok(String::new());
    };
    let label = label_for(provider).to_string();
    let legacy_key = match provider {
        LlmProvider::Gemini => store.legacy_gemini_api_key()?,
        _ => None,
    };
    let secure_key = match get_secret(app, account, &label)? {
        Some(key) => key,
        None => match legacy_key.as_deref() {
            Some(key) if !key.is_empty() => {
                set_secret(app, account, &label, key)?;
                key.to_string()
            }
            _ => String::new(),
        },
    };
    if legacy_key.is_some() {
        let settings = store.load()?;
        store.save(&settings)?;
    }
    Ok(secure_key)
}

pub fn set_provider_api_key(app: &AppHandle, provider: LlmProvider, value: &str) -> AppResult<()> {
    let Some(account) = account_for(provider) else {
        return Ok(());
    };
    let label = label_for(provider).to_string();
    set_secret(app, account, &label, value)
}

pub fn resolve_ollama_password(app: &AppHandle) -> AppResult<String> {
    Ok(get_secret(app, OLLAMA_PASSWORD_ACCOUNT, "ollama password")?.unwrap_or_default())
}

pub fn set_ollama_password(app: &AppHandle, value: &str) -> AppResult<()> {
    set_secret(app, OLLAMA_PASSWORD_ACCOUNT, "ollama password", value)
}

pub fn hydrate_global_settings(
    app: &AppHandle,
    store: &SettingsStore,
) -> AppResult<GlobalSettings> {
    let mut settings = store.load()?;
    settings.providers.gemini.api_key = resolve_provider_api_key(app, store, LlmProvider::Gemini)?;
    settings.providers.openai.api_key = resolve_provider_api_key(app, store, LlmProvider::OpenAi)?;
    settings.providers.anthropic.api_key =
        resolve_provider_api_key(app, store, LlmProvider::Anthropic)?;
    settings.providers.ollama.password = resolve_ollama_password(app)?;
    Ok(settings)
}
