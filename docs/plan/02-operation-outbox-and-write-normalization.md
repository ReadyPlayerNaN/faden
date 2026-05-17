# Phase 02 — Operation outbox and write normalization

## Objective

Make every local mutation produce a deterministic sync operation in a normalized outbox.

## Scope

- Create `sync_outbox`.
- Convert mutating commands to append normalized ops.
- Define the first operation catalog.
- Ensure entity versions are incremented in the same transaction as the local mutation.

## Implementation

1. Create `sync_outbox` with:
   - `op_id`
   - `project_uid`
   - `device_id`
   - `client_seq`
   - `op_type`
   - `entity_type`
   - `entity_uid`
   - `base_versions_json`
   - `payload_json`
   - `status`
   - `created_at`
2. Add a monotonic per-device `client_seq` allocator.
3. Define canonical payload shapes for the first operation set:
   - project/interview updates
   - speaker updates
   - segment create/update/split/merge/delete/reorder
   - codebook operations
   - tagging operations
   - memo upsert/delete
4. Refactor each mutating command to follow one transaction:
   1. validate local state
   2. apply domain mutation
   3. increment touched versions
   4. append one or more sync ops
   5. commit
5. Normalize broad UI/backend commands into a smaller sync vocabulary.
6. Mark outbox items as `pending` initially.
7. Notify a future sync worker after commit.

## Design rules

- Sync ops are the source of truth for future replication.
- Local side effects must be explicit, not implicit.
- Each op must carry the versions it was based on.
- Replay of the same op must be safe.

## Acceptance criteria

- Every supported mutation produces deterministic outbox entries.
- Repeating the same completed local write does not create ambiguous sync state.
- Versions and outbox writes are committed atomically.
- Operation payloads are stable enough to become API contracts later.

## Risks to watch

- Commands that currently mutate multiple entities with hidden behavior.
- Overly large or UI-shaped op payloads.
- Reorder logic that is not yet stable enough for sync.
