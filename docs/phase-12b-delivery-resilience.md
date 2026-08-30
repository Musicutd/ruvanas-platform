# Stage 12B — External Delivery Resilience and Recovery

## Outcome

Stage 12B hardens the Stage 12A external-notification paths without changing the default opt-in boundary. A failing webhook or provider cannot interrupt unrelated deliveries, webhook evidence contains bounded operational codes, and a Super Admin can recover abandoned webhook events through an explicit, audited action.

## Webhook resilience

- Each due event is claimed and processed independently. An unexpected failure is contained to that event and the worker continues with the remaining batch.
- Endpoint DNS, blocked-address, timeout, request and HTTP failures are stored as safe codes. Raw exceptions, response bodies, credentials and signing secrets are not persisted.
- Every attempt retains its request hash, response status when available, safe failure code and attempt number.
- Five automatic attempts are available in each retry cycle. Exhausted events become `ABANDONED` and stop automatically.

## Controlled recovery

- Recovery is available only to a signed-in Ruvanas Super Admin under **Admin → API & integrations**.
- An operational reason of 8–500 characters is required and written to the audit trail.
- Each action queues at most ten abandoned events; each event permits at most three recovery cycles.
- Recovery increments a separate counter and never resets `attemptCount`, deletes attempts or changes earlier evidence.
- Recovered events re-enter the normal signed, idempotent delivery queue.

## Email provider boundary

The primary provider remains the only required configuration. An optional provider-neutral secondary adapter can be configured with the three `NOTIFICATION_EMAIL_FAILOVER_*` variables.

Failover occurs only when duplication is not reasonably possible: primary DNS resolution failed before transmission, or the primary returned an explicit HTTP 502, 503 or 504. Timeouts, connection resets and other ambiguous failures remain on the primary retry path because the primary may already have accepted the message. Both providers receive the same deterministic idempotency key.

## Data and rollback

Migration `20260927000000_stage_12b_delivery_resilience` adds `recoveryCount` and `lastRecoveredAt` to existing outgoing webhook events, with a database check limiting recovery cycles to zero through three. Existing events receive zero recoveries. The migration is additive; if the application is rolled back, retain these fields and all delivery evidence.

See [External Notification Operations](runbooks/external-notification-delivery.md).
