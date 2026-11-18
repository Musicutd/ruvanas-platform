# Simple shopper web app

Local implementation of the approved 18 November 2026 mobile design. No release or activation is part of this change.

## Shopper journey

1. Choose a town, then select **Find shops**.
2. Search or filter the participating shops in that town.
3. Open a shop to see vivid credit-card-style vouchers. Each card shows the saving, minimum spend, validity, single/repeat-use type and personal uses left.
4. **Use voucher** opens the published terms. The existing explicit claim and checkout-code controls follow. Only authorised shop redemption consumes an allowance.

Explore, My vouchers and Account form the bottom navigation. The wallet retains issued terms, short-lived credentials, receipts and corrections. Checkout codes retain their existing expiry, rotation and hide-on-leave behavior. The brief card is supplemented by full terms; it does not replace them.

## Read contracts and limits

- `GET /api/rewards/discovery/locations` accepts bounded `search`, `countryCode` and `page`. It returns eligible public town/country pairs in bounded shop-candidate windows. The client merges repeated pairs across pages and offers location search. It makes no claim to total shop or voucher counts.
- Shop discovery applies `locality` and `countryCode` before pagination, alongside existing category/search controls.
- Shop/offer reads include private `usage: { limit, used, remaining, asOf }` for the authenticated shopper. Counts include successful non-reversed redemptions for the exact organisation/offer across revisions. Claims and code views are not redemptions.
- Remaining uses mean the personal lifetime allowance at read time. Daily limits, shared offer capacity, membership and current publication state are rechecked by the existing checkout service. A read does not reserve capacity.
- Invalid or missing UI usage data never becomes an invented zero or full allowance. The UI falls back to the published limit. The service fails unavailable if its current count cannot be read safely.
- The existing feature gates, shopper authority, tenant guards, publication consent and private/no-store headers remain in place. No database migration is required.

## Local verification

See `retail-rewards-shopper-mobile-local.md` for the loopback demo and browser check. The demo bundles the actual components with synthetic fixtures and blocks outbound requests; it does not require enabling Rewards or activating a real shopper. Preview-only cashier controls are outside the product UI.

Verification includes Node 20 focused tests, an isolated PostgreSQL 16 integration run, a complete Next build and desktop/mobile browser checks. No hosted database, production account, registration setting, encoder, supplier plan or charge is changed. The earlier disabled-shopper activation preparation remains in its separate worktree and is not silently included or activated here.
