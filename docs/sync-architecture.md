# Sync architecture journey

## Goal
Build a sync system that lets the same Faden project run on multiple devices, including a laptop and a tablet at the same time, with a clear path from simple sync to reliable realtime collaboration.

The sync server will use **PostgreSQL**, not SQLite. SQLite remains the local on-device database for offline work.

The shared data model is **team-owned**. Users do not talk to Faden anonymously: every sync-server request and every WebSocket session must be authenticated. Projects belong to teams, users belong to teams, and devices belong to authenticated users.

## Why this is possible
Faden already has several properties that make sync feasible:

- project data is structured, not freeform
- writes already go through backend commands
- important mutations already exist as domain operations (`segment_split`, `segment_merge`, `span_create`, `span_update_tags`, `memo_upsert`, ...)
- local persistence is already durable and transactional

This means sync should be built as **operation sync over structured entities**, not as raw file sync.

## Main fear: two laptops offline for a long time
That fear is valid. It is the hardest case and it must shape the design from the beginning.

The system must assume:

- device A and device B start from the same project state
- both go offline for hours or days
- both create, edit, delete, reorder, split, merge, and tag data
- both reconnect later in arbitrary order

A safe design therefore needs:

- **stable global IDs** for every syncable entity
- **device IDs** and **operation IDs**
- an **append-only operation log**
- **per-entity versioning**
- **conflict detection**, not blind overwrite
- **idempotent replay** on both client and server
- a **manual conflict path** for edits that cannot be merged safely

## Non-goals for the first iterations
Do not start with these:

- CRDT-based character-level collaborative transcript editing
- peer-to-peer sync
- syncing `cache/` artifacts
- advanced enterprise auth/SSO and complex RBAC beyond simple team/project roles
- background merging of arbitrary binary files

Those can come later if real usage demands them.

---

## Current local model
Today each project is a folder:

```text
my-project/
  project.sqlite
  media/
  cache/
```

Core local entities already persisted in SQLite:

- `project_meta`
- `interview`
- `speaker`
- `segment`
- `cluster`
- `category`
- `tag`
- `tagged_span`
- `span_tag`
- `memo`
- `ai_run`
- `proposal`
- `ai_run_stage`
- `ai_run_task`

This is a good base, but sync needs more metadata than the current schema has.

---

## Guiding principles

1. **Offline-first**
   Every device must remain fully usable while offline.

2. **Server-authoritative convergence**
   The server is the canonical source for shared project history, but clients can queue local operations while disconnected.

3. **Operations over snapshots**
   Sync structured commands, not whole SQLite files.

4. **Stable IDs everywhere**
   Integer row IDs are local implementation details. Sync must use UUIDs/ULIDs.

5. **Idempotency**
   Re-sending the same operation must be safe.

6. **Conflict visibility**
   If the system cannot merge safely, it must surface that clearly.

7. **Realtime is an optimization over correct sync**
   First make delayed offline sync correct. Then add WebSocket fanout.

8. **Team-owned tenancy and authenticated access from day one**
   Do not start with user-owned projects and retrofit teams later. Authentication, authorization, and auditability are part of the core sync design.

---

## Target architecture

```text
Faden client A          Faden client B          Faden tablet
  local SQLite            local SQLite            local SQLite
  op queue                op queue                op queue
  sync worker             sync worker             sync worker
       \                    |                    /
        \                   |                   /
         +----------- Sync API / WS -----------+
                     stateless app servers
                            |
                        PostgreSQL
                            |
                     blob/object storage
                 (audio, imported files, exports)
```

### Responsibilities

#### Client
- stores full working project locally
- generates operations
- applies local operations immediately
- queues unsynced operations
- uploads and downloads server operations
- resolves conflicts with user help when necessary
- subscribes to realtime events over WebSocket when online

#### Sync server
- authenticates users/devices
- authorizes every action in a team context
- stores teams, users, memberships, projects, devices, cursors, operations, versions, conflicts
- validates operations against current server state
- applies accepted operations transactionally in Postgres
- emits WebSocket events
- tracks blob uploads for media

#### PostgreSQL
- canonical shared state
- append-only project operation log
- per-entity metadata and versions
- sync cursors and conflict records

#### Blob storage
- audio files
- imported transcripts
- optional exports
- never stream these through the operation log

---

## Technology conclusions

