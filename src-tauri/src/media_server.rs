use crate::app_state::AppState;
use crate::db;
use crate::db::queries::interview;
use crate::error::{AppError, AppResult};
use axum::body::Body;
use axum::extract::{Path, Query, State};
use axum::http::{header, HeaderMap, HeaderValue, Response, StatusCode};
use axum::routing::get;
use axum::Router;
use serde::Deserialize;
use std::io::SeekFrom;
use std::path::PathBuf;
use tauri::Manager;
use tokio::fs::File;
use tokio::io::{AsyncReadExt, AsyncSeekExt};
use tokio_util::io::ReaderStream;

#[derive(Clone)]
struct ServerState {
    app: tauri::AppHandle,
    token: String,
}

#[derive(Deserialize)]
struct AudioQuery {
    token: String,
}

enum ByteRange {
    Full,
    Partial { start: u64, end: u64 },
    Invalid,
}

pub fn start(app: tauri::AppHandle) -> AppResult<()> {
    let token = uuid::Uuid::new_v4().to_string();
    let state = ServerState {
        app: app.clone(),
        token: token.clone(),
    };
    let (tx, rx) = std::sync::mpsc::sync_channel::<AppResult<String>>(1);

    std::thread::Builder::new()
        .name("media-server".into())
        .spawn(move || {
            let runtime = match tokio::runtime::Builder::new_multi_thread()
                .enable_all()
                .build()
            {
                Ok(runtime) => runtime,
                Err(err) => {
                    let _ = tx.send(Err(AppError::Io(std::io::Error::other(err.to_string()))));
                    return;
                }
            };

            runtime.block_on(async move {
                let listener = match tokio::net::TcpListener::bind(("127.0.0.1", 0)).await {
                    Ok(listener) => listener,
                    Err(err) => {
                        let _ = tx.send(Err(AppError::from(err)));
                        return;
                    }
                };

                let origin = match listener.local_addr() {
                    Ok(addr) => format!("http://127.0.0.1:{}", addr.port()),
                    Err(err) => {
                        let _ = tx.send(Err(AppError::from(err)));
                        return;
                    }
                };

                if tx.send(Ok(origin.clone())).is_err() {
                    return;
                }

                tracing::info!(%origin, "media server started");

                let router = Router::new()
                    .route("/health", get(|| async { "ok" }))
                    .route("/audio/{interview_id}", get(audio_stream))
                    .with_state(state);

                if let Err(err) = axum::serve(listener, router).await {
                    tracing::error!(?err, "media server exited");
                }
            });
        })
        .map_err(AppError::from)?;

    let origin = rx
        .recv()
        .map_err(|err| AppError::Invalid(format!("media server startup failed: {err}")))??;

    app.state::<AppState>().set_media_server(origin, token);
    Ok(())
}

pub fn url_for_interview(app: &tauri::AppHandle, interview_id: i64) -> AppResult<String> {
    let server = app.state::<AppState>().media_server()?;
    Ok(format!(
        "{}/audio/{}?token={}",
        server.origin, interview_id, server.token
    ))
}

async fn audio_stream(
    State(state): State<ServerState>,
    Path(interview_id): Path<i64>,
    Query(query): Query<AudioQuery>,
    headers: HeaderMap,
) -> Response<Body> {
    if query.token != state.token {
        return text_response(StatusCode::UNAUTHORIZED, "unauthorized");
    }

    match load_audio_response(&state.app, interview_id, &headers).await {
        Ok(resp) => resp,
        Err((status, message)) => text_response(status, &message),
    }
}

async fn load_audio_response(
    app: &tauri::AppHandle,
    interview_id: i64,
    headers: &HeaderMap,
) -> Result<Response<Body>, (StatusCode, String)> {
    let path = resolve_audio_path(app, interview_id).map_err(app_error_to_http)?;
    let metadata = tokio::fs::metadata(&path)
        .await
        .map_err(|e| app_error_to_http(AppError::from(e)))?;
    let file_size = metadata.len();
    if file_size == 0 {
        return Err((StatusCode::NO_CONTENT, "empty audio file".into()));
    }

    let range = match headers.get(header::RANGE).and_then(|v| v.to_str().ok()) {
        Some(raw) => parse_range_header(raw, file_size),
        None => ByteRange::Full,
    };

    if matches!(range, ByteRange::Invalid) {
        let mut resp = text_response(StatusCode::RANGE_NOT_SATISFIABLE, "invalid range");
        if let Ok(value) = HeaderValue::from_str(&format!("bytes */{file_size}")) {
            resp.headers_mut().insert(header::CONTENT_RANGE, value);
        }
        return Ok(resp);
    }

    let (start, end, status) = match range {
        ByteRange::Full => (0, file_size - 1, StatusCode::OK),
        ByteRange::Partial { start, end } => (start, end, StatusCode::PARTIAL_CONTENT),
        ByteRange::Invalid => unreachable!(),
    };

    let content_length = end - start + 1;
    let mime = content_type_for_path(&path);

    let mut file = File::open(&path)
        .await
        .map_err(|e| app_error_to_http(AppError::from(e)))?;
    file.seek(SeekFrom::Start(start))
        .await
        .map_err(|e| app_error_to_http(AppError::from(e)))?;
    let stream = ReaderStream::new(file.take(content_length));

    let mut response = Response::new(Body::from_stream(stream));
    *response.status_mut() = status;
    let headers = response.headers_mut();
    headers.insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
    headers.insert(header::CONTENT_TYPE, HeaderValue::from_static(mime));
    if let Ok(value) = HeaderValue::from_str(&content_length.to_string()) {
        headers.insert(header::CONTENT_LENGTH, value);
    }
    if status == StatusCode::PARTIAL_CONTENT {
        if let Ok(value) = HeaderValue::from_str(&format!("bytes {start}-{end}/{file_size}")) {
            headers.insert(header::CONTENT_RANGE, value);
        }
    }
    Ok(response)
}

