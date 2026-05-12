# 03 — Transcription Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Port the Python `gemini_main.py` transcription pipeline to Rust, bundle ffmpeg/ffprobe as Tauri sidecars, wire up audio import + on-demand transcription with progress events and resumability, and render the resulting transcript in the workspace center pane.

**Architecture:** A `transcription` module orchestrates async pipeline stages (normalize → chunk → upload → generate → parse → persist). ffmpeg/ffprobe invoked via Tauri shell sidecars. Gemini Files API + `generateContent` called via `reqwest`. State persisted incrementally to `cache/<interview>/chunk_results/*.json` and `segment` rows. Progress emitted as Tauri events. The frontend gets a transcription run id and subscribes to events.

**Tech Stack:** All of Plan 01/02 plus: `reqwest` (with `json`, `multipart`, `rustls-tls` features), `tokio` extended features, `bytes`, `futures`, `uuid`.

**Spec reference:** `docs/superpowers/specs/2026-05-12-stt-qda-design.md` §5.

**Prerequisites:** Plans 01 and 02 merged. The Python reference at `gemini_main.py` (in repo root) is the source of truth for the porting work.

---

## File structure

```
src-tauri/
├── binaries/                            # NEW — ffmpeg/ffprobe sidecars per target
│   ├── ffmpeg-x86_64-unknown-linux-gnu
│   ├── ffmpeg-aarch64-apple-darwin
│   ├── ffmpeg-x86_64-pc-windows-msvc.exe
│   └── (ditto for ffprobe)
├── Cargo.toml                           # MODIFIED — reqwest, futures, bytes
├── tauri.conf.json                      # MODIFIED — declare externalBin sidecars
├── capabilities/default.json            # MODIFIED — allow shell:execute for these sidecars
└── src/
    ├── transcription/
    │   ├── mod.rs                       # pipeline orchestration + public API
    │   ├── ffmpeg.rs                    # shell-out helpers (sidecar invocation)
    │   ├── chunker.rs                   # chunk planning + sub-chunk fallback math
    │   ├── gemini.rs                    # Files API + generateContent client
    │   ├── prompts.rs                   # default transcription prompts (copied from Python)
    │   ├── schema.rs                    # response parsing + timestamp rescaling
    │   ├── retry.rs                     # exponential backoff + classifier
    │   ├── progress.rs                  # event payloads
    │   └── cache.rs                     # chunk_results persistence
    ├── commands/
    │   ├── transcribe.rs                # NEW — start/cancel/status
    │   └── interview.rs                 # MODIFIED — add audio import
    ├── db/queries/
    │   └── ai_run.rs                    # NEW
    └── domain/
        └── transcription.rs             # progress + run DTOs

src-tauri/tests/
├── transcription_chunker.rs             # unit tests for chunk math
├── transcription_schema.rs              # response parsing tests
├── transcription_retry.rs               # retry classifier tests
├── transcription_gemini_cassette.rs     # integration test against recorded HTTP cassette
└── audio_import.rs                      # audio file import command tests

src/
├── ipc/
│   ├── transcribe.ts                    # NEW
│   └── interview.ts                     # MODIFIED — add audio import
├── state/
│   └── transcription.ts                 # NEW — active runs, progress per interview
└── views/Workspace/
    └── CenterPane/
        ├── CenterPane.tsx               # NEW — replaces the placeholder
        ├── CenterPane.module.css
        ├── TranscriptViewer.tsx         # NEW
        └── TranscriptViewer.module.css
```

---

## Task 1: Add Rust dependencies

**Files:** `src-tauri/Cargo.toml`

Add to `[dependencies]`:

```toml
reqwest = { version = "0.12", default-features = false, features = ["json", "multipart", "rustls-tls", "stream"] }
futures = "0.3"
bytes = "1"
uuid = { version = "1", features = ["v4", "serde"] }
async-trait = "0.1"
```

Add to `[dev-dependencies]`:

```toml
mockito = "1"
```

Run `cargo check`. Commit: `chore: add reqwest and async deps for transcription`.

