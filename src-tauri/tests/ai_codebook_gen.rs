use mockito::Server;
use rusqlite::Connection;
use serde_json::json;
use faden_app_lib::ai::codebook_gen::{self, CodebookGenInput};
use faden_app_lib::db::migrations::apply_migrations;
use faden_app_lib::db::queries::proposal::{self, ProposalStatus};
use faden_app_lib::db::queries::{ai_run, interview, proposal as _proposal_alias, segment, speaker};
use faden_app_lib::transcription::gemini::GeminiClient;

fn fresh() -> Connection {
    let mut c = Connection::open_in_memory().unwrap();
    c.pragma_update(None, "foreign_keys", "ON").unwrap();
    apply_migrations(&mut c).unwrap();
    c
}

#[tokio::test]
async fn codebook_gen_persists_proposal_on_success() {
    let mut server = Server::new_async().await;
    let response_text = json!({
        "proposals": [{
            "name": "ideals",
            "description": "Statements about personal ideals or standards"
        }]
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
            text: "I had high ideals".into(),
        }],
    )
    .unwrap();

    let client = GeminiClient::with_base_url("k".into(), server.url());
    let pid = codebook_gen::run(
        &conn,
        CodebookGenInput {
            interview_ids: vec![i.id],
            include_existing_codebook: false,
        },
        &client,
        "gemini-3-flash-preview",
        None,
        "English",
    )
    .await
    .unwrap()
    .expect("expected a non-empty proposal");

    let p = proposal::get(&conn, pid).unwrap();
    assert_eq!(p.status, ProposalStatus::Pending);
    let tag_count = p.payload["proposals"].as_array().unwrap().len();
    assert_eq!(tag_count, 1);
    let runs = ai_run::list_all(&conn).unwrap();
    assert_eq!(runs.len(), 1);
    assert_eq!(runs[0].raw_output.as_deref(), Some(response_text.as_str()));
    let _ = _proposal_alias::list_pending(&conn, None).unwrap();
}

#[test]
fn codebook_gen_prompt_prefers_enhancing_existing_codebook_without_duplicates() {
    let conn = fresh();
    let prompt = codebook_gen::build_prompt(
        &conn,
        &CodebookGenInput {
            interview_ids: vec![],
            include_existing_codebook: true,
        },
        None,
        "Czech",
    )
    .unwrap();

    assert!(prompt.contains("Produce all generated labels, descriptions, rationales, summaries, and other free-text output in Czech."));
    assert!(prompt.contains("starting point and improve it"));
    assert!(prompt.contains("Do not recreate existing tags"));
    assert!(prompt.contains("near-duplicates or semantically equivalent tags"));
}

#[tokio::test]
async fn codebook_gen_skips_empty_proposals() {
    let mut server = Server::new_async().await;
    let response_text = json!({
        "proposals": []
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

    let conn = fresh();
    let i = interview::create(&conn, "I").unwrap();
    let client = GeminiClient::with_base_url("k".into(), server.url());
    let pid = codebook_gen::run(
        &conn,
        CodebookGenInput {
            interview_ids: vec![i.id],
            include_existing_codebook: false,
        },
        &client,
        "gemini-3-flash-preview",
        None,
        "English",
    )
    .await
    .unwrap();

    assert_eq!(pid, None);
    assert!(_proposal_alias::list_pending(&conn, None)
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn codebook_gen_invalid_json_marks_run_failed() {
    let mut server = Server::new_async().await;
    let _m = server
        .mock(
            "POST",
            mockito::Matcher::Regex(r"/v1beta/models/.+:generateContent".to_string()),
        )
        .with_status(200)
        .with_body(
            json!({
                "candidates": [{ "content": {"parts": [{"text": "not json"}]} }]
            })
            .to_string(),
        )
        .create_async()
        .await;

    let conn = fresh();
    let _i = interview::create(&conn, "I").unwrap();
    let client = GeminiClient::with_base_url("k".into(), server.url());
    let err = codebook_gen::run(
        &conn,
        CodebookGenInput {
            interview_ids: vec![_i.id],
            include_existing_codebook: false,
        },
        &client,
        "gemini-3-flash-preview",
        None,
        "English",
    )
    .await
    .unwrap_err();
    assert!(matches!(err, faden_app_lib::error::AppError::Invalid(_)));
    let runs = ai_run::list_all(&conn).unwrap();
    assert_eq!(runs.len(), 1);
    assert_eq!(runs[0].raw_output.as_deref(), Some("not json"));
}
