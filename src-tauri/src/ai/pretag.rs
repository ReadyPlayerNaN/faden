use crate::ai::{prompts, SpanSuggestion, SpanSuggestions, SPAN_SUGGESTIONS_SCHEMA};
use crate::db::queries::ai_run::{self, AiRunKind};
use crate::db::queries::proposal::{self, ProposalKind};
use crate::db::queries::{category, cluster, segment, span_tag, speaker, tag, tagged_span};
use crate::error::{AppError, AppResult};
use crate::transcription::gemini::GeminiClient;
use rusqlite::Connection;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::fmt::Write;

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
    let speaker_labels: HashMap<i64, &str> = speakers
        .iter()
        .map(|speaker| (speaker.id, speaker.label_raw.as_str()))
        .collect();

    let mut requests = Vec::new();
    for (transcript_chunk_index, transcript_chunk) in transcript_chunks.iter().enumerate() {
        let transcript = format_transcript_chunk(transcript_chunk, &speaker_labels);
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
    speaker_labels: &HashMap<i64, &str>,
) -> String {
    let mut out = String::new();
    for segment in segments {
        let label = segment
            .speaker_id
            .and_then(|id| speaker_labels.get(&id).copied())
            .unwrap_or("?");
        writeln!(
            out,
            "[segment_id={}] [{:.1}-{:.1}] {}: {}",
            segment.id, segment.start_sec, segment.end_sec, label, segment.text
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

fn existing_tag_names_by_span_key(
    conn: &Connection,
    interview_id: i64,
) -> AppResult<HashMap<(i64, i32, i32), HashSet<String>>> {
    let spans = tagged_span::list_for_interview(conn, interview_id)?;
    let tags = tag::list_all(conn)?;
    let tag_names_by_id: HashMap<i64, &str> =
        tags.iter().map(|tag| (tag.id, tag.name.as_str())).collect();
    let mut out: HashMap<(i64, i32, i32), HashSet<String>> = HashMap::new();

    for span in spans {
        let key = (span.segment_id, span.start_offset, span.end_offset);
        let entry = out.entry(key).or_default();
        for (tag_id, _) in span_tag::list_for_span(conn, span.id)? {
            if let Some(name) = tag_names_by_id.get(&tag_id) {
                entry.insert((*name).to_string());
            }
        }
    }
    Ok(out)
}

fn validate_and_merge_suggestions(
    conn: &Connection,
    interview_id: i64,
    suggestions: Vec<SpanSuggestion>,
) -> AppResult<(SpanSuggestions, usize)> {
    let known_tags: HashSet<String> = tag::list_all(conn)?
        .into_iter()
        .map(|tag| tag.name)
        .collect();
    let existing_by_span = existing_tag_names_by_span_key(conn, interview_id)?;
    let mut merged: BTreeMap<(i64, i32, i32), SpanSuggestion> = BTreeMap::new();
    let mut skipped = 0_usize;

    for suggestion in suggestions {
        let segment = match segment::get(conn, suggestion.segment_id) {
            Ok(segment) if segment.interview_id == interview_id => segment,
            _ => {
                skipped += 1;
                continue;
            }
        };
        let text_len = segment.text.chars().count() as i32;
        if suggestion.start_offset < 0
            || suggestion.end_offset <= suggestion.start_offset
            || suggestion.end_offset > text_len
        {
            skipped += 1;
            continue;
        }

        let key = (
            suggestion.segment_id,
            suggestion.start_offset,
            suggestion.end_offset,
        );
        let already_present = existing_by_span.get(&key);
        let mut tag_names: Vec<String> = suggestion
            .tag_names
            .into_iter()
            .filter(|name| known_tags.contains(name))
            .filter(|name| !already_present.is_some_and(|present| present.contains(name)))
            .collect();
        if tag_names.is_empty() {
            skipped += 1;
            continue;
        }
        tag_names.sort();
        tag_names.dedup();

        merged
            .entry(key)
            .and_modify(|existing| {
                for tag_name in &tag_names {
                    if !existing.tag_names.iter().any(|current| current == tag_name) {
                        existing.tag_names.push(tag_name.clone());
                    }
                }
                existing.tag_names.sort();
                if existing.rationale.is_none() {
                    existing.rationale = suggestion.rationale.clone();
                }
            })
            .or_insert_with(|| SpanSuggestion {
                segment_id: suggestion.segment_id,
                start_offset: suggestion.start_offset,
                end_offset: suggestion.end_offset,
                tag_names,
                rationale: suggestion.rationale,
            });
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
