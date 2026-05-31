use crate::ai::{
    prompts, SpanSuggestion, SpanSuggestionKind, SpanSuggestions, SPAN_SUGGESTIONS_SCHEMA,
};
use crate::db::queries::ai_run::{self, AiRunKind};
use crate::db::queries::proposal::{self, ProposalKind};
use crate::db::queries::{category, cluster, segment, span_tag, speaker, tag, tagged_span};
use crate::error::{AppError, AppResult};
use crate::transcription::gemini::GeminiClient;
use rusqlite::Connection;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::fmt::Write;

#[derive(Debug, Clone)]
struct ExistingTaggedRange {
    span_id: i64,
    segment_id: i64,
    start_offset: i32,
    end_offset: i32,
    tag_names: HashSet<String>,
}

const TRANSCRIPT_CHUNK_TARGET_CHARS: usize = 24_000;
const TRANSCRIPT_CHUNK_MAX_SEGMENTS: usize = 160;
const TAG_CHUNK_TARGET_CHARS: usize = 12_000;
const TAG_CHUNK_MAX_TAGS: usize = 80;
pub const PRETAG_MAX_OUTPUT_TOKENS_ESTIMATE: u32 = 65_536;

pub struct PretagInput {
    pub interview_id: i64,
}

#[derive(Debug, Clone)]
pub struct PretagRequest {
    pub system_instruction: String,
    pub user_parts: Vec<String>,
    pub prompt_preview: String,
    pub transcript_chunk_index: usize,
    pub transcript_chunk_count: usize,
    pub tag_chunk_index: usize,
    pub tag_chunk_count: usize,
}

pub fn build_prompt(
    conn: &Connection,
    input: &PretagInput,
    override_template: Option<&str>,
    project_language: &str,
) -> AppResult<String> {
    let requests = build_requests(conn, input, override_template, project_language)?;
    Ok(prompt_for_run_record(&requests))
}

pub fn build_requests(
    conn: &Connection,
    input: &PretagInput,
    override_template: Option<&str>,
    project_language: &str,
) -> AppResult<Vec<PretagRequest>> {
    let template = override_template.unwrap_or(prompts::DEFAULT_PRETAG);
    let system_instruction = prompts::with_project_language(template, project_language);
    let segments = segment::list_for_interview(conn, input.interview_id)?;
    let tags = tag::list_all(conn)?;
    if segments.is_empty() || tags.is_empty() {
        return Ok(Vec::new());
    }

    let transcript_chunks = chunk_segments(&segments);
    let tag_chunks = chunk_tags(&tags);
    let speakers = speaker::list_for_interview(conn, input.interview_id)?;
    let speaker_meta: HashMap<i64, (&str, bool)> = speakers
        .iter()
        .map(|speaker| {
            (
                speaker.id,
                (speaker.label_raw.as_str(), speaker.interviewer),
            )
        })
        .collect();

    let mut requests = Vec::new();
    for (transcript_chunk_index, transcript_chunk) in transcript_chunks.iter().enumerate() {
        let transcript = format_transcript_chunk(transcript_chunk, &speaker_meta);
        for (tag_chunk_index, tag_chunk) in tag_chunks.iter().enumerate() {
            let codebook = format_codebook_subset(conn, tag_chunk)?;
            let user_parts = vec![
                format!("Transcript:\n{transcript}"),
                format!("Codebook:\n{codebook}"),
            ];
            let prompt_preview = render_prompt_preview(&system_instruction, &user_parts);
            requests.push(PretagRequest {
                system_instruction: system_instruction.clone(),
                user_parts,
                prompt_preview,
                transcript_chunk_index,
                transcript_chunk_count: transcript_chunks.len(),
                tag_chunk_index,
                tag_chunk_count: tag_chunks.len(),
            });
        }
    }

    Ok(requests)
}

fn render_prompt_preview(system_instruction: &str, user_parts: &[String]) -> String {
    let mut out = String::new();
    out.push_str("System instruction:\n");
    out.push_str(system_instruction);
    for (idx, part) in user_parts.iter().enumerate() {
        let _ = write!(out, "\n\nPart {}:\n{}", idx + 1, part);
    }
    out
}

