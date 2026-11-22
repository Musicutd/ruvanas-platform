# Connected shopper layout and saved wallet — local implementation

Date: 22 November 2026. This builds on the approved location → category → shops → voucher-card layout. The work remains local; it is not a hosted release or a pilot activation.

## Shopper behaviour

- `/rewards` renders the approved vivid dashboard using the existing authenticated discovery services. Location, category, shop and offer searches use their bounded server pages. A shop page shows only that shop's currently eligible published offers.
- Public shop profiles currently have no approved logo/image field. The connected view displays a generated name/initials mark, not a fictional merchant logo. The separate visual fixture can still display its explicitly fictional logos.
- Voucher fronts retain the approved card ratio, gradients, chip artwork and flip interaction. Their displayed terms, expiry and uses left come from the existing public offer DTO and the authenticated shopper's successful, non-reversed redemptions.
- My Wallet stores favourites in the database. Saves survive page reloads and a later authenticated shopper session. Saving does not issue a claim, reserve availability, use an allowance or record savings. The Stack and search operate on the displayed wallet page; pagination remains available.
- Opening checkout refreshes the offer and its terms before using the existing `ClaimOfferAction`. Only the shop's existing redemption service can confirm redemption. Real temporary QR/text credentials are generated through the existing credential route, hidden on leaving, and never stored in favourites.
- Issued vouchers and receipts remain available at `/rewards/wallet`. This history is distinct from favourites and is not migrated into saves automatically.
- Total saved uses the existing authenticated savings snapshot. Different currencies are not added together. Unknown monetary discounts or missing payment evidence are not represented as zero or invented subscription benefits.

## Persistent storage and authority

The additive `RewardSavedVoucher` table binds the authenticated shopper, a public shop profile and an offer. A unique shopper/profile/offer key makes repeated saves idempotent. Composite foreign keys require the offer and profile to belong to the same organisation.

Routes:

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/rewards/saved-wallet?page=1` | GET | Private paginated favourites, total count and current availability |
| `/api/rewards/saved-wallet` | POST | Save a currently discoverable shop/offer pair |
| `/api/rewards/saved-wallet/status` | POST | Read saved state for at most 25 displayed offer pairs |
| `/api/rewards/saved-wallet/[id]` | DELETE | Remove the authenticated shopper's entry idempotently |

The service derives the shopper exclusively from the authenticated shopper session. Caller-supplied shopper or tenant identities are rejected. Other shoppers' saved identifiers cannot expose or remove their records. Mutations enforce same-origin checks, bounded JSON, throttling and strict output projections. Responses are private/no-store.

Saved offers are rechecked against current discovery permissions and entitlements. Withdrawn or expired records retain only a generic removable unavailable entry, not a copy of hidden shop information or terms. Wallet refresh failures clear stale private cards; late requests cannot overwrite a newer shop or account state. Current saved status is reconciled after refresh, including changes made in another session.

Terminal access failures also close an open checkout credential and clear all private dashboard projections. Connected voucher controls identify both the shop and offer for assistive technology. The [local release review](rewards-connected-shopper-wallet-release-review.md) records the resolved findings, final checks and remaining release gates.

## Migration and release boundaries

`20261222000000_retail_rewards_saved_wallet` adds the table, indexes and one public-profile composite uniqueness index. It changes no existing data and grants no music, shop, subscription or pilot permissions.

Only a new owned loopback PostgreSQL 16 database was migrated for verification. No hosted migration, production flags, registration settings, encoder controls or paid services were changed. A future release needs the reviewed additive migration before enabling this code against a database. Rollback can revert application code while leaving the additive table and its data intact; a destructive down migration is unnecessary.

The existing shopper, Rewards, checkout and private-pilot gates remain authoritative. Defaults stay disabled and public registration stays closed. This implementation does not authorise a hosted test or deployment.

## Verification evidence

Local results and screenshots are stored in `output/retail-rewards-connected-wallet-20261122` in the main workspace. The database harness creates and verifies its own loopback cluster, runs with synthetic accounts, confirms the migration preserves the existing tables, and stops the cluster afterward. The browser harness uses the real service/HTTP factories and connected client against that database, without a personal Chrome profile or hosted records.
