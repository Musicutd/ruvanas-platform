# Connected shopper dashboard and saved wallet — local release review

Reviewed 22 November 2026. Branch: `codex/rewards-shopper-dashboard-local-20261122`. Base: `456134e406aa07be5b4c610906ad0d0cc63e8723`.

## Decision

The local candidate passes review after the fixes below. It is ready for release-commit preparation and the full GitHub CI workflow. This is not deployment clearance or approval to activate Rewards. The candidate remains local and uncommitted.

No hosted database, account, service, feature flag, registration setting, encoder or charge was changed. Rewards stays disabled and registration closed in the reviewed configuration. Both encoders remain outside this work. The US$15.75/month allowance is unchanged; hosted billing was not queried or re-estimated.

## Scope and behaviour

The candidate includes the earlier shopper dashboard foundation, approved vivid voucher design and their connected implementation. It connects location → category → shops → that shop's eligible vouchers to the existing authenticated services. Favourites persist in the authenticated shopper's database wallet across reloads and sessions. Saved favourites are separate from issued vouchers and redemption receipts.

Card terms, expiry and personal uses come from current eligible offer data. Saving a card does not claim, reserve, redeem or increase savings. Checkout refreshes the offer and uses the existing claim and short-lived credential flow; only the authorised shop redemption service can confirm a redemption. Savings reflect confirmed, non-reversed receipts, with currencies separated. Subscription payment evidence is not connected, so the application does not invent subscription-paid totals or a net benefit.

Public shop data currently has no approved logo/image field. Connected shops use name initials; fictional shop artwork remains confined to the labelled visual preview. The card proportions, artwork, gradients and CSS were preserved during this review.

## Findings resolved

1. **Revoked access could leave checkout visible.** A `FORBIDDEN` response was not treated like other terminal access failures. An already-open checkout credential and private client projections could remain on screen after membership or pilot access was revoked. The shared dashboard now clears checkout, wallet, saved state, savings and browse data on `UNAUTHENTICATED`, `FORBIDDEN` or `FEATURE_DISABLED`, cancels request lanes and rejects late responses. It preserves the original native Response for the existing checkout child. Temporary service outages remain recoverable. Regression cases failed before the fix; the final actual-browser/database test also confirms that revoking a synthetic membership removes an issued checkout code.
2. **CI could silently omit the new database suites.** The saved-wallet and savings suites accepted only their local harness flags. The existing GitHub `rewards-wallet-database` job now explicitly runs both suites after its current wallet suite, against the same disposable PostgreSQL 16 service. Exact CI job, runner, connection and database identity guards are checked before fixture writes. No new job, hosting service or subscription was added. Local regression checks prove suite selection and rejection before connection when ownership is absent. The actual Linux/GitHub run remains a release gate.
3. **Voucher actions were ambiguous to assistive technology.** Cards and Stack controls from one shop previously shared shop-only labels. Connected controls now include shop and offer title; duplicate titles receive numbered labels within the displayed collection. Rendered React checks cover flip, copy, save/remove, redeem and Stack controls. The fictional preview's labels and visual layout are preserved.
4. **Account navigation had no destination.** The connected page now provides and focuses its `#account` section, preserving the shared Rewards Account navigation and focusing sign-in guidance when access is lost.

Additional middleware tests execute the actual middleware body with the real shopper policies and synthetic adapters. They cover shopper-only admission for the precise saved-wallet and savings methods, missing/revoked sessions, disabled gates, registration closure, wrong methods, server actions and foreign origins. The historical visual-preview documentation now links the connected implementation rather than presenting its old limitations as current.

No remaining blocking local defect was identified in the reviewed scope.

## Verification

Evidence is in workspace `output/retail-rewards-connected-wallet-release-20261122/`.

