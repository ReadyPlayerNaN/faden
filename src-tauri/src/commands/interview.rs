use crate::commands::util::project_conn;
use crate::db;
use crate::db::queries::interview::{self, Interview, TranscriptStatus};
use crate::db::queries::segment;
use crate::db::queries::speaker::{self, Speaker};
use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SegmentDTO {
    pub id: i64,
    pub interview_id: i64,
    pub speaker_id: Option<i64>,
    pub speaker_label_raw: Option<String>,
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
        let sp = s
            .speaker_id
            .and_then(|speaker_id| by_speaker.get(&speaker_id));
        out.push(SegmentDTO {
            id: s.id,
            interview_id: s.interview_id,
            speaker_id: s.speaker_id,
            speaker_label_raw: sp.map(|x| x.label_raw.clone()),
            speaker_display_name: sp.and_then(|x| x.effective_display_name().map(str::to_owned)),
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

fn replace_transcript(
    conn: &mut rusqlite::Connection,
    interview_id: i64,
    parsed: crate::import::plain_text::ParsedTranscript,
) -> AppResult<Interview> {
    interview::get(conn, interview_id)?;
    segment::delete_all_for_interview(conn, interview_id)?;
    speaker::delete_all_for_interview(conn, interview_id)?;

    let mut speaker_map: std::collections::HashMap<String, i64> = std::collections::HashMap::new();
    for sp in &parsed.speakers {
        let s = speaker::create_or_get(
            conn,
            interview_id,
            &sp.label_raw,
            sp.display_name.as_deref(),
            None,
        )?;
        speaker_map.insert(sp.label_raw.clone(), s.id);
    }
    for seg in &parsed.segments {
        if !speaker_map.contains_key(&seg.speaker_label) {
            let s = speaker::create_or_get(conn, interview_id, &seg.speaker_label, None, None)?;
            speaker_map.insert(seg.speaker_label.clone(), s.id);
        }
    }

    let new_segments: Vec<segment::NewSegment> = parsed
        .segments
        .iter()
        .map(|seg| segment::NewSegment {
            speaker_id: Some(*speaker_map.get(&seg.speaker_label).unwrap()),
            start_sec: seg.start_sec,
            end_sec: seg.end_sec,
            text: seg.text.clone(),
        })
        .collect();
    segment::insert_batch(conn, interview_id, &new_segments)?;

    interview::set_status(conn, interview_id, TranscriptStatus::Complete)?;
    interview::set_notes(
        conn,
        interview_id,
        if parsed.synthetic_timestamps {
            Some("[synthetic timestamps]")
        } else {
            None
        },
    )?;
    interview::get(conn, interview_id)
}

#[tauri::command]
pub async fn interview_replace_transcript_text(
    app: tauri::AppHandle,
    interview_id: i64,
    raw_text: String,
) -> AppResult<Interview> {
    let parsed = crate::import::plain_text::parse(&raw_text)?;
    let mut conn = project_conn(&app)?;
    replace_transcript(&mut conn, interview_id, parsed)
}

#[tauri::command]
pub async fn interview_replace_transcript_json(
    app: tauri::AppHandle,
    interview_id: i64,
    raw_json: String,
) -> AppResult<Interview> {
    let parsed = crate::import::json_schema::parse_json(&raw_json)?;
    let mut conn = project_conn(&app)?;
    replace_transcript(&mut conn, interview_id, parsed)
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
    pub person_id: Option<i64>,
    pub person_name: Option<String>,
    pub interviewer: bool,
}

impl From<Speaker> for SpeakerDTO {
    fn from(s: Speaker) -> Self {
        Self {
            id: s.id,
            interview_id: s.interview_id,
            label_raw: s.label_raw,
            display_name: s.display_name,
            person_id: s.person_id,
            person_name: s.person_name,
            interviewer: s.interviewer,
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
    label_raw: Option<String>,
    display_name: Option<String>,
    person_id: Option<i64>,
) -> AppResult<SpeakerDTO> {
    let conn = project_conn(&app)?;
    let sp = if let Some(pid) = person_id {
        speaker::create_for_person(
            &conn,
            interview_id,
            pid,
            label_raw.as_deref(),
            display_name.as_deref(),
        )?
    } else {
        let label = label_raw
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| AppError::Invalid("speaker label is required".into()))?;
        speaker::create_or_get(&conn, interview_id, label, display_name.as_deref(), None)?
    };
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
pub async fn speaker_set_person(
    app: tauri::AppHandle,
    speaker_id: i64,
    person_id: Option<i64>,
) -> AppResult<()> {
    let conn = project_conn(&app)?;
    speaker::set_person(&conn, speaker_id, person_id)
}

#[tauri::command]
pub async fn speaker_set_interviewer(
    app: tauri::AppHandle,
    speaker_id: i64,
    interviewer: bool,
) -> AppResult<()> {
    let conn = project_conn(&app)?;
    speaker::set_interviewer(&conn, speaker_id, interviewer)
}

#[tauri::command]
pub async fn speaker_merge(
    app: tauri::AppHandle,
    interview_id: i64,
    source_speaker_ids: Vec<i64>,
    new_name: String,
) -> AppResult<SpeakerDTO> {
    let mut conn = project_conn(&app)?;
    let speaker =
        speaker::merge_many_into_new(&mut conn, interview_id, &source_speaker_ids, &new_name)?;
    Ok(speaker.into())
}

#[tauri::command]
pub async fn speaker_delete(app: tauri::AppHandle, speaker_id: i64) -> AppResult<()> {
    let mut conn = project_conn(&app)?;
    speaker::delete_and_unassign(&mut conn, speaker_id)
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