---

## Task 2: ffmpeg/ffprobe sidecars

**Goal:** Bundle ffmpeg/ffprobe so end users don't install them. Tauri's `externalBin` mechanism does this.

- [ ] **Step 1:** Download static ffmpeg/ffprobe builds for each target platform:
  - Linux (x86_64): https://johnvansickle.com/ffmpeg/ (static builds)
  - macOS (arm64 + x86_64): https://evermeet.cx/ffmpeg/
  - Windows (x86_64): https://www.gyan.dev/ffmpeg/builds/
  
  Tauri requires sidecars named `<base>-<target-triple>[.exe]`. So `binaries/ffmpeg-x86_64-unknown-linux-gnu`, `binaries/ffprobe-aarch64-apple-darwin`, etc.

  **For now** (initial implementation), only commit the host-platform binaries. CI/release builds will assemble cross-platform sidecars later. Document this in `binaries/README.md`.

- [ ] **Step 2:** Update `src-tauri/tauri.conf.json`:

```jsonc
{
  "bundle": {
    "externalBin": ["binaries/ffmpeg", "binaries/ffprobe"]
    // existing keys preserved
  }
}
```

- [ ] **Step 3:** Update `src-tauri/capabilities/default.json` to allow executing these sidecars:

```jsonc
{
  "permissions": [
    "core:default",
    "dialog:default",
    "store:default",
    "fs:default",
    {
      "identifier": "shell:allow-execute",
      "allow": [
        { "name": "binaries/ffmpeg", "sidecar": true, "args": true },
        { "name": "binaries/ffprobe", "sidecar": true, "args": true }
      ]
    }
  ]
}
```

Add the `tauri-plugin-shell` dependency to `Cargo.toml` (`tauri-plugin-shell = "2"`) and register it in `lib.rs::run()`. Also install `@tauri-apps/plugin-shell` in the frontend (`npm install @tauri-apps/plugin-shell`).

- [ ] **Step 4:** `binaries/README.md`:

```markdown
# Bundled binaries

This directory contains ffmpeg and ffprobe static binaries bundled as Tauri
sidecars (configured via `tauri.conf.json` → `bundle.externalBin`).

Tauri requires each sidecar to be named `<base>-<target-triple>[.exe]`. For
local development, you only need the binary for your host triple. For releases,
the CI pipeline assembles all supported triples before `tauri build`.

Host triple lookup: `rustc -vV | grep host`.

These binaries are not version-controlled (the Linux ffmpeg static build is
~80MB). They are downloaded by `scripts/fetch-binaries.sh` (see below).
```

Add `binaries/*` to `src-tauri/.gitignore` (one path level under `binaries/`, plus `!binaries/README.md` to keep the readme tracked).

Provide a fetcher script at `scripts/fetch-binaries.sh`:

```sh
#!/usr/bin/env bash
set -euo pipefail
HOST=$(rustc -vV | sed -n 's/host: //p')
mkdir -p src-tauri/binaries
# ... per-platform download + extract logic ...
echo "Fetched ffmpeg + ffprobe for $HOST"
```

Document in main README: "Before first build, run `scripts/fetch-binaries.sh` to populate `src-tauri/binaries/`."

Commit: `chore: configure ffmpeg/ffprobe sidecars and shell plugin`.

---

## Task 3: ffmpeg helper module (TDD)

**Files:**
- Create: `src-tauri/src/transcription/ffmpeg.rs`
- Create: `src-tauri/src/transcription/mod.rs`
- Create: `src-tauri/tests/transcription_chunker.rs` (later task, not now)

The Tauri shell plugin lets us invoke a sidecar like:

```rust
use tauri_plugin_shell::ShellExt;
let output = app.shell()
    .sidecar("binaries/ffprobe")?
    .args(["-v", "error", "-show_entries", "format=duration", ...])
    .output()
    .await?;
```

Module API:

