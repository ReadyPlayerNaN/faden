use mockito::Server;
use rusqlite::Connection;
use serde_json::json;
use faden_app_lib::ai::find_more::{self, FindMoreInput};
use faden_app_lib::db::migrations::apply_migrations;
use faden_app_lib::db::queries::{
    ai_run, category, cluster, interview, proposal, segment, speaker, tag,
};
use faden_app_lib::transcription::gemini::GeminiClient;

fn fresh() -> Connection {
    let mut c = Connection::open_in_memory().unwrap();
    c.pragma_update(None, "foreign_keys", "ON").unwrap();
    apply_migrations(&mut c).unwrap();
    c
}

#[tokio::test]
async fn find_more_persists_suggestions_with_target_tag() {
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
    let t = tag::create(&conn, Some(cat.id), "target", Some("definition"), None).unwrap();

    let mut server = Server::new_async().await;
    // model may return both valid in-range and out-of-range suggestions.
    let response_text = json!({
        "suggestions": [
            { "segment_id": seg_id, "start_offset": 0, "end_offset": 5, "tag_names": ["target"] },
            { "segment_id": seg_id, "start_offset": 6, "end_offset": 99, "tag_names": ["target"] }
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
    let pid = find_more::run(
        &conn,
        FindMoreInput {
            tag_id: t.id,
            interview_id: i.id,
        },
        &client,
        "gemini-3-flash-preview",
        None,
        "en",
    )
    .await
    .unwrap()
    .expect("expected a non-empty proposal");

    let p = proposal::get(&conn, pid).unwrap();
    let arr = p.payload["suggestions"].as_array().unwrap();
    assert_eq!(arr.len(), 1, "out-of-range suggestion should be filtered");
    assert_eq!(arr[0]["tag_names"][0], "target");
    let runs = ai_run::list_all(&conn).unwrap();
    assert_eq!(runs.len(), 1);
    assert_eq!(runs[0].raw_output.as_deref(), Some(response_text.as_str()));
}

#[tokio::test]
async fn find_more_skips_empty_filtered_suggestions() {
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
    let t = tag::create(&conn, Some(cat.id), "target", Some("definition"), None).unwrap();

    let mut server = Server::new_async().await;
    let response_text = json!({
        "suggestions": [
            { "segment_id": seg_id, "start_offset": 0, "end_offset": 99, "tag_names": ["target"] }
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
    let pid = find_more::run(
        &conn,
        FindMoreInput {
            tag_id: t.id,
            interview_id: i.id,
        },
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

#[tokio::test]
async fn find_more_invalid_json_fails_run() {
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

    let conn = fresh();
    let i = interview::create(&conn, "I").unwrap();
    let cl = cluster::create(&conn, "C", None, None).unwrap();
    let cat = category::create(&conn, Some(cl.id), "Cat", None, None).unwrap();
    let t = tag::create(&conn, Some(cat.id), "target", None, None).unwrap();
    let client = GeminiClient::with_base_url("k".into(), server.url());
    let err = find_more::run(
        &conn,
        FindMoreInput {
            tag_id: t.id,
            interview_id: i.id,
        },
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
