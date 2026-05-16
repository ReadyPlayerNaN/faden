use crate::error::{AppError, AppResult};
use crate::settings::SettingsStore;
use keyring::{Entry, Error as KeyringError};
use tauri::AppHandle;

const GEMINI_API_KEY_ACCOUNT: &str = "gemini_api_key";

fn gemini_entry(app: &AppHandle) -> AppResult<Entry> {
    Entry::new(&app.config().identifier, GEMINI_API_KEY_ACCOUNT)
        .map_err(|e| AppError::Invalid(format!("secure storage setup failed: {e}")))
}

pub fn get_gemini_api_key(app: &AppHandle) -> AppResult<Option<String>> {
    match gemini_entry(app)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(e) => Err(AppError::Invalid(format!(
            "failed to read Gemini API key from secure storage: {e}"
        ))),
    }
}

pub fn set_gemini_api_key(app: &AppHandle, value: &str) -> AppResult<()> {
    let entry = gemini_entry(app)?;
    if value.is_empty() {
        match entry.delete_password() {
            Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
            Err(e) => Err(AppError::Invalid(format!(
                "failed to remove Gemini API key from secure storage: {e}"
            ))),
        }
    } else {
        entry.set_password(value).map_err(|e| {
            AppError::Invalid(format!(
                "failed to store Gemini API key in secure storage: {e}"
            ))
        })
    }
}

pub fn resolve_gemini_api_key(app: &AppHandle, store: &SettingsStore) -> AppResult<String> {
    let legacy_key = store.legacy_gemini_api_key()?;
    let secure_key = match get_gemini_api_key(app)? {
        Some(key) => key,
        None => match legacy_key.as_deref() {
            Some(key) if !key.is_empty() => {
                set_gemini_api_key(app, key)?;
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
