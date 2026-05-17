use crate::db::queries::{
    category, cluster, interview, segment, span_tag, speaker, tag, tagged_span,
};
use crate::error::AppResult;
use rusqlite::Connection;
use std::collections::{HashMap, HashSet};
use std::fmt::Write;

const MAX_EVIDENCE_SNIPPETS: usize = 2;
const MAX_EVIDENCE_CHARS: usize = 96;

#[derive(Default)]
struct EvidenceStats {
    span_ids: HashSet<i64>,
    snippets: Vec<String>,
}

fn compact_snippet(text: &str) -> String {
    let collapsed = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let trimmed = collapsed.trim();
    if trimmed.chars().count() <= MAX_EVIDENCE_CHARS {
        return trimmed.to_string();
    }
    let shortened: String = trimmed.chars().take(MAX_EVIDENCE_CHARS - 1).collect();
    format!("{}…", shortened.trim_end())
}

fn push_snippet(snippets: &mut Vec<String>, text: &str) {
    let snippet = compact_snippet(text);
    if snippet.is_empty() || snippets.iter().any(|existing| existing == &snippet) {
        return;
    }
    if snippets.len() < MAX_EVIDENCE_SNIPPETS {
        snippets.push(snippet);
    }
}

fn format_evidence(snippets: &[String]) -> String {
    if snippets.is_empty() {
        "(none)".to_string()
    } else {
        snippets
            .iter()
            .map(|snippet| format!("\"{snippet}\""))
            .collect::<Vec<_>>()
            .join("; ")
    }
}

fn load_tag_evidence(conn: &Connection) -> AppResult<HashMap<i64, EvidenceStats>> {
    let mut stmt = conn.prepare(
        "SELECT st.tag_id, ts.id, ts.text_snapshot
         FROM span_tag st
         JOIN tagged_span ts ON ts.id = st.span_id
         ORDER BY st.tag_id, ts.id",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, i64>(1)?,
            row.get::<_, String>(2)?,
        ))
    })?;
    let mut evidence_by_tag: HashMap<i64, EvidenceStats> = HashMap::new();
    for row in rows {
        let (tag_id, span_id, text_snapshot) = row?;
        let stats = evidence_by_tag.entry(tag_id).or_default();
        stats.span_ids.insert(span_id);
        push_snippet(&mut stats.snippets, &text_snapshot);
    }
    Ok(evidence_by_tag)
}

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

pub fn format_tags_for_categorizing(conn: &Connection) -> AppResult<String> {
    let tags = tag::list_all(conn)?;
    let categories = category::list_all(conn)?;
    let clusters = cluster::list(conn)?;
    let tag_evidence = load_tag_evidence(conn)?;
    let mut out = String::new();

    writeln!(out, "Existing categories available for reuse:").ok();
    if categories.is_empty() {
        writeln!(out, "- (none)").ok();
    } else {
        for category in &categories {
            let cluster = category
                .cluster_id
                .and_then(|id| clusters.iter().find(|cluster| cluster.id == id));
            let category_tags: Vec<_> = tags
                .iter()
                .filter(|tag| tag.category_id == Some(category.id))
                .collect();
            let tag_count = category_tags.len();
            let mut category_span_ids = HashSet::new();
            let mut category_snippets = Vec::new();
            for tag in &category_tags {
                if let Some(stats) = tag_evidence.get(&tag.id) {
                    category_span_ids.extend(stats.span_ids.iter().copied());
                    for snippet in &stats.snippets {
                        push_snippet(&mut category_snippets, snippet);
                    }
                }
            }
            let member_tags = if category_tags.is_empty() {
                "(none)".to_string()
            } else {
                category_tags
                    .iter()
                    .map(|tag| format!("[tag_id={}] {}", tag.id, tag.name))
                    .collect::<Vec<_>>()
                    .join(", ")
            };
            writeln!(
                out,
                "- [category_id={}] {}{} | cluster: {} | current tags: {} | tagged spans: {} | member tags: {} | evidence: {}",
                category.id,
                category.name,
                category
                    .description
                    .as_ref()
                    .map(|description| format!(": {description}"))
                    .unwrap_or_default(),
                cluster
                    .map(|cluster| format!("[cluster_id={}] {}", cluster.id, cluster.name))
                    .unwrap_or_else(|| "(none)".to_string()),
                tag_count,
                category_span_ids.len(),
                member_tags,
                format_evidence(&category_snippets),
            )
            .ok();
        }
    }

    writeln!(out, "\nTags to organize:").ok();
    if tags.is_empty() {
        writeln!(out, "- (none)").ok();
    } else {
        for tag in tags {
            let category = tag
                .category_id
                .and_then(|id| categories.iter().find(|category| category.id == id));
            let cluster = category
                .and_then(|category| category.cluster_id)
                .and_then(|id| clusters.iter().find(|cluster| cluster.id == id));
            let usage_count = tag_evidence
                .get(&tag.id)
                .map(|stats| stats.span_ids.len())
                .unwrap_or(0);
            let evidence = tag_evidence
                .get(&tag.id)
                .map(|stats| format_evidence(&stats.snippets))
                .unwrap_or_else(|| "(none)".to_string());
            writeln!(
                out,
                "- [tag_id={}] {}{} | current category: {} | current cluster: {} | tagged spans: {} | evidence: {}",
                tag.id,
                tag.name,
                tag.description
                    .as_ref()
                    .map(|description| format!(": {description}"))
                    .unwrap_or_default(),
                category
                    .map(|category| format!("[category_id={}] {}", category.id, category.name))
                    .unwrap_or_else(|| "(none)".to_string()),
                cluster
                    .map(|cluster| format!("[cluster_id={}] {}", cluster.id, cluster.name))
                    .unwrap_or_else(|| "(none)".to_string()),
                usage_count,
                evidence,
            )
            .ok();
        }
    }
    Ok(out)
}

