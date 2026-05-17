# Phase 08 — Conflict detection and resolution UI

## Objective

Detect stale or ambiguous operations safely and give users an explicit, recoverable resolution flow.

## Scope

- Server conflict classification and storage.
- Client handling for accepted, rejected, and conflicted ops.
- Initial conflict resolution API integration.
- Basic conflict resolver UI.

## Implementation

1. Implement server conflict classes:
   - safe/idempotent auto-merge
   - field-disjoint auto-merge
   - structural rebase where deterministic
   - explicit conflict for ambiguous text/structural cases
2. On conflict, store:
   - conflicted op
   - entity type / entity UID
   - server state snapshot
   - conflict type / status
3. Implement conflict responses in `ops:push` and future events.
4. Implement `POST /v1/projects/{project_uid}/conflicts/{conflict_id}:resolve`.
5. Support resolution modes:
   - `accept_server`
   - `apply_client_override`
   - `manual_merge`
   - `duplicate_entity`
6. Build a local conflict view backed by `sync_conflict`.
7. Build initial resolver UI with side-by-side client/server information.
8. Emit a normal follow-up op when a conflict is resolved.

## Design rules

- No silent overwrite of concurrent risky edits.
- Same-segment concurrent transcript text edits are conflicts in the first version.
- Conflict resolution is part of normal product flow, not an admin-only escape hatch.

## Acceptance criteria

- Stale conflicting ops become explicit conflict records.
- Users can understand what happened and choose a resolution.
- Conflict resolution produces a canonical follow-up operation.
- The client can recover without manual database intervention.

## Risks to watch

- Resolver UI that exposes raw internal payloads without enough context.
- Too many false-positive conflicts for harmless edits.
- Resolution flows that bypass auditability.