| Check | Result | Evidence |
| --- | --- | --- |
| Final focused Node 20.20.2 tests | 87 passed; no failures or skips | `focused-tests.log` |
| Owned PostgreSQL 16.16 migration and saved-wallet integration | 12 passed; no skips; all 277 baseline table digests preserved | `backend-postgres16-result.json`, `backend-postgres16-tests.log` |
| Real connected client with actual HTTP/service factories and owned PostgreSQL | 8 groups passed; no browser, service or cross-origin errors | `connected-browser-results.json` |
| Visual regression in local Chrome | 19 groups passed at 320, 390, 900 and 1440px, including both themes, card controls and keyboard navigation | `visual-browser/browser-results.json` |
| Next 15.5.28 production build | Passed | `build.log` |
| Compiled loopback website with Rewards disabled | 14 checks passed; temporary server stopped | `runtime-results.json` |
| Repository static integrity and diff whitespace | 2,140 files checked; passed | `static-checks.log`, final review manifest |

The database checks cover concurrent/idempotent saves, cross-shop and cross-shopper restrictions, current availability, removal, and pagination across 26 saved offers with no duplicates. The browser checks cover location/category/shop browsing, save persistence after reload and another shopper session, isolation, real claim/code creation without a fabricated redemption, access revocation, and a withdrawn offer reduced to a generic removable bookmark. The owned database and browser server were stopped; the database port is closed.

The first expanded browser run stopped because its new synthetic revocation step used an invalid enum value. This was a test-harness error, not an application failure. The harness was corrected to the actual `DISABLED` membership status plus `revokedAt` and rerun successfully in a new owned cluster. Failed-run evidence is retained under `*-harness-error.*`; its cluster was also stopped.

The visual suite uses explicitly fictional in-memory offers and simulated redemptions. It is evidence of presentation and interaction only. The separate connected browser suite uses actual service and HTTP factories but does not traverse Next middleware; middleware admission and the compiled disabled routes are tested separately. None of these checks is a hosted pilot acceptance or a real purchase.

Build output includes existing unrelated CSS compatibility warnings and expected missing-database warnings during unrelated static page generation in the sanitized local environment. The build completed successfully. No ambient database credentials or real shopper sessions were loaded.

## Migration and rollback

`20261222000000_retail_rewards_saved_wallet` adds `RewardSavedVoucher`, its indexes and one composite unique public-profile index. Composite foreign keys bind the offer and shop profile to the same organisation; the shopper/profile/offer unique key makes saves idempotent. It changes no existing row or permission. A populated synthetic baseline was migrated and all 277 existing table digests remained identical.

A later authorised release must apply this additive migration before the new saved-wallet feature is used. Application rollback should use the independently verified previous website release while retaining the additive table, indexes and saved data; do not drop them as part of a website rollback. Old-binary execution against the migrated database was not performed here, and the digest check is not a production restore or exact hosted-binary compatibility test. Keep Rewards disabled through rollback. The candidate also adds the `ELECTRONICS` offer category; if a future enabled pilot creates such offers, assess the old release's category handling before rollback rather than assuming it can edit those records.

## Remaining release gates and limits

1. Prepare and review the exact release commit from the final candidate manifest. Exclude generated builds, local evidence, database clusters and real configuration. No commit, public push or draft PR was created in this review.
2. Run the repository's full clean-install Node 20/PostgreSQL 16 GitHub CI on that exact commit, including the amended database job. The local build uses the existing dependency installation; it is not a substitute for clean-install, audit and the complete workflow required by `docs/runbooks/release-verification.md`.
3. Before a separately authorised deployment, verify the actual hosted baseline, backup and rollback target, and review/apply the additive migration. Deploy only the website; keep Rewards disabled, registration closed and both encoders untouched. This review grants no deployment or activation approval.
4. Before an enabled hosted pilot, verify the complete Next/session/database journey using the intended separate shopper account. Physical mobile devices and two-device QR scanning remain untested. The existing computer-only acceptance does not prove those devices.
5. Wallet and directory authority checks are bounded but perform multiple database reads per page. The 25-entry wallet page passed locally; hosted latency and broad-scale load have not been measured. Public merchant logo support and verified subscription-payment integration remain separate work.

The final review manifest records source and evidence hashes. Earlier implementation evidence remains historical and has not been overwritten.
