# Ruvanas Inside C9 fictional demo refresh

This branch is based on C9 commit `696b70370e6e3746bc5a082f4071f438ab7677bf`. It prepares an updated, public, read-only tour for an **isolated demo service**. It is not a customer release, C8 acceptance, or approval to merge or deploy production.

## Boundaries

- The tour at `/inside-demo` exists only when `RUVANAS_ENVIRONMENT=DEMO` exactly. Its three facility labels and submission-review transitions are synthetic browser state; they do not call an API, persist a record, or play audio.
- In DEMO mode, `/` redirects to the tour. The four public registration/invitation pages return 404, and their account-creation endpoints return 403 before parsing or database access. This includes the local registration-test bypass.
- Existing owner sign-in and privileged administration remain available for **synthetic-only** private checks. The demo database must remain separate from production and contain no real customer or facility information.
- The existing demo service's startup command expects `scripts/seed-inside-demo.mjs`. This branch carries that seed and its rollback-only, 23-field inventory validator from the currently deployed demo branch. The seed refuses to run unless the environment marker, Render service name, database host/name and separate strong demo password all match its named demo resources. A rotated demo password now replaces the old hash on the next guarded start.
- Before the first seed write, a serializable transaction now runs `scripts/assert-inside-demo-synthetic-database.mjs`. It rejects unexpected organisation, owner, facility, zone and draft identities; real facility address/brand fields, non-default Corrections facility policies, players, media and playback proofs; foreign tenant-scoped records; and nonempty public tables outside the explicit seed, catalogue, session, audit and migration allowlist. Existing plans must match the authoritative catalogue field-for-field, including tier and entitlements. Failure aborts the seed without logging row contents or credentials. This is a guard, **not** independent proof that free-text audit details, authentication metadata or external storage contain no real data.
- Outside DEMO mode, the existing registration, invitation, Studio, product-access, and other six-product behavior is unchanged by these guards. The Inside tour returns 404.
- The public `ruvanas.com` Coming Soon page and production Render service are outside this branch. No production migration or deployment is part of this work.

## Local evidence, 2 October 2026

- `node --test tests/inside-demo-registration-boundary.test.mjs tests/inside-demo-tour.test.mjs tests/self-service-registration-closed.test.mjs`: 8 passed.
- `npm test`: 1,020 passed, 8 skipped, 0 failed after Prisma Client generation, including the seed-boundary tests.
- `npm run ci:static`: passed, 1,492 files checked.
- `npm run build`: passed; it emitted the existing Studio CSS warning and expected missing-local-`DATABASE_URL` messages while generating pages without a database.
- With the built app started locally in DEMO mode, GET `/` redirected to `/inside-demo`; GET `/inside-demo` returned 200; the four registration/invitation pages returned 404; and same-origin POSTs to the four account-creation endpoints returned the DEMO-specific 403 response. These tests used no database.
- In a separate local run with `RUVANAS_ENVIRONMENT=LOCAL`, the tour returned 404 and the four existing registration/invitation pages remained reachable (200). This checks that the new page guards are DEMO-only, not that public account creation is enabled outside DEMO.
- The ported seed and validator passed syntax checks; database-free focused tests passed, and an incorrect service name was rejected before any database connection. The validator and synthetic-only preflight have **not** run against the demo database at this branch head; their live behavior requires the isolated demo environment.
- A read-only Render dashboard inspection on 2 October showed the existing demo web service on the Free plan, tracking `codex/ruvanas-inside-demo-20260930` at deployed `b65cfab`, with Auto-Deploy and PR previews Off. The production `ruvanas-platform` service still showed deployed `bff07f3`, Auto-Deploy Off, PR previews Off, and Maintenance Mode Enabled. These are time-bound observations, not future guarantees.
- On 3 October, after tightening the synthetic-only preflight, the full local unit suite passed **1,074** with **8 skipped** and no failures; static integrity checked **1,494** files; syntax checks passed. These are local, database-free checks and do not establish the live demo database's contents.

## Before any demo-service update

1. Confirm the destination is the existing isolated demo service and database, not the production service; verify its `RUVANAS_ENVIRONMENT` is exactly `DEMO` and its branch/deploy settings. Keep production Auto-Deploy Off.
2. Confirm no production credentials, customer data, facility data, media, or live players are connected to that service. Do not infer this from source code alone.
3. Run exact-head GitHub CI and review the branch diff. Re-run the DEMO HTTP boundary checks against the deployed demo URL after deployment.
4. Do not portray this tour as live Edge playback or operational Corrections acceptance. C8 and the remaining C9 release gates remain open.
