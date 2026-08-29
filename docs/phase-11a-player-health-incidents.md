# Stage 11A — Player Health History and Incident Operations

Stage 11A closes the remaining approved player-health observability gap before wider retail and school pilots. It preserves the existing 30-second heartbeat and 90-second offline rule, adds sampled history, and provides a platform-admin incident workflow without introducing remote device commands.

## Delivered foundation

- One heartbeat sample per player per five-minute bucket, with recovery samples promoted in the same bucket.
- Bounded operational diagnostics: app version, manifest version, and allow-listed source status only.
- A continuously running operations worker that detects enrolled players beyond the existing offline threshold.
- One unresolved missed-heartbeat incident per player, with time-based LOW, MEDIUM, HIGH, and CRITICAL escalation.
- Automatic incident resolution when the enrolled player heartbeat resumes.
- Super Admin and Support access to an operational dashboard with current offline counts, unresolved incidents, critical incidents, acknowledgement, and resolution notes.
- Audit records for incident creation, escalation, acknowledgement, manual resolution, and automatic recovery.

## Safety boundary

This stage observes heartbeat availability and records operator actions. It does not restart, mute, disable, replace, or re-enrol a player; alter a channel or schedule; send external notifications; or modify playback/content records. Heartbeat samples intentionally exclude request IP addresses, user-agent history, customer content, and school/student data.

## Incident rules

- The existing player is still considered online through 90 seconds after its last heartbeat.
- The operations worker opens an incident only after that boundary has passed.
- Severity becomes MEDIUM after five minutes, HIGH after fifteen minutes, and CRITICAL after sixty minutes of confirmed offline time.
- Only one OPEN or ACKNOWLEDGED missed-heartbeat incident may exist for a player.
- Acknowledgement requires an operator note and may occur only once.
- Resolution requires an operator note; a returning heartbeat may also resolve the incident automatically with system evidence.

## Routes and worker

- `GET /api/admin/players/health`
- `PATCH /api/admin/players/health/:incidentId`
- `npm run worker:operations`

Both routes require a platform Super Admin or Support session. The production launcher starts the operations worker whenever `DATABASE_URL` is configured. Multiple processes remain safe because the database prevents duplicate unresolved heartbeat incidents.

## Database migration

`20260923000000_stage_11a_player_health_incidents` creates `PlayerHeartbeatSample`, `PlayerHealthIncident`, four supporting enums, evidence checks, reporting indexes, and the single-unresolved-incident invariant. The migration is additive and does not rewrite existing players or heartbeat timestamps.

## Verification

1. Validate and generate the Prisma client.
2. Apply all migrations to a clean PostgreSQL database.
3. Run unit tests for bucketing, privacy-safe diagnostics, thresholds, severity, transitions, and summary metrics.
4. Run route-security tests for the new platform-admin endpoints.
5. Run the full unit suite and production build.
6. On staging, stop one enrolled test player, confirm incident creation/escalation, acknowledge it, restart the player, and confirm automatic resolution plus a RECOVERY sample.

## Rollback

The admin panel, API routes, and operations worker can be disabled without affecting playback. Once heartbeat or incident evidence exists, retain the new tables and roll back only the application surfaces. Before evidence exists, the new tables and enums may be removed in dependency order. Never delete or re-enrol players as part of this rollback.

## Next smallest safe milestone

Stage 11B should add expiring, acknowledged player diagnostic commands and replacement/revoke controls. It must remain separate because remote commands change device state and require stronger compatibility, authorization, and rollback testing.

