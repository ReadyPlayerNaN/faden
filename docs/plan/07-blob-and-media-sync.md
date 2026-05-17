# Phase 07 — Blob and media sync

## Objective

Add safe media synchronization without pushing large binaries through the operation log.

## Scope

- Blob existence check by hash.
- Object-storage upload flow.
- Server blob metadata tables.
- Linking blobs to project entities via normal ops.

## Implementation

1. Create blob metadata tables:
   - `blob`
   - optional `interview_blob_link`
2. Implement client hash computation for media files.
3. Implement blob handshake flow:
   1. client sends hash/size metadata
   2. server reports whether blob already exists
   3. if absent, client uploads to object storage
   4. server returns `blob_id`
   5. client emits normal op linking entity to `blob_id`
4. Keep binary transfer out of WebSocket and operation payloads.
5. Define auth rules for blob upload/download identical to project access rules.
6. Handle retry and dedupe by `sha256`.
7. Add failure states for partially uploaded or abandoned blobs.

## Design rules

- Media transport is separate from project mutation sync.
- Linking a blob to an entity is the only part that belongs in the op log.
- Blob access must respect the same tenancy model as the rest of sync.

## Acceptance criteria

- Large media files sync without inflating op payloads.
- Duplicate uploads are avoided when the same hash already exists.
- Interview audio can be attached on one device and recognized on another after sync.
- Blob failures do not corrupt project state.

## Risks to watch

- Race conditions around upload completion vs entity linking.
- Unauthorized blob access paths.
- Cleanup of orphaned partial uploads.
