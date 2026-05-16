# Faden Desktop Application — Design

**Status:** Draft for review
**Date:** 2026-05-12
**Authors:** Pavel Žák (with Claude)

## 1. Purpose and scope

A desktop application for end-to-end qualitative interview research:

1. Ingest interview audio or existing transcripts.
2. Produce structured transcripts via Gemini.
3. Tag transcripts with a project-scoped codebook (manual coding, optionally assisted by AI).
4. Export tagged data and analyze code distributions.

**Primary user:** an experienced qualitative researcher (PhD-level), currently with one thesis project, scaling to multiple larger projects over time. Has used NVivo/Atlas.ti/MAXQDA and found them expensive or low-quality.

**Out of scope for v1:** multi-user collaboration, cloud sync, web/mobile, plugin systems, live transcription, word-level audio sync, inter-rater reliability features, auto-translation.

## 2. Solution overview

A single-binary Tauri 2 application.

- **Backend:** Rust. Owns all I/O, network, computation, storage. Ports the existing `gemini_main.py` transcription pipeline.
- **Frontend:** React + TypeScript + Vite. Thin presentation layer. State via Jotai (atoms defined outside components). Routing via TanStack Router. Plain CSS / CSS Modules — no CSS-in-JS, no Tailwind. No client-side fetching libraries (no TanStack Query) — backend is the source of all data.
- **Storage:** per-project SQLite file + per-project `media/` folder for audio (copied in, not referenced — projects are self-contained).
- **AI:** Gemini via REST `reqwest`; same Files API + `generateContent` pattern as the existing Python script.
- **Bundled binaries:** `ffmpeg`, `ffprobe` as Tauri sidecars. Zero setup for the end user.
- **i18n:** English and Czech UI. Language auto-selected from OS preference; manual override in settings.

## 3. UI architecture

Three surfaces:

- **Project Picker** (launch screen): open recent, open folder, new project.
- **Workspace** (main view): three-pane IDE-style layout.
- **Settings** (page): global + per-project settings.

The workspace is where the user spends ~90% of their time:

```
┌─────────────────────────────────────────────────────────────────────┐
│ Project: Fatherhood Study                  Settings | Export | Help │
├────────────────┬──────────────────────────────────┬─────────────────┤
│ Interviews     │ Transcript                       │ Selected span   │
│ ▸ Father #1 ✓  │ [00:12] B: No, abych byl...      │ "abych byl..."  │
│ ▶ Father #2    │ [00:47] A: Mhm. A vzpomenete...  │                 │
│ ▸ Father #3    │ [01:06] B: Ne, to jsem měl       │ Tags:           │
│                │     celkem jasno.                │ • work-family   │
│ Codebook       │                                  │   conflict      │
│ ▾ Identity     │                                  │                 │
│   • ideals (4) │                                  │ Memo:           │
│   • models (2) │                                  │ Strong example  │
│ ▸ Work         │                                  │ of generational │
│ ▸ Relationships│                                  │ contrast        │
├────────────────┴──────────────────────────────────┴─────────────────┤
│ ▶ ──────●─────────────────── 02:14 / 45:32   1.0×   [Loop span]    │
└─────────────────────────────────────────────────────────────────────┘
```

**Left pane:** interview list + codebook tree (cluster → category → tag with counts).
**Center pane:** transcript viewer (segments with speaker labels and timestamps) + audio player at the bottom.
**Right pane:** selected-span detail (the span text, tags applied, memo editor).

## 4. Domain and data model

A project is a directory on disk:

```
my-project/
├── project.sqlite          # source of truth: all metadata, transcripts, codebook, tags, memos
├── media/                  # copied-in audio files; project is self-contained
│   ├── interview-001.m4a
│   └── interview-002.mp3
└── cache/                  # regenerable: normalized audio + transcription chunks
    └── interview-001/
        ├── normalized.mp3
        ├── chunks/
        └── chunk_results/
```

**SQLite schema (canonical):**