```rust
pub struct AudioStats { pub duration_seconds: f64 }

pub async fn probe_duration(app: &tauri::AppHandle, path: &Path) -> AppResult<AudioStats>;

pub struct NormalizeParams {
    pub channels: u32,
    pub sample_rate: u32,
    pub bitrate: String, // "64k"
}

pub async fn normalize(
    app: &tauri::AppHandle,
    input: &Path,
    output: &Path,
    params: &NormalizeParams,
) -> AppResult<()>;

pub async fn extract_subchunk(
    app: &tauri::AppHandle,
    input: &Path,
    output: &Path,
    start_seconds: f64,
    duration_seconds: f64,
    params: &NormalizeParams,
) -> AppResult<()>;

pub async fn split_into_chunks(
    app: &tauri::AppHandle,
    input: &Path,
    chunk_dir: &Path,
    chunk_seconds: u32,
) -> AppResult<Vec<PathBuf>>;
```

Each function shells out to ffmpeg/ffprobe via the sidecar. Errors mapped to `AppError::Invalid(format!("ffmpeg failed: {stderr}"))`.

Tests: hard to unit-test shell invocation without real ffmpeg. Add an integration test gated behind a `--ignored` flag that requires a real `.mp3` fixture file in `src-tauri/tests/fixtures/sample.mp3` (small, ~5 seconds, committed). Run with `cargo test -- --ignored`.

Commit: `feat(transcription): add ffmpeg/ffprobe sidecar wrappers`.

---

## Task 4: Chunker (TDD)

**Files:**
- Create: `src-tauri/src/transcription/chunker.rs`
- Create: `src-tauri/tests/transcription_chunker.rs`

This is pure math, fully unit-testable. Ports the chunk-planning logic from `gemini_main.py`:

```rust
pub struct ChunkPlan {
    pub index: usize,
    pub offset_seconds: f64,
    pub duration_seconds: f64,
}

pub fn plan_chunks(total_duration: f64, chunk_seconds: u32) -> Vec<ChunkPlan>;

pub fn plan_subchunks(
    chunk_duration: f64,
    min_split_seconds: f64,
) -> AppResult<Vec<ChunkPlan>>;
```

Constants (mirror Python):
- `CHUNK_SECONDS = 420` (7 minutes)
- `MIN_SPLIT_CHUNK_SECONDS = 45`

Tests:
- `plan_chunks(840.0, 420)` → 2 chunks of 420s each.
- `plan_chunks(900.0, 420)` → 3 chunks: 420 / 420 / 60.
- `plan_chunks(10.0, 420)` → 1 chunk of 10s.
- `plan_subchunks(420.0, 45.0)` → 2 subchunks of 210s.
- `plan_subchunks(50.0, 45.0)` → returns AppError::Invalid("cannot split further").
- `plan_subchunks(100.0, 45.0)` → 2 subchunks (50/50).

Commit: `feat(transcription): chunker module with planning + subchunk fallback math`.

---

## Task 5: Schema parsing (TDD)

**Files:**
- Create: `src-tauri/src/transcription/schema.rs`
- Create: `src-tauri/tests/transcription_schema.rs`

Ports `parse_gemini_segments` and `maybe_rescale_timestamps` from Python:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedSegment {
    pub speaker: String,
    pub start: f64,
    pub end: f64,
    pub text: String,
}

pub fn parse_response(json_str: &str, chunk_duration: f64) -> AppResult<Vec<ParsedSegment>>;
```

Behavior (from Python source):
- Parse JSON, expect `{ segments: [...] }`.
- Each segment must have `speaker`, `start`, `end`, `text`. Otherwise `AppError::Invalid`.
- Canonicalize speaker labels (strip "Speaker"/"speaker" prefix, uppercase if single letter).
- Clamp `start`, `end` to `[0.0, chunk_duration]`.
- Reject if `end < start` (returns `AppError::Invalid`).
- Apply timestamp rescaling heuristic: if `max(end) <= 1.2` and `words_per_second > 12`, multiply all timestamps by 60 (clamping to chunk_duration).
- Sort by `(start, end)`.

Tests:
- Valid 2-segment response → returns sorted, canonicalized segments.
- Missing `speaker` field → `Invalid` error.
- `end < start` → `Invalid`.
- Rescaling heuristic triggered (high words-per-second on tiny timestamps).
- Rescaling NOT triggered (normal speech).
- Speaker "Speaker A:" → canonicalized to "A".

Commit: `feat(transcription): response schema parsing with timestamp rescaling`.

---

## Task 6: Retry classifier (TDD)

**Files:**
- Create: `src-tauri/src/transcription/retry.rs`
- Create: `src-tauri/tests/transcription_retry.rs`

```rust
pub fn should_retry(err: &TranscriptionError) -> bool;

