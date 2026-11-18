# RR-02 — Client Admin offer management

## Scope

Local implementation on 14 November 2026, following the account model in `retail-rewards-account-model.md`. A Client Admin manages offers for their own organisation. A Shopper / Subscriber is a separate consumer context. The existing organisation subscription remains the client plan; it is not repurposed for shopper membership.

This milestone adds the Client Admin offer list, category/search/status filters, and a three-step editor: offer, shops and rules, then review. A shop can have multiple offers. Supported terms include percentage discounts, fixed discounts, buy/get offers, minimum spend, selected shops, validity dates/timezone, exclusions, combination rules and explicit usage limits. For example, a reusable 10% discount above EUR50 can be limited to one use per shopper per day and ten uses per shopper overall.

Saving changes preserves a draft. Publishing creates an immutable terms revision. Further editing cannot silently replace published terms; publication, pause, resume and cancellation require separate actions. Resume uses the existing published revision, not an edited draft. Cancellation retains history.

This is not a shopper launch. Consumer accounts, category-to-shop discovery, saved/claimed coupons, redemption, checkout validation and shopper billing are not implemented by RR-02. Publication here records an offer revision; it does not produce a redeemable coupon. A reusable benefit will require a fresh separately validated claim for each use in the subsequent redemption milestone.

## Isolation and access

- Rewards routes and navigation remain gated by `RUVANAS_RETAIL_REWARDS_ENABLED`; public claims remain separately disabled. New Rewards handlers do not query authentication or the database when the feature is off. The existing dashboard layout still performs its normal core authentication.
- Authority comes from the authenticated session's exact active organisation and current membership, client subscription, Rewards entitlement and staff grants. Request bodies cannot supply organisation, actor or entitlement authority.
- Ordinary client access does not acquire a Super Admin bypass. Any future cross-client support UI must use explicit, audited platform operations.
- Existing private-preview accounts remain excluded by the foundation policy. No current tester was granted Rewards access, and no account or grant was created by this work.
- Every draft and published target shop must be within the caller's permitted scope. Missing, foreign and inaccessible offers share the same unavailable response.
- Writes use bounded serializable transactions, optimistic versions and a per-organisation programme lock. Quotas reserve scheduled, active and paused unexpired offers and count the union of their published shop targets. Audit records commit with the mutation.
- Exact existing authority rows and target shops are locked before the final permission/status checks. A revocation committed while a save waits forces a transaction retry and fresh denial; a revocation against an already-held row waits until that save commits. This protects the tested session, membership and entitlement revocations without claiming a global lock over newly inserted optional policies.
- Mutations require the configured canonical website origin; cookies, credentials and client-owned identifiers never establish tenant access. Payloads are strict, bounded JSON. Responses are private and not cacheable.

## Additive database change

`20261212000000_retail_rewards_offers` adds `RewardOffer`, `RewardOfferLocation`, `RewardOfferRevision` and associated enums, indices and constraints. Composite foreign keys enforce tenant consistency. Published revisions reject update, deletion and truncation. Existing audit actions/metadata validation are extended without backfilling or activating any account.

The migration follows the repository's existing migration ordering. No earlier migration is edited. It uses a short lock timeout and a bounded statement timeout, so a busy production database should fail the migration rather than wait indefinitely; any eventual release must inspect its result before proceeding.

The existing test-data reset dependency graph ignores only the precise optional pointer from an offer back to its immutable published revision. Revisions still precede offers in reset order. This makes empty Rewards tables compatible with the existing reset tool; it does not permit deletion of published history. Attempting to reset an organisation with immutable Rewards evidence fails atomically.

## Verification and release boundary

Verification scripts and synthetic evidence are kept in the workspace's `output/retail-rewards-rr02-20261114` directory. Checks cover unit policies, the built HTTP application, desktop/mobile interactions, and owned disposable PostgreSQL databases. Database verification includes a complete migration replay and an upgrade from the 134-migration predecessor, with legacy synthetic rows compared before and after.

The local preview uses sample shops and offers and keeps changes in memory. It has no live accounts, music, claims, payment flow or production connection. Passing this preview is not evidence of production activation or consumer redemption.

No production migration, Git push, deployment, feature activation or new service is authorised by this local milestone. The live website, both encoders, registration settings, music permissions, other channels and hosting allowance are unchanged.

For a later approved release: validate the exact commit and additive migration, keep both Rewards flags false, apply the migration only to the intended website database, deploy only the website, and verify the disabled routes and registration. Leave encoders alone. An application rollback should keep the additive tables and immutable history; do not drop Rewards data or rewind migrations. Enabling Rewards, provisioning a test client and releasing shopper access are separate steps.

## Next dependent work

Define and implement a separate Shopper / Subscriber identity and membership contract before adding claim and redemption flows. Preserve the category → shop → available coupons journey. Each redemption must be atomic and replay-safe, with staff validation scoped to that client's shop; usage limits shown by this editor must be enforced by the redemption service rather than trusted from a browser. Shopper pricing and membership tiers remain undecided.
