# Phase 10 — Offline divergence hardening and edit coordination

## Objective

Harden the system for long offline divergence and reduce the frequency of painful concurrent-edit conflicts.

## Scope

- Deterministic rebase rules for more stale-but-safe operations.
- Repair from snapshot + replay.
- Simulation coverage for two-offline-device scenarios.
- Advisory edit coordination and stale-view warnings.

## Implementation

1. Expand deterministic server rebase rules for:
   - field-disjoint updates
   - reorder/move operations
   - selected structural operations where correctness is provable
2. Build repair flow:
   - fetch fresh snapshot
   - rebuild local materialized state
   - replay unresolved local outbox where valid
3. Add simulation/integration tests for long offline divergence, including:
   - same tag renamed differently
   - same segment text edited concurrently
   - split vs text edit on same segment
   - tag deletion vs later attachment
   - independent category reorder
   - audio upload plus metadata edits
4. Add advisory edit coordination:
   - optional short-lived edit leases or focus hints
   - “someone is editing this segment” warnings
   - optional refresh-before-edit for stale views
   - visible override when a user proceeds anyway
5. Measure whether coordination reduces conflict frequency enough.
6. Keep CRDT/OT explicitly out of scope unless real usage proves it necessary.

## Design rules

- Promise lossless conflict detection, not magical merge of all transcript edits.
- Coordination is advisory and expiring, not a hard global lock.
- Repair must be routine and safe.

## Acceptance criteria

- Long-offline reconnection is explicit and recoverable.
- No silent overwrite occurs in tested divergence scenarios.
- Users get useful warnings before risky concurrent edits.
- The product is ready for a realistic first shipping promise.

## Deferred follow-up

If this still leaves transcript collaboration too painful, evaluate a separate future phase for CRDT/OT-based segment text editing.

## Risks to watch

- Overcomplicated rebase rules that are hard to trust.
- Advisory lease UX that annoys users without reducing conflicts.
- Premature CRDT work before measuring actual need.