## Server language
Stay with **Rust** for the sync server.

Why:
- the desktop/backend domain logic is already Rust-heavy
- correctness, replay, idempotency, and conflict handling matter more than CRUD scaffolding speed
- sharing sync types, validation rules, and operation semantics with the desktop side is easier in Rust
- realtime HTTP/WebSocket servers are a good fit for Rust

Expected trade-off:
- early development will likely be somewhat slower than a TypeScript server
- later correctness work should be safer and easier to keep aligned with the desktop backend

## Transport model
Do **not** build a custom tRPC-style RPC framework.

Use:
- JSON over HTTP for snapshot/bootstrap/push/pull/conflict/blob flows
- WebSockets for presence and low-latency sync events
- optional OpenAPI or schema-driven client generation later if helpful

Reason:
- sync is a small explicit protocol, not a large UI-driven RPC surface
- a purpose-built sync protocol is easier to test and reason about than inventing a new RPC abstraction

## Recommended Rust stack
Suggested, not mandatory:
- `axum` for HTTP and WebSockets
- `sqlx` or `Diesel` for PostgreSQL access
- shared Rust crate for sync operation payloads, IDs, validation helpers, and conflict rule definitions

Important constraint:
- share sync/domain types where useful
- do not over-couple local SQLite persistence code and server Postgres persistence code

---

## Auth and tenancy conclusions

These are now architectural requirements, not optional follow-ups:

- every user-facing sync interaction must be authenticated
- every request runs in a team context
- every project is owned by a team
- every device is registered to an authenticated user
- authorization must be checked for HTTP, WebSocket, and blob access

Recommended initial role model:
- team roles: `owner`, `member`
- project roles: `editor` now, `viewer` later if needed

Do not design the first server as user-owned and migrate later. Team ownership changes too many core foreign keys and access rules.

---

## Core decision: sync model
Use **operation-based sync with materialized state**.

That means the server stores both:

1. **current relational state** for efficient reads
2. **append-only operations** for sync, replay, audit, and repair

This is better than file sync because:

- SQLite file merge is unsafe
- ops are smaller
- conflicts can be detected precisely
- realtime fanout becomes easy
- project history becomes inspectable

---

## Identity and versioning model

## Stable IDs
Every syncable entity gets a globally unique `uid`.

Recommended format:

- `UUIDv7` or `ULID`

Use `uid` for sync and API payloads. Keep local integer IDs if helpful for existing Rust query code, but treat them as local-only.

### Entities that need `uid`
- project
- interview
- speaker
- segment
- cluster
- category
- tag
- tagged_span
- memo
- ai_run
- proposal
- optionally attachments/blobs

### Composite/link tables
- `span_tag` should use `(span_uid, tag_uid)`

## Device identity
Each app install gets a stable `device_id`.

## Operation identity
Each locally created operation gets:

- `op_id` - globally unique
- `device_id`
- `client_seq` - monotonic per device

Uniqueness constraint:

- `(project_uid, device_id, client_seq)` unique
- `op_id` unique

## Versioning
Use three layers:

### 1. Project log sequence
A server-assigned monotonic `server_seq` per project.

Purpose:
- ordering
- cursor advancement
- incremental pull
- websocket catch-up

### 2. Per-entity version
Every syncable row has `version BIGINT NOT NULL`.

Increment when a mutation changes that row.

Purpose:
- optimistic concurrency
- conflict detection
- rebase rules

### 3. Client base version in each op
Each mutation references the entity version it was based on.

Example:

```json
{
  "type": "segment.update_text",
  "segment_uid": "seg_...",
  "base_version": 12,
  "new_text": "..."
}
```

If the server row is now version 15, the server knows the client edited stale state.

---

## Conflict strategy

## Default rule
- if an operation is still valid against current server state, accept it
- if it touches stale data but can be safely rebased, rebase it
- if it cannot be safely rebased, reject it into a conflict state

## Merge classes

### Class A: safe commutative or idempotent
Usually auto-merge.

Examples:
- `span_tag.attach`
- `span_tag.detach`
- memo create when memo absent
- ai run/proposal inserts
- blob upload state updates

### Class B: safe if field-disjoint
Auto-merge if different fields changed.

Examples:
- tag color changed on one device, tag description changed on another
- interview name changed on one device, notes changed on another

### Class C: structural but rebaseable
Auto-merge only with explicit server logic.