```sql
-- One row; project-level metadata and settings overrides
CREATE TABLE project_meta (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    schema_version INTEGER NOT NULL,
    settings_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE interview (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    recorded_at TEXT,
    audio_path TEXT,                        -- relative to project root, NULL allowed
    notes TEXT,
    transcript_status TEXT NOT NULL         -- none|in_progress|complete|failed
        CHECK (transcript_status IN ('none','in_progress','complete','failed')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE speaker (
    id INTEGER PRIMARY KEY,
    interview_id INTEGER NOT NULL REFERENCES interview(id) ON DELETE CASCADE,
    label_raw TEXT NOT NULL,                -- e.g. "A" from Gemini
    display_name TEXT,                      -- e.g. "Interviewer"
    UNIQUE(interview_id, label_raw)
);

CREATE TABLE segment (
    id INTEGER PRIMARY KEY,
    interview_id INTEGER NOT NULL REFERENCES interview(id) ON DELETE CASCADE,
    speaker_id INTEGER NOT NULL REFERENCES speaker(id),
    start_sec REAL NOT NULL,
    end_sec REAL NOT NULL,
    text TEXT NOT NULL,
    order_index INTEGER NOT NULL
);
CREATE INDEX idx_segment_interview ON segment(interview_id, order_index);

-- Codebook (three-level hierarchy; uniqueness enforced project-wide per level)
CREATE TABLE cluster (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    color TEXT,
    order_index INTEGER NOT NULL
);

CREATE TABLE category (
    id INTEGER PRIMARY KEY,
    cluster_id INTEGER NOT NULL REFERENCES cluster(id) ON DELETE RESTRICT,
    name TEXT NOT NULL UNIQUE,              -- unique across whole project
    description TEXT,
    color TEXT,
    order_index INTEGER NOT NULL
);

CREATE TABLE tag (
    id INTEGER PRIMARY KEY,
    category_id INTEGER NOT NULL REFERENCES category(id) ON DELETE RESTRICT,
    name TEXT NOT NULL UNIQUE,              -- unique across whole project
    description TEXT,
    color TEXT,
    order_index INTEGER NOT NULL
);

CREATE TABLE tagged_span (
    id INTEGER PRIMARY KEY,
    interview_id INTEGER NOT NULL REFERENCES interview(id) ON DELETE CASCADE,
    segment_id INTEGER NOT NULL REFERENCES segment(id) ON DELETE CASCADE,
    start_offset INTEGER NOT NULL,          -- character offset within segment.text
    end_offset INTEGER NOT NULL,            -- exclusive
    text_snapshot TEXT NOT NULL,            -- copy of text at tagging time
    audio_start_sec REAL NOT NULL,          -- interpolated within segment
    audio_end_sec REAL NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX idx_span_interview ON tagged_span(interview_id);
CREATE INDEX idx_span_segment ON tagged_span(segment_id);

CREATE TABLE span_tag (
    span_id INTEGER NOT NULL REFERENCES tagged_span(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tag(id) ON DELETE RESTRICT,
    source TEXT NOT NULL                    -- manual|ai_suggested|ai_accepted
        CHECK (source IN ('manual','ai_suggested','ai_accepted')),
    PRIMARY KEY (span_id, tag_id)
);

CREATE TABLE memo (
    id INTEGER PRIMARY KEY,
    span_id INTEGER NOT NULL UNIQUE REFERENCES tagged_span(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- Audit trail for every AI invocation (transcription and tagging)
CREATE TABLE ai_run (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL                      -- transcribe|pretag|codebook_gen|find_more
        CHECK (kind IN ('transcribe','pretag','codebook_gen','find_more')),
    interview_id INTEGER REFERENCES interview(id) ON DELETE SET NULL,
    model TEXT NOT NULL,
    prompt TEXT NOT NULL,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    status TEXT NOT NULL                    -- running|complete|failed|cancelled
        CHECK (status IN ('running','complete','failed','cancelled')),
    error TEXT,
    token_usage_json TEXT,
    result_summary TEXT
);
```

**Key invariants:**

- Tag, category, and cluster names are each globally unique within a project. Duplication is structurally impossible (UNIQUE constraint), not just UI-prevented.
- A tag belongs to exactly one category; a category to exactly one cluster. No M:N relationships in the codebook. Rationale: clean semantic grouping; alternative groupings should be modeled as new entity types if ever needed.
- `text_snapshot` preserves the originally-tagged quote even if the underlying segment text is later edited.
- `audio_start_sec` / `audio_end_sec` on a tagged span are computed by linear interpolation across the parent segment. Acceptable approximation for jump-to-audio playback. Word-level timestamps are a future enhancement.
- A tagged span is anchored to a single segment. Spans cannot cross segment boundaries in v1.
- AI suggestions are full `tagged_span` rows with `span_tag.source='ai_suggested'`. Acceptance flips to `ai_accepted`. Rejection deletes the span.

## 5. Backend architecture (Rust)