fn chunk_segments(segments: &[segment::Segment]) -> Vec<Vec<segment::Segment>> {
    let mut chunks = Vec::new();
    let mut current = Vec::new();
    let mut current_chars = 0_usize;

    for segment in segments {
        let estimated_chars = segment.text.chars().count() + 48;
        let should_split = !current.is_empty()
            && (current.len() >= TRANSCRIPT_CHUNK_MAX_SEGMENTS
                || current_chars + estimated_chars > TRANSCRIPT_CHUNK_TARGET_CHARS);
        if should_split {
            chunks.push(current);
            current = Vec::new();
            current_chars = 0;
        }
        current_chars += estimated_chars;
        current.push(segment.clone());
    }

    if !current.is_empty() {
        chunks.push(current);
    }
    chunks
}

fn chunk_tags(tags: &[tag::Tag]) -> Vec<Vec<tag::Tag>> {
    let mut chunks = Vec::new();
    let mut current = Vec::new();
    let mut current_chars = 0_usize;

    for tag in tags {
        let estimated_chars = tag.name.chars().count()
            + tag
                .description
                .as_deref()
                .map(|d| d.chars().count())
                .unwrap_or(0)
            + 32;
        let should_split = !current.is_empty()
            && (current.len() >= TAG_CHUNK_MAX_TAGS
                || current_chars + estimated_chars > TAG_CHUNK_TARGET_CHARS);
        if should_split {
            chunks.push(current);
            current = Vec::new();
            current_chars = 0;
        }
        current_chars += estimated_chars;
        current.push(tag.clone());
    }

    if !current.is_empty() {
        chunks.push(current);
    }
    chunks
}

fn format_transcript_chunk(
    segments: &[segment::Segment],
    speaker_meta: &HashMap<i64, (&str, bool)>,
) -> String {
    let mut out = String::new();
    for segment in segments {
        let (label, role) = segment
            .speaker_id
            .and_then(|id| speaker_meta.get(&id).copied())
            .map(|(label, interviewer)| {
                (
                    label,
                    if interviewer {
                        "interviewer"
                    } else {
                        "participant"
                    },
                )
            })
            .unwrap_or(("?", "unknown"));
        writeln!(
            out,
            "[segment_id={}] [speaker_role={}] [{:.1}-{:.1}] {}: {}",
            segment.id, role, segment.start_sec, segment.end_sec, label, segment.text
        )
        .ok();
    }
    out
}

fn format_codebook_subset(conn: &Connection, selected_tags: &[tag::Tag]) -> AppResult<String> {
    let clusters = cluster::list(conn)?;
    let categories = category::list_all(conn)?;
    let mut out = String::new();

    for cluster in &clusters {
        let cluster_categories: Vec<_> = categories
            .iter()
            .filter(|category| {
                category.cluster_id == Some(cluster.id)
                    && selected_tags
                        .iter()
                        .any(|tag| tag.category_id == Some(category.id))
            })
            .collect();
        if cluster_categories.is_empty() {
            continue;
        }
        writeln!(out, "# Cluster: {}", cluster.name).ok();
        if let Some(description) = &cluster.description {
            writeln!(out, "  {description}").ok();
        }
        for category in cluster_categories {
            writeln!(out, "  ## Category: {}", category.name).ok();
            if let Some(description) = &category.description {
                writeln!(out, "    {description}").ok();
            }
            for tag in selected_tags
                .iter()
                .filter(|tag| tag.category_id == Some(category.id))
            {
                writeln!(
                    out,
                    "    - {}{}",
                    tag.name,
                    tag.description
                        .as_ref()
                        .map(|description| format!(": {description}"))
                        .unwrap_or_default()
                )
                .ok();
            }
        }
    }

    for category in categories
        .iter()
        .filter(|category| category.cluster_id.is_none())
    {
        let tags_in_category: Vec<_> = selected_tags
            .iter()
            .filter(|tag| tag.category_id == Some(category.id))
            .collect();
        if tags_in_category.is_empty() {
            continue;
        }
        writeln!(out, "# Category: {}", category.name).ok();
        if let Some(description) = &category.description {
            writeln!(out, "  {description}").ok();
        }
        for tag in tags_in_category {
            writeln!(
                out,
                "  - {}{}",
                tag.name,
                tag.description
                    .as_ref()
                    .map(|description| format!(": {description}"))
                    .unwrap_or_default()
            )
            .ok();
        }
    }

    let standalone_tags: Vec<_> = selected_tags
        .iter()
        .filter(|tag| tag.category_id.is_none())
        .collect();
    if !standalone_tags.is_empty() {
        writeln!(out, "# Standalone tags").ok();
        for tag in standalone_tags {
            writeln!(
                out,
                "  - {}{}",
                tag.name,
                tag.description
                    .as_ref()
                    .map(|description| format!(": {description}"))
                    .unwrap_or_default()
            )
            .ok();
        }
    }

    if out.is_empty() {
        out.push_str("(none)\n");
    }
    Ok(out)
}

