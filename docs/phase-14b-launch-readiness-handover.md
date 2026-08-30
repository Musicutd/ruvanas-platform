# Stage 14B: controlled launch readiness and operational handover

Stage 14B converts the final architecture acceptance into a repeatable, Super Admin-only launch decision. It introduces no schema migration, changes no customer data, performs no deployment, and does not replace human legal, commercial, safeguarding or operational approval.

## Delivered scope

- A read-only **Super Admin -> Launch readiness** view.
- A protected `GET /api/admin/launch-readiness` endpoint available only to a platform Super Admin.
- A deterministic readiness resolver combining current paid-service health, release consistency and recovery readiness.
- Explicit blockers for the wrong environment, missing commit attribution, mixed releases, missing services, critical platform health and incomplete recovery controls.
- Attention status for non-critical operational or recovery warnings.
- A mandatory operator checklist for CI/acceptance evidence, paid deployment, live smoke, suspended free staging and business/legal approval.
- A final launch handover runbook with non-destructive smoke and rollback guidance.

## Evidence and privacy boundary

The endpoint returns safe aggregate readiness only. It does not expose credentials, instance identifiers, provider links, job payloads, recipient data, customer content, media, student data or recovery secrets. Operator checks are deliberately never marked complete automatically because GitHub, hosting-provider, smoke-test and business approvals require external evidence and accountable human confirmation.

## Status rules

- `BLOCKED`: automated operational or recovery evidence contains a critical launch blocker.
- `ATTENTION`: no critical blocker exists, but an operational or recovery warning requires review.
- `READY_FOR_OPERATOR_SIGN_OFF`: automated evidence is clear; every external operator confirmation is still required before launch.

No status authorises content publication, customer onboarding, billing activation, external notification delivery or a legal/commercial claim.

## Verification

1. Run unit tests for paid-environment enforcement, release attribution, mixed-release detection, service availability, operational/recovery status and manual-approval semantics.
2. Run repository integrity checks and Prisma validation.
3. Run the production build and confirm the new admin page and API route compile.
4. Run the final Stage 14A acceptance gate in CI.
5. After approval, deploy only the paid `ruvanas-platform` service and keep the free staging web service suspended.

## Rollback

The admin page, route, resolver, tests and navigation entry can be removed without changing the database or customer data. Earlier releases ignore these files. If an application rollback is required, use the existing release-verification and operational runbooks and retain all underlying recovery and operational evidence.
