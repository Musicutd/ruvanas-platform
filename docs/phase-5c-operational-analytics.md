# Stage 5C — Shared operational analytics and protected exports

Stage 5C adds a tenant-scoped operational view across Retail Radio and School Radio without replacing the existing campaign proof report. It materialises durable hourly evidence so the new dashboard does not repeatedly scan raw playback events.

## Delivered scope

- `AnalyticsHourlyAggregate` stores per-player hourly counts with historical player, location, and zone labels.
- `AnalyticsAggregationCursor` consumes `PlayoutIntent` and `ProofOfPlayEvent` records once, in stable creation/receipt order, under a per-organisation database lock.
- Player heartbeats increment hourly aggregate evidence transactionally with the existing last-heartbeat update.
- `/dashboard/analytics` presents planned insertions, device-confirmed playback, failures, current player health, heartbeat coverage, storage, content totals, and aggregate-only School Radio learning/moderation counts.
- `/api/reports/operational` resolves the active organisation server-side and accepts a maximum 93-day range.
- Owners and managers can request an asynchronous CSV. The download remains session-protected, carries an expiring HMAC signature, expires after 24 hours, and is audited on request, completion, or failure.

## Evidence and privacy boundaries

- Playback counts are device-confirmed operational events, not listeners, audience, impressions, or reach.
- Historical heartbeat coverage begins with this release. The application does not invent uptime for periods before hourly heartbeat aggregation existed.
- School metrics expose counts only. Student contributor identities, assessment notes, scores, rankings, and portfolio content are excluded.
- All reads and exports are scoped to the authenticated session's active organisation. Viewers and content editors may read aggregate dashboards; only organisation owners and managers may export them.
- Aggregate retention is intentionally non-destructive until territory and contract-specific retention periods are approved. This migration does not delete raw or historical data.

## Migration and rollback

Migration: `20260902000000_stage_5c_operational_analytics`.

The migration only creates two tables, non-negative/hour-bucket constraints, supporting indexes, and organisation foreign keys. Existing data is untouched. If the release must be rolled back, deploy the previous application and leave the additive tables in place; use a new corrective migration for any later schema change.

## Validation requirements

- Prisma format and validation.
- Clean PostgreSQL migration deployment.
- Unit coverage for bounded ranges, hourly aggregation, evidence labelling, tenant-separated deltas, CSV safety, and expiring signed download tokens.
- Route-level checks for unauthenticated denial, viewer read access, viewer export denial, owner export, signed download validation, and cross-tenant job isolation.
- Production build and GitHub CI before deployment.

## Deferred Stage 5 work

- Provider billing reconciliation and signed/idempotent payment webhooks.
- Enterprise OIDC, service accounts/API keys, custom scopes, and MFA.
- Compliance exports, data requests, support tickets, and approved retention automation.
- Guarded student access remains blocked until the safeguarding, age, territory, invitation/identity, and privacy decisions are formally approved.
