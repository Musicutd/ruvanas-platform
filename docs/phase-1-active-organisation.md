# Phase 1: active organisation context

This slice removes implicit first-membership selection from client workflows.

## Behaviour

- Every new session stores an explicit active organisation when the user has a membership.
- Existing sessions are backfilled deterministically during migration.
- Multi-organisation users can switch workspaces from the client dashboard.
- A switch is accepted only when the current user belongs to the target organisation.
- The session update and audit record are committed in one database transaction.
- Dashboard and station workflows resolve resources through the active organisation.

## Security invariant

An organisation identifier supplied by the browser never grants access. The platform verifies the current session's `(userId, organisationId)` membership before changing context or accessing organisation-owned resources.