fn build_request_body(system_instruction: &str, user_parts: &[String]) -> serde_json::Value {
    serde_json::json!({
        "contents": [{
            "role":"user",
            "parts": user_parts
                .iter()
                .map(|part| serde_json::json!({"text": part}))
                .collect::<Vec<_>>()
        }],
        "systemInstruction": {
            "role": "system",
            "parts": [{"text": system_instruction}]
        },
        "generationConfig": {
            "temperature": 0,
            "responseMimeType": "application/json",
            "responseJsonSchema": serde_json::from_str::<serde_json::Value>(SPAN_SUGGESTIONS_SCHEMA).unwrap_or(serde_json::Value::Null)
        }
    })
}

pub fn prepare(
    conn: &Connection,
    input: &PretagInput,
    client: &GeminiClient,
    model: &str,
    prompt_override: Option<&str>,
    project_language: &str,
) -> AppResult<(i64, String, Vec<PretagRequest>)> {
    let requests = build_requests(conn, input, prompt_override, project_language)?;
    let prompt = prompt_for_run_record(&requests);
    let url = client.text_generate_url(model);
    let input_json = serde_json::json!({
        "request_count": requests.len(),
        "transcript_chunk_count": requests
            .first()
            .map(|request| request.transcript_chunk_count)
            .unwrap_or(0),
        "tag_chunk_count": requests
            .first()
            .map(|request| request.tag_chunk_count)
            .unwrap_or(0),
    })
    .to_string();
    let run_id = ai_run::start(
        conn,
        AiRunKind::Pretag,
        Some(input.interview_id),
        model,
        &prompt,
        Some(&input_json),
    )?;
    Ok((run_id, url, requests))
}

pub fn prompt_for_run_record(requests: &[PretagRequest]) -> String {
    match requests {
        [] => "Pretag: no segments or tags to evaluate".into(),
        [request] => request.prompt_preview.clone(),
        _ => format!(
            "Pretag split into {} transcript chunks × {} tag chunks = {} requests.\n\nFirst request prompt:\n{}",
            requests[0].transcript_chunk_count,
            requests[0].tag_chunk_count,
            requests.len(),
            requests[0].prompt_preview
        ),
    }
}

fn is_word_char(ch: char) -> bool {
    ch.is_alphanumeric()
}

fn is_strong_sentence_boundary_char(ch: char) -> bool {
    matches!(ch, '.' | '!' | '?')
}

fn prev_non_whitespace(chars: &[char], mut index: i32) -> Option<(i32, char)> {
    while index >= 0 {
        let ch = chars[index as usize];
        if !ch.is_whitespace() {
            return Some((index, ch));
        }
        index -= 1;
    }
    None
}

fn next_non_whitespace(chars: &[char], mut index: i32) -> Option<(i32, char)> {
    let len = chars.len() as i32;
    while index < len {
        let ch = chars[index as usize];
        if !ch.is_whitespace() {
            return Some((index, ch));
        }
        index += 1;
    }
    None
}