pub fn delay_for_attempt(attempt: u32) -> Duration; // exponential backoff + jitter

pub const MAX_RETRY_ATTEMPTS: u32 = 6;
pub const INITIAL_RETRY_DELAY: Duration = Duration::from_secs(3);
pub const MAX_RETRY_DELAY: Duration = Duration::from_secs(60);

pub enum TranscriptionError {
    Network(reqwest::Error),
    Server { status: u16 }, // 5xx
    RateLimit, // 429
    InvalidJson(String),
    MaxTokens,
    Permanent(String),
}
```

`should_retry`:
- `Network` (transport-level): true
- `Server { status: 500|502|503|504 }`: true
- `RateLimit`: true
- `InvalidJson`: true (LLM might recover)
- `MaxTokens`: false (needs sub-chunking, handled separately by caller)
- `Permanent`: false

`delay_for_attempt(attempt)`: `INITIAL_RETRY_DELAY * 2^(attempt-1)` capped at `MAX_RETRY_DELAY`, plus 0–1s jitter.

8 tests covering each branch + delay growth.

Commit: `feat(transcription): retry classifier and backoff`.

---

## Task 7: Gemini client (TDD with mocked HTTP)

**Files:**
- Create: `src-tauri/src/transcription/gemini.rs`
- Create: `src-tauri/tests/transcription_gemini_cassette.rs`

```rust
pub struct GeminiClient {
    http: reqwest::Client,
    api_key: String,
    base_url: String,
}

impl GeminiClient {
    pub fn new(api_key: String) -> Self;
    pub fn with_base_url(api_key: String, base_url: String) -> Self; // for testing with mockito

    pub async fn upload_file(&self, path: &Path, mime_type: &str) -> AppResult<UploadedFile>;
    pub async fn delete_file(&self, name: &str) -> AppResult<()>;
    pub async fn generate_content(
        &self,
        model: &str,
        prompt: &str,
        file: &UploadedFile,
        system_instruction: &str,
        response_schema: serde_json::Value,
    ) -> AppResult<GenerateResponse>;
}

pub struct UploadedFile { pub name: String, pub uri: String }
pub struct GenerateResponse {
    pub text: String,
    pub usage: Option<TokenUsage>,
    pub finish_reason: Option<String>,
}
```

REST endpoints (Gemini v1beta):
- Files: `POST https://generativelanguage.googleapis.com/upload/v1beta/files?key=API_KEY`
- Files Delete: `DELETE https://generativelanguage.googleapis.com/v1beta/files/<name>?key=API_KEY`
- GenerateContent: `POST https://generativelanguage.googleapis.com/v1beta/models/<model>:generateContent?key=API_KEY`

Tests use `mockito` to spin up a local HTTP server, point the client at it, and verify request shape + response handling. Record real responses once and check them in as JSON fixtures under `src-tauri/tests/fixtures/gemini/`.

Commit: `feat(transcription): gemini client with files API and generateContent`.

---

## Task 8: Prompts module

**Files:**
- Create: `src-tauri/src/transcription/prompts.rs`

