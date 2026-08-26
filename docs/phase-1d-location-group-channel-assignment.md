# Stage 1D: location-group channel assignment

## Purpose

This milestone implements the master build specification's requirement for a previewable bulk operation across locations while preserving the existing Organisation -> LocationGroup -> Location -> Zone -> Channel hierarchy.

## Behaviour

- A platform administrator selects one non-archived channel owned by the location group's organisation.
- The page shows a client-side impact preview for every location and zone in the group.
- The operator must run a server-verified dry run before the confirmation control is enabled.
- The apply request recalculates the plan inside a serializable database transaction; it never trusts the browser's preview.
- Zones already using exactly the selected channel are unchanged.
- Other active assignments are closed and the selected channel is created or safely reactivated.
- Duplicate active assignments are repaired by closing them before the new effective assignment is applied.
- The operation records a location-group summary audit and one audit record for each changed zone.

## API and UI

- `POST /api/admin/location-groups/:groupId/channel`
  - `{ channelId, dryRun: true }` returns authoritative counts without writing.
  - `{ channelId }` applies the recalculated plan atomically.
- `/admin/location-groups/:groupId` now includes the impact table, dry-run verification, and confirmation workflow.

## Security and validation

- The existing platform-admin policy protects both preview and apply requests.
- Zod validates the request body.
- The channel must belong to the group's organisation and must not be archived.
- Group membership resolves target zones server-side, so browser-supplied zone or organisation identifiers cannot expand the operation.
- Groups without zones are rejected.

## Database and rollback

No schema migration is required. The feature reuses `ChannelAssignment` history and `AuditLog`.

Application rollback is safe because no existing data is deleted. Assignments made before rollback remain valid and can still be changed using the existing single-zone workflow.

## Verification

- Pure tests cover flattening, impact counts, idempotency, and duplicate-active-assignment repair planning.
- Route-level PostgreSQL integration coverage verifies authentication, privilege denial, a non-writing dry run, atomic apply, idempotent repeat, and audit creation.
- Required release gates: dependency audit, unit tests, GitHub CI database/integration suite, production build, Render staging smoke, then production deployment verification.