fn is_ordinal_continuation(chars: &[char], index: i32) -> bool {
    if index < 0 || index >= chars.len() as i32 || chars[index as usize] != '.' {
        return false;
    }
    let prev = prev_non_whitespace(chars, index - 1).map(|(_, ch)| ch);
    let next = next_non_whitespace(chars, index + 1).map(|(_, ch)| ch);
    prev.is_some_and(|c| c.is_ascii_digit()) && next.is_some_and(|c| c.is_lowercase())
}

fn is_sentence_boundary(chars: &[char], index: i32) -> bool {
    if index < 0 || index >= chars.len() as i32 {
        return false;
    }
    let ch = chars[index as usize];
    if !is_strong_sentence_boundary_char(ch) {
        return false;
    }
    if ch != '.' {
        return true;
    }

    let prev = prev_non_whitespace(chars, index - 1).map(|(_, ch)| ch);
    let next = next_non_whitespace(chars, index + 1).map(|(_, ch)| ch);

    if prev.is_some_and(|c| c.is_ascii_digit()) {
        if next.is_some_and(|c| c.is_lowercase() || c.is_numeric()) {
            return false;
        }
    }

    true
}

fn is_clause_boundary_char(ch: char) -> bool {
    matches!(ch, '.' | '!' | '?' | ';' | ':' | '—')
}

fn is_boundary_separator(ch: char) -> bool {
    ch.is_whitespace() || is_clause_boundary_char(ch) || matches!(ch, ',' | '-' | '–')
}

fn conjunction_boundary(chars: &[char], index: usize) -> Option<(usize, usize)> {
    const CONJUNCTIONS: &[&str] = &["ale", "protože", "but", "because"];
    if index >= chars.len() || !is_word_char(chars[index]) {
        return None;
    }
    let mut end = index;
    while end < chars.len() && is_word_char(chars[end]) {
        end += 1;
    }
    let token: String = chars[index..end].iter().collect();
    let normalized = token.to_lowercase();
    if !CONJUNCTIONS.iter().any(|candidate| *candidate == normalized) {
        return None;
    }
    let before_ok = index == 0 || is_boundary_separator(chars[index - 1]);
    let after_ok = end == chars.len() || is_boundary_separator(chars[end]);
    if before_ok && after_ok {
        Some((index, end))
    } else {
        None
    }
}

fn sentence_start(chars: &[char], index: i32) -> i32 {
    let mut pos = index.clamp(0, chars.len() as i32);
    while pos > 0 {
        if is_sentence_boundary(chars, pos - 1) {
            break;
        }
        pos -= 1;
    }
    while pos < chars.len() as i32 && chars[pos as usize].is_whitespace() {
        pos += 1;
    }
    pos
}

fn next_sentence_start(chars: &[char], start: i32, end: i32) -> Option<i32> {
    let mut pos = start.clamp(0, end);
    while pos < end {
        if is_sentence_boundary(chars, pos) {
            let mut next = pos + 1;
            while next < end && chars[next as usize].is_whitespace() {
                next += 1;
            }
            if next < end {
                return Some(next);
            }
            return None;
        }
        pos += 1;
    }
    None
}

fn has_meaningful_leading_fragment(chars: &[char], sentence_start: i32, start: i32) -> bool {
    let word_chars = chars[sentence_start as usize..start as usize]
        .iter()
        .filter(|ch| is_word_char(**ch))
        .count();
    word_chars >= 4
}

fn move_to_clause_start(chars: &[char], mut index: i32) -> i32 {
    let mut candidate = 0_i32;
    let mut pos = index;
    while pos > 0 {
        let prev = chars[(pos - 1) as usize];
        if is_clause_boundary_char(prev) {
            candidate = pos;
            break;
        }
        pos -= 1;
        if let Some((_start, end)) = conjunction_boundary(chars, pos as usize) {
            candidate = end as i32;
            break;
        }
    }
    index = candidate;
    while index < chars.len() as i32 && chars[index as usize].is_whitespace() {
        index += 1;
    }
    index
}