```
src-tauri/src/
├── main.rs                 — Tauri setup, command registration, event channels
├── commands/               — Tauri IPC handlers (the API surface to the frontend)
│   ├── project.rs          — open/create/close project, list recents
│   ├── interview.rs        — CRUD interviews, attach audio, set speakers
│   ├── transcribe.rs       — start/cancel transcription, query status
│   ├── codebook.rs         — clusters/categories/tags CRUD with uniqueness checks
│   ├── tagging.rs          — create/delete tagged spans, attach tags, memos
│   ├── ai.rs               — pretag, codebook_gen, find_more
│   ├── export.rs           — CSV / Markdown / REFI-QDA / stats
│   └── settings.rs         — read/write global + per-project settings
├── db/
│   ├── mod.rs              — connection pool, migrations
│   ├── schema.sql          — canonical schema (above)
│   ├── migrations/         — versioned migrations
│   └── queries/            — typed query functions per entity
├── transcription/          — ported from gemini_main.py
│   ├── pipeline.rs         — orchestration (normalize → chunk → transcribe → assemble)
│   ├── ffmpeg.rs           — shell-out helpers for ffmpeg/ffprobe sidecars
│   ├── chunker.rs          — chunk planning, sub-chunk fallback math
│   ├── gemini.rs           — Files API upload, generateContent calls
│   ├── schema.rs           — segment validation, timestamp rescaling heuristic
│   └── retry.rs            — exponential backoff + retry classification
├── ai/
│   ├── pretag.rs           — whole-transcript tag suggestions
│   ├── codebook_gen.rs     — generate clusters/categories/tags from interview(s)
│   ├── find_more.rs        — find similar passages for an existing tag
│   ├── prompts.rs          — default prompts + variable substitution
│   └── client.rs           — shared GeminiClient (also used by transcription)
├── export/
│   ├── csv.rs, markdown.rs, refi_qda.rs, stats.rs, codebook.rs
├── domain/                 — pure types (no I/O)
│   └── project.rs, interview.rs, segment.rs, tag.rs, span.rs, ai_run.rs
└── events.rs               — typed progress events emitted to frontend
```

**Long-running operations** (transcription, AI runs) use Tauri events, not synchronous IPC:

- Frontend calls `transcribe_start(interview_id)` → returns immediately with `run_id`.
- Backend emits `transcription:progress` events: `{ run_id, chunk_index, chunk_count, segments_added }`.
- Frontend can call `transcribe_cancel(run_id)` to stop a run mid-flight.
- Pipeline state is persisted incrementally (per-chunk results in `cache/`), so a crashed or cancelled run resumes on retry. Matches the existing Python behavior.

## 6. Frontend architecture (React)

```
src/
├── main.tsx
├── App.tsx                          — root, mounts router
├── router.ts                        — TanStack Router config; routes:
│                                       /picker, /workspace/$projectId/$, /settings
├── ipc/                             — thin wrappers over @tauri-apps/api/core invoke()
│   └── project.ts, interview.ts, transcribe.ts, codebook.ts,
│       tagging.ts, ai.ts, export.ts, settings.ts
├── state/                           — Jotai atoms; defined outside components
│   ├── project.ts                   — current project, recents
│   ├── workspace.ts                 — selected interview, selected span
│   ├── codebook.ts                  — codebook tree, derived counts
│   ├── transcription.ts             — active runs, progress
│   ├── ai.ts                        — staged proposals, cost confirmations
│   └── settings.ts                  — merged global + per-project settings
├── views/
│   ├── ProjectPicker/
│   ├── Workspace/
│   │   ├── Workspace.tsx            — 3-pane layout shell
│   │   ├── LeftPane/                — InterviewList, CodebookTree
│   │   ├── CenterPane/              — TranscriptViewer, AudioPlayer
│   │   └── RightPane/               — SpanDetail (tags + memo)
│   └── Settings/
├── components/                      — shared primitives: Button, Modal, Tree, ...
├── i18n/
│   ├── en.json, cs.json             — translation strings
│   └── index.ts                     — i18next setup, OS-language detection
└── styles/                          — global CSS variables, reset, theme
```

**Frontend rules:**

- No business logic in React. No client-side computation of counts, frequencies, exports, etc. The backend returns ready-to-render DTOs.
- No client-side fetching libraries. `invoke()` returns data, atoms hold it, components render it.
- Atoms live in `src/state/*.ts` and are imported into components. Atoms can be read and updated outside React (for testing and for atom-to-atom derivation).
- Audio playback uses a plain `<audio>` element wrapped in a small React component. Backend exposes media via Tauri's asset protocol.

## 7. Core workflows

### 7.1 New project
1. User selects "New project" from Picker → folder dialog.
2. Backend creates `project.sqlite`, runs migrations, writes `project_meta` row, creates `media/` and `cache/`.
3. Workspace opens with empty interview list.

### 7.2 Add interview
Three variants:

