use crate::error::AppResult;
use crate::settings::{GlobalSettings, SettingsStore};
use std::path::PathBuf;
use tauri::Manager;

fn store_for(app: &tauri::AppHandle) -> AppResult<SettingsStore> {
    let dir: PathBuf = app.path().app_config_dir()?;
    Ok(SettingsStore::new(dir))
}

#[tauri::command]
pub async fn settings_get(app: tauri::AppHandle) -> AppResult<GlobalSettings> {
    store_for(&app)?.load()
}

#[tauri::command]
pub async fn settings_set(app: tauri::AppHandle, value: GlobalSettings) -> AppResult<()> {
    store_for(&app)?.save(&value)
}

#[tauri::command]
pub async fn settings_add_recent(app: tauri::AppHandle, path: String) -> AppResult<GlobalSettings> {
    let store = store_for(&app)?;
    let mut s = store.load()?;
    s.add_recent(path);
    store.save(&s)?;
    Ok(s)
}
