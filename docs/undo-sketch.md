# Undo sketch

## Goal
Add reliable undo for persisted project mutations in a backend-first way, with optional redo later.

## Why backend-first
The app persists changes through Tauri commands into SQLite. A frontend-only undo stack would drift from the database and miss side effects such as:

- `segment_update_text` also clamping/updating tagged spans
- `segment_split` moving spans and changing ordering
- `segment_merge` reassigning spans and deleting a segment
- tag/codebook mutations changing persistent ordering

Undo should therefore be recorded and applied in Rust, inside the same database transaction as the mutation.

## Scope proposal

### Phase 1
Support undo for the most common single-step edits:

- `segment_update_text`
- `segment_set_speaker`
- `span_create`
- `span_update_tags`
- `span_update_offsets`
- `span_delete`
- `memo_upsert`

### Phase 2
Support structural edits:

- `segment_split`
- `segment_merge`
- `segment_delete`
- cluster/category/tag create, rename, move, recolor, description edits, delete
- reorder operations

### Phase 3
Add redo and undo grouping for multi-step UI flows.

## Core design

### New database tables

```sql
CREATE TABLE undo_event (
    id INTEGER PRIMARY KEY,
    project_id TEXT NOT NULL DEFAULT 'default',
    kind TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    undone_at TEXT NULL
);

CREATE TABLE redo_event (
    id INTEGER PRIMARY KEY,
    project_id TEXT NOT NULL DEFAULT 'default',
    kind TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);
```

Notes:
- `project_id` can stay constant if each project has its own DB; keep it only if future-proofing helps.
- Simpler alternative: one `history_event` table with `direction/status`. Two tables are easier to reason about initially.
- Any new user mutation should clear `redo_event`.

## Event model
Each mutation writes an inverse operation as JSON.

```rust
#[derive(Serialize, Deserialize)]
#[serde(tag = "kind")]
enum UndoPayload {
    SegmentUpdateText {
        segment_id: i64,
        old_text: String,
        old_spans: Vec<SpanSnapshot>,
    },
    SegmentSetSpeaker {
        segment_id: i64,
        old_speaker_id: Option<i64>,
    },
    SpanCreate {
        span_id: i64,
    },
    SpanDelete {
        span: SpanSnapshot,
        tags: Vec<SpanTagSnapshot>,
        memo: Option<String>,
    },
    SpanUpdateTags {
        span_id: i64,
        old_tag_ids: Vec<i64>,
    },
    SpanUpdateOffsets {
        span_id: i64,
        old_start_offset: i32,
        old_end_offset: i32,
        old_text_snapshot: String,
        old_audio_start_sec: f64,
        old_audio_end_sec: f64,
    },
    MemoUpsert {
        span_id: i64,
        old_body: Option<String>,
    },
}
```

For phase 2, add payloads for split/merge/delete and codebook mutations.

## Snapshot structs

```rust
struct SegmentSnapshot {
    id: i64,
    interview_id: i64,
    speaker_id: Option<i64>,
    start_sec: f64,
    end_sec: f64,
    text: String,
    order_index: i64,
}

struct SpanSnapshot {
    id: i64,
    interview_id: i64,
    segment_id: i64,
    start_offset: i32,
    end_offset: i32,
    text_snapshot: String,
    audio_start_sec: f64,
    audio_end_sec: f64,
    created_at: String,
}

struct SpanTagSnapshot {
    span_id: i64,
    tag_id: i64,
    source: String,
}
```

These snapshots should be sufficient to restore rows exactly, not approximately.

## Command flow
For each mutating Tauri command:

1. Open transaction.
2. Read current state needed for inverse action.
3. Build `UndoPayload`.
4. Apply mutation.
5. Insert undo event.
6. Clear redo events.
7. Commit.

Pseudo-flow:

```rust
pub async fn segment_set_speaker(...) -> AppResult<()> {
    let mut conn = project_conn(&app)?;
    let tx = conn.transaction()?;

    let seg = segment::get(&tx, segment_id)?;
    history::push_undo(&tx, UndoPayload::SegmentSetSpeaker {
        segment_id,
        old_speaker_id: seg.speaker_id,
    })?;

    segment::set_speaker(&tx, segment_id, speaker_id)?;
    history::clear_redo(&tx)?;
    tx.commit()?;
    Ok(())
}
```

## Undo execution
Add commands:

- `history_undo()`
- later `history_redo()`
- optionally `history_can_undo()` / `history_can_redo()`

`history_undo()` flow:

1. Open transaction.
2. Load latest undo event.
3. Deserialize payload.
4. Before applying inverse action, capture current state as redo payload.
5. Apply inverse action.
6. Delete or mark undo event as consumed.
7. Push redo event.
8. Commit.

This symmetry makes redo straightforward once payload coverage exists.

## How inverses should behave

### `segment_update_text`
Undo payload must include:
- old segment text
- all affected span snapshots for that segment before mutation

Undo action:
- restore old segment text
- restore every saved span offset/snapshot/audio range exactly

Reason: current command recalculates span bounds/snapshots.

### `span_create`
Undo payload:
- created `span_id`

Undo action:
- delete span

Redo payload should contain full span snapshot because the row may need recreation.

### `span_delete`
Undo payload:
- full deleted span snapshot
- attached tags
- memo body

Undo action:
- reinsert span with same values
- restore tags and memo

This may require adding low-level query helpers that can insert with explicit IDs for history restore paths.

### `segment_split`
Undo payload should include:
- original full segment snapshot before split
- created second segment snapshot
- all affected span snapshots before reassignment

Undo action:
- restore original segment text/end time
- move any moved spans back
- delete created segment
- restore original ordering

### `segment_merge`
Undo payload should include:
- both original segment snapshots
- affected span snapshots on both segments

Undo action:
- restore both segments
- restore text/end times/order
- restore span segment assignments and offsets

## Suggested module layout

```text
src-tauri/src/history/
  mod.rs
  model.rs        # payload enums + snapshot types
  store.rs        # DB read/write helpers for undo/redo tables
  apply.rs        # apply undo/redo payloads
  capture.rs      # helpers to snapshot rows before mutation
```

Potential integration points:
- `src-tauri/src/commands/*.rs` call `history::push_undo(...)`
- `src-tauri/src/db/migrations/` add history tables
- `src/ipc/` add frontend bindings for undo/redo commands
- `src/state/` optionally hold canUndo/canRedo flags
- `src/views/Workspace/` add buttons/shortcuts

## Frontend sketch
Minimal phase-1 UI:

- Add Undo button in workspace header
- Shortcut: `Ctrl+Z` / `Cmd+Z`
- Optional Redo button later with `Ctrl+Shift+Z` / `Cmd+Shift+Z`
- Disable when unavailable

Frontend does not compute inverse actions. It only calls:

```ts
await historyUndo();
```

Then refresh relevant state:
- segments for selected interview
- spans for selected interview
- codebook tree if codebook mutations are covered

## API sketch

### Rust Tauri commands

```rust
#[tauri::command]
pub async fn history_undo(app: tauri::AppHandle) -> AppResult<()>;

#[tauri::command]
pub async fn history_redo(app: tauri::AppHandle) -> AppResult<()>;

#[tauri::command]
pub async fn history_status(app: tauri::AppHandle) -> AppResult<HistoryStatus>;
```

```rust
#[derive(Serialize)]
pub struct HistoryStatus {
    pub can_undo: bool,
    pub can_redo: bool,
}
```

### TypeScript IPC

```ts
export type HistoryStatus = {
  canUndo: boolean;
  canRedo: boolean;
};

export const historyUndo = (): Promise<void> => invoke("history_undo");
export const historyRedo = (): Promise<void> => invoke("history_redo");
export const historyStatus = (): Promise<HistoryStatus> =>
  invoke<RawHistoryStatus>("history_status").then(fromRaw);
```

## Recommended implementation order

1. Add migration for history tables.
2. Add `history` Rust module with payload enum and storage helpers.
3. Implement `history_undo` for phase-1 payloads only.
4. Wrap these commands with undo capture:
   - `segment_set_speaker`
   - `segment_update_text`
   - `span_create`
   - `span_update_tags`
   - `span_update_offsets`
   - `span_delete`
   - `memo_upsert`
5. Add frontend IPC + workspace shortcut/button.
6. Add redo.
7. Extend to split/merge/delete/codebook mutations.

## Risks / edge cases

- Restoring rows with original IDs may require dedicated restore helpers.
- Undoing after a conflicting later mutation can fail unless operations are strictly stack-ordered; stack-only undo is recommended.
- Reorder operations should snapshot the full previous order, not partial deltas.
- AI workflows may perform multi-row mutations; those should eventually be grouped into one history event.
- If history should not survive app restarts, tables can still be persistent but cleared on project open; otherwise keep them durable.

## Opinionated recommendation
Start with a **persistent stack-based undo/redo history in SQLite**, recorded by Rust commands, and expose only simple `undo`/`redo` actions to the UI.

That gives:
- exact restoration
- no frontend drift
- support for side-effectful commands
- a clean path to redo and grouped transactions later