Examples:
- reorder operations
- `segment_split`
- `segment_merge`
- moving category to another cluster

### Class D: text-conflicting or semantically ambiguous
Do not auto-merge initially.

Examples:
- both devices edit the same segment text
- one device splits a segment while the other edits its text
- one device deletes a tag while another renames it
- one device deletes a segment while another creates a span inside it

These become explicit conflicts.

## Resolution policy by entity

| Entity / operation | Initial policy |
|---|---|
| Interview metadata | field-level merge where safe |
| Cluster/category/tag rename/color/description | field-level merge where safe |
| Reorder | server rebase by parent scope |
| Speaker display name | last-writer-wins with version check acceptable |
| Segment text | explicit conflict if same segment changed concurrently |
| Segment split/merge/delete | explicit conflict against stale base unless deterministic rebase succeeds |
| Tagged span offsets | conflict if source segment text changed since base |
| Span tag attach/detach | set semantics, auto-merge |
| Memo body | explicit conflict or optional last-writer-wins; prefer explicit conflict |
| AI runs/proposals | append-only, no merge issue |

## Conflict record lifecycle
When the server cannot apply an op safely:

1. op is stored as `conflicted`
2. conflict record is created
3. clients receive `conflict.created`
4. UI shows a resolver
5. user chooses:
   - keep server version
   - apply mine anyway
   - manual merge
   - duplicate as new entity where applicable
6. resolution emits a normal operation

## Important stance on offline laptop divergence
For the first serious version:

- **do not promise automatic merge of concurrent transcript text edits**
- **do promise lossless detection and explicit recovery**

That is the correct safety-first promise.

---

## PostgreSQL schema
Below is the recommended server-side schema. Names can change, but these responsibilities should remain.

## 1. Auth and tenancy

### `user_account`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | authenticated user id |
| `email` | text unique | nullable if external auth only |
| `display_name` | text null | |
| `created_at` | timestamptz | |
| `disabled_at` | timestamptz null | |

### `team`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | team uid |
| `name` | text | |
| `created_at` | timestamptz | |
| `archived_at` | timestamptz null | |

### `team_member`
| Column | Type | Notes |
|---|---|---|
| `team_id` | uuid fk | |
| `user_account_id` | uuid fk | |
| `role` | text | `owner`, `member` |
| `created_at` | timestamptz | |
| `disabled_at` | timestamptz null | |
| PK | `(team_id, user_account_id)` | |

### `device`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | stable device id |
| `user_account_id` | uuid fk | authenticated owner |
| `name` | text | user-visible device name |
| `platform` | text | mac/windows/linux/ipad/etc |
| `app_version` | text | |
| `created_at` | timestamptz | |
| `last_seen_at` | timestamptz | |
| `revoked_at` | timestamptz null | optional device revocation |

### `project`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | project uid |
| `team_id` | uuid fk | team owner |
| `name` | text | |
| `created_by_user_account_id` | uuid fk | audit |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |
| `head_server_seq` | bigint | latest accepted op seq |
| `base_snapshot_version` | bigint | optional snapshot generation |
| `archived_at` | timestamptz null | |

### `project_member`
Optional initially. If omitted, all active team members can edit all team projects.

| Column | Type | Notes |
|---|---|---|
| `project_id` | uuid fk | |
| `user_account_id` | uuid fk | |
| `role` | text | `editor`, later `viewer` |
| `created_at` | timestamptz | |
| PK | `(project_id, user_account_id)` | |

## 2. Sync state

### `project_cursor`
Tracks how far each device has pulled/applied.

| Column | Type | Notes |
|---|---|---|
| `project_id` | uuid fk | |
| `device_id` | uuid fk | |
| `last_pulled_server_seq` | bigint | last delivered from server |
| `last_acked_client_seq` | bigint | highest client seq durably accepted |
| `updated_at` | timestamptz | |
| PK | `(project_id, device_id)` | |

### `project_presence`
Ephemeral but persisted enough for reconnects.

| Column | Type | Notes |
|---|---|---|
| `project_id` | uuid fk | |
| `device_id` | uuid fk | |
| `user_account_id` | uuid fk | denormalized for easier fanout/audit |
| `status` | text | `online`, `idle`, `offline` |
| `active_interview_uid` | uuid null | optional focus |
| `active_segment_uid` | uuid null | optional focus |
| `last_heartbeat_at` | timestamptz | |
| PK | `(project_id, device_id)` | |

