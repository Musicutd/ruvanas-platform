# Stage 10B — Controlled Retention and Pilot Readiness

Stage 10B turns the Stage 10A retention preview into a controlled school-operations workflow without adding deletion. Organisation owners and managers can review aggregate candidate counts, place or release safeguarding and legal holds, and complete a supervised pilot-readiness checklist.

## Delivered foundation

- Aggregate candidate counts for raw audio takes and consent evidence older than the approved safeguarding periods.
- Organisation-wide or record-specific holds for episodes, contributors, and media assets.
- Tenant validation before a record-specific hold can be created.
- Explicit, reasoned hold release rather than deletion of a hold record.
- An operational checklist covering staff training, emergency withdrawal, retention review, support contacts, and recovery.
- Readiness derived by the server from the checklist, approved safeguarding status, and configured retention periods.
- Audit events for checklist updates, hold creation, and hold release.

## Safety boundary

This stage cannot delete, archive, anonymise, or alter a school recording, consent record, contributor, episode, or media file. Candidate counts are previews only and never return student identities. A hold preserves operational intent; releasing a hold only closes that hold and does not mutate the referenced record.

Automatic retention execution remains excluded. A future executor would require separately approved legal policy, dry-run evidence, exclusions for active holds, explicit manager approval, recoverability, and independent acceptance testing.

## Pilot-readiness rules

The status is calculated rather than freely selected:

- `IN_PROGRESS`: one or more operational checklist items remain incomplete.
- `BLOCKED`: the checklist is complete, but safeguarding is not approved or a retention period is missing.
- `READY`: every checklist item is complete, safeguarding is approved, and both raw-recording and consent-evidence retention periods are configured.

Active holds do not block a pilot. They are surfaced so the school can see preserved records and operational obligations before launch.

## Routes

- `GET /api/school-radio/pilot-readiness`
- `PATCH /api/school-radio/pilot-readiness`
- `POST /api/school-radio/retention-holds`
- `PATCH /api/school-radio/retention-holds/:holdId`

All routes require an active School Radio entitlement and an organisation owner or manager role. Organisation scope comes from the authenticated session, never from request input.

## Database migration

`20260921000000_stage_10b_controlled_retention_pilot_readiness` creates:

- `SchoolRetentionHold`, including scope, optional tenant-verified reference, create/release actors, reasons, and timestamps;
- `SchoolPilotReadiness`, including the five checklist confirmations, derived status, notes, responsible manager, and readiness timestamp.

## Verification

Before release:

1. Validate the Prisma schema and generate the client.
2. Run unit tests for hold validation, derived readiness, privacy language, and non-destructive preview guarantees.
3. Run route-security integration tests against an isolated database.
4. Run a production build.
5. Apply the migration before serving the application version.

## Rollback

The dashboard and APIs can be removed without affecting School Radio publishing. The tables should be retained while any hold or readiness history remains operationally relevant. If a database rollback is required, export and review active holds first; never interpret rollback as authority to delete referenced school records.
