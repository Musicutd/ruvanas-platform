# Shopper categories and savings foundation

Local candidate, 22 November 2026. Baseline `456134e406aa07be5b4c610906ad0d0cc63e8723`. No release, feature activation or hosted migration is part of this work.

## Shopper experience

The discovery journey now has four explicit steps: location → category → matching shops → vouchers. Changing location returns to category selection. Back navigation preserves the selected location and category. Category selection, search and pagination remain read-only and do not issue a coupon. A deliberate All categories choice is available. Existing voucher cards, terms, claims, checkout codes and uses-left behaviour remain in place.

Household retains the stored `HOME` category key; existing offers do not need rewriting. `ELECTRONICS` is added to the shared offer/discovery category contract. Other categories are unchanged.

The shopper navigation contains Explore, My vouchers, My savings and Account. The new savings screen is separate from Client Admin coupon management, checkout and reports.

## Savings evidence

`GET /api/rewards/savings` and `/rewards/savings` require existing shopper authority and the existing Rewards/shopper feature gates. Server rendering and refresh use the same throttled path. No caller can supply a shopper identity, payment amount, proof of payment or currency conversion. Responses are private and no-store.

The service reads only the authenticated shopper's redemption receipts. It validates the receipt/claim organisation, shop, offer and shopper relationships and reversal identity. Successful receipts from multiple participating merchants may contribute to that same shopper's history. Another shopper's receipts cannot. Unused claims never contribute.

The snapshot reports all-time recorded savings as of its cut-off. Reversals effective by that cut-off are removed. Currencies are separate. A redemption without a recorded money value is counted separately; its value is never invented. Reads are bounded to 10,000 receipt rows. Exceeding that bound fails the snapshot rather than showing a partial all-time total. Authentication, feature flags and clock progression are rechecked after data collection. The snapshot describes recorded state, not a guarantee against later corrections.

**Subscription payments are not integrated in this milestone.** Runtime responses explicitly set payment evidence to `UNAVAILABLE`, and subscription paid/net benefit to `null`. They do not assume that internal shopper membership is paid, borrow Client Admin billing records or treat a missing payment history as zero.

The pure internal projection contract supports future verified, complete shopper-membership payment history. It validates settled payment/refund references, currency, chronology, duplicate events, refunded amounts, safe integer arithmetic and all-time coverage through the snapshot time. A marker is not proof of payment: a future trusted payment adapter must establish that provenance. No HTTP write endpoint, provider integration, shopper charge, price or database payment ledger is added here.

Net benefit equals recorded coupon savings minus settled subscription payments after refunds, in one currency and the same period. Missing payment evidence or unvalued redeemed offers leaves net benefit unavailable. Positive, zero and negative results use different messages. The local fixture demonstrates €15 paid, €25 saved and +€10 net benefit with clearly labelled synthetic data.

## Verification and boundaries

Focused tests cover actual React event handlers, stale-request cancellation, category/location resets, strict savings projections, refund edge cases, per-shopper scope, inaccessible routes and closed registration. A dedicated Node 20/PostgreSQL 16 loopback fixture exercises the real service and compares every table's contents before/after reads. The fixture rejects hosted or existing databases and stops its own cluster afterward. No new schema or migration is required.

The standalone preview uses the production components with an in-memory transport and blocks external requests. Its savings examples are not evidence of a real payment, signed-in shopper or hosted voucher rehearsal. Browser checks cover 320px, 390px and desktop layouts. Exact results and source hashes are recorded in `output/retail-rewards-shopper-dashboard-20261122` in the shared workspace.

Before release, review the local candidate and its test evidence. A later shopper-billing milestone must supply a persisted, reconciled payment ledger/provider adapter and prove complete coverage before runtime paid/net totals are enabled. Scale review should address the bounded all-time history query and its indexing/aggregation. Real-device camera compatibility and a hosted shop/shopper rehearsal remain separate checks. Rewards remains disabled, registration closed, and neither encoder is changed by this local work.
