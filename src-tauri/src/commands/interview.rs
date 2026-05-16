use crate::commands::util::project_conn;
use crate::db;
use crate::db::queries::interview::{self, Interview};
use crate::db::queries::segment;
use crate::db::queries::speaker::{self, Speaker};
use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SegmentDTO {
    pub id: i64,
    pub interview_id: i64,
    pub speaker_id: i64,
    pub speaker_label_raw: String,
    pub speaker_display_name: Option<String>,
    pub start_sec: f64,
    pub end_sec: f64,
    pub text: String,
    pub order_index: i64,
}

#[tauri::command]
pub async fn segment_list_for_interview(
    app: tauri::AppHandle,
    interview_id: i64,
) -> AppResult<Vec<SegmentDTO>> {
    let conn = project_conn(&app)?;
    let segments = segment::list_for_interview(&conn, interview_id)?;
    let speakers = speaker::list_for_interview(&conn, interview_id)?;
    let by_speaker: std::collections::HashMap<i64, Speaker> =
        speakers.into_iter().map(|s| (s.id, s)).collect();
    let mut out = Vec::with_capacity(segments.len());
    for s in segments {
        let sp = by_speaker.get(&s.speaker_id);
        out.push(SegmentDTO {
            id: s.id,
            interview_id: s.interview_id,
            speaker_id: s.speaker_id,
            speaker_label_raw: sp.map(|x| x.label_raw.clone()).unwrap_or_default(),
            speaker_display_name: sp.and_then(|x| x.display_name.clone()),
            start_sec: s.start_sec,
            end_sec: s.end_sec,
            text: s.text,
            order_index: s.order_index,
        });
    }
    Ok(out)
}

#[tauri::command]
pub async fn interview_create(app: tauri::AppHandle, name: String) -> AppResult<Interview> {
    let conn = project_conn(&app)?;
    interview::create(&conn, &name)
}

#[tauri::command]
pub async fn interview_list(app: tauri::AppHandle) -> AppResult<Vec<Interview>> {
    let conn = project_conn(&app)?;
    interview::list(&conn)
}

#[tauri::command]
pub async fn interview_get(app: tauri::AppHandle, id: i64) -> AppResult<Interview> {
    let conn = project_conn(&app)?;
    interview::get(&conn, id)
}

#[tauri::command]
pub async fn interview_rename(app: tauri::AppHandle, id: i64, name: String) -> AppResult<()> {
    let conn = project_conn(&app)?;
    interview::rename(&conn, id, &name)
}

#[tauri::command]
pub async fn interview_delete(app: tauri::AppHandle, id: i64) -> AppResult<()> {
    let conn = project_conn(&app)?;
    interview::delete(&conn, id)
}

// Helper to compute a sanitized filename. Keeps alphanum, dashes, underscores.
fn sanitize_filename(name: &str) -> String {
    name.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '-' | '_') {
                c
            } else {
                '_'
            }
        })
        .collect::<String>()
        .trim_matches('_')
        .to_string()
}

pub async fn interview_create_with_audio_impl(
    project_dir: PathBuf,
    name: String,
    source_audio_path: String,
) -> AppResult<Interview> {
    let src = Path::new(&source_audio_path);
    if !src.exists() {
        return Err(AppError::NotFound(format!("audio file: {}", src.display())));
    }
    let ext = src.extension().and_then(|e| e.to_str()).unwrap_or("audio");
    let sanitized = sanitize_filename(&name);
    let short_uuid = uuid::Uuid::new_v4().simple().to_string()[..8].to_string();
    let target_name = format!("{sanitized}-{short_uuid}.{ext}");
    let media_dir = project_dir.join("media");
    std::fs::create_dir_all(&media_dir)?;
    let target_path = media_dir.join(&target_name);
    std::fs::copy(src, &target_path)?;

    let sqlite = project_dir.join("project.sqlite");
    let conn = db::open(&sqlite)?;
    let mut iv = interview::create(&conn, &name)?;
    let rel_path = format!("media/{target_name}");
    interview::set_audio_path(&conn, iv.id, Some(&rel_path))?;
    iv.audio_path = Some(rel_path);
    Ok(iv)
}

#[tauri::command]
pub async fn interview_create_with_audio(
    app: tauri::AppHandle,
    name: String,
    source_audio_path: String,
) -> AppResult<Interview> {
    use tauri::Manager;
    let state = app.state::<crate::app_state::AppState>();
    let project_dir = state.current_project()?;
    interview_create_with_audio_impl(project_dir, name, source_audio_path).await
}

#[tauri::command]
pub async fn interview_import_text(
    app: tauri::AppHandle,
    name: String,
    raw_text: String,
) -> AppResult<Interview> {
    use tauri::Manager;
    let project_dir = app
        .state::<crate::app_state::AppState>()
        .current_project()?;
    let parsed = crate::import::plain_text::parse(&raw_text)?;
    crate::import::ingest::ingest_impl(project_dir, name, None, Some(parsed)).await
}

#[tauri::command]
pub async fn interview_import_json(
    app: tauri::AppHandle,
    name: String,
    raw_json: String,
) -> AppResult<Interview> {
    use tauri::Manager;
    let project_dir = app
        .state::<crate::app_state::AppState>()
        .current_project()?;
    let parsed = crate::import::json_schema::parse_json(&raw_json)?;
    crate::import::ingest::ingest_impl(project_dir, name, None, Some(parsed)).await
}