fn resolve_audio_path(app: &tauri::AppHandle, interview_id: i64) -> AppResult<PathBuf> {
    let project_dir = app.state::<AppState>().current_project()?;
    let conn = db::open(&project_dir.join("project.sqlite"))?;
    let iv = interview::get(&conn, interview_id)?;
    let rel = iv
        .audio_path
        .ok_or_else(|| AppError::NotFound(format!("interview {interview_id} has no audio")))?;
    let path = project_dir.join(rel);
    if !path.exists() {
        return Err(AppError::NotFound(format!(
            "audio file: {}",
            path.display()
        )));
    }
    Ok(path)
}

fn content_type_for_path(path: &std::path::Path) -> &'static str {
    match path
        .extension()
        .and_then(|x| x.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "mp3" => "audio/mpeg",
        "m4a" | "mp4" => "audio/mp4",
        "aac" => "audio/aac",
        "wav" => "audio/wav",
        "ogg" | "oga" => "audio/ogg",
        "flac" => "audio/flac",
        _ => "application/octet-stream",
    }
}

fn parse_range_header(raw: &str, file_size: u64) -> ByteRange {
    let spec = match raw.strip_prefix("bytes=") {
        Some(spec) => spec,
        None => return ByteRange::Invalid,
    };
    if spec.contains(',') {
        return ByteRange::Invalid;
    }
    let (start_raw, end_raw) = match spec.split_once('-') {
        Some(parts) => parts,
        None => return ByteRange::Invalid,
    };

    if start_raw.is_empty() {
        let suffix: u64 = match end_raw.parse() {
            Ok(v) if v > 0 => v,
            _ => return ByteRange::Invalid,
        };
        let start = file_size.saturating_sub(suffix);
        return ByteRange::Partial {
            start,
            end: file_size - 1,
        };
    }

    let start: u64 = match start_raw.parse() {
        Ok(v) if v < file_size => v,
        _ => return ByteRange::Invalid,
    };

    let end: u64 = if end_raw.is_empty() {
        file_size - 1
    } else {
        match end_raw.parse() {
            Ok(v) if v >= start && v < file_size => v,
            _ => return ByteRange::Invalid,
        }
    };

    ByteRange::Partial { start, end }
}

fn text_response(status: StatusCode, message: &str) -> Response<Body> {
    let mut response = Response::new(Body::from(message.to_string()));
    *response.status_mut() = status;
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/plain; charset=utf-8"),
    );
    response
}

fn app_error_to_http(error: AppError) -> (StatusCode, String) {
    match error {
        AppError::NotFound(message) => (StatusCode::NOT_FOUND, message),
        AppError::Invalid(message) => (StatusCode::BAD_REQUEST, message),
        other => (StatusCode::INTERNAL_SERVER_ERROR, other.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::{parse_range_header, ByteRange};

    #[test]
    fn parses_explicit_range() {
        match parse_range_header("bytes=10-19", 100) {
            ByteRange::Partial { start, end } => {
                assert_eq!(start, 10);
                assert_eq!(end, 19);
            }
            _ => panic!("expected partial range"),
        }
    }

    #[test]
    fn parses_open_ended_range() {
        match parse_range_header("bytes=10-", 100) {
            ByteRange::Partial { start, end } => {
                assert_eq!(start, 10);
                assert_eq!(end, 99);
            }
            _ => panic!("expected partial range"),
        }
    }

    #[test]
    fn parses_suffix_range() {
        match parse_range_header("bytes=-25", 100) {
            ByteRange::Partial { start, end } => {
                assert_eq!(start, 75);
                assert_eq!(end, 99);
            }
            _ => panic!("expected partial range"),
        }
    }

    #[test]
    fn rejects_invalid_range() {
        assert!(matches!(
            parse_range_header("items=0-10", 100),
            ByteRange::Invalid
        ));
        assert!(matches!(
            parse_range_header("bytes=200-300", 100),
            ByteRange::Invalid
        ));
        assert!(matches!(
            parse_range_header("bytes=10-5", 100),
            ByteRange::Invalid
        ));
    }
}
