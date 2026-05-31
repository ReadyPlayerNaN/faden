use faden_app_lib::ai::pretag::{self, PretagInput};
use faden_app_lib::db::migrations::apply_migrations;
use faden_app_lib::db::queries::{
    ai_run, category, cluster, interview, proposal, segment, speaker, tag,
};
use faden_app_lib::transcription::gemini::GeminiClient;
use mockito::Server;
use rusqlite::Connection;
use serde_json::json;

fn fresh() -> Connection {
    let mut c = Connection::open_in_memory().unwrap();
    c.pragma_update(None, "foreign_keys", "ON").unwrap();
    apply_migrations(&mut c).unwrap();
    c
}

fn char_index_of(text: &str, needle: &str) -> i32 {
    text.find(needle)
        .map(|byte_idx| text[..byte_idx].chars().count() as i32)
        .unwrap()
}

#[tokio::test]
async fn pretag_persists_filtered_suggestions() {
    let mut conn = fresh();
    let i = interview::create(&conn, "I").unwrap();
    let sp = speaker::create_or_get(&conn, i.id, "A", None, None).unwrap();
    let ids = segment::insert_batch(
        &mut conn,
        i.id,
        &[segment::NewSegment {
            speaker_id: Some(sp.id),
            start_sec: 0.0,
            end_sec: 5.0,
            text: "hello world".into(),
        }],
    )
    .unwrap();
    let seg_id = ids[0];

    let cl = cluster::create(&conn, "C", None, None).unwrap();
    let cat = category::create(&conn, Some(cl.id), "Cat", None, None).unwrap();
    let _t1 = tag::create(&conn, Some(cat.id), "known", None, None).unwrap();

    let mut server = Server::new_async().await;
    let response_text = json!({
        "suggestions": [
            { "segment_id": seg_id, "start_offset": 0, "end_offset": 5, "tag_names": ["known"] },
            { "segment_id": seg_id, "start_offset": 6, "end_offset": 11, "tag_names": ["unknown"] }
        ]
    })
    .to_string();
    let _m = server
        .mock(
            "POST",
            mockito::Matcher::Regex(r"/v1beta/models/.+:generateContent".to_string()),
        )
        .with_status(200)
        .with_body(
            json!({
                "candidates": [{
                    "content": {"parts": [{"text": response_text}]}
                }]
            })
            .to_string(),
        )
        .create_async()
        .await;

    let client = GeminiClient::with_base_url("k".into(), server.url());
    let pid = pretag::run(
        &conn,
        PretagInput { interview_id: i.id },
        &client,
        "gemini-3-flash-preview",
        None,
        "en",
    )
    .await
    .unwrap()
    .expect("expected a non-empty proposal");
    let p = proposal::get(&conn, pid).unwrap();
    let n = p.payload["suggestions"].as_array().unwrap().len();
    assert_eq!(n, 1, "unknown-tag suggestion should be filtered");
    let runs = ai_run::list_all(&conn).unwrap();
    assert_eq!(runs.len(), 1);
    assert_eq!(runs[0].raw_output.as_deref(), Some(response_text.as_str()));
}

