# Stage 10C — School Pilot Operations and Incident Readiness

Stage 10C turns the Stage 10B readiness decision into a supervised operating record. Organisation owners and managers can plan a bounded pilot, start or resume it only while the server derives a current `READY` state, record drills and incidents, and preserve acknowledgement and resolution evidence.

## Delivered foundation

- Tenant-scoped pilot runs with planned, active, paused, completed, and cancelled states.
- A maximum 90-day planned window and a database rule allowing only one active or paused pilot per organisation.
- Current-readiness enforcement before a pilot can start or resume.
- Aggregate readiness snapshots stored when operations start or resume; no checklist notes, student details, or record identities are copied into the snapshot.
- Privacy-safe operational drills with category, severity, outcome, summary, evidence, time, and manager attribution.
- Incident records with open, acknowledged, and resolved states plus manager response and recovery notes.
- Audit events for pilot creation and every run or incident transition.
- A manager-only dashboard showing current operations, planned pilots, open incidents, critical incidents, and drill history.

## Safety boundary

This stage records operational evidence only. It cannot withdraw an episode, change a publication policy, contact external parties, shut down a service, delete data, or execute retention. Text fields instruct managers to use privacy-safe summaries and not enter student identities.

Emergency procedures remain human-led. The dashboard records that a drill or response occurred; it is not evidence that an external regulator, emergency service, parent, distributor, or support provider was contacted unless the organisation preserves that evidence through its separately approved process.

## State rules

- `PLANNED` can move to `ACTIVE` or `CANCELLED`.
- `ACTIVE` can move to `PAUSED`, `COMPLETED`, or `CANCELLED`.
- `PAUSED` can move to `ACTIVE`, `COMPLETED`, or `CANCELLED`.
- `COMPLETED` and `CANCELLED` are terminal.
- Starting and resuming require the current Stage 10B readiness result to be `READY`.
- Only one run may be `ACTIVE` or `PAUSED` for an organisation at a time.
- Drills are complete when recorded and require an outcome.
- Incidents begin `OPEN`, may be acknowledged once, and require manager evidence to resolve.

## Routes

- `GET /api/school-radio/pilot-operations`
- `POST /api/school-radio/pilot-operations`
- `PATCH /api/school-radio/pilot-operations/:recordId`

All routes require an active School Radio entitlement and an organisation owner or manager role. The organisation is taken from the authenticated active session and never accepted from the request body.

## Database migration

`20260922000000_stage_10c_school_pilot_operations` creates:

- `SchoolPilotRun`, including the bounded pilot window, controlled status, readiness snapshot, transition reason, and manager attribution;
- `SchoolPilotEvent`, including drill/incident classification, severity, outcome, response, acknowledgement, resolution, and tenant ownership;
- partial uniqueness and check constraints for a single operational pilot, valid time windows, and valid drill outcomes.

The migration is additive and does not alter any School Radio content, publication, safeguarding, retention, student-access, or delivery record.

## Verification

Before release:

1. Validate the Prisma schema and generate the client.
2. Apply every migration to an empty PostgreSQL database in CI.
3. Run unit tests for window limits, readiness gates, state transitions, drill/incident rules, privacy flags, and record-only safety language.
4. Run route-security tests to confirm all new operations reject unauthenticated requests.
5. Run the complete unit suite and a production build.
6. On staging, plan a pilot, prove that a non-ready school cannot start it, start it after readiness passes, record a drill and incident, then acknowledge and resolve the incident.

## Rollback

The dashboard and routes can be removed without affecting School Radio playback or publishing. Once pilot or incident evidence exists, retain the new tables and disable the UI rather than deleting operational history. Before any data is accepted, a database rollback may remove `SchoolPilotEvent`, then `SchoolPilotRun`, followed by the six Stage 10C enums. Never treat rollback as authority to change or delete school content.
