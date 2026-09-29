# Ruvanas Inside C9 — release-readiness gate (draft)

**Decision: BLOCKED.** This document is an evidence ledger, not approval to merge, migrate, deploy, enable customers, or change Render settings. It applies to the local C9 branch based on cached C7 `origin/main` commit `0e1deb3f8a36d18bd19574e17c4b6045b534169e`. Remote GitHub and production Render state have **not** been freshly verified for this report. Draft C8 PR #217 is outside this branch.

## Evidence available in this checkout

| Gate | Current evidence | Result |
| --- | --- | --- |
| Product-family integrity | `tests/corrections-foundation.test.mjs` asserts seven families, 35 public plans, five Corrections tiers, and fail-closed access. Full local unit suite passed on 29 September 2026. | Local code evidence only |
| Existing products and static integrity | Full `tests/*.test.mjs` suite exited 0; `scripts/ci-static-checks.mjs` passed. The C9 diff is additive to the Super Admin compliance view, a read-only API, local probes, tests, and docs. | Local code evidence only |
| C9 privacy inventory | Tenant-scoped, Super Admin-only aggregate counts; tests cover scope and no record-content response. It is not a retention or legal-hold decision. No live database was connected for this report. | Partial |
| C9 policy probe | 24 synthetic facilities and 10,000 in-process C7 scheduler decisions had zero mismatches. This does not exercise player, API, database, media, proof, network, Edge, or capacity. | Partial |
| Build | Local Next.js build exited 0 in the preceding C9 implementation slice. It logged an existing Studio CSS warning and missing `DATABASE_URL` messages during static-page generation. | Code build only; live database untested |

## Blocking evidence and decisions

| Gate | What is still required | Status |
| --- | --- | --- |
| C8 Secure Edge | Complete independent appliance/LAN/TLS and offline acceptance; verify PR #217 status and integrate only through its own review. Do not infer acceptance from C7 or the C9 synthetic probe. | BLOCKED |
| Identity and SSO | Select a customer identity provider, verify domains and recovery ownership, exercise sign-in, session expiry and revocation. The current code defaults `ssoRequired` to false and refuses requiring SSO without a verified provider; live customer SSO is not established. | BLOCKED |
| Corrections security | Complete independent facility-grant, contributor-session, service-account-scope and cross-tenant review against an isolated environment. An organisation read scope must not imply facility control. | BLOCKED |
| Retention and legal hold | Obtain authority/legal-approved periods, legal-hold authority, exclusions, deletion approval and evidence-preservation rules. The current inventory makes no deletion candidates and there is no Corrections deletion executor. | BLOCKED |
| Residency | Confirm required jurisdiction, application and media storage regions, backups and subprocessors using actual deployment configuration. No residency claim follows from a UI setting or code label. | BLOCKED |
| Capacity and recovery | Obtain an approved facility/player concurrency profile, availability and RPO/RTO targets; run isolated end-to-end playback/proof, failure and recovery exercises. The policy microbenchmark cannot satisfy this gate. | BLOCKED |
| Code and migrations | Verify current remote `main`, reconcile C9 with newer work, validate migration ordering and database compatibility in an isolated environment, run GitHub CI and full review. No production migration is authorised here. | BLOCKED |
| Operator and customer acceptance | Verify current Render Auto-Deploy and deployed commit, agree the controlled release sequence, obtain operational, security, legal and customer sign-off. This branch has not been deployed. | BLOCKED |

## Control boundary

The existing six product families must retain their normal Studio, catalogue, entitlement, navigation and playout behaviour. Inside must remain behind its product entitlement and permissions; contributor submission is not approval, ordinary Studio handoff is unchanged, and offline players must not be counted as delivered. Priority/Emergency and return-to-current-private-programme claims need independent end-to-end evidence for the intended release. No public or unrelated audio is an acceptable fallback for a private Corrections facility.

This ledger may be updated only with attributable evidence for the exact commit and environment under review. A local test result is not a production verification. Even when every row has evidence, a human release decision is still required; this document cannot trigger a deployment or migration.
