# 02 — Database & Codebook Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete the SQLite schema (all spec §4 tables), provide a typed Rust query layer for every entity, expose Tauri commands for codebook CRUD with uniqueness enforcement, and render a codebook tree in the workspace left pane that lets the user build the codebook end-to-end.

**Architecture:** Single migration `m002_main.sql` creates every remaining table. Query modules live under `src-tauri/src/db/queries/<entity>.rs`, one per entity, exposing only typed functions (no SQL strings leak outside). Commands at `src-tauri/src/commands/codebook.rs` orchestrate queries and surface uniqueness errors as typed `AppError::Conflict`. Frontend gets new IPC wrappers, atoms for the codebook tree, and a `CodebookTree` component in the left pane with inline editing.

**Tech Stack:** Same as Plan 01.

**Spec reference:** `docs/superpowers/specs/2026-05-12-faden-design.md` §4.

**Prerequisite:** Plan 01 merged to master.

---

## File structure (after this plan)

```
src-tauri/src/
├── db/
│   ├── migrations/
│   │   ├── m002_main.sql               # NEW — all remaining tables
│   │   └── mod.rs                      # MODIFIED — register m002
│   └── queries/
│       ├── cluster.rs                  # NEW
│       ├── category.rs                 # NEW
│       ├── tag.rs                      # NEW
│       ├── interview.rs                # NEW
│       ├── speaker.rs                  # NEW
│       ├── segment.rs                  # NEW
│       ├── stats.rs                    # NEW — per-tag/category/cluster counts
│       └── mod.rs                      # MODIFIED — register modules
├── commands/
│   ├── codebook.rs                     # NEW — cluster/category/tag CRUD
│   ├── interview.rs                    # NEW — list/get (CRUD without audio for now; audio in Plan 03)
│   └── mod.rs                          # MODIFIED — register modules
├── domain/                             # NEW directory — pure DTOs
│   ├── mod.rs
│   ├── codebook.rs                     # CodebookTree, Cluster, Category, Tag DTOs
│   └── interview.rs
└── error.rs                            # MODIFIED — add Conflict variant
src-tauri/tests/
├── codebook.rs                         # NEW — CRUD + uniqueness + reorder
├── interview.rs                        # NEW
└── stats.rs                            # NEW

src/
├── ipc/
│   ├── codebook.ts                     # NEW
│   └── interview.ts                    # NEW
├── state/
│   └── codebook.ts                     # NEW — codebookTreeAtom, selectedTagAtom, etc.
└── views/Workspace/LeftPane/
    ├── LeftPane.tsx                    # NEW — extracted from Workspace
    ├── LeftPane.module.css
    ├── InterviewList.tsx               # NEW (stub, fully built in Plan 03)
    ├── CodebookTree.tsx                # NEW
    └── CodebookTree.module.css
```

---

## Task 1: Migration `m002_main.sql` (TDD)

**Files:**
- Create: `src-tauri/src/db/migrations/m002_main.sql`
- Modify: `src-tauri/src/db/migrations/mod.rs` (register new migration)
- Modify: `src-tauri/tests/migrations.rs` (add a test for m002)

- [ ] **Step 1: Write the failing test**

Append to `src-tauri/tests/migrations.rs`:

```rust
#[test]
fn applies_m002_main_schema() {
    let mut conn = open_mem();
    apply_migrations(&mut conn).unwrap();
    let versions = applied_versions(&conn).unwrap();
    assert_eq!(versions, vec![1, 2]);

    let expected_tables = [
        "interview", "speaker", "segment",
        "cluster", "category", "tag",
        "tagged_span", "span_tag", "memo", "ai_run",
    ];
    for table in expected_tables {
        let count: i64 = conn
            .query_row(
                &format!("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='{table}'"),
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1, "table {table} missing");
    }
}
```

- [ ] **Step 2: Verify failure**

`cargo test --manifest-path src-tauri/Cargo.toml --test migrations` — must fail because m002 isn't registered yet.

- [ ] **Step 3: Create the migration file**