pub fn format_categories_for_clustering(conn: &Connection) -> AppResult<String> {
    let categories = category::list_all(conn)?;
    let clusters = cluster::list(conn)?;
    let tags = tag::list_all(conn)?;
    let tag_evidence = load_tag_evidence(conn)?;
    let mut out = String::new();
    let mut category_span_counts: HashMap<i64, HashSet<i64>> = HashMap::new();
    let mut category_snippets: HashMap<i64, Vec<String>> = HashMap::new();

    for tag in &tags {
        let Some(category_id) = tag.category_id else {
            continue;
        };
        let Some(stats) = tag_evidence.get(&tag.id) else {
            continue;
        };
        category_span_counts
            .entry(category_id)
            .or_default()
            .extend(stats.span_ids.iter().copied());
        let snippets = category_snippets.entry(category_id).or_default();
        for snippet in &stats.snippets {
            push_snippet(snippets, snippet);
        }
    }

    writeln!(out, "Existing clusters available for reuse:").ok();
    if clusters.is_empty() {
        writeln!(out, "- (none)").ok();
    } else {
        for cluster in &clusters {
            let cluster_categories: Vec<_> = categories
                .iter()
                .filter(|category| category.cluster_id == Some(cluster.id))
                .collect();
            let mut cluster_span_ids = HashSet::new();
            let mut cluster_snippets = Vec::new();
            for category in &cluster_categories {
                if let Some(span_ids) = category_span_counts.get(&category.id) {
                    cluster_span_ids.extend(span_ids.iter().copied());
                }
                if let Some(snippets) = category_snippets.get(&category.id) {
                    for snippet in snippets {
                        push_snippet(&mut cluster_snippets, snippet);
                    }
                }
            }
            let member_categories = if cluster_categories.is_empty() {
                "(none)".to_string()
            } else {
                cluster_categories
                    .iter()
                    .map(|category| format!("[category_id={}] {}", category.id, category.name))
                    .collect::<Vec<_>>()
                    .join(", ")
            };
            writeln!(
                out,
                "- [cluster_id={}] {}{} | current categories: {} | tagged spans: {} | member categories: {} | evidence: {}",
                cluster.id,
                cluster.name,
                cluster
                    .description
                    .as_ref()
                    .map(|description| format!(": {description}"))
                    .unwrap_or_default(),
                cluster_categories.len(),
                cluster_span_ids.len(),
                member_categories,
                format_evidence(&cluster_snippets),
            )
            .ok();
        }
    }

    writeln!(out, "\nCategories to organize:").ok();
    if categories.is_empty() {
        writeln!(out, "- (none)").ok();
    } else {
        for category in categories {
            let cluster = category
                .cluster_id
                .and_then(|id| clusters.iter().find(|cluster| cluster.id == id));
            let tag_names: Vec<&str> = tags
                .iter()
                .filter(|tag| tag.category_id == Some(category.id))
                .map(|tag| tag.name.as_str())
                .collect();
            let usage_count = category_span_counts
                .get(&category.id)
                .map(|span_ids| span_ids.len())
                .unwrap_or(0);
            let evidence = category_snippets
                .get(&category.id)
                .map(|snippets| format_evidence(snippets))
                .unwrap_or_else(|| "(none)".to_string());
            writeln!(
                out,
                "- [category_id={}] {}{} | current cluster: {} | tag count: {} | tagged spans: {} | tags: {} | evidence: {}",
                category.id,
                category.name,
                category
                    .description
                    .as_ref()
                    .map(|description| format!(": {description}"))
                    .unwrap_or_default(),
                cluster
                    .map(|cluster| format!("[cluster_id={}] {}", cluster.id, cluster.name))
                    .unwrap_or_else(|| "(none)".to_string()),
                tag_names.len(),
                usage_count,
                if tag_names.is_empty() {
                    "(none)".to_string()
                } else {
                    tag_names.join(", ")
                },
                evidence,
            )
            .ok();
        }
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
