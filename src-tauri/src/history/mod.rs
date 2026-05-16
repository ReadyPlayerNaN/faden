use crate::db::queries::{memo, segment, span_tag, tagged_span};
use crate::error::{AppError, AppResult};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpanTagSnapshot {
    pub tag_id: i64,
    pub source: span_tag::SpanTagSource,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoSnapshot {
    pub id: i64,
    pub span_id: i64,
    pub body: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpanWithRelationsSnapshot {
    pub span: tagged_span::TaggedSpan,
    pub tags: Vec<SpanTagSnapshot>,
    pub memo: Option<MemoSnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum HistoryPayload {
    SegmentUpdateText {
        segment_id: i64,
        text: String,
        spans: Vec<tagged_span::TaggedSpan>,
    },
    SegmentSetSpeaker {
        segment_id: i64,
        speaker_id: Option<i64>,
    },
    SpanCreate {
        span_id: i64,
    },
    SpanDelete {
        snapshot: SpanWithRelationsSnapshot,
    },
    SpanUpdateTags {
        span_id: i64,
        tags: Vec<SpanTagSnapshot>,
    },
    SpanUpdateOffsets {
        span: tagged_span::TaggedSpan,
    },
    MemoUpsert {
        span_id: i64,
        memo: Option<MemoSnapshot>,
    },
}

#[derive(Debug, Clone, Serialize)]
pub struct HistoryStatus {
    pub can_undo: bool,
    pub can_redo: bool,
}

#[derive(Debug)]
struct StoredEvent {
    id: i64,
    payload: HistoryPayload,
}

impl HistoryPayload {
    fn kind(&self) -> &'static str {
        match self {
            Self::SegmentUpdateText { .. } => "segment_update_text",
            Self::SegmentSetSpeaker { .. } => "segment_set_speaker",
            Self::SpanCreate { .. } => "span_create",
            Self::SpanDelete { .. } => "span_delete",
            Self::SpanUpdateTags { .. } => "span_update_tags",
            Self::SpanUpdateOffsets { .. } => "span_update_offsets",
            Self::MemoUpsert { .. } => "memo_upsert",
        }
    }
}

pub fn record_undo(conn: &Connection, payload: &HistoryPayload) -> AppResult<()> {
    insert_event(conn, "undo_event", payload)?;
    clear_events(conn, "redo_event")?;
    Ok(())
}

pub fn status(conn: &Connection) -> AppResult<HistoryStatus> {
    Ok(HistoryStatus {
        can_undo: has_events(conn, "undo_event")?,
        can_redo: has_events(conn, "redo_event")?,
    })
}

pub fn undo(conn: &mut Connection) -> AppResult<()> {
    let tx = conn.transaction()?;
    let event = latest_event(&tx, "undo_event")?
        .ok_or_else(|| AppError::Invalid("nothing to undo".into()))?;
    let redo_payload = invert_payload(&tx, &event.payload)?;
    apply_payload(&tx, &event.payload)?;
    delete_event(&tx, "undo_event", event.id)?;
    insert_event(&tx, "redo_event", &redo_payload)?;
    tx.commit()?;
    Ok(())
}

pub fn redo(conn: &mut Connection) -> AppResult<()> {
    let tx = conn.transaction()?;
    let event = latest_event(&tx, "redo_event")?
        .ok_or_else(|| AppError::Invalid("nothing to redo".into()))?;
    let undo_payload = invert_payload(&tx, &event.payload)?;
    apply_payload(&tx, &event.payload)?;
    delete_event(&tx, "redo_event", event.id)?;
    insert_event(&tx, "undo_event", &undo_payload)?;
    tx.commit()?;
    Ok(())
}

pub fn capture_span_with_relations(
    conn: &Connection,
    span_id: i64,
) -> AppResult<SpanWithRelationsSnapshot> {
    let span = tagged_span::get(conn, span_id)?;
    let tags = span_tag::list_for_span(conn, span_id)?
        .into_iter()
        .map(|(tag_id, source)| SpanTagSnapshot { tag_id, source })
        .collect();
    let memo = memo::get_for_span(conn, span_id)?.map(|item| MemoSnapshot {
        id: item.id,
        span_id: item.span_id,
        body: item.body,
        created_at: item.created_at,
        updated_at: item.updated_at,
    });
    Ok(SpanWithRelationsSnapshot { span, tags, memo })
}

fn invert_payload(conn: &Connection, payload: &HistoryPayload) -> AppResult<HistoryPayload> {
    match payload {
        HistoryPayload::SegmentUpdateText { segment_id, .. } => {
            Ok(HistoryPayload::SegmentUpdateText {
                segment_id: *segment_id,
                text: segment::get(conn, *segment_id)?.text,
                spans: tagged_span::list_for_segment(conn, *segment_id)?,
            })
        }
        HistoryPayload::SegmentSetSpeaker { segment_id, .. } => {
            Ok(HistoryPayload::SegmentSetSpeaker {
                segment_id: *segment_id,
                speaker_id: segment::get(conn, *segment_id)?.speaker_id,
            })
        }
        HistoryPayload::SpanCreate { span_id } => Ok(HistoryPayload::SpanDelete {
            snapshot: capture_span_with_relations(conn, *span_id)?,
        }),
        HistoryPayload::SpanDelete { snapshot } => Ok(HistoryPayload::SpanCreate {
            span_id: snapshot.span.id,
        }),
        HistoryPayload::SpanUpdateTags { span_id, .. } => Ok(HistoryPayload::SpanUpdateTags {
            span_id: *span_id,
            tags: span_tag::list_for_span(conn, *span_id)?
                .into_iter()
                .map(|(tag_id, source)| SpanTagSnapshot { tag_id, source })
                .collect(),
        }),
        HistoryPayload::SpanUpdateOffsets { span } => Ok(HistoryPayload::SpanUpdateOffsets {
            span: tagged_span::get(conn, span.id)?,
        }),
        HistoryPayload::MemoUpsert { span_id, .. } => Ok(HistoryPayload::MemoUpsert {
            span_id: *span_id,
            memo: memo::get_for_span(conn, *span_id)?.map(|item| MemoSnapshot {
                id: item.id,
                span_id: item.span_id,
                body: item.body,
                created_at: item.created_at,
                updated_at: item.updated_at,
            }),
        }),
    }
}

fn apply_payload(conn: &Connection, payload: &HistoryPayload) -> AppResult<()> {
    match payload {
        HistoryPayload::SegmentUpdateText {
            segment_id,
            text,
            spans,
        } => {
            segment::update_text(conn, *segment_id, text)?;
            for span in spans {
                tagged_span::restore(conn, span)?;
            }
            Ok(())
        }
        HistoryPayload::SegmentSetSpeaker {
            segment_id,
            speaker_id,
        } => segment::set_speaker(conn, *segment_id, *speaker_id),
        HistoryPayload::SpanCreate { span_id } => tagged_span::delete(conn, *span_id),
        HistoryPayload::SpanDelete { snapshot } => {
            tagged_span::create_with_id(conn, &snapshot.span)?;
            span_tag::replace_for_span(conn, snapshot.span.id, &snapshot.tags)?;
            memo::restore_for_span(conn, snapshot.memo.as_ref())?;
            Ok(())
        }
        HistoryPayload::SpanUpdateTags { span_id, tags } => {
            span_tag::replace_for_span(conn, *span_id, tags)
        }
        HistoryPayload::SpanUpdateOffsets { span } => tagged_span::restore(conn, span),
        HistoryPayload::MemoUpsert { span_id, memo } => {
            memo::restore_for_span(conn, memo.as_ref())?;
            if memo.is_none() {
                memo::delete_for_span(conn, *span_id)?;
            }
            Ok(())
        }
    }
}

fn latest_event(conn: &Connection, table: &str) -> AppResult<Option<StoredEvent>> {
    let sql = format!("SELECT id, payload_json FROM {table} ORDER BY id DESC LIMIT 1");
    Ok(conn
        .query_row(&sql, [], |row| {
            let payload_json: String = row.get(1)?;
            let payload = serde_json::from_str::<HistoryPayload>(&payload_json).map_err(|err| {
                rusqlite::Error::FromSqlConversionFailure(
                    1,
                    rusqlite::types::Type::Text,
                    Box::new(err),
                )
            })?;
            Ok(StoredEvent {
                id: row.get(0)?,
                payload,
            })
        })
        .optional()?)
}

fn insert_event(conn: &Connection, table: &str, payload: &HistoryPayload) -> AppResult<()> {
    let sql = format!("INSERT INTO {table} (kind, payload_json, created_at) VALUES (?1, ?2, ?3)");
    conn.execute(
        &sql,
        params![
            payload.kind(),
            serde_json::to_string(payload)?,
            chrono::Utc::now().to_rfc3339(),
        ],
    )?;
    Ok(())
}

fn delete_event(conn: &Connection, table: &str, id: i64) -> AppResult<()> {
    let sql = format!("DELETE FROM {table} WHERE id = ?1");
    conn.execute(&sql, params![id])?;
    Ok(())
}

fn clear_events(conn: &Connection, table: &str) -> AppResult<()> {
    let sql = format!("DELETE FROM {table}");
    conn.execute(&sql, [])?;
    Ok(())
}

fn has_events(conn: &Connection, table: &str) -> AppResult<bool> {
    let sql = format!("SELECT COUNT(*) > 0 FROM {table}");
    Ok(conn.query_row(&sql, [], |row| row.get::<_, bool>(0))?)
}