```rust
pub const SYSTEM_INSTRUCTION: &str = r#"You are a transcription engine.
[...verbatim from gemini_main.py...]"#;

pub const PROMPT_TEMPLATE: &str = r#"Transcribe this audio chunk into structured segments.
[...verbatim from gemini_main.py...]"#;

pub const SPEAKER_CONTEXT_SEGMENTS: usize = 6;

pub fn build_prompt(previous_segments: &[ParsedSegment]) -> String;

pub const RESPONSE_SCHEMA: &str = r#"{"type":"object",...}"#;
```

`build_prompt` mirrors the Python `build_transcription_prompt` — appends the last N segments as context if non-empty, formatted as `[start - end] Speaker X: text` lines.

3 tests:
- Empty prior segments → returns base prompt unchanged.
- 10 prior segments → context block contains last 6.
- Format check: each context line has timestamp + speaker + text.

Commit: `feat(transcription): prompt templates + schema`.

---

## Task 9: Cache persistence

**Files:**
- Create: `src-tauri/src/transcription/cache.rs`

Reuses the Python pattern: each chunk's parsed segments saved to `cache/<interview>/chunk_results/chunk_NNN.json`. On startup, reload existing chunks to determine resume point.

```rust
pub struct ChunkCache { dir: PathBuf }

impl ChunkCache {
    pub fn new(dir: PathBuf) -> Self;
    pub fn ensure_dirs(&self) -> AppResult<()>;
    pub fn save(&self, index: usize, segments: &[ParsedSegment]) -> AppResult<()>;
    pub fn load(&self, index: usize) -> AppResult<Vec<ParsedSegment>>;
    pub fn exists(&self, index: usize) -> bool;
    pub fn load_all(&self) -> AppResult<Vec<ParsedSegment>>; // sorted by chunk index
}
```

4 tests covering save + reload + exists + load_all merging.

Commit: `feat(transcription): chunk-result cache`.

---

## Task 10: `ai_run` queries

**Files:**
- Create: `src-tauri/src/db/queries/ai_run.rs`
- Modify: `src-tauri/src/db/queries/mod.rs`

```rust
pub enum AiRunKind { Transcribe, Pretag, CodebookGen, FindMore } // mapped to/from strings
pub enum AiRunStatus { Running, Complete, Failed, Cancelled }

pub struct AiRun {
    pub id: i64,
    pub kind: AiRunKind,
    pub interview_id: Option<i64>,
    pub model: String,
    pub prompt: String,
    pub started_at: String,
    pub completed_at: Option<String>,
    pub status: AiRunStatus,
    pub error: Option<String>,
    pub token_usage_json: Option<String>,
    pub result_summary: Option<String>,
}

pub fn start(conn: &Connection, kind: AiRunKind, interview_id: Option<i64>, model: &str, prompt: &str) -> AppResult<i64>;
pub fn complete(conn: &Connection, id: i64, token_usage_json: Option<&str>, result_summary: Option<&str>) -> AppResult<()>;
pub fn fail(conn: &Connection, id: i64, error: &str) -> AppResult<()>;
pub fn cancel(conn: &Connection, id: i64) -> AppResult<()>;
pub fn list_for_interview(conn: &Connection, interview_id: i64) -> AppResult<Vec<AiRun>>;
pub fn get(conn: &Connection, id: i64) -> AppResult<AiRun>;
```

5 tests.

Commit: `feat(db): ai_run query module`.

---

## Task 11: Audio import in `interview_create_with_audio`

**Files:**
- Modify: `src-tauri/src/commands/interview.rs`
- Modify: `src-tauri/src/db/queries/interview.rs` (if needed)
- Create: `src-tauri/tests/audio_import.rs`

New command:

```rust
#[tauri::command]
pub async fn interview_create_with_audio(
    app: tauri::AppHandle,
    name: String,
    source_audio_path: String,
) -> AppResult<Interview>;
```

Behavior:
1. Resolve current project dir from `AppState`.
2. Compute target path: `<project>/media/<sanitized-name>-<short-uuid>.<ext>`. Extension preserved from source.
3. Copy file (not move, not symlink — design choice from spec §7.2).
4. `interview::create` with `audio_path = Some(<relative path>)`. Store as project-relative.
5. Return the `Interview`.

