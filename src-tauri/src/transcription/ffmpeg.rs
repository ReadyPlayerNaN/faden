use crate::error::{AppError, AppResult};
use std::path::{Path, PathBuf};
use tokio::process::Command;

#[derive(Debug, Clone)]
pub struct NormalizeParams {
    pub channels: u32,
    pub sample_rate: u32,
    pub bitrate: String,
}

impl Default for NormalizeParams {
    fn default() -> Self {
        Self {
            channels: 1,
            sample_rate: 16000,
            bitrate: "64k".into(),
        }
    }
}

async fn run_command(binary: &str, args: &[&str]) -> AppResult<std::process::Output> {
    Command::new(binary)
        .args(args)
        .output()
        .await
        .map_err(|e| AppError::Invalid(format!("{binary} exec: {e}")))
}

pub async fn probe_duration(_app: &tauri::AppHandle, path: &Path) -> AppResult<f64> {
    let output = run_command(
        "ffprobe",
        &[
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            path.to_str()
                .ok_or_else(|| AppError::Invalid("non-utf8 path".into()))?,
        ],
    )
    .await?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(AppError::Invalid(format!("ffprobe failed: {stderr}")));
    }
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    stdout
        .parse::<f64>()
        .map_err(|e| AppError::Invalid(format!("ffprobe parse: {e}")))
}

pub async fn normalize(
    _app: &tauri::AppHandle,
    input: &Path,
    output: &Path,
    params: &NormalizeParams,
) -> AppResult<()> {
    let out = run_command(
        "ffmpeg",
        &[
            "-y",
            "-i",
            input
                .to_str()
                .ok_or_else(|| AppError::Invalid("non-utf8 input".into()))?,
            "-ac",
            &params.channels.to_string(),
            "-ar",
            &params.sample_rate.to_string(),
            "-b:a",
            &params.bitrate,
            output
                .to_str()
                .ok_or_else(|| AppError::Invalid("non-utf8 output".into()))?,
        ],
    )
    .await?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr).to_string();
        return Err(AppError::Invalid(format!(
            "ffmpeg normalize failed: {stderr}"
        )));
    }
    Ok(())
}

pub async fn extract_subchunk(
    _app: &tauri::AppHandle,
    input: &Path,
    output: &Path,
    start_seconds: f64,
    duration_seconds: f64,
    params: &NormalizeParams,
) -> AppResult<()> {
    let out = run_command(
        "ffmpeg",
        &[
            "-y",
            "-ss",
            &format!("{start_seconds:.3}"),
            "-t",
            &format!("{duration_seconds:.3}"),
            "-i",
            input
                .to_str()
                .ok_or_else(|| AppError::Invalid("non-utf8 input".into()))?,
            "-ac",
            &params.channels.to_string(),
            "-ar",
            &params.sample_rate.to_string(),
            "-b:a",
            &params.bitrate,
            output
                .to_str()
                .ok_or_else(|| AppError::Invalid("non-utf8 output".into()))?,
        ],
    )
    .await?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr).to_string();
        return Err(AppError::Invalid(format!(
            "ffmpeg extract failed: {stderr}"
        )));
    }
    Ok(())
}

pub async fn split_into_chunks(
    _app: &tauri::AppHandle,
    input: &Path,
    chunk_dir: &Path,
    chunk_seconds: u32,
) -> AppResult<Vec<PathBuf>> {
    let pattern = chunk_dir.join("chunk_%03d.mp3");
    let out = run_command(
        "ffmpeg",
        &[
            "-y",
            "-i",
            input
                .to_str()
                .ok_or_else(|| AppError::Invalid("non-utf8 input".into()))?,
            "-f",
            "segment",
            "-segment_time",
            &chunk_seconds.to_string(),
            "-c",
            "copy",
            pattern
                .to_str()
                .ok_or_else(|| AppError::Invalid("non-utf8 pattern".into()))?,
        ],
    )
    .await?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr).to_string();
        return Err(AppError::Invalid(format!("ffmpeg split failed: {stderr}")));
    }
    let mut entries: Vec<_> = std::fs::read_dir(chunk_dir)?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.starts_with("chunk_") && n.ends_with(".mp3"))
                .unwrap_or(false)
        })
        .collect();
    entries.sort();
    Ok(entries)
}
