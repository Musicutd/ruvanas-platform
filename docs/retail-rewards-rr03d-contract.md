# RR-03d local redemption corrections

14 November 2026. Continue the user's local-only Rewards work with manager-only correction of a mistaken redemption. Preserve RR03c and preview49334 unchanged. No publication, production migration, live account, registration, billing, encoder or stream change. Synthetic fixtures only. No payment or refund processing.

## Local behavior

- Additional exact-string default-off `RUVANAS_RETAIL_REWARDS_REVERSALS_ENABLED` requires valid enabled checkout, shopper and main Rewards flags. Existing public claims/private-preview policies remain unchanged.
- A currently authorised OWNER or MANAGER with exact-location REVERSE authority can inspect and reverse a receipt. VIEWER/cashier REDEEM alone, Shopper credentials, a different tenant or location cannot. Reuse existing action/role guards; do not widen them.
- One full correction per receipt, within 24 hours after its original `occurredAt`, not at/after the deadline. Reason is exactly WRONG_COUPON, PURCHASE_CANCELLED or DUPLICATE_CHECKOUT, with explicit correctionConfirmed:true. No free text or shopper PII.
- Keep the original receipt, claim, issued terms and code consumed forever. Insert a separate immutable reversal record. No deletion, record rewriting, reactivation, payment, stock change or refund.
- A reversed redemption no longer consumes offer total, per-shopper lifetime or daily allowance. Counts use the same stable offer identity and fixed calendar across revisions/shops. The shopper must request a fresh claim, meeting all current eligibility, limits and offer terms. Reversal never automatically issues one.
- Merchant monthly service usage continues to count every successful redemption, including reversed ones. Corrections cannot replenish this service quota. UI explains this and that a replacement coupon is not guaranteed.
- Old shopper claim shows REVERSED and original receipt plus reversal date/reason; no credential can be issued for it. Old redemption same-request retry returns its original receipt with current reversal status, never consumes again.
- Reversal may correct a receipt even after shopper expiry/revocation or offer cancellation: only original receipt identity, deadline, current merchant/manager and active location authority matter. Global feature disable and current tenant access still fail closed.
- Same tenant+member+idempotency key and exact request returns original correction after current REVERSE authorization, even after the 24h window. Changed payload conflicts; another key against an already reversed receipt returns ALREADY_REVERSED. No disclosure to foreign scope.
- Serialize on RewardProgram then RewardOffer using the same order as checkout; lock current staff/session/user/member, subscription/plan/grant and location, then receipt. Recheck current authority/time before commit. SERIALIZABLE bounded retries, one reversal per receipt. No external calls. Corrections and final-use redemption/claim races must share the program lock.

## Database agent ownership

Additive migration139 `20261216000000_retail_rewards_reversals`. Do not change historical migrations, RewardAuditEvent schema or reset guards. Add `RewardRedemptionReversal`:

id PK; organisationId; redemptionId UNIQUE; actorUserId and actorOrganisationMemberId historical scalar IDs; reason varchar32 with three-value CHECK; idempotencyKeyHash/requestHash64hex; occurredAt finite TIMESTAMPTZ(3). Unique(organisationId,actorOrganisationMemberId,idempotencyKeyHash). Index(organisationId,occurredAt). Add unique RewardRedemption(id,organisationId) and composite reversal FK(redemptionId,organisationId) -> receipt(id,organisationId), Restrict delete/update. Organisation relation as appropriate. All identifiers checked with existing helper. Immutable UPDATE/DELETE/TRUNCATE trigger; no reset bypass. Relation names: RewardRedemption.reversal and Organisation.rewardRedemptionReversals.

Own schema/migration, dedicated database tests/harness/CI, compatibility evidence. Fresh139 and138→139 with legacy checkout data preserved/zero backfill. Actual races, FK/immutability/rollback, scoped role checks and queued revocations, expiry boundary and delayed commit, exact retry/conflict, revoked Shopper/cancelled offer correction, net-offer counters vs gross monthly counters, fresh claim after reversal and old-claim replay denial. Preserve prior suites/guards; use a dedicated CI job if retained immutable fixtures require it. Local harness role rr03d_qa, databases ruvanas_rewards_reversal_full and ruvanas_rewards_reversal_upgrade, unique owned cluster under output/retail-rewards-rr03d-20261114/sessions; same export interface as rr03c helper.

