# Stage 6B - public API and integration backbone

Stage 6B gives Ruvanas a controlled connection layer without exposing the application database.

## Delivered foundation

- A versioned, tenant-scoped public API authenticated by revocable service-account keys.
- A `locations:read` scope and paginated `/api/v1/locations` resource.
- Per-key API rate limiting with standard limit, remaining, and retry headers.
- Super Admin management of outgoing webhook connections.
- AES-256-GCM encrypted webhook signing secrets with one-time display and rotation.
- HTTPS-only endpoint validation, local-network blocking, DNS revalidation, redirect blocking, and request timeouts.
- HMAC-SHA256 signatures over the exact timestamp and request body.
- Stable event IDs and idempotency keys so receivers can safely ignore duplicates.
- Delivery-attempt history with bounded retries, visible errors, disconnect, reconnect, and permanent revoke controls.
- Safe event queueing for campaign publication, player health recovery, accepted proof-of-play batches, and production status changes.

## Data boundary

Webhook payloads are deliberately small and allow-listed. They contain operational identifiers, counts, statuses, and timestamps only. Raw playback submissions, user contact details, school scripts, student identities, and private student data are excluded.

## Receiver verification

Each request contains:

- `x-ruvanas-event-id`
- `x-ruvanas-idempotency-key`
- `x-ruvanas-timestamp`
- `x-ruvanas-signature` in the form `v1=<hex digest>`

The receiver should calculate HMAC-SHA256 using its signing secret and the exact UTF-8 string `<timestamp>.<raw request body>`, compare signatures using a timing-safe function, reject stale timestamps, and store the idempotency key before processing.

## Operational model

Connections begin in `CONNECTED`. Failed deliveries move the connection to `DEGRADED` while preserving queued work. Five bounded retry windows are supported: one minute, five minutes, thirty minutes, two hours, and twelve hours. Operators can run due deliveries from the Super Admin console. `DISCONNECTED` pauses dispatch without deleting history; `REVOKED` is permanent.

The POS, inventory, and footfall adapter types are represented in the schema for the next Stage 6 slice. Their future imports must store source timestamps and summarized metrics, and must not claim that correlation proves causation.

## Verification

Automated checks cover exact-body signatures, deterministic idempotency, bounded retry timing, URL and private-network rejection, event allow-listing, payload redaction, API authentication, tenant scoping, rate-limit headers, encrypted secret storage, and role restrictions.