fn move_to_clause_end(chars: &[char], mut index: i32) -> i32 {
    let len = chars.len() as i32;
    while index < len {
        if let Some((start, _end)) = conjunction_boundary(chars, index as usize) {
            index = start as i32;
            break;
        }
        let ch = chars[index as usize];
        index += 1;
        if is_clause_boundary_char(ch) {
            break;
        }
    }
    while index > 0 && chars[(index - 1) as usize].is_whitespace() {
        index -= 1;
    }
    index
}

fn normalize_span_to_word_edges(
    chars: &[char],
    start_offset: i32,
    end_offset: i32,
) -> Option<(i32, i32)> {
    let len = chars.len() as i32;
    if len == 0 {
        return None;
    }

    let mut start = start_offset.clamp(0, len);
    let mut end = end_offset.clamp(0, len);
    if end <= start {
        return None;
    }

    while start < end && !is_word_char(chars[start as usize]) {
        start += 1;
    }
    while end > start && !is_word_char(chars[(end - 1) as usize]) {
        end -= 1;
    }
    if end <= start {
        return None;
    }

    while start > 0
        && is_word_char(chars[start as usize])
        && is_word_char(chars[(start - 1) as usize])
    {
        start -= 1;
    }
    while end < len && is_word_char(chars[(end - 1) as usize]) && is_word_char(chars[end as usize])
    {
        end += 1;
    }

    if end < len && is_ordinal_continuation(chars, end) {
        end += 1;
        while end < len && chars[end as usize].is_whitespace() {
            end += 1;
        }
        while end < len && is_word_char(chars[end as usize]) {
            end += 1;
        }
    }

    Some((start, end))
}

fn normalize_span_to_word_boundaries(
    text: &str,
    start_offset: i32,
    end_offset: i32,
) -> Option<(i32, i32)> {
    let chars: Vec<char> = text.chars().collect();
    let (mut start, mut end) = normalize_span_to_word_edges(&chars, start_offset, end_offset)?;
    let original_start = start;
    let original_end = end;

    start = move_to_clause_start(&chars, start);
    end = move_to_clause_end(&chars, end);

    let original_sentence_start = sentence_start(&chars, original_start);
    if let Some(next_start) = next_sentence_start(&chars, start, end) {
        if original_start > original_sentence_start
            && has_meaningful_leading_fragment(&chars, original_sentence_start, original_start)
        {
            start = next_start;
        }
    }

    while start < end && !is_word_char(chars[start as usize]) {
        start += 1;
    }
    while end > start && !is_word_char(chars[(end - 1) as usize]) {
        end -= 1;
    }

    if end <= start || original_end <= original_start {
        None
    } else {
        Some((start, end))
    }
}

fn existing_tagged_ranges(
    conn: &Connection,
    interview_id: i64,
) -> AppResult<Vec<ExistingTaggedRange>> {
    let spans = tagged_span::list_for_interview(conn, interview_id)?;
    let tags = tag::list_all(conn)?;
    let tag_names_by_id: HashMap<i64, &str> =
        tags.iter().map(|tag| (tag.id, tag.name.as_str())).collect();
    let mut out = Vec::new();

    for span in spans {
        let segment = match segment::get(conn, span.segment_id) {
            Ok(segment) if segment.interview_id == interview_id => segment,
            _ => continue,
        };
        let chars: Vec<char> = segment.text.chars().collect();
        let Some((start_offset, end_offset)) =
            normalize_span_to_word_edges(&chars, span.start_offset, span.end_offset)
        else {
            continue;
        };
        let mut tag_names = HashSet::new();
        for (tag_id, _) in span_tag::list_for_span(conn, span.id)? {
            if let Some(name) = tag_names_by_id.get(&tag_id) {
                tag_names.insert((*name).to_string());
            }
        }
        if tag_names.is_empty() {
            continue;
        }
        out.push(ExistingTaggedRange {
            span_id: span.id,
            segment_id: span.segment_id,
            start_offset,
            end_offset,
            tag_names,
        });
    }
    Ok(out)
}

