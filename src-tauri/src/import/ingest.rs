use crate::db;
use crate::db::queries::interview::{self, Interview, TranscriptStatus};
use crate::db::queries::{segment, speaker};
use crate::error::{AppError, AppResult};
use crate::import::plain_text::ParsedTranscript;
use std::path::{Path, PathBuf};

pub async fn ingest_impl(
    project_dir: PathBuf,
    name: String,
    source_audio_path: Option<String>,
    parsed_transcript: Option<ParsedTranscript>,
) -> AppResult<Interview> {
    if source_audio_path.is_none() && parsed_transcript.is_none() {
        return Err(AppError::Invalid(
            "must provide audio or transcript".into(),
        ));
    }
    let sqlite = project_dir.join("project.sqlite");
    let mut conn = db::open(&sqlite)?;

    let mut iv = interview::create(&conn, &name)?;

    // Audio import
    if let Some(src) = &source_audio_path {
        let src_path = Path::new(src);
        if !src_path.exists() {
            return Err(AppError::NotFound(format!("audio: {}", src)));
        }
        let ext = src_path.extension().and_then(|e| e.to_str()).unwrap_or("audio");
        let sanitized: String = name
            .chars()
            .map(|c| {
                if c.is_ascii_alphanumeric() || matches!(c, '-' | '_') {
                    c
                } else {
                    '_'
                }
            })
            .collect();
        let short_uuid = uuid::Uuid::new_v4().simple().to_string()[..8].to_string();
        let target_name = format!("{sanitized}-{short_uuid}.{ext}");
        let media_dir = project_dir.join("media");
        std::fs::create_dir_all(&media_dir)?;
        let target = media_dir.join(&target_name);
        std::fs::copy(src_path, &target)?;
        let rel = format!("media/{target_name}");
        interview::set_audio_path(&conn, iv.id, Some(&rel))?;
        iv.audio_path = Some(rel);
    }

    // Transcript import
    if let Some(pt) = &parsed_transcript {
        // Insert speakers
        let mut speaker_map: std::collections::HashMap<String, i64> =
            std::collections::HashMap::new();
        for sp in &pt.speakers {
            let s = speaker::create_or_get(
                &conn,
                iv.id,
                &sp.label_raw,
                sp.display_name.as_deref(),
            )?;
            speaker_map.insert(sp.label_raw.clone(), s.id);
        }
        // Make sure all segments have a speaker; if a segment references an unseen label, create it
        for seg in &pt.segments {
            if !speaker_map.contains_key(&seg.speaker_label) {
                let s = speaker::create_or_get(&conn, iv.id, &seg.speaker_label, None)?;
                speaker_map.insert(seg.speaker_label.clone(), s.id);
            }
        }
        let new_segs: Vec<segment::NewSegment> = pt
            .segments
            .iter()
            .map(|s| segment::NewSegment {
                speaker_id: *speaker_map.get(&s.speaker_label).unwrap(),
                start_sec: s.start_sec,
                end_sec: s.end_sec,
                text: s.text.clone(),
            })
            .collect();
        segment::insert_batch(&mut conn, iv.id, &new_segs)?;
        interview::set_status(&conn, iv.id, TranscriptStatus::Complete)?;
        iv.transcript_status = TranscriptStatus::Complete;

        // If synthetic timestamps, mark a note
        if pt.synthetic_timestamps {
            interview::set_notes(&conn, iv.id, Some("[synthetic timestamps]"))?;
            iv.notes = Some("[synthetic timestamps]".into());
        }
    }

    Ok(iv)
}
