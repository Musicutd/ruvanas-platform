# Stage 11D — Job and In-App Notification Foundation

## Outcome

Stage 11D establishes the reliable asynchronous work and notification layer required by the master build specification. It preserves the existing application and operations worker while moving notification delivery outside web requests.

## Delivered

- PostgreSQL-backed jobs with an idempotency key, availability time, exclusive worker lease, bounded attempts, exponential retry, and dead-letter state.
- Safe structured worker logs with job, request, and correlation identifiers. Job payloads, credentials, and raw exception messages are not logged.
- Tenant-scoped notification events, in-app delivery evidence, per-user preferences, unread state, and dismissal.
- Player-offline and stream-source incidents enqueue one deduplicated delivery job when the incident first opens.
- A client notification centre with in-app preferences.
- A super-admin operations screen showing queue health and audited manual recovery for dead-letter jobs.
- Email and webhook channels represented only as future extension points; external delivery is not enabled.

## Reliability boundary

The worker claims a job by writing a random lease token and expiration. Only the holder of that token can complete or fail it. An expired lease can be reclaimed after a worker interruption. Failures expose a bounded public code and generic message, then retry with exponential backoff up to the configured maximum. Exhausted work moves to `DEAD_LETTER` and requires a super-admin note to retry.

Notification creation is idempotent when a producer supplies a deduplication key. Delivery is unique per event, user, and channel. In-app preferences default to enabled; a disabled preference records a skipped delivery rather than silently losing operational evidence.

## Security and privacy

- Client notification reads and changes are restricted to the signed-in user and active organisation.
- Job operations require platform-admin access, and the navigation link is super-admin only.
- Administrative responses omit job payloads and results.
- Manual retries create an audit entry containing the operator, reason, entity, and request identifier.
- School notifications use operational records only; this stage does not add student identity data to notification payloads.

## Operations

The existing `worker:operations` process now handles notification jobs in addition to its health scans. Production must run exactly one web service and one compatible operations-worker process from the paid Ruvanas environment. The retired free staging service remains suspended and is not a deployment target.

See [Background Job and Notification Runbook](runbooks/background-job-notifications.md) for recovery steps.