3 tests covering copy + row creation + relative path storage.

Commit: `feat(commands): add interview_create_with_audio`.

---

## Task 12: Pipeline orchestrator

**Files:**
- Create: `src-tauri/src/transcription/mod.rs` (the orchestration entry point)
- Create: `src-tauri/src/transcription/progress.rs`

```rust
// progress.rs
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "stage")]
pub enum TranscriptionProgress {
    #[serde(rename = "starting")]
    Starting { interview_id: i64, run_id: i64 },
    #[serde(rename = "normalizing")]
    Normalizing { interview_id: i64 },
    #[serde(rename = "chunking")]
    Chunking { interview_id: i64, total_chunks: usize },
    #[serde(rename = "transcribing_chunk")]
    TranscribingChunk { interview_id: i64, index: usize, total: usize, attempt: u32 },
    #[serde(rename = "chunk_complete")]
    ChunkComplete { interview_id: i64, index: usize, segments_added: usize },
    #[serde(rename = "complete")]
    Complete { interview_id: i64, total_segments: usize },
    #[serde(rename = "failed")]
    Failed { interview_id: i64, message: String },
    #[serde(rename = "cancelled")]
    Cancelled { interview_id: i64 },
}

// transcription/mod.rs
pub struct PipelineConfig {
    pub model: String,
    pub chunk_seconds: u32,
    pub normalize: ffmpeg::NormalizeParams,
    pub api_key: String,
}

pub async fn run_pipeline(
    app: tauri::AppHandle,
    interview_id: i64,
    cancel: CancellationToken, // tokio_util
    config: PipelineConfig,
) -> AppResult<()>;
```

The pipeline orchestrates all stages, emitting `transcription:progress` events via `app.emit("transcription:progress", payload)`.

Pipeline flow:
1. Load interview; verify `audio_path` is set.
2. Compute paths: `cache/<interview>/normalized.mp3`, `cache/<interview>/chunks/`, `cache/<interview>/chunk_results/`.
3. `ai_run::start` → run_id.
4. Update interview status to `InProgress`.
5. Normalize (skip if already exists).
6. Probe duration; plan chunks.
7. For each chunk:
   - If cached result exists, load and continue.
   - Otherwise: extract chunk file, upload to Gemini, generate with prompt+schema, parse response.
   - On `MaxTokens` error: recursively sub-chunk (using `plan_subchunks`).
   - On retryable error: backoff + retry up to `MAX_RETRY_ATTEMPTS`.
   - Save chunk result to cache.
   - Insert speakers (`speaker::create_or_get`) and segments (`segment::insert_batch`) into DB with offset applied to timestamps.
   - Check `cancel.is_cancelled()` between chunks → emit `Cancelled`, set interview status `Failed` (or a new `Cancelled` status — for now use `Failed` with an error message), `ai_run::cancel`, return early.
   - Emit `ChunkComplete`.
8. On all chunks done:
   - Update interview status to `Complete`.
   - `ai_run::complete`.
   - Emit `Complete`.
9. On any unrecoverable error:
   - Update interview status to `Failed`.
   - `ai_run::fail`.
   - Emit `Failed`.
   - Partial progress (cached chunks + saved segments) is preserved.

Add `tokio-util = { version = "0.7", features = ["rt"] }` for `CancellationToken`.

No tests for the pipeline directly in this task — it's orchestration. Coverage comes from Task 13's cassette test.

Commit: `feat(transcription): pipeline orchestrator with progress events`.

---

## Task 13: Integration cassette test

**Files:**
- Create: `src-tauri/tests/transcription_gemini_cassette.rs`
- Create: fixtures under `src-tauri/tests/fixtures/`

Use `mockito` to spin up a fake Gemini server. Pre-record:
- One `upload` response.
- One `generateContent` response with a valid 2-segment transcript JSON payload.
- One `delete` response.

