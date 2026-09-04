# Stage 19.7 — Provider-Neutral External Live

## Outcome

Stage 19.7 lets an organisation owner or manager connect an external Icecast, SHOUTcast or standards-based HTTP audio source to an active Ruvanas channel. A source is saved, health-tested and deliberately activated before it can outrank scheduled programming. It feeds the Stage 19.6 Unified Playout Engine as the reserved `LIVE_SESSION` candidate; it does not create another scheduler, player or stream-priority path.

## Controlled workflow

1. The operator selects an organisation-owned active channel and records a provider-neutral source.
2. Ruvanas validates that the endpoint is public HTTP/HTTPS and rejects local, credentialed-URL and private-network targets.
3. Optional Basic or Bearer credentials are encrypted with the existing platform secret key and are never returned by subscriber APIs.
4. A protected server-side probe must receive supported audio before activation is allowed.
5. Activating a source safely replaces any other active External Live source on that channel.
6. Suspending or archiving the source immediately removes it from live-source selection.

## Playout and player contract

- A healthy, active and in-window source enters the unified resolver at priority 1100, below emergency override and above protected School Radio and scheduled programming.
- Unverified, unhealthy, stale, not-yet-started and expired sources remain in the explainable fallback chain but cannot be selected.
- The player manifest contains a source ID, provider class, display label and protected Ruvanas relay URL. It never contains the upstream URL or credential.
- The relay re-verifies the enrolled player, active listener lease, current unified decision, organisation/channel ownership and public endpoint before opening the upstream audio response.
- Existing subscriber listener quotas and device locks therefore apply to External Live without a second access system.

## Health and operations

The existing operations worker checks active sources every 30 seconds. A healthy result refreshes the authoritative live candidate. A failed result makes the candidate unavailable so the unified engine selects the next approved schedule or AutoDJ source. Three consecutive failures produce a deduplicated in-app/external notification through the existing job system. Stage 19.9 will add the richer failover state machine and recovery evidence; Stage 19.7 deliberately establishes only the safe source and health boundary.

## Security boundaries

- Endpoint validation prevents server-side requests to loopback, link-local, private and reserved networks.
- Redirects are not followed automatically.
- Only owners and managers may save credentials or change live state; other organisation members receive a read-only view.
- One partial database uniqueness rule permits only one active External Live source per channel.
- Audit records contain provider class, channel and action metadata, never the upstream URL or credential.
- The upstream audio response is relayed with private, no-store caching and content sniffing disabled.

## Rollback

Application rollback makes the new rows dormant because older releases do not query them. Before removing the migration, suspend active External Live sources and preserve any required audit evidence. Retail, School Radio, scheduled Online Radio and Continuous AutoDJ remain unchanged.
