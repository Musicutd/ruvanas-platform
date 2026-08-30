# Stage 14B final launch handover runbook

## Safety boundary

Use this runbook only for the paid `ruvanas-platform` service. Keep the free `ruvanas-platform-staging` web service suspended. A green automated report is necessary but not sufficient for launch: an authorised operator must complete every external confirmation, and business/legal owners must approve the intended launch scope.

## Before merge

1. Confirm the pull request contains only the approved milestone and targets `main`.
2. Confirm all required GitHub checks pass, including the final retail and School Radio acceptance gate.
3. Confirm there is no unresolved P0/P1 security, safeguarding, privacy, data-integrity, migration, or customer-impact defect.
4. Review migration SQL when present and verify the approved backup or snapshot procedure before structural changes.

## Paid-service deployment

1. Deploy only the paid `ruvanas-platform` service from the approved merge commit.
2. Confirm the pre-deploy migration step completes and the application becomes live.
3. Open **Super Admin -> Launch readiness** and confirm the environment is `ruvanas-platform`, the release commit is attributable, active versions are consistent, required processes are current, and no blocking platform or recovery finding remains.
4. Confirm the free staging web service remains suspended. Do not resume or deploy it as part of this handover.

## Non-destructive live smoke

1. Load the public home and login pages.
2. Confirm unauthenticated protected pages redirect to login and protected APIs reject access safely.
3. Check the changed workflow only with authorised operator access and bounded test records where necessary.
4. Do not upload customer media, publish campaigns or school episodes, send player commands, send notifications, alter subscriptions, or change recovery evidence merely to prove availability.

## Human launch approval

Record a safe release reference and confirm:

- GitHub CI and final acceptance passed for the deployed commit;
- the paid deployment is live and stable;
- the bounded live smoke passed;
- the free staging web service remains suspended; and
- licensing, privacy, safeguarding, retention, pricing and customer commitments are approved for the launch scope.

Do not store credentials, private provider links, customer content, student data, recipient details, or signed URLs in handover evidence.

## Failure and rollback

- Preserve the failed check, deployment identifier, safe commit reference and operator timeline.
- Do not bypass a blocked launch-readiness status or manually deploy a different branch.
- Follow the release, operational-observability and backup/recovery runbooks for migration, service, storage, stream, player or queue failures.
- Roll back application code only to a version compatible with the current additive schema.
- Treat the release as complete only after the paid service is stable, the live smoke passes, external confirmations are recorded and the free staging web service remains suspended.
