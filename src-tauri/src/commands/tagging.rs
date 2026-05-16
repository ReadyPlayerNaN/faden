use crate::commands::util::project_conn;
use crate::db::queries::{memo, segment, span_tag, span_tag::SpanTagSource, tagged_span};
use crate::error::{AppError, AppResult};
use crate::history::{self, HistoryPayload, SpanTagSnapshot};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpanDTO {
    pub id: i64,
    pub interview_id: i64,
    pub segment_id: i64,
    pub start_offset: i32,
    pub end_offset: i32,
    pub text_snapshot: String,
    pub audio_start_sec: f64,
    pub audio_end_sec: f64,
    pub created_at: String,
    pub tags: Vec<TagOnSpan>,
    pub memo: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TagOnSpan {
    pub tag_id: i64,
    pub source: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateSpanArgs {
    pub interview_id: i64,
    pub segment_id: i64,
    pub start_offset: i32,
    pub end_offset: i32,
    pub tag_ids: Vec<i64>,
}

pub fn build_span_dto(conn: &Connection, span_id: i64) -> AppResult<SpanDTO> {
    let span = tagged_span::get(conn, span_id)?;
    let tags = span_tag::list_for_span(conn, span_id)?
        .into_iter()
        .map(|(id, src)| TagOnSpan {
            tag_id: id,
            source: src.as_str().to_string(),
        })
        .collect();
    let memo = memo::get_for_span(conn, span_id)?.map(|m| m.body);
    Ok(SpanDTO {
        id: span.id,
        interview_id: span.interview_id,
        segment_id: span.segment_id,
        start_offset: span.start_offset,
        end_offset: span.end_offset,
        text_snapshot: span.text_snapshot,
        audio_start_sec: span.audio_start_sec,
        audio_end_sec: span.audio_end_sec,
        created_at: span.created_at,
        tags,
        memo,
    })
}

pub fn span_create_impl(conn: &Connection, args: &CreateSpanArgs) -> AppResult<SpanDTO> {
    let seg = segment::get(conn, args.segment_id)?;
    if args.start_offset < 0 || args.end_offset <= args.start_offset {
        return Err(AppError::Invalid("invalid span offsets".into()));
    }
    let text_len = seg.text.chars().count() as i32;
    if args.end_offset > text_len {
        return Err(AppError::Invalid(format!(
            "end_offset {} > segment text len {}",
            args.end_offset, text_len
        )));
    }
    let snapshot: String = seg
        .text
        .chars()
        .skip(args.start_offset as usize)
        .take((args.end_offset - args.start_offset) as usize)
        .collect();
    let (a_start, a_end) = tagged_span::interpolate_audio_range(
        seg.start_sec,
        seg.end_sec,
        text_len as usize,
        args.start_offset,
        args.end_offset,
    );
    let span = tagged_span::create(
        conn,
        &tagged_span::NewSpan {
            interview_id: args.interview_id,
            segment_id: args.segment_id,
            start_offset: args.start_offset,
            end_offset: args.end_offset,
            text_snapshot: &snapshot,
            audio_start_sec: a_start,
            audio_end_sec: a_end,
        },
    )?;
    for tag_id in &args.tag_ids {
        span_tag::attach(conn, span.id, *tag_id, SpanTagSource::Manual)?;
    }
    build_span_dto(conn, span.id)
}

pub fn span_update_tags_impl(
    conn: &Connection,
    span_id: i64,
    tag_ids: &[i64],
) -> AppResult<SpanDTO> {
    let existing: std::collections::HashSet<i64> = span_tag::list_for_span(conn, span_id)?
        .into_iter()
        .map(|(t, _)| t)
        .collect();
    let desired: std::collections::HashSet<i64> = tag_ids.iter().copied().collect();
    for old in existing.difference(&desired) {
        span_tag::detach(conn, span_id, *old)?;
    }
    for new in desired.difference(&existing) {
        span_tag::attach(conn, span_id, *new, SpanTagSource::Manual)?;
    }
    build_span_dto(conn, span_id)
}

pub fn span_update_offsets_impl(
    conn: &Connection,
    span_id: i64,
    start_offset: i32,
    end_offset: i32,
) -> AppResult<SpanDTO> {
    let span = tagged_span::get(conn, span_id)?;
    let seg = segment::get(conn, span.segment_id)?;
    if start_offset < 0 || end_offset <= start_offset {
        return Err(AppError::Invalid("invalid offsets".into()));
    }
    let text_len = seg.text.chars().count() as i32;
    if end_offset > text_len {
        return Err(AppError::Invalid("end_offset out of range".into()));
    }
    let snapshot: String = seg
        .text
        .chars()
        .skip(start_offset as usize)
        .take((end_offset - start_offset) as usize)
        .collect();
    let (a_start, a_end) = tagged_span::interpolate_audio_range(
        seg.start_sec,
        seg.end_sec,
        text_len as usize,
        start_offset,
        end_offset,
    );
    tagged_span::update_offsets(
        conn,
        span_id,
        start_offset,
        end_offset,
        &snapshot,
        a_start,
        a_end,
    )?;
    build_span_dto(conn, span_id)
}

pub fn span_list_for_interview_impl(
    conn: &Connection,
    interview_id: i64,
) -> AppResult<Vec<SpanDTO>> {
    let spans = tagged_span::list_for_interview(conn, interview_id)?;
    let mut out = Vec::with_capacity(spans.len());
    for s in spans {
        out.push(build_span_dto(conn, s.id)?);
    }
    Ok(out)
}

#[tauri::command]
pub async fn span_create(app: tauri::AppHandle, args: CreateSpanArgs) -> AppResult<SpanDTO> {
    let mut conn = project_conn(&app)?;
    let tx = conn.transaction()?;
    let dto = span_create_impl(&tx, &args)?;
    history::record_undo(&tx, &HistoryPayload::SpanCreate { span_id: dto.id })?;
    tx.commit()?;
    Ok(dto)
}

#[tauri::command]
pub async fn span_update_tags(
    app: tauri::AppHandle,
    span_id: i64,
    tag_ids: Vec<i64>,
) -> AppResult<SpanDTO> {
    let mut conn = project_conn(&app)?;
    let tx = conn.transaction()?;
    let tags = span_tag::list_for_span(&tx, span_id)?
        .into_iter()
        .map(|(tag_id, source)| SpanTagSnapshot { tag_id, source })
        .collect();
    let dto = span_update_tags_impl(&tx, span_id, &tag_ids)?;
    history::record_undo(&tx, &HistoryPayload::SpanUpdateTags { span_id, tags })?;
    tx.commit()?;
    Ok(dto)
}

#[tauri::command]
pub async fn span_update_offsets(
    app: tauri::AppHandle,
    span_id: i64,
    start_offset: i32,
    end_offset: i32,
) -> AppResult<SpanDTO> {
    let mut conn = project_conn(&app)?;
    let tx = conn.transaction()?;
    let previous = tagged_span::get(&tx, span_id)?;
    let dto = span_update_offsets_impl(&tx, span_id, start_offset, end_offset)?;
    history::record_undo(&tx, &HistoryPayload::SpanUpdateOffsets { span: previous })?;
    tx.commit()?;
    Ok(dto)
}

#[tauri::command]
pub async fn span_delete(app: tauri::AppHandle, span_id: i64) -> AppResult<()> {
    let mut conn = project_conn(&app)?;
    let tx = conn.transaction()?;
    let snapshot = history::capture_span_with_relations(&tx, span_id)?;
    tagged_span::delete(&tx, span_id)?;
    history::record_undo(&tx, &HistoryPayload::SpanDelete { snapshot })?;
    tx.commit()?;
    Ok(())
}

#[tauri::command]
pub async fn span_get(app: tauri::AppHandle, span_id: i64) -> AppResult<SpanDTO> {
    let conn = project_conn(&app)?;
    build_span_dto(&conn, span_id)
}

#[tauri::command]
pub async fn span_list_for_interview(
    app: tauri::AppHandle,
    interview_id: i64,
) -> AppResult<Vec<SpanDTO>> {
    let conn = project_conn(&app)?;
    span_list_for_interview_impl(&conn, interview_id)
}

#[tauri::command]
pub async fn memo_upsert(app: tauri::AppHandle, span_id: i64, body: String) -> AppResult<()> {
    let mut conn = project_conn(&app)?;
    let tx = conn.transaction()?;
    let previous = memo::get_for_span(&tx, span_id)?.map(|item| history::MemoSnapshot {
        id: item.id,
        span_id: item.span_id,
        body: item.body,
        created_at: item.created_at,
        updated_at: item.updated_at,
    });
    memo::upsert(&tx, span_id, &body)?;
    history::record_undo(
        &tx,
        &HistoryPayload::MemoUpsert {
            span_id,
            memo: previous,
        },
    )?;
    tx.commit()?;
    Ok(())
}