### `project_conflict`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `project_id` | uuid fk | |
| `entity_type` | text | |
| `entity_uid` | uuid | |
| `conflict_type` | text | |
| `server_state_json` | jsonb | |
| `client_op_json` | jsonb | rejected/conflicted op |
| `status` | text | `open`, `resolved`, `discarded` |
| `created_at` | timestamptz | |
| `resolved_at` | timestamptz null | |
| `resolved_by_device_id` | uuid null | |

## 3. Append-only operation log

### `project_op`
This is the heart of sync.

| Column | Type | Notes |
|---|---|---|
| `op_id` | uuid pk | globally unique op id |
| `project_id` | uuid fk | |
| `device_id` | uuid fk | origin device |
| `client_seq` | bigint | per-device monotonic |
| `server_seq` | bigint unique | per-project monotonic, assigned on accept |
| `op_type` | text | domain op name |
| `entity_type` | text | primary entity touched |
| `entity_uid` | uuid null | |
| `base_versions_json` | jsonb | map of entity uid -> expected version |
| `payload_json` | jsonb | canonical op payload |
| `status` | text | `accepted`, `rejected`, `conflicted` |
| `rejection_reason` | text null | |
| `created_at` | timestamptz | client time optional inside payload too |
| `accepted_at` | timestamptz null | |

Constraints:
- unique `(project_id, device_id, client_seq)`
- index `(project_id, server_seq)`
- index `(project_id, entity_type, entity_uid)`

## 4. Materialized project tables
These mirror the current domain, but with sync metadata.

### Shared metadata columns for syncable tables
Add to each syncable table:

| Column | Type | Notes |
|---|---|---|
| `uid` | uuid pk or unique | stable entity identity |
| `project_id` | uuid fk | not needed on every child if denormalized choice differs, but recommended |
| `version` | bigint | optimistic concurrency |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |
| `deleted_at` | timestamptz null | tombstone when needed |
| `last_op_id` | uuid null | op that last changed row |

### `project_meta_state`
Optional if project row already carries enough settings. If project settings grow, keep them here.

### `interview_state`
| Column | Type | Notes |
|---|---|---|
| `uid` | uuid pk | |
| `project_id` | uuid fk | |
| `name` | text | |
| `recorded_at` | timestamptz null | |
| `audio_blob_id` | uuid null | |
| `notes` | text null | |
| `transcript_status` | text | |
| `version` | bigint | |
| sync metadata | ... | |

### `speaker_state`
| Column | Type | Notes |
|---|---|---|
| `uid` | uuid pk | |
| `project_id` | uuid fk | |
| `interview_uid` | uuid fk | |
| `label_raw` | text | original transcript label |
| `display_name` | text null | |
| `version` | bigint | |

Unique:
- `(project_id, interview_uid, label_raw)`

### `segment_state`
| Column | Type | Notes |
|---|---|---|
| `uid` | uuid pk | |
| `project_id` | uuid fk | |
| `interview_uid` | uuid fk | |
| `speaker_uid` | uuid null fk | |
| `start_sec` | double precision | |
| `end_sec` | double precision | |
| `text` | text | |
| `order_key` | text | fractional ordering token preferred |
| `version` | bigint | |

Important: use `order_key`, not integer-only `order_index`, on the server.

Reason:
- concurrent insert/reorder becomes easier
- clients can still materialize local integer order after pull

### `cluster_state`, `category_state`, `tag_state`
Keep existing fields plus `uid`, `version`, sync metadata. Also prefer `order_key` over integer-only ordering.

### `tagged_span_state`
| Column | Type | Notes |
|---|---|---|
| `uid` | uuid pk | |
| `project_id` | uuid fk | |
| `interview_uid` | uuid fk | |
| `segment_uid` | uuid fk | |
| `start_offset` | integer | |
| `end_offset` | integer | |
| `text_snapshot` | text | |
| `audio_start_sec` | double precision | |
| `audio_end_sec` | double precision | |
| `version` | bigint | |

### `span_tag_state`
| Column | Type | Notes |
|---|---|---|
| `project_id` | uuid fk | |
| `span_uid` | uuid fk | |
| `tag_uid` | uuid fk | |
| `source` | text | |
| `created_at` | timestamptz | |
| PK | `(span_uid, tag_uid)` | set semantics |

