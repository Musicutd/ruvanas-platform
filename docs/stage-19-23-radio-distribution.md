# Stage 19.23 — Provider-neutral station distribution

## Purpose

Stage 19.23 gives an Online Radio organisation one controlled workspace for connecting an approved radio directory, streaming/CDN partner, app platform or voice-assistant adapter. It reuses the public station, channel, integrations, encrypted-secret, webhook retry, audit and tenant-access foundations already in Ruvanas.

This stage does not claim that any external provider has accepted, certified, listed or contracted with Ruvanas. A `DELIVERED` event proves only that the configured HTTPS adapter acknowledged the request.

## Destination lifecycle

1. An organisation owner or manager creates a `DRAFT` destination against one owned station. Streaming/CDN destinations must also select an active channel.
2. Ruvanas generates a signing secret, stores only its encrypted form and displays the plaintext once.
3. Activation fails closed until the station is active, its public player is published, the required public website or stream output is ready, and the HTTPS adapter is configured.
4. `ACTIVATE`, `SYNC`, `PAUSE` and `REVOKE` each create a new immutable revision and queue one destination-specific event through the existing outgoing-webhook worker.
5. Revocation is terminal. The linked connection remains delivery-capable only so the final delete event can complete; an operator can retire the connection after terminal evidence is recorded.

## Adapter contract

The only core event is `distribution.destination.sync`. Its public payload is explicitly allowlisted and contains the operation, destination kind/key, revision, station/listener URLs, optional public channel name, territories, languages, categories and policy version. It excludes organisation identifiers, private stream URLs, storage keys, credentials and internal account data.

Requests use the existing timestamped HMAC signature, idempotency key, SSRF protections, bounded retries, failure codes and operator recovery controls. Provider-specific transforms belong behind the receiving adapter endpoint; provider names and SDKs do not enter the Ruvanas domain model.

## Security and tenancy

- Every read and mutation is scoped to the active organisation.
- Only `OWNER` and `MANAGER` roles may create or change destinations; other members have a redacted read-only view.
- Composite database relationships prevent cross-organisation station, channel and connection references.
- Full endpoints are reduced to their origin in subscriber responses. Encrypted or plaintext secrets are never returned after creation and never written to audit details.
- All endpoints must use public HTTPS and are revalidated by the webhook delivery worker before connection.

## Operations and evidence

The workspace shows adapter status and bounded recent delivery evidence. Failed events use the shared retry and manual-recovery operations. Operators should compare the event revision and configuration hash with the provider response before declaring a listing current. External publication approval must be recorded by the provider or commercial team outside this transport status.

## Migration and rollback

The migration is additive: two enums, one destination table and one composite uniqueness constraint on existing integration connections. Before rollback, pause destinations and allow queued terminal events to finish. Then remove the destination table and enums; remove the composite index only after confirming no other composite relationship depends on it. Existing integration events and audit records should be retained under the platform retention policy.

## Verification matrix

- Unit: input normalization, lifecycle, readiness, configuration hashing and safe payloads.
- Integration: destination-specific directory/CDN/app/assistant webhook queue and allowlist.
- Route security: authenticated tenant context, entitlement, manager capability and one-time secret handling.
- Database: composite ownership, destination uniqueness, channel-kind constraint and active-state evidence.
- Regression: subscriber navigation, existing integration delivery, Retail Radio and School Radio shared-core tests.
- Performance: linear 10,000-destination station fan-out planning; real partner throughput and acceptance remain an external pre-launch test.
