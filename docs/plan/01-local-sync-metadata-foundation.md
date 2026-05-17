# Phase 01 — Local sync metadata foundation

## Objective

Prepare the local SQLite model so every future syncable entity has stable identity and version metadata.

## Scope

- Add `uid` to all syncable entities.
- Add `version`, `updated_at`, and `deleted_at` where tombstones matter.
- Add local sync metadata tables:
  - `sync_device`
  - `sync_project`
  - `sync_conflict`
- Keep existing local integer IDs for now.

## Implementation

1. Inventory all syncable tables:
   - project
   - interview
   - speaker
   - segment
   - cluster
   - category
   - tag
   - tagged span
   - memo
   - optional AI/proposal tables
2. Add `uid TEXT UNIQUE NOT NULL` to each syncable table.
3. Add `version INTEGER NOT NULL DEFAULT 1` to each syncable table.
4. Add `updated_at` to each syncable table.
5. Add `deleted_at` to entities that should tombstone instead of hard-delete.
6. Create `sync_device` with a stable per-install `device_id`.
7. Create `sync_project` to track per-project sync cursor and health.
8. Create `sync_conflict` as a local cache for future conflict UI.
9. Centralize UID generation in one backend utility.

## Design rules

- `uid` becomes the sync identity everywhere.
- Local integer IDs remain internal only.
- New entities must always get a UID at creation time.
- Deletion policy must be explicitly decided per entity.

## Acceptance criteria

- All syncable rows have stable global IDs.
- New writes always create a UID.
- Versions exist on all syncable rows.
- App remains fully offline-capable.
- No server dependency is introduced yet.

## Risks to watch

- Hidden tables or link entities missed in migration.
- Existing code paths that create rows outside the main write flow.
- Ambiguity around which entities need tombstones.
