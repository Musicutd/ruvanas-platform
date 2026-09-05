# Stage 19.13 — Privacy-Safe Listener Analytics

## Outcome

Stage 19.13 establishes the audience-measurement contract required by the future Ruvanas public player. It records short, anonymous listening-session events, collapses them into organisation and channel-owned hourly totals, applies bounded retention and gives subscribers a dedicated Listener Analytics workspace. It extends the existing analytics and operations-worker foundation rather than creating a second reporting platform.

The stage does not publish an anonymous player. Stage 19.14 will issue the short-lived channel and session-scoped telemetry token when a public listener starts playback.

## Privacy contract

- Ruvanas does not store a listener name, account, email address, raw IP address, precise location or raw user-agent string.
- The player creates a private random session identifier. Ruvanas converts it into a keyed SHA-256 hash before it is placed in a signed telemetry token; the raw identifier is never accepted by the ingestion route.
- The token contains only a version, organisation, channel, irreversible session hash and expiry. It cannot be moved to another organisation or channel without invalidating its signature.
- Subscriber reports describe anonymous sessions and listener time. They never claim to identify people or unique reach across multiple hours or devices.
- Raw event rows are retained for 31 days. Identity-free hourly totals are retained for 395 days.

## Event ingestion

The public contract accepts batches of 1–20 events:

- `SESSION_STARTED`;
- `HEARTBEAT`;
- `SESSION_ENDED`;
- `PLAYBACK_ERROR`.

Each event uses a private random event ID, a bounded 0–60-second listening contribution and a timestamp close to receipt. The channel must still be active. The `(channelId, clientEventId)` database constraint and `createMany(skipDuplicates)` make browser retries idempotent. The request body is capped before parsing and responses are never cached.

The ingestion route never logs a token, event body, address or browser string. Unexpected failures produce only a bounded operational error code.

## Aggregation and capacity

The existing operations worker processes raw events in bounded batches ordered by receipt time and ID. Every touched channel/hour is recomputed from the retained source rows, so a retry or late event cannot inflate a total. The organisation cursor advances only after its affected aggregates have been written.

Hourly rows contain:

- anonymous session count for that hour;
- session starts and ends;
- heartbeat count;
- confirmed listening seconds;
- playback-error count;
- channel identity and the last source receipt time.

The report layer exposes session starts, listener hours, average listening minutes per session start, peak anonymous sessions in one UTC hour and playback errors. Reports are limited to 93 days per request. CSV exports require an organisation owner or manager and create an audit record with the export period and content hash.

## Subscriber experience

`/dashboard/listener-analytics` adds:

- 7-, 30- and 90-day views;
- an accessible daily listener-hours chart;
- channel comparison;
- explicit empty-state wording before the public player is launched;
- a visible explanation of measurement limits and retention;
- a manager-only protected CSV export.

Online Radio and subscriber navigation link to this workspace while the existing Service Insights page remains the authority for enrolled-player and operational evidence.

## Governance boundaries

- Subscriber reads are resolved from the active organisation context.
- Only owners and managers may export.
- Public writes require a valid server-signed, short-lived, channel-scoped telemetry token.
- A token for one organisation cannot submit data to another organisation.
- Listener analytics are product improvement evidence, not billing, royalty or advertising truth. Rights reporting remains Stage 19.22.
- Stage 19.13 does not loosen the enrolled-player listener quota or device-lock controls.

## Rollback

Stop issuing listener telemetry tokens and allow the worker to drain accepted events. Application rollback leaves the additive raw-event, aggregate and cursor tables dormant. Retain or export any required aggregate evidence before reversing the migration. Removing listener analytics must not delete channels, stations, enrolled-player leases, proof of play or operational analytics.
