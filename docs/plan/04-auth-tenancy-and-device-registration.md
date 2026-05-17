# Phase 04 — Auth, tenancy, and device registration

## Objective

Introduce the cloud identity model correctly from the start: authenticated users, team-owned projects, and registered devices.

## Scope

- User authentication.
- Team membership model.
- Project ownership by team.
- Device registration and validation.
- Authorization checks shared by HTTP and WebSocket entry points.

## Implementation

1. Implement server tables and models for:
   - `user_account`
   - `team`
   - `team_member`
   - `device`
   - `project`
   - optional `project_member`
2. Choose the initial auth mechanism and token format.
3. Add device registration flow:
   - app authenticates user
   - app registers `device_id`
   - server binds device to authenticated user
4. Enforce authorization rules:
   - every sync request is authenticated
   - every request runs in a team context
   - project access is checked before data access
5. Define initial role model:
   - team roles: `owner`, `member`
   - project role: `editor`
6. Add revocation/disable handling for users and devices.
7. Add audit-friendly timestamps and actor fields where needed.

## Design rules

- Do not build a user-owned server first and migrate later.
- Never trust `device_id` without authenticated user binding.
- Use the same authorization logic for HTTP, WebSocket, and blob access.

## Acceptance criteria

- Only authenticated team members can access team projects.
- Devices are registered and ownership is verified on every sync path.
- Revoked users/devices cannot continue syncing.
- Auth and tenancy checks are simple enough to reason about in tests.

## Risks to watch

- Splitting auth logic across endpoints.
- Hidden assumptions that a project belongs to one user instead of a team.
- Missing device revocation handling.
