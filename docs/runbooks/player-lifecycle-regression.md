# Stage 13C player-lifecycle regression runbook

## Before merge

1. Confirm the complete CI workflow passes on the pull request, including static integrity, dependency audit, Prisma validation, clean migrations, unit tests, production build, route security, player lifecycle, release smoke, and performance baseline.
2. Confirm the lifecycle test used generated fixtures and removed them after completion.
3. Treat a lifecycle failure as release evidence. Do not bypass it or repeatedly rerun it without understanding the cause.
4. Determine which boundary failed: enrolment, authentication, assignment, heartbeat recovery, command delivery, acknowledgement, proof idempotency, or disablement.
5. Preserve the existing single-use enrolment, bounded diagnostic, allow-listed command, and idempotent proof rules when correcting a regression.

## Paid production release

1. Merge only after every required GitHub check succeeds.
2. Deploy only the paid `ruvanas-platform` service and keep the free staging service suspended.
3. Confirm the paid deployment uses the approved merge commit and completes its controlled migration/start sequence.
4. Use non-destructive live checks by default: public access, login access, and protected player boundaries without a valid player session.
5. Exercise a real enrolment, command, or proof event only with an authorised test player and an approved operational window; never reuse a customer player or production proof event for release testing.

## Regression response

- Enrolment failure: confirm code expiry, single-use state, secret configuration, and cookie delivery before issuing a replacement code.
- Missing channel or stream: confirm the active zone assignment, channel status, station relation, and provider-neutral stream URL without editing unrelated tenants.
- Heartbeat recovery failure: preserve the ninety-second offline boundary and inspect heartbeat samples, incident state, analytics evidence, and safe request attribution.
- Command failure: do not widen the command allow-list or replay a delivered command; inspect expiry, delivery, acknowledgement, and audit evidence.
- Proof replay failure: preserve the client event identifier and signed player/manifest/schedule/content binding; never delete legitimate production proof to force a retry.
- Disabled-player access: revoke or disable through the controlled lifecycle operation and confirm state, heartbeat, command, and proof endpoints all reject the old session.

Close the incident only after the corrected lifecycle passes in CI, the paid service is stable, and the free staging service remains suspended.