Create `src-tauri/src/db/migrations/m002_main.sql` (the canonical schema from spec §4, minus `schema_version` which the runner owns and `project_meta` which m001 already created):

```sql
CREATE TABLE interview (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    recorded_at TEXT,
    audio_path TEXT,
    notes TEXT,
    transcript_status TEXT NOT NULL
        CHECK (transcript_status IN ('none','in_progress','complete','failed')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE speaker (
    id INTEGER PRIMARY KEY,
    interview_id INTEGER NOT NULL REFERENCES interview(id) ON DELETE CASCADE,
    label_raw TEXT NOT NULL,
    display_name TEXT,
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
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    color TEXT,
    order_index INTEGER NOT NULL
);

CREATE TABLE tag (
    id INTEGER PRIMARY KEY,
    category_id INTEGER NOT NULL REFERENCES category(id) ON DELETE RESTRICT,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    color TEXT,
    order_index INTEGER NOT NULL
);

CREATE TABLE tagged_span (
    id INTEGER PRIMARY KEY,
    interview_id INTEGER NOT NULL REFERENCES interview(id) ON DELETE CASCADE,
    segment_id INTEGER NOT NULL REFERENCES segment(id) ON DELETE CASCADE,
    start_offset INTEGER NOT NULL,
    end_offset INTEGER NOT NULL,
    text_snapshot TEXT NOT NULL,
    audio_start_sec REAL NOT NULL,
    audio_end_sec REAL NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX idx_span_interview ON tagged_span(interview_id);
CREATE INDEX idx_span_segment ON tagged_span(segment_id);

CREATE TABLE span_tag (
    span_id INTEGER NOT NULL REFERENCES tagged_span(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tag(id) ON DELETE RESTRICT,
    source TEXT NOT NULL
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

CREATE TABLE ai_run (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL
        CHECK (kind IN ('transcribe','pretag','codebook_gen','find_more')),
    interview_id INTEGER REFERENCES interview(id) ON DELETE SET NULL,
    model TEXT NOT NULL,
    prompt TEXT NOT NULL,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    status TEXT NOT NULL
        CHECK (status IN ('running','complete','failed','cancelled')),
    error TEXT,
    token_usage_json TEXT,
    result_summary TEXT
);
```

- [ ] **Step 4: Register the migration**

In `src-tauri/src/db/migrations/mod.rs`, change the `MIGRATIONS` constant to:

```rust
const MIGRATIONS: &[(i64, &str)] = &[
    (1, include_str!("m001_init.sql")),
    (2, include_str!("m002_main.sql")),
];
```

- [ ] **Step 5: Verify tests pass**

`cargo test --manifest-path src-tauri/Cargo.toml --test migrations` — 5 tests now (the 4 from Plan 01 plus the new m002 test).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(db): add m002 migration with full domain schema"
```

---

## Task 2: Add `AppError::Conflict` variant

**Files:**
- Modify: `src-tauri/src/error.rs`

- [ ] **Step 1: Add the variant**

In `src-tauri/src/error.rs`, add a `Conflict` variant between `Invalid` and `Tauri`:

```rust
#[error("conflict: {0}")]
Conflict(String),
```

This represents user-visible uniqueness violations distinct from generic `Sqlite` errors. Commands that catch a `rusqlite::Error::SqliteFailure` with `ErrorCode::ConstraintViolation` and message containing "UNIQUE" will translate to this variant for friendlier UI errors.

- [ ] **Step 2: Verify**

`cargo check --manifest-path src-tauri/Cargo.toml` — clean.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(error): add Conflict variant for uniqueness violations"
```

---

## Task 3: `cluster` query module (TDD, full pattern shown)

This task defines the pattern. Tasks 4 and 5 apply the same pattern to `category` and `tag`. The CRUD operations and uniqueness handling will be analogous.

**Files:**
- Create: `src-tauri/src/db/queries/cluster.rs`
- Modify: `src-tauri/src/db/queries/mod.rs`
- Create: `src-tauri/tests/codebook.rs`

- [ ] **Step 1: Write failing tests**

Create `src-tauri/tests/codebook.rs`:

```rust
use rusqlite::Connection;
use faden_app_lib::db::migrations::apply_migrations;
use faden_app_lib::db::queries::cluster;

fn fresh_conn() -> Connection {
    let mut c = Connection::open_in_memory().unwrap();
    apply_migrations(&mut c).unwrap();
    c
}

#[test]
fn cluster_create_assigns_id_and_appends() {
    let conn = fresh_conn();
    let a = cluster::create(&conn, "Identity", None, None).unwrap();
    let b = cluster::create(&conn, "Work", None, None).unwrap();
    assert!(b.id > a.id);
    assert_eq!(b.order_index, a.order_index + 1);
}

#[test]
fn cluster_create_rejects_duplicate_name() {
    let conn = fresh_conn();
    cluster::create(&conn, "Identity", None, None).unwrap();
    let err = cluster::create(&conn, "Identity", None, None).unwrap_err();
    assert!(matches!(err, faden_app_lib::error::AppError::Conflict(_)));
}

#[test]
fn cluster_list_returns_in_order() {
    let conn = fresh_conn();
    cluster::create(&conn, "A", None, None).unwrap();
    cluster::create(&conn, "B", None, None).unwrap();
    cluster::create(&conn, "C", None, None).unwrap();
    let all = cluster::list(&conn).unwrap();
    let names: Vec<_> = all.iter().map(|c| c.name.as_str()).collect();
    assert_eq!(names, vec!["A", "B", "C"]);
}

#[test]
fn cluster_rename_persists() {
    let conn = fresh_conn();
    let c = cluster::create(&conn, "Old", None, None).unwrap();
    cluster::rename(&conn, c.id, "New").unwrap();
    let all = cluster::list(&conn).unwrap();
    assert_eq!(all[0].name, "New");
}

#[test]
fn cluster_rename_rejects_duplicate() {
    let conn = fresh_conn();
    let a = cluster::create(&conn, "A", None, None).unwrap();
    cluster::create(&conn, "B", None, None).unwrap();
    let err = cluster::rename(&conn, a.id, "B").unwrap_err();
    assert!(matches!(err, faden_app_lib::error::AppError::Conflict(_)));
}

#[test]
fn cluster_delete_works_when_empty() {
    let conn = fresh_conn();
    let c = cluster::create(&conn, "A", None, None).unwrap();
    cluster::delete(&conn, c.id).unwrap();
    assert!(cluster::list(&conn).unwrap().is_empty());
}

#[test]
fn cluster_reorder_swaps_indexes() {
    let conn = fresh_conn();
    let a = cluster::create(&conn, "A", None, None).unwrap();
    let b = cluster::create(&conn, "B", None, None).unwrap();
    let c = cluster::create(&conn, "C", None, None).unwrap();
    cluster::reorder(&conn, &[c.id, a.id, b.id]).unwrap();
    let all = cluster::list(&conn).unwrap();
    let names: Vec<_> = all.iter().map(|c| c.name.as_str()).collect();
    assert_eq!(names, vec!["C", "A", "B"]);
}
```

- [ ] **Step 2: Run; expect compile failure**

- [ ] **Step 3: Implement `cluster` module**

Create `src-tauri/src/db/queries/cluster.rs`:

```rust
use crate::error::{AppError, AppResult};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Cluster {
    pub id: i64,
    pub name: String,
    pub description: Option<String>,
    pub color: Option<String>,
    pub order_index: i64,
}

fn map_unique(err: rusqlite::Error, label: &str) -> AppError {
    if let rusqlite::Error::SqliteFailure(_, Some(msg)) = &err {
        if msg.contains("UNIQUE") {
            return AppError::Conflict(format!("{label} name already exists"));
        }
    }
    AppError::Sqlite(err)
}

fn next_order(conn: &Connection) -> AppResult<i64> {
    let next: i64 = conn
        .query_row("SELECT COALESCE(MAX(order_index), -1) + 1 FROM cluster", [], |r| r.get(0))?;
    Ok(next)
}

pub fn create(
    conn: &Connection,
    name: &str,
    description: Option<&str>,
    color: Option<&str>,
) -> AppResult<Cluster> {
    let order_index = next_order(conn)?;
    conn.execute(
        "INSERT INTO cluster (name, description, color, order_index) VALUES (?1, ?2, ?3, ?4)",
        params![name, description, color, order_index],
    ).map_err(|e| map_unique(e, "cluster"))?;
    let id = conn.last_insert_rowid();
    Ok(Cluster {
        id,
        name: name.into(),
        description: description.map(String::from),
        color: color.map(String::from),
        order_index,
    })
}

pub fn list(conn: &Connection) -> AppResult<Vec<Cluster>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, description, color, order_index FROM cluster ORDER BY order_index, id",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(Cluster {
            id: r.get(0)?,
            name: r.get(1)?,
            description: r.get(2)?,
            color: r.get(3)?,
            order_index: r.get(4)?,
        })
    })?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

pub fn rename(conn: &Connection, id: i64, name: &str) -> AppResult<()> {
    let affected = conn
        .execute("UPDATE cluster SET name = ?1 WHERE id = ?2", params![name, id])
        .map_err(|e| map_unique(e, "cluster"))?;
    if affected == 0 {
        return Err(AppError::NotFound(format!("cluster {id}")));
    }
    Ok(())
}

pub fn set_description(conn: &Connection, id: i64, description: Option<&str>) -> AppResult<()> {
    let affected = conn.execute(
        "UPDATE cluster SET description = ?1 WHERE id = ?2",
        params![description, id],
    )?;
    if affected == 0 {
        return Err(AppError::NotFound(format!("cluster {id}")));
    }
    Ok(())
}

pub fn set_color(conn: &Connection, id: i64, color: Option<&str>) -> AppResult<()> {
    let affected = conn.execute(
        "UPDATE cluster SET color = ?1 WHERE id = ?2",
        params![color, id],
    )?;
    if affected == 0 {
        return Err(AppError::NotFound(format!("cluster {id}")));
    }
    Ok(())
}

pub fn delete(conn: &Connection, id: i64) -> AppResult<()> {
    let affected = conn.execute("DELETE FROM cluster WHERE id = ?1", params![id])?;
    if affected == 0 {
        return Err(AppError::NotFound(format!("cluster {id}")));
    }
    Ok(())
}

pub fn reorder(conn: &mut Connection, ids_in_order: &[i64]) -> AppResult<()> {
    let tx = conn.transaction()?;
    for (idx, id) in ids_in_order.iter().enumerate() {
        let affected = tx.execute(
            "UPDATE cluster SET order_index = ?1 WHERE id = ?2",
            params![idx as i64, id],
        )?;
        if affected == 0 {
            return Err(AppError::NotFound(format!("cluster {id}")));
        }
    }
    tx.commit()?;
    Ok(())
}

pub fn get(conn: &Connection, id: i64) -> AppResult<Cluster> {
    conn.query_row(
        "SELECT id, name, description, color, order_index FROM cluster WHERE id = ?1",
        params![id],
        |r| {
            Ok(Cluster {
                id: r.get(0)?,
                name: r.get(1)?,
                description: r.get(2)?,
                color: r.get(3)?,
                order_index: r.get(4)?,
            })
        },
    )
    .optional()?
    .ok_or_else(|| AppError::NotFound(format!("cluster {id}")))
}
```

In `src-tauri/src/db/queries/mod.rs`, add `pub mod cluster;`.

- [ ] **Step 4: Verify tests pass**

