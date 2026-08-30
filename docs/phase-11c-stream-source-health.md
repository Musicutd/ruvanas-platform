# Stage 11C — Provider-Neutral Stream Source Health

Stage 11C closes the source-reliability gap identified in the master build specification. It keeps `Station` and `StationStreamConfig` as the existing technical streaming foundation, adds a small provider-adapter key, and monitors the public audio source separately from player heartbeat health.

## Delivered scope

- Existing Centova configuration remains compatible through the `CENTOVA_CAST` adapter key; a `GENERIC_HTTP` key supports a future provider without changing channels or players.
- Platform admins can configure bounded probe frequency and timeout values and record a backup public stream URL. Backup switching is deliberately not automatic in this stage.
- The operations worker probes only configured, enabled, due public HTTP/HTTPS sources. It does not follow redirects, transmit stored provider credentials, or probe local/private network addresses.
- Five-minute samples retain status, latency, HTTP status, content type, and a bounded error code without storing response bodies or credentials.
- Three consecutive unhealthy probes open a source incident. Continued failures escalate severity; a healthy probe automatically resolves the incident.
- Platform admins can run a manual probe and acknowledge or resolve incidents with audited notes from **Admin → Stations**.

## API and authorization

- `GET /api/admin/streams/health` returns the platform operations view.
- `POST /api/admin/streams/:stationId/probe` runs one controlled probe.
- `PATCH /api/admin/streams/health/:incidentId` acknowledges or resolves an incident.
- All three routes require the existing platform-admin boundary. Tenant owners and unauthenticated users remain denied.
- The existing station setup route accepts the provider key, optional backup URL, and probe controls while retaining its existing origin, authentication, secret-encryption, and audit protections.

## Data and migration

Migration `20260925000000_stage_11c_stream_source_health` is additive. It extends `StationStreamConfig` with provider and current-probe fields and adds `StationStreamHealthSample` plus `StationStreamHealthIncident`. A partial unique index permits only one unresolved source incident per station.

No existing station, channel, player, schedule, stream URL, Centova credential, or proof-of-play record is renamed or removed. No backfill is required; existing stream configurations default to `CENTOVA_CAST` and begin sampling after the worker runs.

## Testing

- Unit tests cover provider normalization, bounded probe controls, public-endpoint restrictions, response classification, five-minute samples, severity, and incident transitions.
- Database tests cover repeated failure, incident creation, recovery, audit evidence, and preservation of player state.
- Integration security coverage verifies unauthenticated and tenant-owner denial plus platform-admin access.
- Release validation applied all 54 migrations to a clean isolated PostgreSQL database, passed all 260 unit and database-backed tests with no skips, passed the route-security integration suite, and completed the production build.

## Rollback

Application rollback may leave all additive columns and tables in place. Disable probing by setting `probeEnabled` false or by running the previous application version. After source samples or incidents exist, retain them as operational evidence. Dropping the evidence tables or enum requires a separate approved retention decision.

## Deliberate limits

This stage does not contact privileged provider APIs, expose or rotate provider passwords, follow redirects, switch to the backup URL, restart a source, or change player playback. Those actions require a separate controlled milestone after notification delivery and provider-specific contract tests exist.