- **Audio only:** copy audio file into `media/`, create `interview` row with `audio_path` set and `transcript_status='none'`. User clicks "Transcribe" later (7.3).
- **Transcript only (paste / .txt / .json):** parse into segments and speakers; create rows. Audio player disabled.
- **Audio + transcript:** combine the two. If transcript has timestamps that align with audio duration, use them; otherwise mark timestamps as approximate.

Plain-text transcripts are parsed with a simple `Speaker:` line heuristic; user can rename speakers afterward.

### 7.3 Transcribe
1. User clicks "Transcribe" on an interview (explicit action; never automatic).
2. Frontend invokes `transcribe_start(interview_id)`.
3. Backend creates `ai_run`, kicks off the pipeline asynchronously: normalize → chunk → for each chunk upload to Gemini Files, call `generateContent`, validate JSON, save chunk result, insert segments.
4. Backend emits progress events; frontend renders a progress strip.
5. Errors retry per the existing classifier (server errors, 429/500/503/504, transport errors). MAX_TOKENS triggers the sub-chunk fallback. Permanent failure surfaces with a "retry" button. Partial progress is preserved.
6. On completion: `transcript_status='complete'`, transcript renders.

### 7.4 Tag a span (manual)
1. User selects text within a single segment in the transcript pane.
2. Floating "tag" button or right-click opens a tag popover with codebook search.
3. User picks an existing tag, or creates a new tag inline (must specify category).
4. Frontend: `invoke("span_create", { interview_id, segment_id, start_offset, end_offset, tag_ids })`.
5. Backend validates offsets, interpolates audio range, inserts `tagged_span` + `span_tag` rows with `source='manual'`, returns the new span DTO.
6. Right pane displays the new span; memo editor is available.
7. Audio player supports "Loop span" to replay the tagged passage.

### 7.5 AI-assisted flows
All on-demand. All produce *staged proposals*; nothing commits until the user reviews and accepts.

- **Generate codebook from interview(s)** — pick 1+ interviews; AI proposes a tree of clusters/categories/tags with definitions and evidence quotes. User reviews tree, accepts/rejects per item, "Apply selected" commits accepted entities to the codebook (collisions prompt rename/skip).
- **Pre-tag whole transcript** — given an interview + current codebook, AI proposes tagged spans. Suggestions render in the transcript with a dashed underline and "AI" badge. User accepts/rejects per span; bulk actions available ("accept all in cluster X").
- **Find more like this** — given an existing tag (with 0+ examples), AI finds candidate spans in a chosen interview. Same staging mechanism as pre-tag, scoped to one tag.

Before every AI call, a confirmation modal shows: model, estimated input tokens, estimated cost, the full prompt (collapsible). "Don't ask again this session for this kind of call" checkbox is available.

Every call logs to `ai_run` with prompt, model, token usage, and result.

### 7.6 Export
"Export" menu in workspace. Picks one or more formats + scope (current interview / whole project / filter by tag):