### `memo_state`
| Column | Type | Notes |
|---|---|---|
| `uid` | uuid pk | or reuse span uid if 1:1 |
| `project_id` | uuid fk | |
| `span_uid` | uuid unique fk | |
| `body` | text | |
| `version` | bigint | |

### AI tables
Keep them syncable only if you want cross-device visibility for AI history and staged proposals.

Recommended:
- sync `ai_run`, `ai_run_stage`, `ai_run_task`, `proposal`
- do not block main project sync on them

## 5. Blob tables

### `blob`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `project_id` | uuid fk | |
| `kind` | text | `audio`, `transcript_import`, `export`, ... |
| `sha256` | text | dedupe key |
| `size_bytes` | bigint | |
| `mime_type` | text | |
| `storage_key` | text | object store key |
| `created_at` | timestamptz | |

### `interview_blob_link`
If more than one blob per interview is needed later.

---

## WebSocket design
WebSocket is for **presence, push notifications, and low-latency delivery**, not for bypassing the normal operation protocol.

The canonical mutation path stays:

1. client applies locally
2. client sends op to server
3. server validates and commits
4. server emits event
5. all clients pull/apply canonical result

## Connection

### Client -> server
`GET /v1/projects/{project_uid}/ws`

Auth:
- bearer token required
- token identifies authenticated user
- device id supplied separately but never trusted without authenticated user binding
- server must verify the user is an active member of the owning team and has project access

After connect, client sends:

```json
{
  "type": "hello",
  "project_uid": "...",
  "device_id": "...",
  "last_seen_server_seq": 1842,
  "subscriptions": {
    "presence": true,
    "ops": true,
    "conflicts": true
  }
}
```

Server replies:

```json
{
  "type": "hello.ok",
  "project_uid": "...",
  "connection_id": "...",
  "server_head_seq": 1850,
  "heartbeat_interval_ms": 15000
}
```

## Event envelope
All WS messages should share an envelope:

```json
{
  "type": "op.accepted",
  "project_uid": "...",
  "server_time": "2026-05-16T12:00:00Z",
  "event_id": "uuid",
  "payload": {}
}
```

## WebSocket event types

### Presence

#### `presence.joined`
```json
{
  "type": "presence.joined",
  "payload": {
    "device_id": "...",
    "user_account_id": "...",
    "team_id": "...",
    "device_name": "MacBook Pro",
    "active_interview_uid": "...",
    "active_segment_uid": null
  }
}
```

#### `presence.updated`
Focus/heartbeat change.

#### `presence.left`
Device disconnected or timed out.

### Sync progress

#### `project.head`
Server announces new head sequence.

```json
{
  "type": "project.head",
  "payload": {
    "head_server_seq": 1851
  }
}
```

#### `op.accepted`
```json
{
  "type": "op.accepted",
  "payload": {
    "op_id": "...",
    "server_seq": 1851,
    "device_id": "...",
    "client_seq": 88,
    "op_type": "segment.update_text",
    "entity_type": "segment",
    "entity_uid": "..."
  }
}
```

#### `op.rejected`
Validation failure, permission issue, stale impossible rebase, etc.

#### `op.conflicted`
```json
{
  "type": "op.conflicted",
  "payload": {
    "op_id": "...",
    "conflict_id": "...",
    "entity_type": "segment",
    "entity_uid": "...",
    "conflict_type": "stale_segment_text_edit"
  }
}
```

### Conflict lifecycle
- `conflict.created`
- `conflict.updated`
- `conflict.resolved`

### Media/blob lifecycle
- `blob.upload.requested`
- `blob.upload.completed`
- `blob.available`

### Optional edit awareness
These are hints only, not locks:
- `editing.started`
- `editing.updated`
- `editing.stopped`

Use them to lower conflict frequency, not to enforce correctness.

## Heartbeats
Client sends every 15s:

```json
{ "type": "ping" }
```

Server replies:

```json
{ "type": "pong" }
```

If heartbeats stop, mark presence offline.

---

## HTTP sync API

## Push operations
`POST /v1/projects/{project_uid}/ops:push`

Request:

