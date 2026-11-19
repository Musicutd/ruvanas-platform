# RR-06b: optional campaign choice and immutable coupon association

Local unpublished candidate. No production database, service, credential, music file, encoder, registration setting or charge is changed. Existing RR06a review and previews remain available. This milestone stores an optional association; it does not start or modify audio, claim a sale was caused by a campaign, or change an existing shopper claim.

## Merchant workflow

Select a saved coupon draft, review matching published campaigns, choose one and explicitly save. Removing a choice is also explicit. The screen separates the saved draft choice from the association on the current published coupon version. A merchant with publication permission uses the existing coupon publisher to issue a new immutable version. No automatic publication occurs when saving a choice.

Campaigns must belong to the merchant organisation, target exactly the coupon draft's active shops through direct LOCATION targets, overlap its dates in every shop timezone, and retain a valid published configuration hash including current zone topology. Promotional assets must remain approved and ready. Mandatory and Retail Media order campaigns remain excluded. Calendar compatibility is not proof of scheduled delivery, an impression or a purchase.

## Authority and routes

`RUVANAS_RETAIL_REWARDS_CAMPAIGN_LINKS_ENABLED` is an exact default-off flag requiring both Rewards and `RUVANAS_RETAIL_REWARDS_CAMPAIGNS_ENABLED`. READ and MANAGE_OFFERS are required for every draft and published shop in the same current authenticated business organisation. Publication additionally requires PUBLISH_OFFERS. No shopper, private preview, cashier or platform-admin bypass is introduced. Existing authentication, subscription, entitlement, expiry, role ceilings and capacity limits still apply.

POST `/api/retail-rewards/campaign-links/review`: `{offerId, expectedVersion, page?}`. Returns a strict review containing the draft summary, saved selection, current published association and at most 25 eligible campaigns. Underlying candidates are capped at 100; overflow fails rather than providing an incomplete eligibility claim.

POST `/api/retail-rewards/campaign-links/save`: `{offerId, expectedVersion, campaignId, campaignPublicationRevision?}`. A non-null campaign requires its reviewed publication revision; null explicitly removes the saved choice and forbids a campaign revision. Returns the standard saved offer DTO with its incremented version. The client rereads the selection after success. No organisation, hash, actor, asset URL or arbitrary snapshot is accepted from the browser.

Both routes require same-origin bounded JSON, independent IP/principal throttling, current server authority and private no-store responses. Responses omit source hashes, storage keys, media URLs and staff identities. Existing READ-scoped coupon listing supplies the selector; opening and saving each campaign review additionally checks MANAGE_OFFERS over every declared shop.

## Transaction and history

Saving is a serializable offer transaction with optimistic version matching, programme/authority locks and an audit event. Sources and every relevant existing campaign, target, schedule, rule, asset, shop and zone row are revalidated while locked. Concurrent changes force retry/conflict. Read review uses bounded snapshots and fresh checks. Neither pathway calls the campaign publisher, worker or streaming controls.

`RewardOfferCampaignDraft` stores the chosen same-tenant campaign revision and hash outside shopper terms. `RewardOfferCampaignRevision` pins a safe snapshot only after a new RewardOfferRevision is inserted in the same top-level transaction. Its snapshot contains schemaVersion, campaignName, promoName, publishedAt, startsOn, endsOn and locationIds. Existing claims retain their original offer revision. Changing/clearing a draft, pausing or resuming a coupon cannot rewrite that history.

Database composite keys prevent cross-tenant links. Snapshot keys, dates, sizes and shop identifiers are checked. Immutable pins reject updates, deletes and truncation. A transaction identity check rejects inserting a link against an older coupon revision. Retaining a linked campaign uses restrictive foreign keys; archiving remains possible, deletion or tenant reassignment cannot discard the association.

The additive migration introduces two tables and two audit actions; it contains no backfill or activation. Apply it before a future application release. On rollback keep the schema and history: the previous app can publish unlinked coupons, but a deferred database check rejects a publication that would silently omit an existing draft campaign choice. Disabling the feature similarly blocks linked publication while preserving ordinary unlinked coupon operations. Do not manually delete choices to bypass that safeguard.

Existing-row locks give explicit ordering against concurrent updates. New optional deny policies or newly inserted topology follow PostgreSQL serializable ordering; no unsupported global gap-lock guarantee is claimed. A pin records compatibility at publication, not an ongoing promise that the campaign will stay active.

## Local verification

Use synthetic local fixtures and owned loopback PostgreSQL/Next only, with a clean environment. Verify a seeded upgrade from all 139 predecessor migrations, the additive 140th migration, legacy app behavior, cross-tenant/role/scope rejection, stale campaign revisions, rollback on pin failure, concurrent writers, immutable history and existing claims. Verify built HTTP and actual responsive React workflows. Keep all historical migrations, dependencies, encoders, streaming code and registration configuration unchanged.

Production Rewards remains disabled. No publication or live database migration is authorized by this local milestone. Reporting of campaign associations against individual claims/receipts is a later step; current reports must not invent campaign attribution or sales uplift.