#[tokio::test]
async fn pretag_skips_empty_filtered_suggestions() {
    let mut conn = fresh();
    let i = interview::create(&conn, "I").unwrap();
    let sp = speaker::create_or_get(&conn, i.id, "A", None, None).unwrap();
    let ids = segment::insert_batch(
        &mut conn,
        i.id,
        &[segment::NewSegment {
            speaker_id: Some(sp.id),
            start_sec: 0.0,
            end_sec: 5.0,
            text: "hello world".into(),
        }],
    )
    .unwrap();
    let seg_id = ids[0];

    let cl = cluster::create(&conn, "C", None, None).unwrap();
    let cat = category::create(&conn, Some(cl.id), "Cat", None, None).unwrap();
    let _t1 = tag::create(&conn, Some(cat.id), "known", None, None).unwrap();

    let mut server = Server::new_async().await;
    let response_text = json!({
        "suggestions": [
            { "segment_id": seg_id, "start_offset": 0, "end_offset": 5, "tag_names": ["unknown"] }
        ]
    })
    .to_string();
    let _m = server
        .mock(
            "POST",
            mockito::Matcher::Regex(r"/v1beta/models/.+:generateContent".to_string()),
        )
        .with_status(200)
        .with_body(
            json!({
                "candidates": [{
                    "content": {"parts": [{"text": response_text}]}
                }]
            })
            .to_string(),
        )
        .create_async()
        .await;

    let client = GeminiClient::with_base_url("k".into(), server.url());
    let pid = pretag::run(
        &conn,
        PretagInput { interview_id: i.id },
        &client,
        "gemini-3-flash-preview",
        None,
        "en",
    )
    .await
    .unwrap();

    assert_eq!(pid, None);
    assert!(proposal::list_pending(&conn, None).unwrap().is_empty());
}

#[test]
fn pretag_prompt_includes_codebook_without_duplicate_available_tags_section() {
    let mut conn = fresh();
    let i = interview::create(&conn, "I").unwrap();
    let sp = speaker::create_or_get(&conn, i.id, "A", None, None).unwrap();
    segment::insert_batch(
        &mut conn,
        i.id,
        &[segment::NewSegment {
            speaker_id: Some(sp.id),
            start_sec: 0.0,
            end_sec: 5.0,
            text: "hello world".into(),
        }],
    )
    .unwrap();
    let cl = cluster::create(&conn, "C", None, None).unwrap();
    let cat = category::create(&conn, Some(cl.id), "Cat", None, None).unwrap();
    tag::create(
        &conn,
        Some(cat.id),
        "known",
        Some("Known description"),
        None,
    )
    .unwrap();
    tag::create(
        &conn,
        None,
        "standalone",
        Some("Standalone description"),
        None,
    )
    .unwrap();

    let prompt =
        pretag::build_prompt(&conn, &PretagInput { interview_id: i.id }, None, "cs").unwrap();
    assert!(prompt.contains("Produce all generated labels, descriptions, rationales, summaries, and other free-text output in Czech."));
    assert!(prompt.contains("existing tags from the provided codebook"));
    assert!(prompt.contains("participant text"));
    assert!(prompt.contains("smallest complete relevant clause or subsentence"));
    assert!(prompt.contains("interviewer segments"));
    assert!(!prompt.contains("All available tags (name: description)"));
    assert!(prompt.contains("Part 1:\nTranscript:"));
    assert!(prompt.contains("Part 2:\nCodebook:"));
    assert!(prompt.contains("- known: Known description"));
    assert!(prompt.contains("- standalone: Standalone description"));
    assert!(prompt.contains("# Standalone tags"));
    assert!(!prompt.contains("Already tagged spans in this interview"));
}

#[tokio::test]
async fn pretag_rejects_interviewer_segment_suggestions() {
    let mut conn = fresh();
    let i = interview::create(&conn, "I").unwrap();
    let interviewer = speaker::create_or_get(&conn, i.id, "Q", None, None).unwrap();
    conn.execute(
        "UPDATE speaker SET interviewer = 1 WHERE id = ?1",
        [interviewer.id],
    )
    .unwrap();
    let ids = segment::insert_batch(
        &mut conn,
        i.id,
        &[segment::NewSegment {
            speaker_id: Some(interviewer.id),
            start_sec: 0.0,
            end_sec: 5.0,
            text: "Question text".into(),
        }],
    )
    .unwrap();
    let seg_id = ids[0];

    let cl = cluster::create(&conn, "C", None, None).unwrap();
    let cat = category::create(&conn, Some(cl.id), "Cat", None, None).unwrap();
    tag::create(&conn, Some(cat.id), "known", None, None).unwrap();

    let mut server = Server::new_async().await;
    let response_text = json!({
        "suggestions": [
            { "segment_id": seg_id, "start_offset": 0, "end_offset": 8, "tag_names": ["known"] }
        ]
    })
    .to_string();
    let _m = server
        .mock(
            "POST",
            mockito::Matcher::Regex(r"/v1beta/models/.+:generateContent".to_string()),
        )
        .with_status(200)
        .with_body(
            json!({"candidates":[{"content":{"parts":[{"text":response_text}]}}]}).to_string(),
        )
        .create_async()
        .await;

    let client = GeminiClient::with_base_url("k".into(), server.url());
    let pid = pretag::run(
        &conn,
        PretagInput { interview_id: i.id },
        &client,
        "gemini-3-flash-preview",
        None,
        "en",
    )
    .await
    .unwrap();
    assert_eq!(pid, None);
}

