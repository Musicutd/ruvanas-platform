# Stage 12A — Controlled External Notification Delivery

## Outcome

Stage 12A extends the Stage 11D leased job and in-app notification foundation with explicit, provider-neutral external delivery. Existing in-app behaviour remains the default and does not depend on an external provider.

## Email boundary

- Email is opt-in per signed-in, non-student organisation member and notification type. The default is disabled.
- The channel is unavailable unless all three server-side provider settings are valid.
- Messages contain only the bounded operational title, message, type, occurrence time and correlation reference already stored on the notification event. Metadata, student details, credentials, raw errors and session data are never included.
- Provider requests use HTTPS, reject credentials or non-standard ports in the URL, re-check DNS against private-network destinations, reject redirects, use a ten-second timeout and carry a deterministic idempotency key.
- Provider tokens stay in server environment variables and are never returned by an API, rendered in the client or written to worker logs.
- A failed send records only a safe failure code and follows the existing bounded job retry/dead-letter path.

The adapter is intentionally provider-neutral. `NOTIFICATION_EMAIL_ENDPOINT` must accept a JSON object containing `from`, `to`, `subject`, `text` and `idempotencyKey`, authenticated by the bearer token in `NOTIFICATION_EMAIL_TOKEN`.

## Webhook boundary

- Existing signed outgoing webhooks can subscribe to `notification.created`.
- The allow-listed payload contains only the public operational notification fields; internal metadata and recipient details are excluded.
- Notification creation queues a webhook event idempotently for each active subscribed connection.
- The paid operations worker now dispatches due webhook events automatically using the existing signature, SSRF protection, retry window and abandonment evidence.
- Webhook endpoints and subscriptions remain Super Admin controlled under **API & integrations**.

## User experience

The notification centre separates in-app preferences from email opt-in. It reports when email is unavailable instead of accepting a preference that cannot be delivered. Webhooks remain an organisation integration rather than a personal preference.

## Data and rollback

Stage 12A reuses the `EMAIL` and `WEBHOOK` enum values, notification preferences, delivery evidence, jobs and outgoing-webhook tables introduced earlier. No database migration is required. Application rollback leaves all existing records valid; the older worker will simply ignore email preferences and will not automatically drain outgoing webhooks.

See [External Notification Operations](runbooks/external-notification-delivery.md).
