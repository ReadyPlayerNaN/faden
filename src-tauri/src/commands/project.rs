use crate::commands::util::project_conn;
use crate::db;
use crate::db::queries::{ai_run, project_meta};
use crate::error::{AppError, AppResult};
use crate::settings::project::ProjectSettings;
use crate::settings::{canonical_project_language, resolve_definitive_language, SettingsStore};
use deunicode::deunicode;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::path::PathBuf;
use tauri::Manager;

const PROJECT_DB_FILE: &str = "project.sqlite";
const PROJECT_METADATA_FILE: &str = "project.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectInfo {
    pub path: String,
    pub name: String,
    pub language: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ProjectMetadata {
    name: String,
}

fn project_slug(name: &str) -> Option<String> {
    let ascii = deunicode(name).to_lowercase();
    let mut slug = String::new();
    let mut prev_dash = false;

    for ch in ascii.chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch);
            prev_dash = false;
        } else if !prev_dash && !slug.is_empty() {
            slug.push('-');
            prev_dash = true;
        }
    }

    let slug = slug.trim_matches('-').to_string();
    if slug.is_empty() {
        None
    } else {
        Some(slug)
    }
}

fn project_dir(root: &Path, name: &str) -> AppResult<PathBuf> {
    let slug = project_slug(name)
        .ok_or_else(|| AppError::Invalid("project name must contain letters or numbers".into()))?;
    Ok(root.join(slug))
}

fn projects_root(app: &tauri::AppHandle) -> AppResult<PathBuf> {
    Ok(app.path().document_dir()?.join(&app.package_info().name))
}

fn project_db_path(dir: &Path) -> PathBuf {
    dir.join(PROJECT_DB_FILE)
}

fn project_metadata_path(dir: &Path) -> PathBuf {
    dir.join(PROJECT_METADATA_FILE)
}

fn write_project_metadata(dir: &Path, name: &str) -> AppResult<()> {
    let raw = serde_json::to_string_pretty(&ProjectMetadata {
        name: name.to_string(),
    })?;
    std::fs::write(project_metadata_path(dir), raw)?;
    Ok(())
}

fn read_project_metadata(dir: &Path) -> AppResult<Option<ProjectMetadata>> {
    let path = project_metadata_path(dir);
    if !path.exists() {
        return Ok(None);
    }
    Ok(Some(serde_json::from_str(&std::fs::read_to_string(path)?)?))
}

pub async fn project_create_impl(
    root: PathBuf,
    name: String,
    language: String,
) -> AppResult<ProjectInfo> {
    let trimmed_name = name.trim();
    if trimmed_name.is_empty() {
        return Err(AppError::Invalid("project name cannot be empty".into()));
    }

    let dir = project_dir(&root, trimmed_name)?;
    if dir.exists() {
        return Err(AppError::Conflict(format!(
            "project already exists at {}",
            dir.display()
        )));
    }

    std::fs::create_dir_all(dir.join("media"))?;
    std::fs::create_dir_all(dir.join("cache"))?;
    let sqlite = project_db_path(&dir);
    let conn = db::open(&sqlite)?;
    project_meta::insert(&conn, trimmed_name)?;
    project_meta::write_settings(
        &conn,
        &ProjectSettings {
            language: Some(language.clone()),
            ..ProjectSettings::default()
        },
    )?;
    write_project_metadata(&dir, trimmed_name)?;

    Ok(ProjectInfo {
        path: dir.to_string_lossy().to_string(),
        name: trimmed_name.to_string(),
        language,
    })
}

pub async fn project_open_impl(path: String) -> AppResult<ProjectInfo> {
    let dir = Path::new(&path);
    let sqlite = project_db_path(dir);
    if !sqlite.exists() {
        return Err(AppError::NotFound(format!(
            "no project at {}",
            dir.display()
        )));
    }
    let conn = db::open(&sqlite)?;
    let db_meta = project_meta::read(&conn)?;
    let metadata = match read_project_metadata(dir)? {
        Some(metadata) => metadata,
        None => {
            let metadata = ProjectMetadata {
                name: db_meta.name.clone(),
            };
            write_project_metadata(dir, &metadata.name)?;
            metadata
        }
    };
    let settings = project_meta::read_settings(&conn)?;
    Ok(ProjectInfo {
        path,
        name: metadata.name,
        language: settings.language.unwrap_or_else(|| "en".into()),
    })
}

#[tauri::command]
pub async fn project_create(
    app: tauri::AppHandle,
    name: String,
    language: Option<String>,
) -> AppResult<ProjectInfo> {
    let root = projects_root(&app)?;
    let global = SettingsStore::new(app.path().app_config_dir()?).load()?;
    let resolved_language = match language.as_deref() {
        Some(language) => canonical_project_language(language).ok_or_else(|| {
            AppError::Invalid(format!("unsupported project language: {language}"))
        })?,
        None => resolve_definitive_language(global.ui_language.as_deref()),
    };
    let info = project_create_impl(root, name, resolved_language).await?;
    app.state::<crate::app_state::AppState>()
        .set_current(PathBuf::from(&info.path));
    Ok(info)
}

#[tauri::command]
pub async fn project_open(app: tauri::AppHandle, path: String) -> AppResult<ProjectInfo> {
    let mut info = project_open_impl(path.clone()).await?;
    app.state::<crate::app_state::AppState>()
        .set_current(PathBuf::from(&path));
    let conn = project_conn(&app)?;
    ai_run::reconcile_interrupted_runs(&conn)?;
    let global = SettingsStore::new(app.path().app_config_dir()?).load()?;
    info.language = resolve_definitive_language(
        Some(info.language.as_str())
            .filter(|value| !value.is_empty())
            .or(global.ui_language.as_deref()),
    );
    Ok(info)
}

#[tauri::command]
pub async fn project_rename(app: tauri::AppHandle, name: String) -> AppResult<()> {
    let trimmed_name = name.trim();
    if trimmed_name.is_empty() {
        return Err(AppError::Invalid("project name cannot be empty".into()));
    }

    let dir = app
        .state::<crate::app_state::AppState>()
        .current_project()?;
    write_project_metadata(&dir, trimmed_name)?;

    let conn = project_conn(&app)?;
    project_meta::rename(&conn, trimmed_name)
}

#[tauri::command]
pub async fn project_update(
    app: tauri::AppHandle,
    name: String,
    language: Option<String>,
) -> AppResult<ProjectInfo> {
    let trimmed_name = name.trim();
    if trimmed_name.is_empty() {
        return Err(AppError::Invalid("project name cannot be empty".into()));
    }

    let global = SettingsStore::new(app.path().app_config_dir()?).load()?;
    let resolved_language = match language.as_deref() {
        Some(language) => canonical_project_language(language).ok_or_else(|| {
            AppError::Invalid(format!("unsupported project language: {language}"))
        })?,
        None => resolve_definitive_language(global.ui_language.as_deref()),
    };

    let dir = app
        .state::<crate::app_state::AppState>()
        .current_project()?;
    write_project_metadata(&dir, trimmed_name)?;

    let conn = project_conn(&app)?;
    project_meta::rename(&conn, trimmed_name)?;
    let mut settings = project_meta::read_settings(&conn)?;
    settings.language = Some(resolved_language.clone());
    project_meta::write_settings(&conn, &settings)?;

    Ok(ProjectInfo {
        path: dir.to_string_lossy().to_string(),
        name: trimmed_name.to_string(),
        language: resolved_language,
    })
}
