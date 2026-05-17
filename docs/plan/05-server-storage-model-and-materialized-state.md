# Phase 05 — Server storage model and materialized state

## Objective

Build the PostgreSQL persistence model that combines canonical relational state with an append-only operation log.

## Scope

- `project_op` append-only log.
- Project/device sync cursors.
- Materialized state tables for project entities.
- Presence/conflict persistence scaffolding.
- Ordering and tombstone strategy.

## Implementation

1. Create sync-state tables:
   - `project_cursor`
   - `project_presence`
   - `project_conflict`
2. Create `project_op` with constraints for:
   - unique `op_id`
   - unique `(project_id, device_id, client_seq)`
   - indexed `(project_id, server_seq)`
3. Add materialized state tables mirroring the local domain:
   - interview
   - speaker
   - segment
   - cluster/category/tag
   - tagged span
   - span-tag link
   - memo
   - optional AI/proposal state
4. Add shared sync metadata to syncable server tables:
   - `uid`
   - `project_id`
   - `version`
   - `created_at`
   - `updated_at`
   - `deleted_at`
   - `last_op_id`
5. Use `order_key` for reorderable entities instead of integer-only ordering.
6. Use tombstones for entities where offline references are likely.
7. Define server transaction boundaries for:
   - append op
   - mutate materialized state
   - advance project head sequence

## Design rules

- The server stores both current state and operation history.
- `server_seq` is the canonical project ordering cursor.
- `version` is the per-entity optimistic concurrency signal.
- Hard deletes are avoided for major syncable entities.

## Acceptance criteria

- Server schema supports efficient reads and safe replay.
- Reorderable entities can evolve without mass renumbering.
- Deleted entities can be represented safely for offline clients.
- The storage model is ready for snapshot, push/pull, and conflict tracking.

## Risks to watch

- Missing sync metadata on one state table.
- Overusing hard deletes.
- Designing server tables too tightly around current local integer IDs.