`cargo test --manifest-path src-tauri/Cargo.toml --test codebook` — 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(db): add cluster query module with CRUD + reorder"
```

---

## Task 4: `category` query module

Same pattern as Task 3. Differences:

- `create` accepts `cluster_id: i64`. Validate it exists via `cluster::get(conn, cluster_id)?` before inserting; on FK failure surface `AppError::NotFound`.
- `list` may optionally filter by cluster: `list_for_cluster(conn, cluster_id)`. Also provide `list_all(conn)` returning all categories.
- Add a `move_to_cluster(conn, category_id, new_cluster_id)` function.
- `delete` must reject if any tags exist with `category_id = id`; map SQLite FK restriction to `AppError::Conflict("category has tags")`.

Tests: 7 tests covering create / list / rename / move / reorder / delete-empty / delete-with-tags-fails.

Commit: `feat(db): add category query module`.

---

## Task 5: `tag` query module

Same pattern. Differences:

- `create` accepts `category_id`. Validate via `category::get`.
- `list_for_category(conn, category_id)` and `list_all(conn)`.
- `move_to_category`.
- `delete` rejects if any `span_tag` rows reference it (via FK restrict) → `AppError::Conflict("tag is in use")`.
- 7 tests.

Commit: `feat(db): add tag query module`.

---

## Task 6: `interview` query module (minimal — list/get/create-without-audio)

The full interview lifecycle (audio import, transcription) happens in Plan 03. Here we expose the minimum needed for the workspace to render an interview list.

**Files:**
- Create: `src-tauri/src/db/queries/interview.rs`
- Create: `src-tauri/tests/interview.rs`

Module API:

```rust
pub struct Interview {
    pub id: i64,
    pub name: String,
    pub recorded_at: Option<String>,
    pub audio_path: Option<String>,
    pub notes: Option<String>,
    pub transcript_status: TranscriptStatus,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TranscriptStatus { None, InProgress, Complete, Failed }

pub fn create(conn: &Connection, name: &str) -> AppResult<Interview>;
pub fn list(conn: &Connection) -> AppResult<Vec<Interview>>;
pub fn get(conn: &Connection, id: i64) -> AppResult<Interview>;
pub fn rename(conn: &Connection, id: i64, name: &str) -> AppResult<()>;
pub fn set_status(conn: &Connection, id: i64, status: TranscriptStatus) -> AppResult<()>;
pub fn set_audio_path(conn: &Connection, id: i64, path: Option<&str>) -> AppResult<()>;
pub fn delete(conn: &Connection, id: i64) -> AppResult<()>;
```

Implementation notes:
- `create` writes `created_at` and `updated_at` as `chrono::Utc::now().to_rfc3339()`, sets `transcript_status` to `'none'`, leaves `audio_path` NULL.
- All mutating functions update `updated_at`.
- `TranscriptStatus` (de)serializes from/to the SQL strings via a `From<&str>` and `Display`.

5 tests covering: create + list, rename, set_status round-trip, set_audio_path, delete cascades to speakers + segments (will be exercised more thoroughly in Plan 03; here we test the contract).

Commit: `feat(db): add interview query module`.

---

## Task 7: `speaker` and `segment` query modules (stubs for Plan 03)

These modules are needed for the schema to be reachable from the rest of the code, even though the workspace doesn't render segments until Plan 03 / 04. Implement minimum:

**`speaker`:**
- `Speaker { id, interview_id, label_raw, display_name }`
- `create_or_get(conn, interview_id, label_raw, display_name)` — INSERT OR IGNORE; returns the row by `UNIQUE(interview_id, label_raw)`.
- `list_for_interview(conn, interview_id)`.
- `set_display_name(conn, id, display_name)`.

**`segment`:**
- `Segment { id, interview_id, speaker_id, start_sec, end_sec, text, order_index }`
- `insert_batch(conn: &mut Connection, interview_id: i64, segments: &[NewSegment])` — single transaction.
- `list_for_interview(conn, interview_id)` — ordered by `order_index`.
- `delete_all_for_interview(conn, interview_id)` — used when re-transcribing.

3 tests per module covering the basic round-trips.

Commit: `feat(db): add speaker and segment query modules`.

---

## Task 8: `stats` query module

Computes per-codebook-entity counts of tagged spans. Used by the codebook tree to show `(N)` next to each tag/category/cluster.

```rust
pub struct CodebookCounts {
    pub by_cluster: HashMap<i64, i64>,
    pub by_category: HashMap<i64, i64>,
    pub by_tag: HashMap<i64, i64>,
}

pub fn codebook_counts(conn: &Connection) -> AppResult<CodebookCounts>;
```

Implementation: three SQL queries that aggregate `span_tag` joined through `tag` → `category` → `cluster`. Use `GROUP BY` and collect into `HashMap`.

3 tests:
- Empty DB → all maps empty.
- After tagging one span → all three counts reflect 1.
- After tagging two spans with different tags in the same category → category count = 2, individual tag counts = 1.

(The "after tagging" tests will need to insert raw `tagged_span` + `span_tag` rows; the typed CRUD for spans is in Plan 04.)

Commit: `feat(db): add stats query module for codebook counts`.

---

## Task 9: Tauri commands — codebook CRUD

**Files:**
- Create: `src-tauri/src/commands/codebook.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs` (register commands)

Commands (all async, returning `AppResult<...>`):

- `codebook_tree() -> CodebookTree`
- `cluster_create(name, description?, color?) -> Cluster`
- `cluster_rename(id, name) -> ()`
- `cluster_set_description(id, description?) -> ()`
- `cluster_set_color(id, color?) -> ()`
- `cluster_delete(id) -> ()`
- `cluster_reorder(ids: Vec<i64>) -> ()`
- Same set for `category_*` (with `cluster_id` on create, `move_to_cluster` extra)
- Same set for `tag_*` (with `category_id` on create, `move_to_category` extra)

All commands take an `app: tauri::AppHandle` to locate the current project's SQLite. **New helper** in `src-tauri/src/commands/mod.rs`:

```rust
pub(crate) fn project_conn(app: &tauri::AppHandle) -> AppResult<rusqlite::Connection> {
    let state = app.state::<crate::app_state::AppState>();
    let path = state.current_project()?;
    crate::db::open(&path.join("project.sqlite"))
}
```

This requires a new module `src-tauri/src/app_state.rs` that holds the currently-open project path. Set up `AppState` as a Tauri-managed state via `.manage(AppState::default())` in `lib.rs::run()`. Modify `project_open` and `project_create` in `commands/project.rs` to also call `state.set_current(path)`.

**`CodebookTree` DTO** in `src-tauri/src/domain/codebook.rs`:

```rust
#[derive(Debug, Clone, Serialize)]
pub struct CodebookTree {
    pub clusters: Vec<ClusterNode>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ClusterNode {
    pub id: i64,
    pub name: String,
    pub description: Option<String>,
    pub color: Option<String>,
    pub order_index: i64,
    pub count: i64,
    pub categories: Vec<CategoryNode>,
}

// CategoryNode { id, name, ..., count, tags: Vec<TagNode> }
// TagNode { id, name, ..., count }
```

`codebook_tree` query joins clusters/categories/tags and calls `stats::codebook_counts` to fill `count` fields.

Tests in `src-tauri/tests/codebook.rs`:
- 4 tests for `codebook_tree` shape (empty, one cluster, full hierarchy, counts after tagging).

Commit: `feat(commands): add codebook CRUD commands with tree DTO`.

---

## Task 10: Tauri commands — interview list

**Files:**
- Create: `src-tauri/src/commands/interview.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`

Commands:

- `interview_list() -> Vec<Interview>`
- `interview_get(id) -> Interview`
- `interview_create(name) -> Interview`
- `interview_rename(id, name) -> ()`
- `interview_delete(id) -> ()`

Tests in `src-tauri/tests/interview.rs`: 4 tests covering create + list + rename + delete.

Commit: `feat(commands): add interview lifecycle commands (no audio yet)`.

---

## Task 11: Frontend IPC wrappers

**Files:**
- Create: `src/ipc/codebook.ts`
- Create: `src/ipc/interview.ts`

Each file follows the pattern from Plan 01's `src/ipc/project.ts`: TS types matching Rust DTOs (camelCase frontend, snake_case wire via converters), one named export per command.

For `codebook.ts`:

```ts
import { invoke } from "@tauri-apps/api/core";

export type ClusterNode = {
  id: number;
  name: string;
  description: string | null;
  color: string | null;
  orderIndex: number;
  count: number;
  categories: CategoryNode[];
};
// CategoryNode, TagNode, CodebookTree analogous

export type Cluster = { /* same as ClusterNode but no children/count */ };

export const codebookTree = (): Promise<CodebookTree> => invoke("codebook_tree");
export const clusterCreate = (name: string, description?: string, color?: string) =>
  invoke<Cluster>("cluster_create", { name, description: description ?? null, color: color ?? null });
// ... all the others
```

Write a small `rsToTs` helper per DTO type to convert snake_case → camelCase (mirror the pattern in `src/ipc/settings.ts`).

For `interview.ts`: similar, exposing `interviewList`, `interviewGet`, `interviewCreate`, `interviewRename`, `interviewDelete`.

Commit: `feat(ipc): add codebook and interview wrappers`.

---

## Task 12: Jotai atoms for codebook + interview

**Files:**
- Create: `src/state/codebook.ts`
- Create: `src/state/interview.ts`

```ts
// codebook.ts
import { atom } from "jotai";
import type { CodebookTree } from "../ipc/codebook";

export const codebookTreeAtom = atom<CodebookTree | null>(null);
export const selectedCodebookNodeAtom = atom<
  | { kind: "cluster"; id: number }
  | { kind: "category"; id: number }
  | { kind: "tag"; id: number }
  | null
>(null);

// interview.ts
import { atom } from "jotai";
import type { Interview } from "../ipc/interview";

export const interviewListAtom = atom<Interview[]>([]);
export const selectedInterviewIdAtom = atom<number | null>(null);
```

Commit: `feat(state): add codebook and interview atoms`.

---

## Task 13: LeftPane component extraction + InterviewList stub

**Files:**
- Create: `src/views/Workspace/LeftPane/LeftPane.tsx`
- Create: `src/views/Workspace/LeftPane/LeftPane.module.css`
- Create: `src/views/Workspace/LeftPane/InterviewList.tsx`
- Modify: `src/views/Workspace/Workspace.tsx` (use LeftPane)

LeftPane structure:

```tsx
import styles from "./LeftPane.module.css";
import { InterviewList } from "./InterviewList";
import { CodebookTree } from "./CodebookTree";
import { useTranslation } from "react-i18next";

export const LeftPane = () => {
  const { t } = useTranslation();
  return (
    <aside className={styles.pane}>
      <section className={styles.section}>
        <h3 className={styles.title}>{t("workspace.interviews")}</h3>
        <InterviewList />
      </section>
      <section className={styles.section}>
        <h3 className={styles.title}>{t("workspace.codebook")}</h3>
        <CodebookTree />
      </section>
    </aside>
  );
};
```

**InterviewList**: loads `interviewListAtom`, fetches via `interviewList()` on mount, renders a list of buttons setting `selectedInterviewIdAtom`. Empty state: `t("workspace.noInterviews")` with an "Add interview" button that calls `interviewCreate(prompt)` (Plan 03 will improve this UX). Add a `+` button at top to create a new interview by name.

Add i18n keys:

```json
"workspace": {
  "leftPaneTitle": "Project",  // existing
  "interviews": "Interviews",
  "codebook": "Codebook",
  "noInterviews": "No interviews yet",
  "addInterview": "+ New interview"
}
```

(Add Czech translations alongside.)

In `Workspace.tsx`, replace the placeholder `<aside className={styles.left}>` block with `<LeftPane />`. Move CSS for the left pane border/padding to `LeftPane.module.css`; remove from `Workspace.module.css`.

Commit: `feat(workspace): extract left pane with interview list stub`.

---

## Task 14: CodebookTree component

**Files:**
- Create: `src/views/Workspace/LeftPane/CodebookTree.tsx`
- Create: `src/views/Workspace/LeftPane/CodebookTree.module.css`

Behavior:

- On mount, calls `codebookTree()` → fills `codebookTreeAtom`.
- Renders a three-level tree:
  - Cluster (collapsible) — name + count + colored swatch.
  - Category (collapsible) — name + count.
  - Tag — name + count.
- Each level has inline rename: double-click to edit, Enter to commit (calls `*Rename`), Esc to cancel.
- Each level has a delete button (`×`) that asks for confirmation and calls `*Delete`. Deletion errors (Conflict) display inline.
- Plus button at each level: "Add cluster", "Add category" (inside a cluster), "Add tag" (inside a category). Each opens a small inline input.
- Each entity has a description input visible on hover/click expand.
- Color: small square picker (10 palette colors). Color changes call `*SetColor`.
- Selecting a node sets `selectedCodebookNodeAtom`. Selection is purely UI; later plans use this for "show all spans tagged with this".

CSS: indentation per level, hover highlights, focus rings via `outline: 2px solid var(--accent)`.

This component will be ~250 LOC. Keep it in a single file; split into sub-components (`ClusterNodeRow`, `CategoryNodeRow`, `TagNodeRow`) within the same file if it exceeds ~300 LOC.

Add i18n keys:

```json
"codebook": {
  "addCluster": "+ Cluster",
  "addCategory": "+ Category",
  "addTag": "+ Tag",
  "rename": "Rename",
  "delete": "Delete",
  "confirmDelete": "Delete \"{{name}}\"?",
  "errorInUse": "Cannot delete — entity is in use",
  "errorDuplicate": "Name already exists"
}
```

Commit: `feat(workspace): add codebook tree with inline CRUD`.

---

## Task 15: Smoke verification

- [ ] **Manual checklist:**

1. `npm run tauri dev` — open the app.
2. Create new project.
3. Add a cluster "Identity". Add another "Work". Confirm both visible.
4. Try to add a third with name "Identity" → see conflict error.
5. Add a category "Self-image" under Identity.
6. Add a tag "ideals" under Self-image with color blue.
7. Rename "ideals" to "ideal-self" via double-click.
8. Try to delete category "Self-image" — should fail with "in use" because of the tag.
9. Delete tag first, then category — should succeed.
10. Close and reopen the project — codebook persists.
11. Add an interview (empty) via the InterviewList "+" button. Confirm it appears.

- [ ] **Non-interactive:**

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: ~35–40 tests pass (Plan 01's 16 + new tests).

```bash
npm run build
```

Clean.

No new commit.

---

## Self-review

### Spec coverage

| Spec section | Task |
|---|---|
| §4 schema (interview, speaker, segment, cluster, category, tag, tagged_span, span_tag, memo, ai_run) | 1 |
| §4 uniqueness per project per level | 3, 4, 5 (UNIQUE + Conflict mapping) |
| §4 single-parent (tag→category→cluster) | 4, 5 (FK + validation) |
| §4 cascade behavior | 1 (FK ON DELETE clauses) + tests |
| §6 left pane: project tree + codebook | 13, 14 |
| Codebook CRUD via UI | 14 |

### Placeholder scan

The plan delegates the analogous CRUD modules (category, tag) by reference to Task 3's pattern. Each is a complete deliverable with concrete differences noted (cluster_id validation, move_to_X, deletion semantics). If executing as separate tasks, an implementer should re-read Task 3's code first.

### Type consistency

- `Cluster`, `Category`, `Tag` Rust structs ↔ TS `Cluster`/`Category`/`Tag` types: name, description (nullable), color (nullable), order_index → orderIndex.
- `CodebookTree`/`ClusterNode`/`CategoryNode`/`TagNode` include `count` (derived in Rust via `stats::codebook_counts`).
- `AppError::Conflict` introduced in Task 2 is used by `map_unique` in cluster/category/tag modules.

---

## Notes for execution

- Multiple tasks reference `AppState` and `project_conn`. Introduce `AppState` in Task 9 alongside the first command that needs it; modify `commands/project.rs` to call `state.set_current(path)` after opening/creating.
- Task 14 (CodebookTree component) is the largest single deliverable. Budget ~2 hours.
- When the implementer subagent works on Task 9, they'll need to also update `Workspace.tsx`'s data-loading flow so the codebook tree atom is hydrated on navigation. Add that to Task 14's component init (`useEffect` calls `codebookTree()`).
