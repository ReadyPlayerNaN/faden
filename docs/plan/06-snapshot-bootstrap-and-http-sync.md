# Phase 06 — Snapshot bootstrap and HTTP sync

## Objective

Ship the first real multi-device sync path using snapshot bootstrap plus delayed HTTP push/pull.

## Scope

- Initial project bootstrap from server snapshot.
- Push local ops to server.
- Pull accepted canonical ops from server.
- Update local and server cursors.
- Idempotent retry behavior.

## Implementation

1. Implement `GET /v1/projects/{project_uid}/snapshot`.
2. Define snapshot payload to include:
   - full materialized project state
   - `head_server_seq`
   - optional blob manifest
3. Implement `POST /v1/projects/{project_uid}/ops:push`.
4. Enforce push rules:
   - authenticated user required
   - device ownership verified
   - project/team access verified
   - ordered per device by `client_seq`
   - idempotent on `op_id`
   - transactional op acceptance
5. Implement `GET /v1/projects/{project_uid}/ops:pull?after_server_seq=...`.
6. Build a client sync worker that can:
   - bootstrap from snapshot
   - send pending outbox ops
   - ack accepted ops
   - pull new canonical ops
   - update `last_pulled_server_seq` and `last_acked_client_seq`
7. Support manual sync first, then interval/background sync.
8. Handle interrupted sync by safe retry, not manual repair.

## Design rules

- HTTP push/pull is the correctness foundation.
- WebSockets must not be required for correctness.
- Accepted ops from pull are canonical, even for the originating device.

## Acceptance criteria

- Laptop A can edit offline and sync later to laptop B.
- Repeated pushes do not duplicate accepted operations.
- Interrupted sync resumes safely.
- First-time device bootstrap works from snapshot alone.

## Risks to watch

- Ambiguous cursor advancement.
- Batch semantics that make partial failure hard to reason about.
- Applying local optimistic state differently from canonical pulled state.
