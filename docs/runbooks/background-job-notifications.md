# Background Job and Notification Runbook

## Routine review

1. Open **Admin → Jobs & notifications**.
2. Confirm that queued and retry-scheduled work is moving and leases are short-lived.
3. Review dead-letter count, organisation, job type, attempt count, public error code, and correlation identifier.
4. Never copy database credentials, session data, notification payloads, student details, or third-party secrets into an operational note.

## Retry-scheduled work

Allow automatic retry to run unless the underlying incident needs repair. Exponential backoff prevents repeated failures from overwhelming a dependency. If counts rise, investigate the related player or stream incident and the operations-worker health before taking manual action.

## Dead-letter recovery

1. Correct or confirm the underlying cause.
2. Add a clear operational note explaining the evidence and intended retry.
3. Select **Retry safely** once.
4. Refresh and confirm the job moves through queued/leased to succeeded. If it dead-letters again, stop retrying and escalate with the job ID, correlation ID, safe error code, and timestamps.

Manual recovery resets the attempt counter and writes an audit entry. It does not modify the original notification event or erase prior job timestamps.

## Worker interruption

An interrupted worker leaves leased jobs recoverable after the 45-second lease expires. Restart only the paid Ruvanas operations worker, then confirm expired work is reclaimed. Do not resume or deploy the retired free staging service.

## Client delivery checks

1. Open **Client dashboard → Notifications** inside the affected organisation.
2. Confirm the signed-in user is an active member and the relevant in-app preference is enabled.
3. A disabled preference produces a `SKIPPED` delivery. It is not a worker failure.
4. Stage 12A email delivery remains disabled by default and requires both valid provider configuration and an explicit user opt-in. Signed notification webhooks are managed separately under **API & integrations**.

## Escalation evidence

Provide the job ID, type, status, correlation ID, safe error code, affected organisation, and UTC timestamps. Do not share payloads or raw exception text. Preserve dead-letter and delivery records for the incident review.