Test scenario:
1. Create temp project + interview with a tiny `sample.mp3` fixture (5–10 seconds).
2. Configure `PipelineConfig` with mockito base URL and a fake API key.
3. Run pipeline.
4. Assert: interview status → `Complete`; 2 segments in DB; cache files exist.

Add an mp3 fixture (~50KB) at `src-tauri/tests/fixtures/sample.mp3`. Commit it (binary, small).

Commit: `test(transcription): integration test with mocked gemini`.

---

## Task 14: Tauri commands — transcribe lifecycle

**Files:**
- Create: `src-tauri/src/commands/transcribe.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`

Commands:

```rust
#[tauri::command]
pub async fn transcribe_start(app: tauri::AppHandle, interview_id: i64) -> AppResult<i64>; // run_id

#[tauri::command]
pub async fn transcribe_cancel(app: tauri::AppHandle, run_id: i64) -> AppResult<()>;

#[tauri::command]
pub async fn transcribe_status(app: tauri::AppHandle, interview_id: i64) -> AppResult<TranscriptStatus>;
```

State: maintain a `HashMap<i64, CancellationToken>` keyed by run_id in `AppState`. `transcribe_start` spawns the pipeline future via `tokio::spawn`, registers the token. `transcribe_cancel` looks up the token and cancels.

Note on tokio: Tauri 2 already runs a tokio runtime; `tauri::async_runtime::spawn` is the right primitive.

Commit: `feat(commands): transcribe_start/cancel/status`.

---

## Task 15: Frontend — IPC + atoms + listener

**Files:**
- Create: `src/ipc/transcribe.ts`
- Create: `src/state/transcription.ts`

`transcribe.ts`:

```ts
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type TranscriptionProgress =
  | { stage: "starting"; interview_id: number; run_id: number }
  | { stage: "normalizing"; interview_id: number }
  | { stage: "chunking"; interview_id: number; total_chunks: number }
  | { stage: "transcribing_chunk"; interview_id: number; index: number; total: number; attempt: number }
  | { stage: "chunk_complete"; interview_id: number; index: number; segments_added: number }
  | { stage: "complete"; interview_id: number; total_segments: number }
  | { stage: "failed"; interview_id: number; message: string }
  | { stage: "cancelled"; interview_id: number };

export const transcribeStart = (interviewId: number) =>
  invoke<number>("transcribe_start", { interviewId });

export const transcribeCancel = (runId: number) =>
  invoke<void>("transcribe_cancel", { runId });

export const onTranscriptionProgress = (
  fn: (p: TranscriptionProgress) => void,
): Promise<UnlistenFn> => listen<TranscriptionProgress>("transcription:progress", (e) => fn(e.payload));
```

`state/transcription.ts`:

```ts
import { atom } from "jotai";
import type { TranscriptionProgress } from "../ipc/transcribe";

// keyed by interview_id
export const activeRunsAtom = atom<Record<number, { runId: number; progress: TranscriptionProgress }>>({});
```

Initialize the listener in `Workspace.tsx`'s `useEffect`:

```tsx
useEffect(() => {
  let unlisten: UnlistenFn | undefined;
  void onTranscriptionProgress((p) => {
    // update activeRunsAtom for p.interview_id
  }).then((u) => { unlisten = u; });
  return () => { if (unlisten) unlisten(); };
}, []);
```

Commit: `feat(transcribe): frontend ipc + progress listener`.

---

## Task 16: Frontend — interview list with audio import

**Files:**
- Modify: `src/views/Workspace/LeftPane/InterviewList.tsx`

Add buttons:
- "+ New interview" (existing — opens a name prompt, calls `interviewCreate`).
- "+ New from audio" — opens a file dialog (`open({ multiple: false, filters: [{ name: "Audio", extensions: ["mp3","m4a","wav","ogg","flac","aac"] }] })`), then asks for a name, then calls `interviewCreateWithAudio`.

For each interview row:
- Show name and current `transcriptStatus`.
- If `audio_path` is set and status is `none` or `failed`: show "Transcribe" button → calls `transcribeStart`.
- If status is `in_progress`: show progress bar derived from `activeRunsAtom` + "Cancel" button → `transcribeCancel`.
- If status is `complete`: show ✓ checkmark.

