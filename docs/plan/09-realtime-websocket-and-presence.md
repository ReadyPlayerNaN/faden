# Phase 09 — Realtime WebSocket and presence

## Objective

Make online collaboration feel live by adding authenticated WebSocket delivery, presence, and fast catch-up.

## Scope

- Authenticated project WebSocket endpoint.
- Presence tracking.
- Realtime notifications for accepted ops and conflicts.
- Client reconnect and catch-up logic.

## Implementation

1. Implement `GET /v1/projects/{project_uid}/ws`.
2. Require bearer auth plus verified `device_id` binding.
3. Support client `hello` payload with:
   - `project_uid`
   - `device_id`
   - `last_seen_server_seq`
   - subscriptions for presence/ops/conflicts
4. Implement initial server events such as:
   - `hello.ok`
   - `project.head`
   - `op.accepted`
   - `op.conflicted`
   - presence updates
   - heartbeats
5. Persist/update `project_presence` on connection and heartbeat.
6. Wake the client sync worker immediately on relevant WS notifications.
7. On reconnect, always catch up through normal pull using `last_seen_server_seq`.
8. Add backoff, reconnect, and stale-connection handling.

## Design rules

- WebSocket is a low-latency transport hint, not the mutation protocol.
- Correctness must still come from push/pull and canonical ops.
- Presence is advisory, not a lock by itself.

## Acceptance criteria

- Online devices see changes within seconds.
- Presence reflects who is active in a project.
- Sleep/network drops recover cleanly via pull catch-up.
- No correctness bug depends on a WebSocket-only path.

## Risks to watch

- Duplicating logic between WS delivery and HTTP pull.
- Reconnect loops causing stale cursor bugs.
- Presence noise or heartbeat load that does not scale well.
