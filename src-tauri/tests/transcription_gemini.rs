use faden_app_lib::transcription::gemini::*;
use mockito::Server;
use serde_json::json;
use std::io::Write;
use tempfile::NamedTempFile;

#[tokio::test]
async fn upload_succeeds_and_returns_file_handle() {
    let mut server = Server::new_async().await;
    let _m = server
        .mock(
            "POST",
            mockito::Matcher::Regex(r"^/upload/v1beta/files".to_string()),
        )
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(
            json!({"file": {"name": "files/abc123", "uri": "https://example/abc123"}}).to_string(),
        )
        .create_async()
        .await;

    let mut tmp = NamedTempFile::new().unwrap();
    tmp.write_all(b"fake audio").unwrap();
    let client = GeminiClient::with_base_url("k".into(), server.url());
    let f = client.upload_file(tmp.path(), "audio/mpeg").await.unwrap();
    assert_eq!(f.name, "files/abc123");
}

#[tokio::test]
async fn upload_maps_429_to_invalid() {
    let mut server = Server::new_async().await;
    let _m = server
        .mock(
            "POST",
            mockito::Matcher::Regex(r"^/upload/v1beta/files".to_string()),
        )
        .with_status(429)
        .with_body("rate limited")
        .create_async()
        .await;
    let mut tmp = NamedTempFile::new().unwrap();
    tmp.write_all(b"x").unwrap();
    let client = GeminiClient::with_base_url("k".into(), server.url());
    let err = client
        .upload_file(tmp.path(), "audio/mpeg")
        .await
        .unwrap_err();
    assert!(matches!(err, faden_app_lib::error::AppError::Invalid(_)));
}

#[tokio::test]
async fn delete_succeeds() {
    let mut server = Server::new_async().await;
    let _m = server
        .mock(
            "DELETE",
            mockito::Matcher::Regex(r"^/v1beta/files/abc".to_string()),
        )
        .with_status(200)
        .with_body("{}")
        .create_async()
        .await;
    let client = GeminiClient::with_base_url("k".into(), server.url());
    client.delete_file("files/abc").await.unwrap();
}

#[tokio::test]
async fn generate_content_returns_text() {
    let mut server = Server::new_async().await;
    let _m = server
        .mock(
            "POST",
            mockito::Matcher::Regex(r"^/v1beta/models/.+:generateContent".to_string()),
        )
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(
            json!({
                "candidates": [{
                    "content": {"parts": [
                        {"text": "{\"segments\":"},
                        {"text": "[]}"}
                    ]},
                    "finishReason": "STOP"
                }],
                "usageMetadata": {
                    "promptTokenCount": 100,
                    "candidatesTokenCount": 50,
                    "totalTokenCount": 150
                }
            })
            .to_string(),
        )
        .create_async()
        .await;

    let client = GeminiClient::with_base_url("k".into(), server.url());
    let file = UploadedFile {
        name: "files/x".into(),
        uri: "https://x".into(),
    };
    let resp = client
        .generate_content(
            "gemini-3-flash-preview",
            "prompt",
            &file,
            "system",
            json!({"type": "object"}),
            65536,
        )
        .await
        .unwrap();
    assert_eq!(resp.text, "{\"segments\":[]}");
    assert_eq!(resp.finish_reason.as_deref(), Some("STOP"));
    assert_eq!(resp.usage.as_ref().unwrap().total_tokens, 150);
}

#[tokio::test]
async fn post_generate_concatenates_multiple_text_parts() {
    let mut server = Server::new_async().await;
    let _m = server
        .mock(
            "POST",
            mockito::Matcher::Regex(r"^/v1beta/models/.+:generateContent".to_string()),
        )
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(
            json!({
                "candidates": [{
                    "content": {"parts": [
                        {"text": "{\"proposals\":"},
                        {"text": "["},
                        {"text": "]}"}
                    ]}
                }]
            })
            .to_string(),
        )
        .create_async()
        .await;

    let client = GeminiClient::with_base_url("k".into(), server.url());
    let url = client.text_generate_url("gemini-3-flash-preview");
    let resp = client
        .post_generate(&url, &json!({"contents": []}))
        .await
        .unwrap();
    assert_eq!(resp, "{\"proposals\":[]}");
}

#[tokio::test]
async fn post_generate_ignores_null_text_parts() {
    let mut server = Server::new_async().await;
    let _m = server
        .mock(
            "POST",
            mockito::Matcher::Regex(r"^/v1beta/models/.+:generateContent".to_string()),
        )
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(
            json!({
                "candidates": [{
                    "content": {"parts": [
                        {"text": "{\"proposals\":"},
                        {"text": null},
                        {"text": "[]}"}
                    ]}
                }]
            })
            .to_string(),
        )
        .create_async()
        .await;

    let client = GeminiClient::with_base_url("k".into(), server.url());
    let url = client.text_generate_url("gemini-3-flash-preview");
    let resp = client
        .post_generate(&url, &json!({"contents": []}))
        .await
        .unwrap();
    assert_eq!(resp, "{\"proposals\":[]}");
}

#[tokio::test]
async fn generate_content_maps_5xx() {
    let mut server = Server::new_async().await;
    let _m = server
        .mock(
            "POST",
            mockito::Matcher::Regex(r"^/v1beta/models/.+:generateContent".to_string()),
        )
        .with_status(503)
        .with_body("unavailable")
        .create_async()
        .await;
    let client = GeminiClient::with_base_url("k".into(), server.url());
    let file = UploadedFile {
        name: "files/x".into(),
        uri: "https://x".into(),
    };
    let err = client
        .generate_content(
            "gemini-3-flash-preview",
            "prompt",
            &file,
            "system",
            json!({"type": "object"}),
            65536,
        )
        .await
        .unwrap_err();
    assert!(matches!(err, faden_app_lib::error::AppError::Invalid(_)));
}
