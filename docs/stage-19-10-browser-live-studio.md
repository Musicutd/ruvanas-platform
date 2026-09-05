# Stage 19.10 — Provider-Neutral Browser Live Studio

## Outcome

Stage 19.10 extends the existing governed `LiveStudioSession` so an Online Radio presenter can soundcheck, mix and publish live audio from a supported browser. It does not add a second identity, scheduler, stream or recording system. Browser audio enters the Stage 19.7 External Live source, Stage 19.9 failover policy and Stage 19.6 Unified Playout Engine before it can reach listeners.

The application is provider-ready, but Ruvanas deliberately keeps **Go live** locked until compatible external real-time media infrastructure is configured. A browser and the current application server cannot supply a production WebRTC media origin, TURN coverage, listener-scale egress or a commercial availability commitment by themselves.

## Presenter and manager journey

1. An owner or manager creates a time-bounded DJ grant for an existing organisation member and includes `START_BROWSER_STUDIO`. Recording additionally requires `RECORD_LIVE_SESSION`.
2. The manager schedules one Online Radio studio session for the same organisation, channel, presenter and a window fully contained by the grant.
3. The presenter opens the existing private DJ link. The server validates the signed-in identity, opaque cookie token, channel, grant window and capability before returning any studio data.
4. The presenter runs a local microphone soundcheck. Permission, device presence, input level, sample rate and estimated browser latency are recorded as bounded evidence. Failed or degraded checks cannot prepare publishing.
5. When provider infrastructure is configured, Ruvanas allocates a time-bounded WHIP publishing endpoint and a separate playback endpoint. Publishing secrets remain encrypted at rest and are returned only to the authorised presenter.
6. The browser combines microphone and optional local cue-bed audio through Web Audio gain and limiter nodes, then sends the single audio track over WebRTC/WHIP.
7. Ruvanas health-checks and activates the resulting External Live source. The unified resolver, listener quota, enrolled-device controls, proof classification and failover behaviour remain authoritative.
8. Presenter heartbeats continue every 15 seconds. A missing heartbeat for 45 seconds suspends the live source and returns the channel to governed schedule/AutoDJ fallback.

## Provider allocation contract

Set both server-only values:

- `BROWSER_LIVE_PROVIDER_API_URL`
- `BROWSER_LIVE_PROVIDER_API_TOKEN`

Ruvanas calls `POST v1/browser-live/sessions` with an idempotency key, tenant/channel/session identifiers, the approved window, recording policy and `protocol: "WHIP"`. A compatible adapter returns:

```json
{
  "sessionRef": "provider-owned-reference",
  "providerKey": "provider-neutral-label",
  "whipEndpoint": "https://media.example/whip/channel",
  "publishToken": "short-lived-secret",
  "playbackUrl": "https://media.example/live/channel.aac",
  "playbackToken": "optional-short-lived-secret",
  "expiresAt": "2026-09-05T12:00:00.000Z"
}
```

Both media URLs must be public HTTPS addresses without embedded credentials. The adapter must accept `DELETE v1/browser-live/sessions/{sessionRef}` for best-effort resource release. Provider credentials never enter the client; only the allocated, time-bounded publish credential is released to the matching presenter.

## Data and concurrency

- Existing School Radio sessions retain `product = SCHOOL_RADIO` and their required programme, fallback promo and supervisor relationships.
- Online Radio sessions use `product = ONLINE_RADIO`, the existing channel and a same-tenant/same-channel `DjAccessGrant`.
- Database checks prevent School and Online ownership fields from being mixed.
- Composite foreign keys prevent cross-tenant channel, grant and generated External Live source relationships.
- Partial unique indexes allow only one open Online Radio studio per channel and per DJ grant.
- `sessionVersion` provides optimistic concurrency for presenter and manager actions. Heartbeats update liveness without creating a new control version or audit event every 15 seconds.
- Provider publishing secrets are encrypted and omitted from all manager/listing responses.

## State and safety rules

`CREATED → SOUNDCHECK → READY → ON_AIR → ENDED`

- A good soundcheck and configured provider are required for `READY`.
- A healthy generated External Live playback source is required for `ON_AIR`.
- `FORCE_FALLBACK` is available to the assigned presenter and organisation managers with an audit reason.
- Manager termination, presenter termination, provider failure, stale heartbeat, expired grant and scheduled-window end all fail closed.
- Recording remains disabled unless the manager records retention approval and the DJ grant includes the recording capability.
- School Live Studio routes and safeguards remain unchanged; their existing regression tests must continue to pass.

## Operational limitations

This stage implements the Ruvanas application, access, mixer, session, provider-adapter, health and fallback boundaries. Production broadcasting additionally requires selection and configuration of a compatible WHIP/WebRTC media provider, TURN coverage, recording/retention terms where used, geographic capacity tests and an agreed support/SLA model. Ruvanas does not claim those external services are active when the two provider environment values are absent.

## Rollback

Application rollback leaves Online Radio session rows dormant and preserves School Radio defaults. Before reversing the migration, end all Online Radio studio sessions, suspend their generated External Live sources and retain required audit/recording evidence. The migration must not be rolled back while an Online Radio studio is open.
