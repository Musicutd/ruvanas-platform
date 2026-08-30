# Stage 12C — Operational observability and release visibility

## Outcome

Stage 12C gives the Super Admin a private, provider-neutral view of platform readiness. The view combines current service heartbeats, active release versions, queue pressure, external-delivery backlog, player and stream incidents, protected-media failures, and device-confirmed proof freshness.

The view is operational evidence, not customer analytics. It excludes customer content, student data, credentials, recipient addresses, webhook payloads, raw error messages, and host instance identifiers.

## Components

- The web application, operations worker, and optional protected-media worker publish bounded heartbeats.
- Active processes are compared by release version so mixed deployments are visible.
- Missing expected services, dead-letter jobs, and critical playback incidents produce critical readiness findings.
- Abandoned deliveries, media-processing failures, mixed versions, and offline players produce attention findings.
- Only Super Admin users can access `/admin/operations` and `/api/admin/operations/health`.
- Worker logs are one-line JSON with timestamp, service, environment, version, a hashed instance key, safe event name, and bounded operational fields.

## Monitoring boundary

The database-backed dashboard is intentionally low-cardinality. Request rate, latency percentiles, HTTP error rates, process CPU/memory, and uncaught runtime errors belong in the hosting platform and an approved external error-monitoring service. Those monitors should carry the same environment and release labels, but must not receive credentials, media payloads, student data, or notification content.

## Deployment safety

Before deployment, apply the additive migration and confirm the new release on the paid Ruvanas service only. The free staging service remains suspended. After deployment, a Super Admin should verify that expected services report current heartbeats and that all current instances use one release version.

Operational response steps are in [the Stage 12C runbook](./runbooks/operational-observability.md).