#[tauri::command]
pub async fn interview_import_audio_text(
    app: tauri::AppHandle,
    name: String,
    audio_path: String,
    raw_text: String,
) -> AppResult<Interview> {
    use tauri::Manager;
    let project_dir = app
        .state::<crate::app_state::AppState>()
        .current_project()?;
    let parsed = crate::import::plain_text::parse(&raw_text)?;
    crate::import::ingest::ingest_impl(project_dir, name, Some(audio_path), Some(parsed)).await
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpeakerDTO {
    pub id: i64,
    pub interview_id: i64,
    pub label_raw: String,
    pub display_name: Option<String>,
}

impl From<Speaker> for SpeakerDTO {
    fn from(s: Speaker) -> Self {
        Self {
            id: s.id,
            interview_id: s.interview_id,
            label_raw: s.label_raw,
            display_name: s.display_name,
        }
    }
}

#[tauri::command]
pub async fn speaker_list_for_interview(
    app: tauri::AppHandle,
    interview_id: i64,
) -> AppResult<Vec<SpeakerDTO>> {
    let conn = project_conn(&app)?;
    Ok(speaker::list_for_interview(&conn, interview_id)?
        .into_iter()
        .map(Into::into)
        .collect())
}

#[tauri::command]
pub async fn speaker_create(
    app: tauri::AppHandle,
    interview_id: i64,
    label_raw: String,
    display_name: Option<String>,
) -> AppResult<SpeakerDTO> {
    let conn = project_conn(&app)?;
    let sp = speaker::create_or_get(&conn, interview_id, &label_raw, display_name.as_deref())?;
    Ok(sp.into())
}

#[tauri::command]
pub async fn speaker_set_display_name(
    app: tauri::AppHandle,
    speaker_id: i64,
    display_name: Option<String>,
) -> AppResult<()> {
    let conn = project_conn(&app)?;
    speaker::set_display_name(&conn, speaker_id, display_name.as_deref())
}

#[tauri::command]
pub async fn interview_set_audio(
    app: tauri::AppHandle,
    interview_id: i64,
    source_audio_path: String,
) -> AppResult<Interview> {
    use tauri::Manager;
    let state = app.state::<crate::app_state::AppState>();
    let project_dir = state.current_project()?;

    let sqlite = project_dir.join("project.sqlite");
    let conn = crate::db::open(&sqlite)?;
    let iv = interview::get(&conn, interview_id)?;

    // Best-effort delete of existing audio file.
    if let Some(old_rel) = &iv.audio_path {
        let _ = std::fs::remove_file(project_dir.join(old_rel));
    }

    let src = Path::new(&source_audio_path);
    if !src.exists() {
        return Err(AppError::NotFound(format!("audio file: {}", src.display())));
    }
    let ext = src.extension().and_then(|e| e.to_str()).unwrap_or("audio");
    let sanitized = sanitize_filename(&iv.name);
    let short_uuid = uuid::Uuid::new_v4().simple().to_string()[..8].to_string();
    let target_name = format!("{sanitized}-{short_uuid}.{ext}");
    let media_dir = project_dir.join("media");
    std::fs::create_dir_all(&media_dir)?;
    let target_path = media_dir.join(&target_name);
    std::fs::copy(src, &target_path)?;
    let rel_path = format!("media/{target_name}");
    interview::set_audio_path(&conn, interview_id, Some(&rel_path))?;
    interview::get(&conn, interview_id)
}

#[tauri::command]
pub async fn interview_audio_stream_url(
    app: tauri::AppHandle,
    interview_id: i64,
) -> AppResult<String> {
    let conn = project_conn(&app)?;
    let iv = interview::get(&conn, interview_id)?;
    if iv.audio_path.is_none() {
        return Err(AppError::NotFound(format!(
            "interview {interview_id} has no audio"
        )));
    }
    crate::media_server::url_for_interview(&app, interview_id)
}

#[tauri::command]
pub async fn interview_clear_audio(
    app: tauri::AppHandle,
    interview_id: i64,
) -> AppResult<Interview> {
    use tauri::Manager;
    let state = app.state::<crate::app_state::AppState>();
    let project_dir = state.current_project()?;

    let sqlite = project_dir.join("project.sqlite");
    let conn = crate::db::open(&sqlite)?;
    let iv = interview::get(&conn, interview_id)?;

    if let Some(rel) = &iv.audio_path {
        let _ = std::fs::remove_file(project_dir.join(rel));
    }
    interview::set_audio_path(&conn, interview_id, None)?;
    interview::get(&conn, interview_id)
}

#[tauri::command]
pub async fn interview_import_audio_json(
    app: tauri::AppHandle,
    name: String,
    audio_path: String,
    raw_json: String,
) -> AppResult<Interview> {
    use tauri::Manager;
    let project_dir = app
        .state::<crate::app_state::AppState>()
        .current_project()?;
    let parsed = crate::import::json_schema::parse_json(&raw_json)?;
    crate::import::ingest::ingest_impl(project_dir, name, Some(audio_path), Some(parsed)).await
}
