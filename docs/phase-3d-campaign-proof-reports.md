# Phase 3D: Campaign proof reports

Phase 3D gives organisation members a tenant-scoped campaign performance dashboard and durable asynchronous CSV export. It reconciles compiled `PlayoutIntent` records with idempotent device proof events; it never treats a schedule as a confirmed play and never presents playback counts as audience reach.

## Historical attribution

New playout intents snapshot the location ID, location name, IANA timezone, and location-group IDs/names that applied when the insertion was compiled. The migration backfills existing intents from their still-referenced zone before making the snapshot fields required. This keeps later location renames or group reorganisation from silently rewriting new report evidence.

The aggregation window is interpreted in each intent's captured local timezone. Reports are limited to 93 inclusive local calendar days while the product still queries raw evidence directly. A later analytics stage can materialise durable hourly aggregates when measured event volume requires it.

## Reconciliation semantics

- **Planned**: one persisted campaign `PlayoutIntent`.
- **Started**: the intent has at least one verified `STARTED` event.
- **Confirmed complete**: the intent has at least one verified `COMPLETED` event.
- **Failed**: the intent has at least one verified `FAILED` event.
- Duplicate event retries cannot inflate these values because ingestion enforces a globally unique client event ID and report aggregation counts each intent outcome once.
- Location-group detail produces one row for every snapshotted group membership. Summary cards count unique intents, so a location in multiple groups is not double-counted.

## Subscriber access

`/dashboard/reports` resolves the active organisation from the authenticated server session. Owners, managers, content editors, and viewers can read only their selected organisation. Report APIs do not accept a caller-supplied organisation ID.

Routes:

- `GET /api/reports/campaign-proof` returns filters, dimensions, summary metrics, and hourly rows.
- `POST /api/reports/campaign-proof/exports` creates a durable `ReportExportJob` and returns `202 Accepted`.
- `GET /api/reports/campaign-proof/exports/:jobId` returns owner-scoped job status and opportunistically recovers an abandoned lease.
- `GET /api/reports/campaign-proof/exports/:jobId/download` returns the completed CSV through authenticated, no-store delivery.

Exports are generated after the create response using the PostgreSQL-backed job record. The output expires after 24 hours, includes a SHA-256 checksum, neutralises spreadsheet-formula prefixes, and labels every row as `device-confirmed playback` with `Audience measured = No`. Request, completion, and failure transitions are audited.

## Migration and rollback

Migration: `20260827180000_campaign_proof_reports`.

The migration is additive: one enum, four backfilled intent snapshot columns, one supporting index, and the `ReportExportJob` table. The previous application remains compatible with these additions. If application rollout fails, roll back the application release and leave the forward migration applied; create a corrective migration rather than editing migration history.

## Validation

Unit coverage verifies date/range validation, timezone buckets, group attribution, unique-intent reconciliation, CSV evidence labels, and spreadsheet-formula neutralisation. PostgreSQL integration coverage verifies unauthenticated rejection, active-organisation isolation, completed-play reconciliation, asynchronous export processing, cross-tenant job rejection, protected download, and audit completion.

## Next milestone

Phase 3E adds School Radio staff announcements and approved broadcast slots to the shared scheduler, behind the `SCHOOL_RADIO` capability boundary and without exposing student details.