fn validate_and_merge_suggestions(
    conn: &Connection,
    interview_id: i64,
    suggestions: Vec<SpanSuggestion>,
) -> AppResult<(SpanSuggestions, usize)> {
    let tags = tag::list_all(conn)?;
    let known_tags: HashSet<String> = tags.iter().map(|tag| tag.name.clone()).collect();
    let speakers = speaker::list_for_interview(conn, interview_id)?;
    let interviewer_speaker_ids: HashSet<i64> = speakers
        .iter()
        .filter(|speaker| speaker.interviewer)
        .map(|speaker| speaker.id)
        .collect();
    let existing_ranges = existing_tagged_ranges(conn, interview_id)?;
    let mut merged: BTreeMap<(Option<i64>, i64, i32, i32), SpanSuggestion> = BTreeMap::new();
    let mut skipped = 0_usize;

    for suggestion in suggestions {
        let segment = match segment::get(conn, suggestion.segment_id) {
            Ok(segment) if segment.interview_id == interview_id => segment,
            _ => {
                skipped += 1;
                continue;
            }
        };
        if segment
            .speaker_id
            .is_some_and(|speaker_id| interviewer_speaker_ids.contains(&speaker_id))
        {
            skipped += 1;
            continue;
        }
        let text_len = segment.text.chars().count() as i32;
        if suggestion.start_offset < 0
            || suggestion.end_offset <= suggestion.start_offset
            || suggestion.end_offset > text_len
        {
            skipped += 1;
            continue;
        }

        let Some((start_offset, end_offset)) = normalize_span_to_word_boundaries(
            &segment.text,
            suggestion.start_offset,
            suggestion.end_offset,
        ) else {
            skipped += 1;
            continue;
        };

        let mut tag_names: Vec<String> = suggestion
            .tag_names
            .into_iter()
            .filter(|name| known_tags.contains(name))
            .collect();
        if tag_names.is_empty() {
            skipped += 1;
            continue;
        }
        tag_names.sort();
        tag_names.dedup();

        let same_tag_overlaps: Vec<&ExistingTaggedRange> = existing_ranges
            .iter()
            .filter(|existing| {
                existing.segment_id == suggestion.segment_id
                    && existing.start_offset < end_offset
                    && existing.end_offset > start_offset
                    && tag_names
                        .iter()
                        .any(|name| existing.tag_names.contains(name))
            })
            .collect();

        let contained_by_same_tag = same_tag_overlaps.iter().any(|existing| {
            existing.start_offset <= start_offset
                && existing.end_offset >= end_offset
                && tag_names
                    .iter()
                    .all(|name| existing.tag_names.contains(name))
        });
        if contained_by_same_tag {
            skipped += 1;
            continue;
        }

        let extension_target = same_tag_overlaps.iter().find(|existing| {
            (start_offset < existing.start_offset || end_offset > existing.end_offset)
                && tag_names
                    .iter()
                    .any(|name| existing.tag_names.contains(name))
        });

        let normalized = if let Some(existing) = extension_target {
            SpanSuggestion {
                kind: Some(SpanSuggestionKind::ExtendSpan),
                existing_span_id: Some(existing.span_id),
                segment_id: suggestion.segment_id,
                start_offset: start_offset.min(existing.start_offset),
                end_offset: end_offset.max(existing.end_offset),
                tag_names,
                rationale: suggestion.rationale,
            }
        } else {
            SpanSuggestion {
                kind: Some(SpanSuggestionKind::NewSpan),
                existing_span_id: None,
                segment_id: suggestion.segment_id,
                start_offset,
                end_offset,
                tag_names,
                rationale: suggestion.rationale,
            }
        };

        let key = match normalized.kind {
            Some(SpanSuggestionKind::ExtendSpan) => {
                (normalized.existing_span_id, normalized.segment_id, 0, 0)
            }
            _ => (
                normalized.existing_span_id,
                normalized.segment_id,
                normalized.start_offset,
                normalized.end_offset,
            ),
        };
        merged
            .entry(key)
            .and_modify(|existing| {
                for tag_name in &normalized.tag_names {
                    if !existing.tag_names.iter().any(|current| current == tag_name) {
                        existing.tag_names.push(tag_name.clone());
                    }
                }
                existing.tag_names.sort();
                if matches!(existing.kind, Some(SpanSuggestionKind::ExtendSpan))
                    && matches!(normalized.kind, Some(SpanSuggestionKind::ExtendSpan))
                {
                    existing.start_offset = existing.start_offset.min(normalized.start_offset);
                    existing.end_offset = existing.end_offset.max(normalized.end_offset);
                }
                if existing.rationale.is_none() {
                    existing.rationale = normalized.rationale.clone();
                }
                if existing.kind.is_none() {
                    existing.kind = normalized.kind;
                }
                if existing.existing_span_id.is_none() {
                    existing.existing_span_id = normalized.existing_span_id;
                }
            })
            .or_insert(normalized);
    }

    Ok((
        SpanSuggestions {
            suggestions: merged.into_values().collect(),
        },
        skipped,
    ))
}