Add i18n keys for all new strings.

Commit: `feat(workspace): wire audio import and transcribe button`.

---

## Task 17: TranscriptViewer in center pane

**Files:**
- Create: `src/views/Workspace/CenterPane/CenterPane.tsx`
- Create: `src/views/Workspace/CenterPane/CenterPane.module.css`
- Create: `src/views/Workspace/CenterPane/TranscriptViewer.tsx`
- Create: `src/views/Workspace/CenterPane/TranscriptViewer.module.css`
- Modify: `src/views/Workspace/Workspace.tsx`
- Create: `src/ipc/segment.ts`
- Create new backend command: `segment_list_for_interview(interview_id) -> Vec<Segment>` (add to existing `interview.rs` commands file). Plus Tauri command + IPC wrapper.

`TranscriptViewer` renders the list of segments:

```tsx
export const TranscriptViewer = ({ interviewId }: { interviewId: number }) => {
  const [segments, setSegments] = useState<Segment[]>([]);
  useEffect(() => {
    void segmentListForInterview(interviewId).then(setSegments);
  }, [interviewId]);

  return (
    <div className={styles.transcript}>
      {segments.map((s) => (
        <div key={s.id} className={styles.segment} data-segment-id={s.id}>
          <span className={styles.timestamp}>{formatTimestamp(s.startSec)}</span>
          <span className={styles.speaker}>{s.speakerLabel}:</span>
          <span className={styles.text}>{s.text}</span>
        </div>
      ))}
    </div>
  );
};
```

`CenterPane.tsx` reads `selectedInterviewIdAtom`; if set, renders `<TranscriptViewer interviewId={id} />`; otherwise renders the empty-state message.

Replace the placeholder `<section className={styles.center}>` in `Workspace.tsx` with `<CenterPane />`.

i18n keys for new strings.

Commit: `feat(workspace): transcript viewer in center pane`.

---

## Task 18: Smoke verification

- [ ] **Step 1: Manual flow**
  1. `npm run tauri dev`.
  2. Open / create a project.
  3. "+ New from audio" → pick the existing `audio.m4a` file at repo root (or any small audio file).
  4. Click Transcribe. Watch progress events update the row.
  5. When complete, click the interview → transcript appears in center pane.
  6. Restart app, reopen project → transcript persists.

- [ ] **Step 2: Tests**
  - `cargo test --manifest-path src-tauri/Cargo.toml` should pass (~55+ tests).
  - `npm run build` passes.

---

## Self-review

### Spec coverage

| Spec section | Task |
|---|---|
| Bundled ffmpeg/ffprobe | 2 |
| Port `gemini_main.py` | 3, 4, 5, 6, 7, 8, 9, 12 |
| ai_run audit | 10 |
| Audio import (copy into media/) | 11 |
| Resumability via cache | 9, 12 |
| Progress events | 12, 15 |
| MAX_TOKENS sub-chunk fallback | 4, 12 |
| Transcribe UI button + status | 16 |
| Transcript viewer (minimal) | 17 |

### Risks

- ffmpeg/ffprobe distribution per platform is non-trivial. Task 2 deliberately scopes to host-platform-only for initial dev; cross-platform binary assembly is deferred to Plan 08.
- Gemini API contract may drift (response shape, files API endpoints). The `mockito` cassette is the canonical contract; refresh against live API periodically.
- Sub-chunking under MAX_TOKENS is recursive — make sure pipeline doesn't infinite-loop on unrecoverable MAX_TOKENS at minimum chunk size.

### Type consistency

- `TranscriptStatus` (Rust enum, snake_case strings in JSON) ↔ TS string literal type. Add explicit mapping in `src/ipc/interview.ts`.
- `TranscriptionProgress` tagged enum (`stage` discriminator) ↔ TS discriminated union (matches by `stage`).
- `AiRunKind` and `AiRunStatus` similarly mapped.
