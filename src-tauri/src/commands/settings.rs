use crate::commands::util::project_conn;
use crate::db::queries::project_meta;
use crate::error::AppResult;
use crate::secrets::{resolve_gemini_api_key, set_gemini_api_key};
use crate::settings::project::ProjectSettings;
use crate::settings::{canonical_project_language, resolve_definitive_language, GlobalSettings, SettingsStore};
use std::path::PathBuf;
use tauri::Manager;

fn store_for(app: &tauri::AppHandle) -> AppResult<SettingsStore> {
    let dir: PathBuf = app.path().app_config_dir()?;
    Ok(SettingsStore::new(dir))
}

fn hydrate_settings(app: &tauri::AppHandle, store: &SettingsStore) -> AppResult<GlobalSettings> {
    let mut settings = store.load()?;
    settings.gemini_api_key = resolve_gemini_api_key(app, store)?;
    Ok(settings)
}

#[tauri::command]
pub async fn settings_get(app: tauri::AppHandle) -> AppResult<GlobalSettings> {
    let store = store_for(&app)?;
    hydrate_settings(&app, &store)
}

#[tauri::command]
pub async fn settings_set(app: tauri::AppHandle, mut value: GlobalSettings) -> AppResult<()> {
    set_gemini_api_key(&app, &value.gemini_api_key)?;
    value.gemini_api_key.clear();
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
    hydrate_settings(&app, &store)
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
    hydrate_settings(&app, &store)
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
    hydrate_settings(&app, &store)
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
pub async fn project_settings_set(app: tauri::AppHandle, mut value: ProjectSettings) -> AppResult<()> {
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
