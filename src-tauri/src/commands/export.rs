use crate::commands::util::project_conn;
use crate::error::AppResult;
use crate::export::{self, ExportScope};
use serde::Deserialize;
use std::fs::File;
use std::path::PathBuf;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StatsFormat {
    Csv,
    Markdown,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CodebookFormat {
    Json,
    Csv,
}

#[tauri::command]
pub async fn export_csv(
    app: tauri::AppHandle,
    scope: ExportScope,
    destination: String,
) -> AppResult<()> {
    let conn = project_conn(&app)?;
    let data = export::compose(&conn, &scope)?;
    let mut f = File::create(PathBuf::from(destination))?;
    crate::export::csv_export::write_csv(&data, &mut f)
}

#[tauri::command]
pub async fn export_markdown(
    app: tauri::AppHandle,
    scope: ExportScope,
    destination: String,
) -> AppResult<()> {
    let conn = project_conn(&app)?;
    let data = export::compose(&conn, &scope)?;
    let mut f = File::create(PathBuf::from(destination))?;
    crate::export::markdown::write_markdown(&data, &mut f)
}

#[tauri::command]
pub async fn export_refi(
    app: tauri::AppHandle,
    scope: ExportScope,
    destination: String,
) -> AppResult<()> {
    let conn = project_conn(&app)?;
    let data = export::compose(&conn, &scope)?;
    let mut f = File::create(PathBuf::from(destination))?;
    crate::export::refi_qda::write_refi_qda(&data, &mut f)
}

#[tauri::command]
pub async fn export_stats(
    app: tauri::AppHandle,
    scope: ExportScope,
    format: StatsFormat,
    destination: String,
) -> AppResult<()> {
    let conn = project_conn(&app)?;
    let data = export::compose(&conn, &scope)?;
    let mut f = File::create(PathBuf::from(destination))?;
    match format {
        StatsFormat::Csv => crate::export::stats::write_stats_csv(&data, &mut f),
        StatsFormat::Markdown => crate::export::stats::write_stats_markdown(&data, &mut f),
    }
}

#[tauri::command]
pub async fn export_codebook(
    app: tauri::AppHandle,
    format: CodebookFormat,
    destination: String,
) -> AppResult<()> {
    let conn = project_conn(&app)?;
    let data = export::compose(&conn, &ExportScope::default())?;
    let mut f = File::create(PathBuf::from(destination))?;
    match format {
        CodebookFormat::Json => crate::export::codebook::write_codebook_json(&data, &mut f),
        CodebookFormat::Csv => crate::export::codebook::write_codebook_csv(&data, &mut f),
    }
}