- **CSV:** one row per tagged span (`interview, speaker, start, end, cluster, category, tag, quote, memo`).
- **Markdown / HTML:** annotated transcript with tags inline or as margin notes.
- **REFI-QDA:** XML per the [REFI-QDA project standard](https://www.qdasoftware.org/products-project-exchange/). Includes audio file references.
- **Stats report:** code frequency by interview/speaker, co-occurrence matrix; CSV or Markdown.
- **Codebook only:** JSON or CSV of clusters/categories/tags + descriptions.

## 8. AI prompts (defaults; per-project overridable)

Prompts are stored as templates with `{{variable}}` substitution. Defaults ship in `src-tauri/src/ai/prompts.rs` and are version-controlled. Per-project overrides go in `project_meta.settings_json`.

### 8.1 Codebook generation
> You are helping a qualitative researcher build a codebook. Read the following interview(s) and propose a three-level coding scheme: clusters (broad themes), categories (sub-themes within a cluster), and tags (specific codes within a category). Each tag should have a short definition. Return JSON matching the provided schema. Do not invent codes that aren't supported by the text. If an existing codebook is provided, prefer extending it over duplicating existing codes.

Variables: `{{transcripts}}`, `{{existing_codebook}}` (optional).

Response schema:
```json
{
  "proposals": [{
    "cluster": { "name": "string", "description": "string" },
    "categories": [{
      "name": "string", "description": "string",
      "tags": [{ "name": "string", "description": "string", "evidence_quotes": ["string"] }]
    }]
  }]
}
```

### 8.2 Pre-tag transcript
> Given this interview transcript and codebook, identify spans of text that should be tagged with codes from the codebook. Only propose tags that are supported by the literal text. For each span, return the segment id, character offsets within that segment, and the tag(s) you propose. Do not invent new tags. If no codes apply to a passage, do not propose anything for it.

Variables: `{{transcript}}`, `{{codebook}}`.

Response schema:
```json
{
  "suggestions": [{
    "segment_id": 0,
    "start_offset": 0,
    "end_offset": 0,
    "tag_names": ["string"],
    "rationale": "string"
  }]
}
```

### 8.3 Find more like this
> The researcher has tagged the following passages with the code "{{tag_name}}" (definition: "{{tag_description}}"). Find other passages in the transcript below that fit the same code. Be conservative — only propose spans that genuinely match. Return spans as segment_id + character offsets + a brief rationale.

Variables: `{{tag_name}}`, `{{tag_description}}`, `{{example_spans}}`, `{{transcript}}`.

Response schema: same as 8.2 (`suggestions[]`).

### 8.4 Transcription
The existing system instruction and user prompt from `gemini_main.py` are carried over verbatim as defaults, and become editable per-project.

## 9. Settings

**Global (OS user config dir, e.g. `~/.config/qda-app/settings.json`):**
- Gemini API key
- Default Gemini model for transcription
- Default Gemini model for AI tagging
- Recent projects list (paths)
- UI language override (default: OS preference)
- UI theme, font size
- Audio playback keyboard shortcuts

**Per-project (`project_meta.settings_json`):**
- Transcription system instruction (override)
- Transcription user prompt (override)
- AI tagging prompts (override): `codebook_gen`, `pretag`, `find_more`
- Audio normalization params (channels, sample rate, bitrate)
- Chunk size in seconds
- Speaker name mapping defaults (e.g. `A → Interviewer`, `B → Respondent`)

Per-project overrides take precedence over global. UI shows a "(using project override)" badge where applicable. Each per-project field has a "reset to default" button.

## 10. Internationalization

- UI strings live in `src/i18n/en.json` and `src/i18n/cs.json`. English is the source of truth.
- `i18next` with `react-i18next` and `i18next-browser-languagedetector` (uses `navigator.language` which Tauri's webview honors from OS settings).
- Manual override available in global settings.
- Transcript content language is independent of UI language (transcripts stay in the source language of the audio).
- Date/time and number formatting via `Intl` APIs in the resolved locale.

## 11. Testing strategy

- **Rust unit tests** on every pure module: chunker math, schema validation, timestamp rescaling, AI proposal parsers, export formatters. Property tests for offset math.
- **Rust integration tests** on transcription and AI pipelines using HTTP cassettes (record real Gemini responses once, replay in CI). One cassette per pipeline path.
- **Database tests** with an in-memory SQLite per test, migrations applied. Cover uniqueness constraints, cascade deletes, transaction boundaries.
- **Frontend tests** with Vitest: atom logic (pure) and component behavior with React Testing Library. Kept light — the React layer is thin.
- **End-to-end smoke test** with Playwright (or Tauri's WebDriver) against a built binary: launch, create project, import a sample audio file, run transcription (against cassette), tag a span, export CSV, assert file contents.
- **Manual acceptance** by the end user on a representative real interview before 1.0.

## 12. Distribution

Personal use first; potentially open-sourced later. The codebase should be license-clean and self-contained from day one (no proprietary assets, no embedded credentials, default prompts in version control). License decision deferred.

Build targets: Linux (primary user), macOS, Windows. Tauri's `tauri build` produces native installers for all three.

## 13. Open questions and explicit non-decisions

- **Word-level audio sync:** deferred. v1 uses interpolated segment timing. If accuracy becomes a problem, request word timestamps from Gemini.
- **Inter-rater reliability:** deferred. Relevant later in PhD work; not v1.
- **Multi-tag span overlap:** v1 allows overlapping spans (two tagged spans can cover the same text). UI must visualize overlap clearly. Stats treat them as independent.
- **Span edit vs delete:** v1 supports edit (resize boundaries, change tags, edit memo) and delete. Move-to-different-segment is delete + re-create.
- **Audio formats:** rely on ffmpeg to normalize anything ffmpeg can read. No explicit allow-list.
- **Backup:** no built-in backup. Project directory copy is the backup story (self-contained design supports this).

## 14. Out of scope (v1 non-goals)

- Multi-user / collaborative editing
- Cloud sync (works on Dropbox-synced folders but no built-in sync)
- Web or mobile versions
- Plugin system / scriptable extensions
- Live (real-time) transcription
- Speaker diarization beyond what Gemini provides
- Word-level audio sync
- Auto-translation
- Inter-rater reliability features
