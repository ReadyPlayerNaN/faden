# Phase 03 — Local migration and repair primitives

## Objective

Safely migrate existing local projects and add the minimum machinery needed for future repair and rebootstrap.

## Scope

- Migrate existing rows to stable UIDs and versions.
- Backfill sync metadata for old projects.
- Add local health states and repair entry points.
- Add deterministic tests around migration and replay.

## Implementation

1. Write migrations that backfill `uid`, `version`, and timestamps for existing data.
2. Initialize `sync_device` for existing installs.
3. Initialize `sync_project` rows for existing local projects.
4. Add project sync health states such as:
   - `healthy`
   - `needs_repair`
   - `conflicted`
5. Define local repair primitives:
   - clear/rebuild local sync cursors
   - re-import from snapshot later
   - replay outbox after repair
6. Add tests for:
   - migration from old databases
   - deterministic op generation before and after migration
   - restart/crash safety during local write + outbox append
7. Add lightweight diagnostics for corrupted or incomplete sync metadata.

## Design rules

- Existing users must not lose local-only projects during migration.
- Repair must be possible without manual database edits.
- A damaged sync state should degrade to `needs_repair`, not silent corruption.

## Acceptance criteria

- Existing local databases migrate successfully.
- Migrated projects can continue creating valid outbox operations.
- Local sync metadata can be reset/rebuilt safely.
- Core migration and replay paths are covered by tests.

## Risks to watch

- Legacy rows missing required relationships.
- Migration ordering issues across linked entities.
- Partial migrations leaving invalid version state.