pub fn finalize_many(
    conn: &Connection,
    run_id: i64,
    interview_id: i64,
    api_results: Vec<AppResult<String>>,
) -> AppResult<Option<i64>> {
    let mut responses = Vec::new();
    let mut all_suggestions = Vec::new();

    for api_result in api_results {
        let response_text = match api_result {
            Ok(text) => text,
            Err(error) => {
                let raw_output = serialize_raw_outputs(&responses);
                ai_run::fail(conn, run_id, &error.to_string(), raw_output.as_deref())?;
                return Err(error);
            }
        };
        let parsed: SpanSuggestions = match serde_json::from_str(&response_text) {
            Ok(parsed) => parsed,
            Err(error) => {
                responses.push(response_text.clone());
                let raw_output = serialize_raw_outputs(&responses);
                ai_run::fail(
                    conn,
                    run_id,
                    &format!("parse: {error}"),
                    raw_output.as_deref(),
                )?;
                return Err(AppError::Invalid(format!("pretag parse: {error}")));
            }
        };
        responses.push(response_text);
        all_suggestions.extend(parsed.suggestions);
    }

    let (filtered, skipped) = validate_and_merge_suggestions(conn, interview_id, all_suggestions)?;
    let raw_output = serialize_raw_outputs(&responses);

    if filtered.suggestions.is_empty() {
        ai_run::complete(
            conn,
            run_id,
            None,
            Some(&format!("No suggestions found ({} skipped)", skipped)),
            raw_output.as_deref(),
        )?;
        return Ok(None);
    }

    let proposal_id = proposal::create(
        conn,
        run_id,
        ProposalKind::Pretag,
        &serde_json::to_value(&filtered)?,
    )?;
    ai_run::complete(
        conn,
        run_id,
        None,
        Some(&format!(
            "{} suggestions ({} skipped)",
            filtered.suggestions.len(),
            skipped
        )),
        raw_output.as_deref(),
    )?;
    Ok(Some(proposal_id))
}

fn serialize_raw_outputs(responses: &[String]) -> Option<String> {
    match responses {
        [] => None,
        [response] => Some(response.clone()),
        _ => serde_json::to_string(responses).ok(),
    }
}

pub fn finalize(
    conn: &Connection,
    run_id: i64,
    interview_id: i64,
    api_result: AppResult<String>,
) -> AppResult<Option<i64>> {
    finalize_many(conn, run_id, interview_id, vec![api_result])
}

pub async fn run(
    conn: &Connection,
    input: PretagInput,
    client: &GeminiClient,
    model: &str,
    prompt_override: Option<&str>,
    project_language: &str,
) -> AppResult<Option<i64>> {
    let (run_id, url, requests) = prepare(
        conn,
        &input,
        client,
        model,
        prompt_override,
        project_language,
    )?;
    if requests.is_empty() {
        ai_run::complete(
            conn,
            run_id,
            None,
            Some("No segments or tags to evaluate"),
            None,
        )?;
        return Ok(None);
    }
    let mut api_results = Vec::with_capacity(requests.len());
    for request in requests {
        let body = build_request_body(&request.system_instruction, &request.user_parts);
        api_results.push(client.post_generate(&url, &body).await);
    }
    finalize_many(conn, run_id, input.interview_id, api_results)
}
