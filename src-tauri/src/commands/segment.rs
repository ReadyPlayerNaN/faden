use crate::commands::util::project_conn;
use crate::db::queries::{segment, speaker, tagged_span};
use crate::error::{AppError, AppResult};

/// Convert a byte/char offset given as i64 (from JS) to a usize char-index
/// clamped into [0, text_chars_len].
fn clamp_char_offset(offset: i64, max: usize) -> usize {
    if offset < 0 {
        0
    } else if (offset as usize) > max {
        max
    } else {
        offset as usize
    }
}

#[tauri::command]
pub async fn segment_update_text(
    app: tauri::AppHandle,
    segment_id: i64,
    text: String,
) -> AppResult<()> {
    let conn = project_conn(&app)?;
    let _ = segment::get(&conn, segment_id)?;
    segment::update_text(&conn, segment_id, &text)?;

    // Clamp any spans whose end_offset exceeds new text length; refresh snapshots.
    let new_chars: Vec<char> = text.chars().collect();
    let new_len = new_chars.len() as i32;
    let spans = tagged_span::list_for_segment(&conn, segment_id)?;
    for span in spans {
        let start = span.start_offset.clamp(0, new_len);
        let end = span.end_offset.clamp(start, new_len);
        let snapshot: String = new_chars
            .iter()
            .skip(start as usize)
            .take((end - start) as usize)
            .collect();
        if start != span.start_offset
            || end != span.end_offset
            || snapshot != span.text_snapshot
        {
            tagged_span::update_offsets_and_snapshot(
                &conn, span.id, start, end, &snapshot,
            )?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn segment_set_speaker(
    app: tauri::AppHandle,
    segment_id: i64,
    speaker_id: i64,
) -> AppResult<()> {
    let conn = project_conn(&app)?;
    let seg = segment::get(&conn, segment_id)?;
    let sp = speaker::get(&conn, speaker_id)?;
    if sp.interview_id != seg.interview_id {
        return Err(AppError::Invalid(
            "speaker does not belong to the same interview as segment".into(),
        ));
    }
    segment::set_speaker(&conn, segment_id, speaker_id)
}

#[tauri::command]
pub async fn segment_delete(app: tauri::AppHandle, segment_id: i64) -> AppResult<()> {
    let mut conn = project_conn(&app)?;
    let seg = segment::get(&conn, segment_id)?;
    segment::delete(&conn, segment_id)?;
    segment::renumber_order_indices(&mut conn, seg.interview_id)?;
    Ok(())
}

#[tauri::command]
pub async fn segment_split(
    app: tauri::AppHandle,
    segment_id: i64,
    split_offset: i64,
    split_audio_sec: f64,
) -> AppResult<()> {
    let mut conn = project_conn(&app)?;
    let seg = segment::get(&conn, segment_id)?;
    let chars: Vec<char> = seg.text.chars().collect();
    let len = chars.len();
    if split_offset <= 0 || (split_offset as usize) >= len {
        return Err(AppError::Invalid(format!(
            "split_offset {split_offset} out of range for text length {len}"
        )));
    }
    if split_audio_sec < seg.start_sec || split_audio_sec > seg.end_sec {
        return Err(AppError::Invalid(format!(
            "split_audio_sec {split_audio_sec} not within segment [{}, {}]",
            seg.start_sec, seg.end_sec
        )));
    }
    let split = clamp_char_offset(split_offset, len) as i32;

    // Reject if any span crosses the split point.
    let spans = tagged_span::list_for_segment(&conn, segment_id)?;
    for span in &spans {
        if span.start_offset < split && span.end_offset > split {
            return Err(AppError::Invalid(format!(
                "span {} crosses split point at {}",
                span.id, split
            )));
        }
    }

    let first_text: String = chars.iter().take(split as usize).collect();
    let second_text: String = chars.iter().skip(split as usize).collect();

    // Shift order_index of segments after seg.order_index by +1.
    segment::shift_order_indices_from(&conn, seg.interview_id, seg.order_index + 1, 1)?;

    // Update original segment: truncate text, set end_sec.
    segment::update_text(&conn, seg.id, &first_text)?;
    conn.execute(
        "UPDATE segment SET end_sec = ?1 WHERE id = ?2",
        rusqlite::params![split_audio_sec, seg.id],
    )?;

    // Insert new segment immediately after original.
    let new_seg = segment::NewSegment {
        speaker_id: seg.speaker_id,
        start_sec: split_audio_sec,
        end_sec: seg.end_sec,
        text: second_text,
    };
    let new_id = segment::insert_at_order(&conn, seg.interview_id, seg.order_index + 1, &new_seg)?;

    // Reassign spans that fall entirely in the second half.
    for span in spans {
        if span.start_offset >= split {
            tagged_span::reassign_to_segment(&conn, span.id, new_id, -split)?;
        }
    }

    // Make sure ordering is contiguous (defensive).
    segment::renumber_order_indices(&mut conn, seg.interview_id)?;
    Ok(())
}

#[tauri::command]
pub async fn segment_merge(
    app: tauri::AppHandle,
    first_id: i64,
    second_id: i64,
) -> AppResult<()> {
    let mut conn = project_conn(&app)?;
    let a = segment::get(&conn, first_id)?;
    let b = segment::get(&conn, second_id)?;
    if a.interview_id != b.interview_id {
        return Err(AppError::Invalid(
            "segments belong to different interviews".into(),
        ));
    }
    if b.order_index != a.order_index + 1 {
        return Err(AppError::Invalid(
            "segments are not order-adjacent (first must directly precede second)".into(),
        ));
    }

    let a_text_len = a.text.chars().count() as i32;
    let merged_text = format!("{}{}", a.text, b.text);

    // Update segment a: text + end_sec (start_sec unchanged, equals a.start_sec).
    segment::update_text(&conn, a.id, &merged_text)?;
    conn.execute(
        "UPDATE segment SET end_sec = ?1 WHERE id = ?2",
        rusqlite::params![b.end_sec, a.id],
    )?;

    // Reassign spans on b -> a, shifting offsets by a_text_len.
    let b_spans = tagged_span::list_for_segment(&conn, b.id)?;
    for span in b_spans {
        tagged_span::reassign_to_segment(&conn, span.id, a.id, a_text_len)?;
    }

    // Delete b.
    segment::delete(&conn, b.id)?;
    segment::renumber_order_indices(&mut conn, a.interview_id)?;
    Ok(())
}
