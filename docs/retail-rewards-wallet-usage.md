# Shopper wallet usage — local milestone

Date: 18 November 2026. Baseline: `3d44e38`. This work is local and has not been committed, pushed or deployed. The homepage work is separate and unchanged by this milestone.

## Behaviour and authority

The shopper wallet and checkout panel now display personal uses left alongside the existing claim status. Claim, wallet and credential responses include a strict `usage` object: `{ used, limit, remaining, asOf }`.

- `used` counts successful redemption receipts without a reversal, scoped to the exact `organisationId`, `offerId` and `shopperId`. It includes all revisions and redemption locations for that stable offer.
- `limit` comes from that claim's immutable issued terms (`perShopperLimit`), never the current offer draft. Claims issued under different limits can therefore show different remaining allowances against the same personal redemption count.
- `remaining` is `max(0, limit - used)`. `asOf` records the observation time. Duplicate offers in one wallet request share a count and its original timestamp; subsequent requests read fresh counts.
- Browsing, claiming, requesting a checkout code, rotating a code and idempotent retries do not consume uses. A successful redemption does; a reversal restores the offer allowance without making the consumed claim or its old code usable again.
- Usage is a projection, not permission to redeem. Claim status, expiry, shop availability, daily limits, total offer limits and authorization remain independently enforced. In particular, uses left do not turn an expired, reversed or unavailable claim into a ready claim.

Additional count reads are followed by existing time, feature and access checks. Invalid or failed counts fail closed rather than becoming zero. The DTO rejects missing usage, inconsistent limits or arithmetic, unsafe counts and extra private fields. The UI has a conservative unavailable-count presentation for missing or invalid data; it does not invent a remaining balance.

## Local evidence

- **95 focused Node 20 tests passed**, covering checkout, reversals, wallet usage, shopper UI/preview, feature policy and closed registration.
- **5 Node 20/PostgreSQL 16 checks passed, none skipped**, including real claim/retry, credential rotation, redemption/retry, reversal and refreshed usage against a new disposable loopback database with synthetic records. Exact tenant/shopper/offer scope, cross-revision and cross-location counting, issued limits and unchanged statuses were checked.

The browser preview uses production shopper components with a synthetic, in-memory transport. Its controls and screenshots demonstrate presentation and interaction, not a real shopper session or a hosted checkout. The separate PostgreSQL tests exercise the actual service and database with synthetic accounts; they do not establish real-account sign-in or hosted readiness.

See the workspace evidence directory `output/retail-rewards-wallet-20261118/`: `focused-tests.log`, `backend-postgres16-result.json`, `backend-postgres16-tests.log` and the final `report.md`. The final report records browser and production-build outcomes; this document does not assume those pending results.

## Repeat the focused checks

From this worktree, with project dependencies installed and Node 20 selected:

```powershell
$walletTests = @(rg --files tests `
  -g 'retail-rewards-checkout-*.test.mjs' `
  -g 'retail-rewards-wallet-usage.test.mjs' `
  -g 'retail-rewards-reversal-*.test.mjs' `
  -g 'retail-rewards-shopper-ui.test.mjs' `
  -g 'retail-rewards-shopper-mobile-preview.test.mjs' `
  -g 'retail-rewards-feature-policy.test.mjs' `
  -g 'self-service-registration-closed.test.mjs' `
  -g '!*-database.test.mjs')
node --test $walletTests
```

The verified local Node executable is `../../output/retail-rewards-rr07u-pilot-admin-20261117/toolchain/node-v20.20.2-win-x64/node.exe` relative to this worktree. The disposable database harness is deliberately tied to this workspace and its owned fixture directory:

```powershell
node ../../output/retail-rewards-wallet-20261118/backend-postgres16.mjs --run
```

It requires Node 20 and the existing local PostgreSQL 16 toolchain, rejects ambient database connection settings and repository dotenv files, creates a new loopback cluster, verifies its identity and stops that owned cluster afterward. Do not point this test at an existing application or hosted database. The underlying test is `tests/retail-rewards-wallet-usage-database.test.mjs`; running it without the harness does not constitute a full database pass.

## Repeat the browser preview

```powershell
node scripts/preview-shopper-mobile.mjs --port 8789
```

Open `http://127.0.0.1:8789/`. Expand **Preview controls**:

1. **Load sample wallet** shows reusable, single-use, exhausted, expired, corrected and unavailable examples.
2. **Simulate cashier redemption**, then refresh vouchers, shows one fewer use and a receipt.
3. **Simulate correction**, then refresh, restores the offer allowance while the old claim remains corrected.
4. **Toggle sample usage counts** demonstrates the honest unavailable-count presentation.
5. **Reset demo** clears the tab's synthetic work.

These controls exist only in the standalone local fixture, not the shopper product. They do not call live APIs or create real purchases. With the preview running and Playwright installed, run the existing browser check in another terminal:

```powershell
node scripts/check-shopper-mobile-browser.mjs --base-url http://127.0.0.1:8789/ --output .next/wallet-browser-check
```

The runner accepts `--playwright-module` when Playwright lives in a separate installed module tree. It only targets loopback, blocks external requests and masks checkout codes and QR codes in captured screenshots.

## Remaining release gates

No schema or migration was added, no feature or registration flag was changed, no hosting service or charge was created, and neither encoder was touched. Rewards remains disabled and registration closed; this milestone authorizes no deployment or rehearsal.

Real-account sign-in verification and renewal of expired pilot grants or membership remain separate outstanding gates before any future authorized hosted rehearsal. Local fixture and database passes do not complete the hosted shop/shopper setup. Review the final local report and release diff before seeking the next publication or rehearsal authorization.

## Release-review follow-up

The local review on 18 November 2026 found that the new wallet database suite would otherwise be skipped by GitHub CI. The candidate now adds a dedicated `rewards-wallet-database` job using Node 20 and a disposable PostgreSQL 16 service. Its fixture requires an empty database, so it runs separately from checkout and reversal suites that retain immutable synthetic history.

The database test accepts either the existing owned local cluster or this exact GitHub-hosted Linux job. CI mode requires explicit opt-in, the expected workflow/job identity, exact loopback database URL and synthetic role, and a verified PostgreSQL 16 server identity. Wrong jobs, self-hosted runners, incompatible versions, mixed local/CI settings and unexpected database targets are rejected. Tests of the CI guard on this computer use injected identity values; they do not substitute for a real GitHub run.

The broader local review suite passed 494 checks with no skips. The unchanged application source retains its earlier passing build, disabled-route and browser evidence. Final database and workflow-validation results, candidate hashes, remaining limitations and the release recommendation are recorded in `output/retail-rewards-wallet-release-review-20261118/report.md` in the workspace. This review creates no commit, pull request, hosted CI run, deployment, migration or charge.
