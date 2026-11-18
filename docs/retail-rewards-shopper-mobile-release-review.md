# Shopper web app: local release review

Reviewed 18 November 2026. Branch: `codex/rewards-shopper-mobile-20261118`. Base: `208558425dd0aa4ba3b4f8472d1a14104b982b4c`.

## Decision

The local candidate passes review after two fixes. It is ready for release-commit preparation and full GitHub CI. This is not deployment clearance or approval to enable Rewards. The changes remain local and uncommitted.

Rewards remains disabled, public registration closed, and both encoders untouched. No hosted account, service, configuration or charge was changed. The US$15.75/month allowance is unchanged; billing was not queried or re-estimated during this review.

## Scope

- Location selection, shop search/category filtering and credit-card-style vouchers.
- Personal uses left from the authenticated shopper's successful, non-reversed redemptions across offer revisions. Claims and code views do not consume uses. The value is an observation, not a reservation; checkout still checks daily limits, offer capacity and eligibility.
- The existing explicit claim, short-lived checkout credential, wallet and receipt flows.
- A new authenticated, read-only location-discovery route with existing feature, session, tenant, publication and cache restrictions.
- An isolated loopback preview with synthetic in-memory data. Production modules do not import preview fixtures.

No schema, migration, package, lockfile, deployment workflow, registration setting, encoder or hosting change is included. The separate disabled-shopper activation preparation is not included.

## Findings resolved

1. **Private-preview location navigation (release blocker).** The exact pilot route allowlist omitted `/api/rewards/discovery/locations`. Initial server-rendered locations bypassed middleware by calling the handler directly, so the sample preview and initial page could work while shopper-only location search, pagination and town changes received 401. Added only GET/HEAD for that exact route to the existing SHOPPER authentication path. A regression failed before the fix and passed after it. Actual middleware-body tests with real shopper policies and a synthetic database adapter now cover current, missing and revoked shopper sessions, disabled gates, and registration closure. Write methods, suffix paths, encoded variants and server actions remain excluded.
2. **Keyboard focus under mobile navigation (accessibility issue).** At 320px, the fixed bottom navigation obscured the lower portion of the focused More locations button. Added scroll margins scoped to the shopper page's focusable controls. Keyboard traversal now checks locations, shops, vouchers, checkout, Account and wallet at 320px and 390px, including code display. All 174 focus observations are unobscured.

Independent source review found no remaining actionable defect in these changes.

## Evidence

Evidence is stored under workspace `output/retail-rewards-shopper-mobile-release-20261118/`:

| Check | Result | Evidence |
| --- | --- | --- |
| Final focused Node 20.20.2 tests | 82 passed, no failures/skips | `reviewed-node20-tests.log` |
| New middleware admission regression | Red before fix; 34 focused checks passed after integration coverage | `pilot-locations-regression-before.log`, `pilot-locations-middleware-result.json` |
| Mobile/desktop component browser checks | 9 groups passed; 174 keyboard-focus observations, no obscured controls | `browser/browser-results.json` |
| Final Next 15.5.28 production build | Passed | `next-build-reviewed-result.json`, `next-build-reviewed.log` |
| Real local Next route smoke, Rewards flags off | 13 checks passed; process stopped | `disabled-routes-result.json` |

The route smoke used the production build on a temporary loopback port, a sanitized child environment and an unreachable dummy database. Shopper pages returned 404, discovery/wallet APIs returned FEATURE_DISABLED with private/no-store responses, and registration showed its paused notice and rejected account creation. No real session, account or database was used.

The earlier 13/13 PostgreSQL 16.16 integration tests remain applicable: the reviewed discovery/count/database source is unchanged. Evidence: workspace `output/retail-shopper-mobile-20261118/backend-postgres16-result.json`. All 143 existing migrations replayed in that isolated synthetic database; it was stopped afterwards. No new migration is needed here.

The final release manifest records source hashes, reviewed checks and boundaries. The prior implementation manifest is preserved as historical evidence rather than overwritten.

## Remaining release gates

1. Prepare an exact release commit containing the reviewed tracked and new files. Do not include local evidence, generated builds, real configuration or the separate activation worktree. Review publication scope before any public push.
2. Run the repository's full clean-install Node 20/PostgreSQL 16 GitHub CI on that commit, as required by `docs/runbooks/release-verification.md`. The local tests and build are not a substitute for the complete workflow. No GitHub push or CI run was started by this review.
3. Before a later authorised website deployment, verify the actual website baseline and rollback commit. Do not assume this local base is still the hosted version. Deploy only the website when authorised; leave both encoders and all Rewards activation flags unchanged.
4. Before enabling a hosted shopper pilot, verify the complete Next/session/database journey with the intended separate shopper account. The local component preview and middleware harness are not hosted acceptance. Physical mobile and two-device cashier QR scanning remain untested; the accepted computer-only workflow does not prove those devices.

The bounded location directory uses sequential authority/listing reads. Large-directory performance should be measured before broad availability; no performance fault was demonstrated for the pilot.

## Rollback compatibility

This candidate adds a read-only route and presentation changes without a schema or data migration. Reverting the candidate's source delta is schema-compatible with its base; there is no database downgrade or data deletion step. A future operational rollback must target the verified previously deployed website commit and preserve its existing disabled Rewards settings, closed registration and encoder configuration. No rollback or deployment was executed during this review.