```json
{
  "device_id": "...",
  "ops": [
    {
      "op_id": "...",
      "client_seq": 88,
      "op_type": "segment.update_text",
      "entity_type": "segment",
      "entity_uid": "...",
      "base_versions": {
        "segment:seg_123": 12
      },
      "payload": {
        "new_text": "updated text"
      },
      "client_created_at": "2026-05-16T12:00:00Z"
    }
  ]
}
```

Response:

```json
{
  "accepted": [
    {
      "op_id": "...",
      "client_seq": 88,
      "server_seq": 1851
    }
  ],
  "rejected": [],
  "conflicted": []
}
```

Requirements:
- authenticated user required
- server verifies device ownership and team/project membership before accepting any op
- idempotent on `op_id`
- ordered per device by `client_seq`
- transactional per op
- optionally transactional per batch only for contiguous valid ops

## Pull operations
`GET /v1/projects/{project_uid}/ops:pull?after_server_seq=1850&limit=500`

Response returns canonical accepted ops in order.

## Snapshot bootstrap
`GET /v1/projects/{project_uid}/snapshot`

Returns:
- current materialized project state
- `head_server_seq`
- optional blob manifest

Used for:
- first device sync
- full repair
- large divergence recovery

## Conflict resolution
`POST /v1/projects/{project_uid}/conflicts/{conflict_id}:resolve`

Resolution modes:
- `accept_server`
- `apply_client_override`
- `manual_merge`
- `duplicate_entity`

---

## Local client changes required

## Phase-zero local schema additions
Before real sync, add these to local SQLite:

### Add stable ids and versions
Add to syncable local tables:
- `uid TEXT UNIQUE NOT NULL`
- `version INTEGER NOT NULL DEFAULT 1`
- `updated_at TEXT NOT NULL`
- `deleted_at TEXT NULL` where tombstones matter

### Add sync metadata tables

#### `sync_device`
| Column | Type | Notes |
|---|---|---|
| `device_id` | text pk | stable UUID |
| `created_at` | text | |

#### `sync_project`
| Column | Type | Notes |
|---|---|---|
| `project_uid` | text unique | server identity |
| `last_pulled_server_seq` | integer | |
| `last_acked_client_seq` | integer | |
| `sync_state` | text | healthy, needs_repair, conflicted |
| `last_sync_at` | text null | |

#### `sync_outbox`
| Column | Type | Notes |
|---|---|---|
| `op_id` | text pk | |
| `project_uid` | text | |
| `device_id` | text | |
| `client_seq` | integer | |
| `op_type` | text | |
| `entity_type` | text | |
| `entity_uid` | text null | |
| `base_versions_json` | text | |
| `payload_json` | text | |
| `status` | text | pending, sent, acked, conflicted |
| `created_at` | text | |

#### `sync_inbox`
Optional dedupe table for received ops.

#### `sync_conflict`
Local cache of open conflicts for UI.

## Client write path after sync is introduced
Every mutating command should:

1. open local transaction
2. validate current local state
3. apply domain mutation locally
4. increment touched entity versions
5. append sync op to `sync_outbox`
6. commit
7. notify sync worker

This mirrors the backend-first approach already recommended for undo.

---

## Operation catalog
Below is the recommended first-class sync operation list.

## Project and interview
- `project.rename`
- `project.settings.update`
- `interview.create`
- `interview.update_fields`
- `interview.delete`
- `interview.set_audio_blob`
- `interview.clear_audio_blob`
- `interview.replace_transcript`

## Speakers
- `speaker.create`
- `speaker.rename_display`
- `speaker.merge`
- `speaker.delete`

## Segments
- `segment.create`
- `segment.update_text`
- `segment.set_speaker`
- `segment.split`
- `segment.merge`
- `segment.delete`
- `segment.reorder`

## Codebook
- `cluster.create`
- `cluster.update_fields`
- `cluster.delete`
- `cluster.reorder`
- `category.create`
- `category.update_fields`
- `category.move`
- `category.delete`
- `category.reorder`
- `tag.create`
- `tag.update_fields`
- `tag.move`
- `tag.delete`
- `tag.reorder`

## Tagging
- `span.create`
- `span.update_offsets`
- `span.delete`
- `span_tag.attach`
- `span_tag.detach`
- `memo.upsert`
- `memo.delete`

## AI
- `ai_run.create`
- `ai_run.update_status`
- `proposal.create`
- `proposal.accept`
- `proposal.reject`

Note: several current IPC commands may remain as UI/backend commands, but sync should normalize them into this smaller op vocabulary.

