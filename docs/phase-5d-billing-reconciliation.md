# Phase 5D: Billing and usage reconciliation

Stage 5D adds a provider-neutral commercial operations layer to Ruvanas. It does not select a payment company and does not alter existing plan prices.

## Included

- One billing account per organisation, initially manual or connected through the generic signed adapter.
- Provider customer and subscription references without making provider records the source of truth for tenant ownership.
- Invoice status and payment-period records.
- Signed SHA-256 webhook intake with durable provider-event idempotency.
- Subscription-status mapping for trial, active, overdue, suspended, and cancelled accounts.
- Explicit payment grace deadlines for overdue subscriptions.
- Monthly snapshots for locations, zones, stations, organisation media storage, and School Radio entitlement usage.
- Provider-to-platform usage comparison with matched, mismatched, pending, and resolved states.
- Super Admin controls and audit records for configuration and reconciliation changes.

## Safe transition policy

Existing overdue subscriptions pre-date billing contracts, so they retain their previous access until a billing account and explicit grace deadline are configured. Once configured, an overdue subscription remains available only until the recorded grace deadline. Suspension changes access only: organisation data, media, schedules, players, and streams are never automatically deleted.

## Generic webhook contract

Send a JSON `POST` to `/api/billing/webhooks/generic` with:

- `x-ruvanas-event-id`: a stable unique event identifier.
- `x-ruvanas-signature`: `sha256=<hex HMAC>` calculated over the exact raw request body using `BILLING_WEBHOOK_SECRET`.
- Event type `subscription.updated` or `invoice.updated`.
- A `data.organisationId` matching the Ruvanas organisation.

Only the payload hash is retained in the webhook journal; the raw provider payload is not stored.

## Deferred provider decision

Stripe, another payment provider, or an internal invoicing system can be connected later through this adapter. Provider checkout, tax calculation, automatic refunds, accounting exports, and customer self-service remain outside Stage 5D until the commercial provider and operating countries are chosen.

