# External Notification Operations

## Before enabling email

1. Approve the provider and its data-processing terms for the intended territories.
2. Configure `NOTIFICATION_EMAIL_ENDPOINT`, `NOTIFICATION_EMAIL_TOKEN` and `NOTIFICATION_EMAIL_FROM` only on the paid Ruvanas environment.
3. Confirm the endpoint is public HTTPS on port 443 and accepts the documented JSON contract and idempotency header.
4. Deploy, open the notification centre and confirm email toggles become available.
5. Opt in a controlled staff test account to one low-risk event and verify one delivery before wider use.

Never copy provider tokens into support tickets, job notes, screenshots or repository files. Do not configure the suspended free staging service.

## Email failures

1. Review **Admin → Jobs & notifications** for retry-scheduled or dead-letter work.
2. Use the safe failure code to distinguish configuration, DNS, connection and provider HTTP failures.
3. Correct the provider configuration or outage first. Do not repeatedly retry a dead-letter job.
4. After correction, add an operational note and use **Retry safely** once.
5. Confirm the email delivery evidence changes to delivered and the job succeeds.

## Webhook failures

1. Review **Admin → API & integrations** for a degraded connection and the worker logs for aggregate webhook-batch results.
2. Confirm the partner endpoint remains HTTPS, publicly resolvable and subscribed to `notification.created`.
3. Ask the partner to verify the signature, timestamp and idempotency headers and to return a successful HTTP status within ten seconds.
4. Failed events retry automatically. An abandoned event remains preserved as delivery evidence.
5. Rotate or revoke a signing secret only through the existing integration controls.

## Privacy and incident evidence

External messages contain no notification metadata, student identity, raw exception, credential or session information. Escalate using the job ID, notification type, correlation ID, safe failure code and UTC timestamps. Never paste full provider requests or authorization headers into an incident record.
