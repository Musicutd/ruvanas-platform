# Ruvanas Inside C9 — release-readiness gate (draft)

**Decision: BLOCKED.** This document is an evidence ledger, not approval to merge, migrate, deploy, enable customers, or change Render settings. It applies to the C9 branch based on C7 `main` commit `0e1deb3f8a36d18bd19574e17c4b6045b534169e`. Draft C8 PR #217 is outside this branch. GitHub CI passed both checks for Draft PR #218 at `65929bd5ac1763154c50d6f884be2b3c505c2219`; subsequent changes require their own CI run after publication. On 1 October 2026, production Render `ruvanas-platform` was read-only verified with Auto-Deploy **Off** and deployed commit `bff07f376ee11db3682cd87f8fb27b5cd51a538e`.

## Evidence available in this checkout

| Gate | Current evidence | Result |
| --- | --- | --- |
| Product-family integrity | `tests/corrections-foundation.test.mjs` asserts seven families, 35 public plans, five Corrections tiers, and fail-closed access. Full local unit suite passed on 1 October 2026: 977 passed, 8 skipped, 0 failed. | Local code evidence only |
| Existing products and static integrity | Full `tests/*.test.mjs` suite exited 0; `scripts/ci-static-checks.mjs` passed on 1 October. The C9A slice extracts the existing session admission condition without changing its logic and adds security regressions; the rest of the branch remains C9-specific. | Local code evidence only |
| C9 privacy inventory | Tenant-scoped, Super Admin-only aggregate counts now include supervised Studio projects, edit versions, takes, renders and linked media alongside the earlier Inside records. Tests cover query scope and no record-content response. On 1 October, the isolated `ruvanas-inside-demo-20260930` service deployed demo commit `3379e8bed35410b9bbd597fbdd2f9bccf1ebd23a` containing the C9 inventory query. Its guarded startup check used the private demo PostgreSQL database to create fictional Studio evidence for two organisations in a transaction. Seven Studio-related count fields stayed organisation-scoped; all returned fields were nonnegative integer counts; all probe rows were rolled back and the second fictional organisation was absent afterward. The deploy completed Live. This does **not** validate every inventory category, record contents, retention, legal holds, customer data, or production. Linked media can be shared; these counts are not deletion candidates. | Partial; isolated demo DB evidence |
| C9 security contract | Local regression cases cover session revocation/expiry, optional SSO, exact service-account scopes, staff facility grants and supervised-session isolation. A further local check binds a stale-membership fallback and explicit organisation switch to the selected organisation's enterprise policy. No live customer provider, machine Corrections API, or isolated end-to-end security exercise was used. | Partial |
| C9 policy probe | 24 synthetic facilities and 10,000 in-process C7 scheduler decisions had zero mismatches. This does not exercise player, API, database, media, proof, network, Edge, or capacity. | Partial |
| Build | Local Next.js build exited 0 on 1 October after Prisma generation. It logged an existing Studio CSS warning and missing `DATABASE_URL` messages during static-page generation. No schema or migration was changed in this C9 slice. The separate guarded demo deployment built successfully and reported no pending migrations in its private demo database. | C9 code build plus isolated demo startup; no production migration |

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
| Operator and customer acceptance | Production Auto-Deploy Off and deployed commit `bff07f376ee11db3682cd87f8fb27b5cd51a538e` were verified on 1 October. A separate fictional demo is Live, but C9 has not been deployed to production. Agree the controlled release sequence and obtain operational, security, legal and customer sign-off. | BLOCKED |

## Control boundary

The existing six product families must retain their normal Studio, catalogue, entitlement, navigation and playout behaviour. Inside must remain behind its product entitlement and permissions; contributor submission is not approval, ordinary Studio handoff is unchanged, and offline players must not be counted as delivered. Priority/Emergency and return-to-current-private-programme claims need independent end-to-end evidence for the intended release. No public or unrelated audio is an acceptable fallback for a private Corrections facility.

This ledger may be updated only with attributable evidence for the exact commit and environment under review. A local test result is not a production verification. Even when every row has evidence, a human release decision is still required; this document cannot trigger a deployment or migration.
