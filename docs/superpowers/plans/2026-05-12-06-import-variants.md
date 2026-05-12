# 06 — Import Variants Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Three non-audio import paths for transcripts: paste plain text, upload `.txt`, upload `.json` (our own schema). Plus combined "audio + transcript" import. Speaker auto-detection for plain text. Audio + transcript timestamp alignment check.

**Architecture:** A parser module per source format. Each parser produces a normalized intermediate (`ParsedTranscript`) consumed by a single ingest function. Frontend gets a multi-tab "Add interview" dialog.

**Tech Stack:** Plans 01–05.

**Spec reference:** §7.2b, §7.2c.

**Prerequisites:** Plans 01–04 merged (Plan 05 optional but recommended).

---

## File structure

```
src-tauri/src/
├── import/                              # NEW
│   ├── mod.rs                           # public API: ingest()
│   ├── plain_text.rs                    # parser for pasted/.txt content
│   ├── json_schema.rs                   # parser for our JSON format
│   └── alignment.rs                     # audio + transcript timestamp validation
├── commands/
│   └── interview.rs                     # MODIFIED — new commands

src/views/Workspace/LeftPane/
└── AddInterviewModal.tsx                # NEW (replaces inline prompts)
```

---

## Task 1: Plain-text parser

**File:** `src-tauri/src/import/plain_text.rs`

Recognize lines like `Speaker A: text`, `Interviewer: text`, `A: text`, or no speaker at all. Conventions:
- A line matching `^(\S[^:]{0,30}):\s+(.*)$` is treated as `speaker: text`.
- A line without that pattern is a continuation of the previous speaker's text.
- Blank lines separate utterances.

```rust
pub struct ParsedTranscript {
    pub speakers: Vec<ParsedSpeaker>,
    pub segments: Vec<ParsedSegment>,
}

pub struct ParsedSpeaker {
    pub label_raw: String,
    pub display_name: Option<String>,
}

pub struct ParsedSegment {
    pub speaker_label: String,
    pub start_sec: f64,
    pub end_sec: f64,
    pub text: String,
}

pub fn parse(raw: &str) -> AppResult<ParsedTranscript>;
```

Without timestamps in plain text, generate synthetic timestamps: segment N starts at N * 5.0 seconds, length proportional to text length (e.g. 0.5s per word, minimum 2s). This is purely so the data model is consistent; the UI should not display these timestamps for plain-text imports.

Add a `synthetic_timestamps: bool` flag on the segment or interview level so the UI knows to suppress display.

Tests (5):
- Single speaker.
- Two-speaker conversation.
- Multi-line continuation.
- No speaker labels → single auto-speaker.
- Empty input → empty ParsedTranscript.

Commit: `feat(import): plain-text parser with speaker heuristic`.

---

## Task 2: JSON-schema parser

**File:** `src-tauri/src/import/json_schema.rs`

Accept our own export shape (matches the JSON output of the transcription pipeline):

```json
{
  "segments": [
    { "speaker": "A", "start": 0.0, "end": 12.0, "text": "..." },
    ...
  ]
}
```

```rust
pub fn parse_json(raw: &str) -> AppResult<ParsedTranscript>;
```

Validate: each segment has speaker, start, end, text; end >= start; start >= 0.

Tests (3): valid round-trip, missing field, invalid JSON.

Commit: `feat(import): JSON-schema parser`.

---

## Task 3: Audio + transcript alignment

**File:** `src-tauri/src/import/alignment.rs`

When importing both audio and a timestamped transcript:

```rust
pub fn validate_alignment(
    parsed: &ParsedTranscript,
    audio_duration: f64,
) -> AlignmentResult;

pub enum AlignmentResult {
    Ok,
    Approximate { last_segment_end: f64, audio_duration: f64 },
    OutOfRange { offending_segment_index: usize },
}
```

Rules:
- `OutOfRange` if any segment's `end > audio_duration + 5.0` (off by more than 5s past the end).
- `Approximate` if the last segment ends more than 30s before audio_duration or after audio_duration but within 5s.
- `Ok` otherwise.

The frontend uses the result to show a warning badge ("Approximate timestamps") without blocking import.

Tests (4).

Commit: `feat(import): alignment validation`.

---

## Task 4: `ingest` orchestrator

**File:** `src-tauri/src/import/mod.rs`

```rust
pub struct IngestInput {
    pub name: String,
    pub source_audio_path: Option<PathBuf>, // copied into media/
    pub parsed_transcript: Option<ParsedTranscript>,
}

pub async fn ingest(app: &tauri::AppHandle, input: IngestInput) -> AppResult<Interview>;
```