---

## Ordering strategy
Current local tables use integer `order_index`. That is fine locally, but weak for concurrent remote reorders.

## Recommendation
Use **fractional order keys** on the server and eventually on the client.

Examples:
- `a0`
- `a1`
- `a1V`
- `a2`

When inserting between two neighbors, generate a key between them.

Benefits:
- avoids mass renumbering
- concurrent inserts are easier to merge
- list operations become more stable across devices

Local SQLite can still materialize contiguous indexes after pull if the UI prefers that.

---

## Tombstones and deletion
Hard delete is dangerous in sync.

## Rule
For syncable domain entities, prefer:
- soft delete / tombstone on server first
- eventual hard cleanup later

This matters because an offline device may reference a recently deleted entity.

Recommended tombstone fields:
- `deleted_at`
- `deleted_by_op_id`

Special cases:
- `span_tag` can stay hard-deletable because it is a pure link with set semantics
- larger entities like `segment`, `tag`, `category`, `interview` should tombstone first

---

## Media sync
Do not treat media files like row mutations.

## Approach
1. client computes hash
2. asks server if blob already exists
3. if absent, uploads to object storage
4. server returns `blob_id`
5. normal operation links interview to `blob_id`

This separates:
- file transport
- project mutation log

It also avoids replaying huge binary payloads through WebSockets.

---

## Realtime behavior expectations by phase

| Capability | Phase 1 | Phase 2 | Phase 3 | Phase 4 | Phase 5 |
|---|---:|---:|---:|---:|---:|
| Same project on two devices | yes | yes | yes | yes | yes |
| Offline local edits | local only | yes | yes | yes | yes |
| Background push/pull | limited | yes | yes | yes | yes |
| WebSocket push | no | no | yes | yes | yes |
| Presence | no | no | yes | yes | yes |
| Conflict detection | minimal | yes | yes | yes | yes |
| Conflict resolution UI | no | basic | basic | solid | solid |
| Concurrent transcript editing | no | detect only | detect only | partial lock hints | maybe richer later |

---

## Implementation phases

## Phase 1 - Prepare the local model for sync
Goal: make future sync possible without yet introducing a server dependency for correctness.

### Deliverables
- add `uid` to all syncable local entities
- add local `version` columns
- add local sync metadata tables (`sync_device`, `sync_project`, `sync_outbox`, `sync_conflict`)
- convert writes to append normalized sync ops into `sync_outbox`
- add migration for existing projects
- add tests proving ops are generated deterministically

### Important details
- existing integer IDs stay temporarily for local query simplicity
- every create operation must generate `uid` locally
- every mutation must know which entity versions it touched
- every delete must decide whether local tombstones are required

### Success criteria
- any local project can generate a complete ordered op stream from new writes
- app remains fully offline-capable
- no server required yet

### Reevaluation after Phase 1
Ask:
- Are all mutations expressible as normalized ops?
- Did any current command leak too much implicit behavior?
- Which operations still mutate too much state at once?
- Do we need to split commands before server sync starts?

If the answer shows too much hidden side-effect complexity, pause and simplify the mutation model before Phase 2.

## Phase 2 - Add PostgreSQL sync server and delayed sync
Goal: support multi-device sync without realtime yet.

### Deliverables
- PostgreSQL schema from this document
- authentication, team membership, device registration, and project registration
- snapshot bootstrap endpoint
- push/pull ops endpoints
- blob upload handshake
- server-side materialized state + append-only `project_op`
- conflict detection for stale operations
- initial conflict UI for explicit failures

### Scope limits
- no WebSocket requirement yet
- acceptable if users must tap sync manually or sync on interval
- same-segment concurrent text edits may conflict and require manual resolution

### Success criteria
- laptop A offline edits sync to laptop B later
- only authenticated team members can access team projects
- no silent data loss
- repeated pushes are idempotent
- same project can recover from interrupted sync

### Reevaluation after Phase 2
Ask:
- Did long-offline reconnection behave safely in tests?
- Are auth and team checks simple enough to reason about?
- Are there too many conflicts for harmless edits?
- Are reorder operations stable enough?
- Is manual conflict resolution understandable?

If harmless operations conflict too often, improve op granularity or rebase logic before Phase 3.

## Phase 3 - Add realtime delivery with WebSockets
Goal: make sync feel live when devices are online together.