#[tokio::test]
async fn pretag_keeps_interviewer_context_but_accepts_participant_targets() {
    let mut conn = fresh();
    let i = interview::create(&conn, "I").unwrap();
    let interviewer = speaker::create_or_get(&conn, i.id, "Q", None, None).unwrap();
    conn.execute(
        "UPDATE speaker SET interviewer = 1 WHERE id = ?1",
        [interviewer.id],
    )
    .unwrap();
    let participant = speaker::create_or_get(&conn, i.id, "A", None, None).unwrap();
    let ids = segment::insert_batch(
        &mut conn,
        i.id,
        &[
            segment::NewSegment {
                speaker_id: Some(interviewer.id),
                start_sec: 0.0,
                end_sec: 2.0,
                text: "Question?".into(),
            },
            segment::NewSegment {
                speaker_id: Some(participant.id),
                start_sec: 2.0,
                end_sec: 5.0,
                text: "Answer text here".into(),
            },
        ],
    )
    .unwrap();
    let participant_seg_id = ids[1];

    let cl = cluster::create(&conn, "C", None, None).unwrap();
    let cat = category::create(&conn, Some(cl.id), "Cat", None, None).unwrap();
    tag::create(&conn, Some(cat.id), "known", None, None).unwrap();

    let mut server = Server::new_async().await;
    let response_text = json!({
        "suggestions": [
            { "segment_id": participant_seg_id, "start_offset": 0, "end_offset": 6, "tag_names": ["known"] }
        ]
    }).to_string();
    let _m = server
        .mock(
            "POST",
            mockito::Matcher::Regex(r"/v1beta/models/.+:generateContent".to_string()),
        )
        .with_status(200)
        .with_body(
            json!({"candidates":[{"content":{"parts":[{"text":response_text}]}}]}).to_string(),
        )
        .create_async()
        .await;

    let client = GeminiClient::with_base_url("k".into(), server.url());
    let pid = pretag::run(
        &conn,
        PretagInput { interview_id: i.id },
        &client,
        "gemini-3-flash-preview",
        None,
        "en",
    )
    .await
    .unwrap()
    .expect("expected participant suggestion");
    let p = proposal::get(&conn, pid).unwrap();
    assert_eq!(p.payload["suggestions"].as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn pretag_snaps_ranges_to_word_boundaries() {
    let mut conn = fresh();
    let i = interview::create(&conn, "I").unwrap();
    let sp = speaker::create_or_get(&conn, i.id, "A", None, None).unwrap();
    let ids = segment::insert_batch(
        &mut conn,
        i.id,
        &[segment::NewSegment {
            speaker_id: Some(sp.id),
            start_sec: 0.0,
            end_sec: 5.0,
            text: "hello world again".into(),
        }],
    )
    .unwrap();
    let seg_id = ids[0];

    let cl = cluster::create(&conn, "C", None, None).unwrap();
    let cat = category::create(&conn, Some(cl.id), "Cat", None, None).unwrap();
    tag::create(&conn, Some(cat.id), "known", None, None).unwrap();

    let mut server = Server::new_async().await;
    let response_text = json!({
        "suggestions": [
            { "segment_id": seg_id, "start_offset": 1, "end_offset": 8, "tag_names": ["known"] }
        ]
    })
    .to_string();
    let _m = server
        .mock(
            "POST",
            mockito::Matcher::Regex(r"/v1beta/models/.+:generateContent".to_string()),
        )
        .with_status(200)
        .with_body(
            json!({
                "candidates": [{
                    "content": {"parts": [{"text": response_text}]}
                }]
            })
            .to_string(),
        )
        .create_async()
        .await;

    let client = GeminiClient::with_base_url("k".into(), server.url());
    let pid = pretag::run(
        &conn,
        PretagInput { interview_id: i.id },
        &client,
        "gemini-3-flash-preview",
        None,
        "en",
    )
    .await
    .unwrap()
    .expect("expected snapped proposal");

    let p = proposal::get(&conn, pid).unwrap();
    let suggestion = &p.payload["suggestions"].as_array().unwrap()[0];
    assert_eq!(suggestion["start_offset"].as_i64(), Some(0));
    assert_eq!(suggestion["end_offset"].as_i64(), Some(17));
}

#[tokio::test]
async fn pretag_filters_already_existing_span_tags() {
    let mut conn = fresh();
    let i = interview::create(&conn, "I").unwrap();
    let sp = speaker::create_or_get(&conn, i.id, "A", None, None).unwrap();
    let ids = segment::insert_batch(
        &mut conn,
        i.id,
        &[segment::NewSegment {
            speaker_id: Some(sp.id),
            start_sec: 0.0,
            end_sec: 5.0,
            text: "Takže novináři se naučili dávat to nejdůležitější hned na začátek. Kdo, co, kdy, kde, proč. Zbytek až potom.".into(),
        }],
    )
    .unwrap();
    let seg_id = ids[0];

    let cl = cluster::create(&conn, "C", None, None).unwrap();
    let cat = category::create(&conn, Some(cl.id), "Cat", None, None).unwrap();
    let known = tag::create(&conn, Some(cat.id), "known", None, None).unwrap();

    let span = faden_app_lib::db::queries::tagged_span::create(
        &conn,
        &faden_app_lib::db::queries::tagged_span::NewSpan {
            interview_id: i.id,
            segment_id: seg_id,
            start_offset: 6,
            end_offset: 82,
            text_snapshot:
                "náři se naučili dávat to nejdůležitější hned na začátek. Kdo, co, kdy, kde",
            audio_start_sec: 0.0,
            audio_end_sec: 4.0,
        },
    )
    .unwrap();
    faden_app_lib::db::queries::span_tag::attach(
        &conn,
        span.id,
        known.id,
        faden_app_lib::db::queries::span_tag::SpanTagSource::Manual,
    )
    .unwrap();

    let mut server = Server::new_async().await;
    let response_text = json!({
        "suggestions": [
            { "segment_id": seg_id, "start_offset": 14, "end_offset": 74, "tag_names": ["known"] }
        ]
    })
    .to_string();
    let _m = server
        .mock(
            "POST",
            mockito::Matcher::Regex(r"/v1beta/models/.+:generateContent".to_string()),
        )
        .with_status(200)
        .with_body(
            json!({
                "candidates": [{
                    "content": {"parts": [{"text": response_text}]}
                }]
            })
            .to_string(),
        )
        .create_async()
        .await;

    let client = GeminiClient::with_base_url("k".into(), server.url());
    let pid = pretag::run(
        &conn,
        PretagInput { interview_id: i.id },
        &client,
        "gemini-3-flash-preview",
        None,
        "en",
    )
    .await
    .unwrap();

    assert_eq!(pid, None);
}

#[tokio::test]
async fn pretag_marks_overlapping_same_tag_as_extension() {
    let mut conn = fresh();
    let i = interview::create(&conn, "I").unwrap();
    let sp = speaker::create_or_get(&conn, i.id, "A", None, None).unwrap();
    let ids = segment::insert_batch(
        &mut conn,
        i.id,
        &[segment::NewSegment {
            speaker_id: Some(sp.id),
            start_sec: 0.0,
            end_sec: 5.0,
            text: "alpha beta gamma, delta epsilon".into(),
        }],
    )
    .unwrap();
    let seg_id = ids[0];

    let cl = cluster::create(&conn, "C", None, None).unwrap();
    let cat = category::create(&conn, Some(cl.id), "Cat", None, None).unwrap();
    let known = tag::create(&conn, Some(cat.id), "known", None, None).unwrap();

    let span = faden_app_lib::db::queries::tagged_span::create(
        &conn,
        &faden_app_lib::db::queries::tagged_span::NewSpan {
            interview_id: i.id,
            segment_id: seg_id,
            start_offset: 6,
            end_offset: 16,
            text_snapshot: "beta gamma",
            audio_start_sec: 0.0,
            audio_end_sec: 2.0,
        },
    )
    .unwrap();
    faden_app_lib::db::queries::span_tag::attach(
        &conn,
        span.id,
        known.id,
        faden_app_lib::db::queries::span_tag::SpanTagSource::Manual,
    )
    .unwrap();

    let mut server = Server::new_async().await;
    let response_text = json!({
        "suggestions": [
            { "segment_id": seg_id, "start_offset": 0, "end_offset": 24, "tag_names": ["known"] }
        ]
    })
    .to_string();
    let _m = server
        .mock(
            "POST",
            mockito::Matcher::Regex(r"/v1beta/models/.+:generateContent".to_string()),
        )
        .with_status(200)
        .with_body(
            json!({"candidates":[{"content":{"parts":[{"text":response_text}]}}]}).to_string(),
        )
        .create_async()
        .await;

    let client = GeminiClient::with_base_url("k".into(), server.url());
    let pid = pretag::run(
        &conn,
        PretagInput { interview_id: i.id },
        &client,
        "gemini-3-flash-preview",
        None,
        "en",
    )
    .await
    .unwrap()
    .expect("expected extension proposal");
    let p = proposal::get(&conn, pid).unwrap();
    let suggestion = &p.payload["suggestions"].as_array().unwrap()[0];
    assert_eq!(suggestion["kind"].as_str(), Some("extend_span"));
    assert_eq!(suggestion["existing_span_id"].as_i64(), Some(span.id));
}

#[tokio::test]
async fn pretag_merges_compatible_extension_suggestions() {
    let mut conn = fresh();
    let i = interview::create(&conn, "I").unwrap();
    let sp = speaker::create_or_get(&conn, i.id, "A", None, None).unwrap();
    let ids = segment::insert_batch(
        &mut conn,
        i.id,
        &[segment::NewSegment {
            speaker_id: Some(sp.id),
            start_sec: 0.0,
            end_sec: 5.0,
            text: "alpha beta gamma, delta epsilon zeta".into(),
        }],
    )
    .unwrap();
    let seg_id = ids[0];

    let cl = cluster::create(&conn, "C", None, None).unwrap();
    let cat = category::create(&conn, Some(cl.id), "Cat", None, None).unwrap();
    let known = tag::create(&conn, Some(cat.id), "known", None, None).unwrap();

    let span = faden_app_lib::db::queries::tagged_span::create(
        &conn,
        &faden_app_lib::db::queries::tagged_span::NewSpan {
            interview_id: i.id,
            segment_id: seg_id,
            start_offset: 6,
            end_offset: 16,
            text_snapshot: "beta gamma",
            audio_start_sec: 0.0,
            audio_end_sec: 2.0,
        },
    )
    .unwrap();
    faden_app_lib::db::queries::span_tag::attach(
        &conn,
        span.id,
        known.id,
        faden_app_lib::db::queries::span_tag::SpanTagSource::Manual,
    )
    .unwrap();

    let mut server = Server::new_async().await;
    let response_text = json!({
        "suggestions": [
            { "segment_id": seg_id, "start_offset": 0, "end_offset": 24, "tag_names": ["known"] },
            { "segment_id": seg_id, "start_offset": 0, "end_offset": 36, "tag_names": ["known"] }
        ]
    })
    .to_string();
    let _m = server
        .mock(
            "POST",
            mockito::Matcher::Regex(r"/v1beta/models/.+:generateContent".to_string()),
        )
        .with_status(200)
        .with_body(
            json!({"candidates":[{"content":{"parts":[{"text":response_text}]}}]}).to_string(),
        )
        .create_async()
        .await;

    let client = GeminiClient::with_base_url("k".into(), server.url());
    let pid = pretag::run(
        &conn,
        PretagInput { interview_id: i.id },
        &client,
        "gemini-3-flash-preview",
        None,
        "en",
    )
    .await
    .unwrap()
    .expect("expected merged extension proposal");
    let p = proposal::get(&conn, pid).unwrap();
    let suggestions = p.payload["suggestions"].as_array().unwrap();
    assert_eq!(suggestions.len(), 1);
    assert_eq!(suggestions[0]["kind"].as_str(), Some("extend_span"));
}

#[tokio::test]
async fn pretag_allows_different_tag_overlap_as_new_span() {
    let mut conn = fresh();
    let i = interview::create(&conn, "I").unwrap();
    let sp = speaker::create_or_get(&conn, i.id, "A", None, None).unwrap();
    let ids = segment::insert_batch(
        &mut conn,
        i.id,
        &[segment::NewSegment {
            speaker_id: Some(sp.id),
            start_sec: 0.0,
            end_sec: 5.0,
            text: "alpha beta gamma delta".into(),
        }],
    )
    .unwrap();
    let seg_id = ids[0];

    let cl = cluster::create(&conn, "C", None, None).unwrap();
    let cat = category::create(&conn, Some(cl.id), "Cat", None, None).unwrap();
    let known = tag::create(&conn, Some(cat.id), "known", None, None).unwrap();
    tag::create(&conn, Some(cat.id), "other", None, None).unwrap();

    let span = faden_app_lib::db::queries::tagged_span::create(
        &conn,
        &faden_app_lib::db::queries::tagged_span::NewSpan {
            interview_id: i.id,
            segment_id: seg_id,
            start_offset: 6,
            end_offset: 16,
            text_snapshot: "beta gamma",
            audio_start_sec: 0.0,
            audio_end_sec: 2.0,
        },
    )
    .unwrap();
    faden_app_lib::db::queries::span_tag::attach(
        &conn,
        span.id,
        known.id,
        faden_app_lib::db::queries::span_tag::SpanTagSource::Manual,
    )
    .unwrap();

    let mut server = Server::new_async().await;
    let response_text = json!({
        "suggestions": [
            { "segment_id": seg_id, "start_offset": 6, "end_offset": 16, "tag_names": ["other"] }
        ]
    })
    .to_string();
    let _m = server
        .mock(
            "POST",
            mockito::Matcher::Regex(r"/v1beta/models/.+:generateContent".to_string()),
        )
        .with_status(200)
        .with_body(
            json!({"candidates":[{"content":{"parts":[{"text":response_text}]}}]}).to_string(),
        )
        .create_async()
        .await;

    let client = GeminiClient::with_base_url("k".into(), server.url());
    let pid = pretag::run(
        &conn,
        PretagInput { interview_id: i.id },
        &client,
        "gemini-3-flash-preview",
        None,
        "en",
    )
    .await
    .unwrap()
    .expect("expected overlapping different-tag suggestion");
    let p = proposal::get(&conn, pid).unwrap();
    let suggestion = &p.payload["suggestions"].as_array().unwrap()[0];
    assert_eq!(suggestion["kind"].as_str(), Some("new_span"));
}

#[tokio::test]
async fn pretag_expands_phrase_to_clause_with_conjunction_boundary() {
    let mut conn = fresh();
    let i = interview::create(&conn, "I").unwrap();
    let sp = speaker::create_or_get(&conn, i.id, "A", None, None).unwrap();
    let text = "Najednou přišel zlom a všechno se změnilo";
    let ids = segment::insert_batch(
        &mut conn,
        i.id,
        &[segment::NewSegment {
            speaker_id: Some(sp.id),
            start_sec: 0.0,
            end_sec: 5.0,
            text: text.into(),
        }],
    ).unwrap();
    let seg_id = ids[0];

    let cl = cluster::create(&conn, "C", None, None).unwrap();
    let cat = category::create(&conn, Some(cl.id), "Cat", None, None).unwrap();
    tag::create(&conn, Some(cat.id), "known", None, None).unwrap();

    let mut server = Server::new_async().await;
    let response_text = json!({
        "suggestions": [{
            "segment_id": seg_id,
            "start_offset": char_index_of(text, "zlom"),
            "end_offset": char_index_of(text, "zlom") + 4,
            "tag_names": ["known"]
        }]
    }).to_string();
    let _m = server.mock("POST", mockito::Matcher::Regex(r"/v1beta/models/.+:generateContent".to_string()))
        .with_status(200)
        .with_body(json!({"candidates":[{"content":{"parts":[{"text":response_text}]}}]}).to_string())
        .create_async().await;

    let client = GeminiClient::with_base_url("k".into(), server.url());
    let pid = pretag::run(&conn, PretagInput { interview_id: i.id }, &client, "gemini-3-flash-preview", None, "en")
        .await.unwrap().expect("expected clause proposal");
    let p = proposal::get(&conn, pid).unwrap();
    let suggestion = &p.payload["suggestions"].as_array().unwrap()[0];
    assert_eq!(suggestion["start_offset"].as_i64(), Some(0));
    assert_eq!(suggestion["end_offset"].as_i64(), Some(char_index_of(text, " a všechno") as i64));
}

#[tokio::test]
async fn pretag_keeps_already_good_clause_stable() {
    let mut conn = fresh();
    let i = interview::create(&conn, "I").unwrap();
    let sp = speaker::create_or_get(&conn, i.id, "A", None, None).unwrap();
    let text = "První klauze, druhá klauze.";
    let ids = segment::insert_batch(
        &mut conn,
        i.id,
        &[segment::NewSegment {
            speaker_id: Some(sp.id),
            start_sec: 0.0,
            end_sec: 5.0,
            text: text.into(),
        }],
    ).unwrap();
    let seg_id = ids[0];

    let cl = cluster::create(&conn, "C", None, None).unwrap();
    let cat = category::create(&conn, Some(cl.id), "Cat", None, None).unwrap();
    tag::create(&conn, Some(cat.id), "known", None, None).unwrap();

    let start = 0_i32;
    let end = char_index_of(text, ", druhá");
    let mut server = Server::new_async().await;
    let response_text = json!({
        "suggestions": [{
            "segment_id": seg_id,
            "start_offset": start,
            "end_offset": end,
            "tag_names": ["known"]
        }]
    }).to_string();
    let _m = server.mock("POST", mockito::Matcher::Regex(r"/v1beta/models/.+:generateContent".to_string()))
        .with_status(200)
        .with_body(json!({"candidates":[{"content":{"parts":[{"text":response_text}]}}]}).to_string())
        .create_async().await;

    let client = GeminiClient::with_base_url("k".into(), server.url());
    let pid = pretag::run(&conn, PretagInput { interview_id: i.id }, &client, "gemini-3-flash-preview", None, "en")
        .await.unwrap().expect("expected stable clause proposal");
    let p = proposal::get(&conn, pid).unwrap();
    let suggestion = &p.payload["suggestions"].as_array().unwrap()[0];
    assert_eq!(suggestion["start_offset"].as_i64(), Some(start as i64));
    assert_eq!(suggestion["end_offset"].as_i64(), Some(end as i64));
}

#[tokio::test]
async fn pretag_expands_czech_punctuation_clause() {
    let mut conn = fresh();
    let i = interview::create(&conn, "I").unwrap();
    let sp = speaker::create_or_get(&conn, i.id, "A", None, None).unwrap();
    let text = "Nejdřív přišel tisk, potom distribuce.";
    let ids = segment::insert_batch(
        &mut conn,
        i.id,
        &[segment::NewSegment {
            speaker_id: Some(sp.id),
            start_sec: 0.0,
            end_sec: 5.0,
            text: text.into(),
        }],
    ).unwrap();
    let seg_id = ids[0];

    let cl = cluster::create(&conn, "C", None, None).unwrap();
    let cat = category::create(&conn, Some(cl.id), "Cat", None, None).unwrap();
    tag::create(&conn, Some(cat.id), "known", None, None).unwrap();

    let mut server = Server::new_async().await;
    let response_text = json!({
        "suggestions": [{
            "segment_id": seg_id,
            "start_offset": char_index_of(text, "tisk"),
            "end_offset": char_index_of(text, "tisk") + 4,
            "tag_names": ["known"]
        }]
    }).to_string();
    let _m = server.mock("POST", mockito::Matcher::Regex(r"/v1beta/models/.+:generateContent".to_string()))
        .with_status(200)
        .with_body(json!({"candidates":[{"content":{"parts":[{"text":response_text}]}}]}).to_string())
        .create_async().await;

    let client = GeminiClient::with_base_url("k".into(), server.url());
    let pid = pretag::run(&conn, PretagInput { interview_id: i.id }, &client, "gemini-3-flash-preview", None, "en")
        .await.unwrap().expect("expected punctuation clause proposal");
    let p = proposal::get(&conn, pid).unwrap();
    let suggestion = &p.payload["suggestions"].as_array().unwrap()[0];
    assert_eq!(suggestion["start_offset"].as_i64(), Some(0));
    assert_eq!(suggestion["end_offset"].as_i64(), Some(char_index_of(text, ", potom") as i64));
}

#[tokio::test]
async fn pretag_invalid_json_fails_run() {
    let mut server = Server::new_async().await;
    let _m = server
        .mock(
            "POST",
            mockito::Matcher::Regex(r"/v1beta/models/.+:generateContent".to_string()),
        )
        .with_status(200)
        .with_body(json!({"candidates":[{"content":{"parts":[{"text":"not json"}]}}]}).to_string())
        .create_async()
        .await;

    let mut conn = fresh();
    let i = interview::create(&conn, "I").unwrap();
    let sp = speaker::create_or_get(&conn, i.id, "A", None, None).unwrap();
    segment::insert_batch(
        &mut conn,
        i.id,
        &[segment::NewSegment {
            speaker_id: Some(sp.id),
            start_sec: 0.0,
            end_sec: 5.0,
            text: "hello world".into(),
        }],
    )
    .unwrap();
    let cl = cluster::create(&conn, "C", None, None).unwrap();
    let cat = category::create(&conn, Some(cl.id), "Cat", None, None).unwrap();
    tag::create(&conn, Some(cat.id), "known", None, None).unwrap();

    let client = GeminiClient::with_base_url("k".into(), server.url());
    let err = pretag::run(
        &conn,
        PretagInput { interview_id: i.id },
        &client,
        "gemini-3-flash-preview",
        None,
        "en",
    )
    .await
    .unwrap_err();
    assert!(matches!(err, faden_app_lib::error::AppError::Invalid(_)));
    let runs = ai_run::list_all(&conn).unwrap();
    assert_eq!(runs.len(), 1);
    assert_eq!(runs[0].raw_output.as_deref(), Some("not json"));
}