Behavior:
- Validate input: at least one of `source_audio_path` / `parsed_transcript` must be set.
- If both: probe audio duration, run `validate_alignment`, store alignment result on the interview's notes field (or a new column — keep it simple: prefix notes with `[approximate timestamps]` marker if Approximate).
- Copy audio into project's `media/` directory if provided.
- Create `interview` row.
- For each unique `speaker_label` in `parsed_transcript.speakers`, call `speaker::create_or_get`.
- Insert all segments via `segment::insert_batch`.
- Set `transcript_status` to `'complete'` if transcript was provided, else `'none'`.

6 tests covering each input combination + alignment scenarios.

Commit: `feat(import): unified ingest orchestrator`.

---

## Task 5: Tauri commands

**File:** `src-tauri/src/commands/interview.rs` (modify)

```rust
#[tauri::command]
pub async fn interview_import_text(
    app: tauri::AppHandle,
    name: String,
    raw_text: String,
) -> AppResult<Interview>;

#[tauri::command]
pub async fn interview_import_json(
    app: tauri::AppHandle,
    name: String,
    raw_json: String,
) -> AppResult<Interview>;

#[tauri::command]
pub async fn interview_import_audio_text(
    app: tauri::AppHandle,
    name: String,
    audio_path: String,
    raw_text: String,
) -> AppResult<Interview>;

#[tauri::command]
pub async fn interview_import_audio_json(
    app: tauri::AppHandle,
    name: String,
    audio_path: String,
    raw_json: String,
) -> AppResult<Interview>;
```

Each:
1. Parse the transcript with the right parser.
2. Call `ingest`.

3 tests covering text-only, json-only, and audio+text paths (audio+json by extension).

Commit: `feat(commands): import-text / import-json variants`.

---

## Task 6: Frontend — AddInterviewModal

**File:** `src/views/Workspace/LeftPane/AddInterviewModal.tsx`

Replaces the bare "+" button's prompt. A modal with 4 tabs:

1. **Audio only** — file picker → name → `interviewCreateWithAudio`.
2. **Transcript text** — name → multiline paste area → `interviewImportText`. Optional file-picker for `.txt`.
3. **Transcript JSON** — name → multiline area → `interviewImportJson`. Optional file picker for `.json`.
4. **Audio + transcript** — file picker for audio + name + transcript source selector (text or json) → respective command.

After successful import, close modal and refresh interview list.

Each tab handles its own validation (e.g. for JSON, parse client-side to give a quick error before invoking).

i18n keys: `import.title`, `import.tabs.audioOnly`, etc.

Commit: `feat(workspace): unified add-interview modal with 4 tabs`.

---

## Task 7: Speaker rename panel

**File:** `src/views/Workspace/CenterPane/SpeakerList.tsx`

A small panel at top of TranscriptViewer (or in a dropdown) that lets the user rename speakers per interview. Shows each speaker's label_raw + their display_name with an inline edit field.

Backend command: `speaker_set_display_name(speaker_id, display_name?)` — already exists in Plan 02 (Task 7). Add to commands surface if not already.

i18n: `speakers.title`, `speakers.rename`.

Commit: `feat(workspace): speaker rename panel`.

---

## Task 8: Smoke verification

Manual:
1. Add interview from pasted text with `Speaker A: ...` / `Speaker B: ...` lines. Confirm speakers detected and renamable.
2. Export an existing audio-transcribed interview to JSON (export comes in Plan 07; for this plan use `sqlite3 project.sqlite 'SELECT * FROM segment'` and craft a JSON by hand, or pull the original `transcript_gemini.json` from the runs directory).
3. Import the JSON as a new interview.
4. Import audio + transcript combo with timestamps slightly off — see "Approximate timestamps" badge.

Non-interactive:
- `cargo test` ≥ 100 tests.
- `npm run build` clean.

---

## Self-review

### Spec coverage

| Spec section | Task |
|---|---|
| §7.2b transcript-only import (paste / .txt / .json) | 1, 2, 4, 5, 6 |
| §7.2c audio + transcript combo | 3, 4, 5, 6 |
| Speaker rename | 7 |
| Approximate-timestamps flag | 3, 4 (notes prefix) |

### Notes

- The synthetic-timestamp approach for plain-text imports is intentionally crude. It satisfies the NOT NULL constraint on `segment.start_sec` / `end_sec` without claiming false precision. The UI suppresses display via the `synthetic_timestamps` flag or by checking notes prefix.
- The "Approximate timestamps" marker via notes prefix is a v1 shortcut. A clean version would add a column to `interview` like `timestamps_quality TEXT CHECK (...)`. Defer to Plan 08 polish if it becomes annoying.
