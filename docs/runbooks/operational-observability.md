# Stage 12C operational response runbook

## First response

1. Open **Super Admin → Platform health** and record the time, overall status, finding codes, environment, and active release versions.
2. Do not copy customer content, credentials, raw payloads, recipient data, or student information into incident notes.
3. Confirm the paid Ruvanas service is the only active deployment target. Keep the free staging service suspended.
4. Prefer reversible containment. Do not delete evidence, reset counters, force a schema change, or republish content during diagnosis.
5. Record the action, operator, reason, start time, end time, and verification result in the appropriate incident/support record.

## Mixed releases or missing service heartbeat

- Confirm whether a deployment is still progressing before intervening.
- If one release remains mixed after the deployment window, stop further operational changes and inspect the affected service logs by safe instance key.
- If the operations worker is missing, queued notifications, stream probes, player scans, and webhooks may be delayed. Restore only the paid service worker and confirm the queue begins reducing.
- If the protected-media worker is expected but missing, pause new media processing and verify protected-storage configuration without exposing values.
- Close the incident only after two consecutive refreshes show current heartbeats and one active release.

## Database migration failure

- Stop application writes and background workers.
- Preserve the failed migration output and the verified pre-deployment snapshot reference.
- Never edit an applied migration or use a broad schema-push operation against production.
- Roll back the application release if it remains compatible with the additive schema. Otherwise restore the verified snapshot and create a new corrective migration.
- Verify authentication, tenant isolation, player manifests, jobs, and the Platform health view before reopening writes.

## Protected object-storage outage

- Pause upload and processing operations; do not make objects public as a workaround.
- Confirm the outage using a metadata-only health check and the provider status channel.
- Keep playback on already-authorised cached media where policy allows.
- After recovery, resume the worker, confirm failure counts stop increasing, and retry only explicitly recoverable jobs.

## Stream-provider outage

- Review provider-neutral stream incidents and affected stations.
- Confirm failure from an independent approved probe before changing configuration.
- Use an approved fallback source only when the station’s operating procedure permits it.
- Do not expose provider credentials in logs or incident notes. Resolve the incident only after stable probes and playback verification.

## Mass player-offline event

- Compare the start time with releases, network events, and source outages.
- Do not rotate all player credentials or send mass commands without a scoped impact review.
- Test one representative location, then use bounded commands only when the cause is confirmed.
- Verify heartbeat recovery and proof ingestion across multiple locations before resolving.

## Schedule compiler failure

- Freeze schedule publication for affected targets and preserve the last valid compiled manifest.
- Record the target scope and safe error code; do not copy customer schedule content into general logs.
- Validate a corrected schedule on a bounded target before resuming publication.
- Confirm the player receives the expected manifest and records device-confirmed proof.

## Proof-ingestion backlog

- Check the latest proof timestamp, job queue age, player connectivity, and database availability.
- Do not manufacture or backdate proof records.
- Restore ingestion capacity, then verify the backlog reduces in chronological order and deduplication remains effective.
- Reconcile gaps explicitly in operational reporting.

## Billing webhook failure

- Treat ambiguous timeouts as potentially delivered and preserve idempotency evidence.
- Verify signatures, endpoint health, and the event status without exposing billing payloads or secrets.
- Use controlled recovery only for eligible events; never reset attempt history.
- Reconcile subscription state against authoritative billing evidence before changing access.

## Emergency school public-unpublish

- Use the existing controlled school unpublish operation with an authorised adult operator.
- Preserve safeguarding review, publication, and retention evidence; do not delete the episode as incident containment.
- Verify the public route is unavailable and caches no longer serve the item.
- Notify the school’s designated safeguarding contact through the approved channel and record all actions without student data in general logs.

## Closure evidence

Close an incident only when the triggering finding is cleared, affected workflows pass a bounded smoke test, queued work is stable or reducing, release versions are consistent, and the operator has recorded follow-up actions.