## Service agent ownership

Own reversal-service.mjs, narrow checkout-service.mjs changes, errors.mjs and focused service test fixtures. Root supplies reversal-contracts.mjs. Factory createRewardReversalService({db,env,loadContext,clock}) methods locations({page?}), inspect({redemptionId,locationId}), reverse({redemptionId,locationId,reason,idempotencyKey,correctionConfirmed:true}). Exact guard action REVERSE for every returned location or receipt; bounded25 candidate page.

Key HMAC domain `ruvanas-rewards-reversal-request:v1:` with SESSION_SECRET>=32. SHA256 canonical request hash includes redemptionId/locationId/reason/true, no arbitrary fields. Same locks/authority checks as checkout. Only scalar immutable ledger insert. Current in-memory clock must be monotonic. Current membership/role/session/grant/location rechecked inside transaction. No broad audit schema changes.

Checkout changes: include redemption.reversal; all receipt DTOs gain `reversal:null|{id,reversedAt,reason}`; claim status REVERSED when this exists. Claim still consumed; no code reissue. Net total/personal/daily counts exclude receipts having a same-tenant reversal, monthly count stays gross. Changes take effect from retained history even if reversal feature is later disabled. Existing no-reversal behavior remains. Update own checkout focused tests for added nullable response field, no weakened assertions.

Success DTOs:
- Receipt = existing checkout receipt plus reversal nullable above. Never shopper, staff, tenant, location IDs or token. id is original opaque receipt ID.
- locations `{ok:true,locations:[{id,name}],page,hasMore}` exact scope.
- inspect `{ok:true,receipt,canReverse:boolean,deadline:ISOdate}`; reversed/too old receipt can be inspected but cannot change.
- reverse `{ok:true,receipt}` with non-null reversal.
- generic REDEMPTION_UNAVAILABLE404, ALREADY_REVERSED409, REVERSAL_WINDOW_CLOSED409; existing invalid400/conflict409/forbidden403/feature-disabled403 errors retained.

## Root ownership

reversal-contracts.mjs, reversal-dtos.mjs, reversal-http.mjs, reversal-server.js, app/api/retail-rewards/reversals/{locations,inspect,reverse}/route.js; update checkout DTO schemas and relevant HTTP fixtures. GET locations page-only; POST inspect and reverse strictJSON<=8192, Origin/Sec-Fetch-Site, noqueries; private/no-store/nosniff. Independent IP then current principal rate limits. Shopper cookie cannot authorize. Gated link from client Rewards page. Built HTTP acceptance with synthetic separate cookies, migration history, feature-off routes/SSR, counter-restoration then new redemption, old credential denial, repeat retry, wrong tenant/location/cashier, stale credentials/window.

## UI agent ownership

New /dashboard/retail/rewards/corrections page (server loader loadRewardCorrectionsPage in reversal-server) and manager CorrectionClient +CSS. Shop selection, receipt confirmation ID, Review receipt (no mutation), clear original terms/amount/date/status/deadline, enumerated reason + explicit confirmation, Reverse redemption, original receipt with correction result. Retry same request/key after lost response; changing input creates new request. No arbitrary customer searches or speculative counters.

Update ShopperClaimsClient and CheckoutClient receipt presentation: reversed badge/date/reason, old code remains unavailable; explain fresh eligible claim and no automatic refund. Existing shopper wallet/authenticated journey remains isolated. Synthetic actual React preview in new owned random-loopback port, preserve49334, desktop/mobile/keyboard/test denied role/window, lost-response retry, immutable original amount, replacement-use guidance. No live browser requests.

## Release boundaries

Everything local and disabled. QR/scanner, public pilot/provisioning/recovery and detailed analytics remain later milestones. This stage supplies correction evidence, not accounting, refunds or sales verification. PostgreSQL18 local checks do not replace PG16 CI. No commit/push/deploy or production DB operation is requested.