### Deliverables
- authenticated WebSocket connection endpoint
- `hello`, `project.head`, `op.accepted`, `op.conflicted`, presence events
- sync worker that wakes immediately on WS notifications
- presence and optional edit-awareness hints
- reconnect and catch-up logic from `last_seen_server_seq`

### Important constraint
Realtime does **not** replace the push/pull protocol. It accelerates it.

### Success criteria
- codebook and tagging changes appear on another online device within seconds
- presence reflects who is in the project
- reconnect after sleep/network drop catches up cleanly

### Reevaluation after Phase 3
Ask:
- Is WS only a transport hint, or did correctness accidentally depend on it?
- Are reconnects reliable?
- Do presence/editing hints reduce conflicts in practice?
- Is server fanout volume acceptable?

If reconnect correctness is fragile, harden pull/cursor logic before adding more realtime features.

## Phase 4 - Harden offline divergence and conflict resolution
Goal: directly address the two-offline-laptops problem.

### Deliverables
- robust rebase rules for field-disjoint updates
- deterministic handling for reorder and move operations
- conflict resolver UI with side-by-side server/client state
- per-entity resolution actions
- repair flow using snapshot + replay if local state drifts
- extensive simulation tests for week-long offline divergence

### Required test matrix
- both devices rename same tag differently
- one device edits segment text, other adds span in same segment
- one device splits a segment, other updates same segment text
- one device deletes tag, other attaches it to a span
- both devices reorder categories independently
- one device uploads audio while another edits transcript metadata

### Success criteria
- no silent overwrite in divergence scenarios
- conflicts are explicit and recoverable
- repair from snapshot does not corrupt local data

### Reevaluation after Phase 4
Ask:
- Are transcript conflicts frequent enough to justify stronger edit coordination?
- Are users resolving conflicts successfully without support?
- Do we need soft locks or edit leases on interviews/segments?
- Is the safety model strong enough to ship broadly?

If transcript conflicts remain painful, Phase 5 should focus on coordination before CRDTs.

## Phase 5 - Add edit coordination and higher-confidence collaboration
Goal: reduce conflict frequency for active concurrent work.

### Deliverables
- optional short-lived edit leases on interview or segment scope
- UI warnings like "Alex is editing this segment"
- delayed commit or confirm-on-override behavior for risky concurrent edits
- optional auto-refresh of stale views before editing

### Suggested lease model
- advisory, not absolute
- expires automatically
- stored in `project_presence` or dedicated `edit_lease`
- override allowed, but visible

### Success criteria
- far fewer same-segment text conflicts
- users understand who is editing what
- online collaboration feels trustworthy

### Reevaluation after Phase 5
Ask:
- Did coordination reduce conflicts enough?
- Is explicit lease UX acceptable?
- Is full CRDT text editing still necessary?

Only if the answer is still no should you consider Phase 6.

## Phase 6 - Optional: CRDT or OT for segment text
Goal: support simultaneous editing of the same transcript text with automatic merge.

### Warning
This is a major complexity jump.

You would need:
- a different text model per segment
- mapping between text ops and span offsets
- rebasing or CRDT-aware span anchoring
- new persistence logic for `segment_split` / `segment_merge`

### Recommendation
Do not do this unless real usage proves it is necessary.

For Faden, segment-level coordination plus explicit conflict resolution may be enough.

### Reevaluation after Phase 6
Ask:
- Did complexity meaningfully improve user outcomes?
- Did tagged span anchoring remain trustworthy?
- Is the operational burden worth it?

If not, roll back to simpler guarded segment editing.

---

## Specific answer to the offline two-laptop fear
Yes, it is possible to support this safely.

But the safe promise should be:

- both laptops can work offline for a long time
- both will sync later without silent loss
- harmless independent edits will merge automatically
- risky concurrent edits will be surfaced as conflicts
- transcript text edited concurrently in the same segment will not be auto-merged at first

That is a strong and honest system.

The unsafe promise would be:

- "everything merges automatically"

Do not promise that until you have a true text-collaboration engine.

---

## Recommended first shipping promise
When this ships to real users, the product promise should be:

- **offline-first multi-device sync**
- **near-realtime updates when online**
- **no silent overwrites**
- **clear conflict handling for concurrent transcript edits**

That is achievable with PostgreSQL, a sync op log, WebSockets, and careful conflict rules.
