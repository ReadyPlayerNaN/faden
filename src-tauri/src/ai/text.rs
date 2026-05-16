use crate::db::queries::{
    category, cluster, interview, segment, span_tag, speaker, tag, tagged_span,
};
use crate::error::AppResult;
use rusqlite::Connection;
use std::fmt::Write;

pub fn format_codebook(conn: &Connection) -> AppResult<String> {
    let clusters = cluster::list(conn)?;
    let categories = category::list_all(conn)?;
    let tags = tag::list_all(conn)?;
    let mut out = String::new();
    for cl in &clusters {
        writeln!(out, "# Cluster: {}", cl.name).ok();
        if let Some(d) = &cl.description {
            writeln!(out, "  {d}").ok();
        }
        for cat in categories.iter().filter(|c| c.cluster_id == Some(cl.id)) {
            writeln!(out, "  ## Category: {}", cat.name).ok();
            if let Some(d) = &cat.description {
                writeln!(out, "    {d}").ok();
            }
            for t in tags.iter().filter(|t| t.category_id == Some(cat.id)) {
                writeln!(
                    out,
                    "    - {}{}",
                    t.name,
                    t.description
                        .as_ref()
                        .map(|d| format!(": {d}"))
                        .unwrap_or_default()
                )
                .ok();
            }
        }
    }
    for cat in categories.iter().filter(|c| c.cluster_id.is_none()) {
        writeln!(out, "# Category: {}", cat.name).ok();
        if let Some(d) = &cat.description {
            writeln!(out, "  {d}").ok();
        }
        for t in tags.iter().filter(|t| t.category_id == Some(cat.id)) {
            writeln!(
                out,
                "  - {}{}",
                t.name,
                t.description
                    .as_ref()
                    .map(|d| format!(": {d}"))
                    .unwrap_or_default()
            )
            .ok();
        }
    }
    let standalone_tags: Vec<_> = tags.iter().filter(|t| t.category_id.is_none()).collect();
    if !standalone_tags.is_empty() {
        writeln!(out, "# Standalone tags").ok();
        for t in standalone_tags {
            writeln!(
                out,
                "  - {}{}",
                t.name,
                t.description
                    .as_ref()
                    .map(|d| format!(": {d}"))
                    .unwrap_or_default()
            )
            .ok();
        }
    }
    Ok(out)
}

pub fn format_available_tags(conn: &Connection) -> AppResult<String> {
    let tags = tag::list_all(conn)?;
    let mut out = String::new();
    for t in tags {
        writeln!(
            out,
            "- {}{}",
            t.name,
            t.description
                .as_ref()
                .map(|d| format!(": {d}"))
                .unwrap_or_default()
        )
        .ok();
    }
    if out.is_empty() {
        out.push_str("(none)\n");
    }
    Ok(out)
}

pub fn format_transcript(conn: &Connection, interview_id: i64) -> AppResult<String> {
    let segs = segment::list_for_interview(conn, interview_id)?;
    let speakers = speaker::list_for_interview(conn, interview_id)?;
    let by_speaker: std::collections::HashMap<i64, &str> = speakers
        .iter()
        .map(|s| (s.id, s.label_raw.as_str()))
        .collect();
    let mut out = String::new();
    for s in &segs {
        let label = s
            .speaker_id
            .and_then(|id| by_speaker.get(&id).copied())
            .unwrap_or("?");
        writeln!(
            out,
            "[segment_id={}] [{:.1}-{:.1}] {}: {}",
            s.id, s.start_sec, s.end_sec, label, s.text
        )
        .ok();
    }
    Ok(out)
}

pub fn format_transcripts(conn: &Connection, interview_ids: &[i64]) -> AppResult<String> {
    let mut out = String::new();
    for id in interview_ids {
        let iv = interview::get(conn, *id)?;
        writeln!(out, "## Interview: {}", iv.name).ok();
        out.push_str(&format_transcript(conn, *id)?);
        out.push('\n');
    }
    Ok(out)
}

pub fn format_existing_tagged_spans(conn: &Connection, interview_id: i64) -> AppResult<String> {
    let spans = tagged_span::list_for_interview(conn, interview_id)?;
    let tags = tag::list_all(conn)?;
    let mut out = String::new();
    for span in spans {
        let names: Vec<String> = span_tag::list_for_span(conn, span.id)?
            .into_iter()
            .filter_map(|st| tags.iter().find(|t| t.id == st.0).map(|t| t.name.clone()))
            .collect();
        if names.is_empty() {
            continue;
        }
        writeln!(
            out,
            "[segment_id={}] [{}-{}] {} -> {}",
            span.segment_id,
            span.start_offset,
            span.end_offset,
            span.text_snapshot,
            names.join(", ")
        )
        .ok();
    }
    if out.is_empty() {
        out.push_str("(none)\n");
    }
    Ok(out)
}
