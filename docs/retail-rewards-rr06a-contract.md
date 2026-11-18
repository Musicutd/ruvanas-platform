# RR-06a: read-only audio campaign compatibility review

This local milestone prepares the optional Rewards/audio association. It does not save a link, attribute any claim or redemption, publish an offer or campaign, schedule audio, create a service or modify production. Rewards and registration stay disabled in production; both encoders and all other channels remain untouched. Preserve RR05a and its preview.

## Scope and authority

`RUVANAS_RETAIL_REWARDS_CAMPAIGNS_ENABLED` is an exact, default-off flag requiring the main Rewards flag. It is independent of checkout and reporting. Endpoints require current ordinary business authentication and BOTH `READ` and `MANAGE_OFFERS` authority in the same organisation. Every declared offer shop must be covered by both action scopes. Existing role ceilings, subscriptions, active-shop checks and private-preview denial remain intact. Shopper, cashier and platform-admin identity alone provide no access.

Read only published, unexpired or upcoming coupons with a valid latest immutable revision. Do not use mutable draft text as the coupon's published terms. A supplied revision must still match. Bound each underlying candidate set to 101 rows; over 100 returns `REVIEW_TOO_LARGE`, with no partial-success claim. Page accepted results in sets of 25. Apply action scope in database predicates before counting candidates.

The initial adapter supports direct LOCATION targets only. Each campaign's explicit shop set must exactly match the coupon's published shop set. Every related shop is active, belongs to the authenticated organisation and is authorised for both actions. Other target types require later reviewed support; this screen must not pretend they match.

## Existing campaign validation

Accept only same-tenant PUBLISHED campaigns with a positive publication revision, a finite past/current publishedAt and the exact recomputed published configuration hash. Reuse existing pure configuration/target helpers without changing them. The publisher hash includes targetZoneIds; current bounded zone topology and canonical projection must reproduce this value. A stale or unverifiable configuration is not compatible.

Require an APPROVED PromoVersion, ACTIVE same-tenant PromoAsset and READY same-tenant MediaAsset with matching promotional types (COMMERCIAL, JINGLE, ANNOUNCEMENT or VOICEOVER), plus an audio MIME type supported by Retail's commercial uploader. The schema's MediaType records purpose; it has no AUDIO enum. MUSIC is excluded. Do not expose media URLs, keys, hashes, private notes or publisher identity. Mandatory and linked Retail Media order campaigns are excluded from this first self-service adapter. No promotion API, publication, status, playout, webhook or audio code is invoked.

Campaign inclusive calendar dates must overlap the coupon's published [start,end) interval in EACH selected shop's validated timezone. This is coarse date compatibility; weekly dayparts, actual playback, listeners, sales and causation are not established. An exact-midnight coupon end belongs to the preceding day. Invalid or unsupported time calculations fail closed.

Use a bounded RepeatableRead snapshot for each result and fresh outside checks for current identity, grants, role, scope, active shops, feature flag, coupon revision/state/expiry and candidate campaign/asset/configuration eligibility. If a published revision or inspected data changes while reading, return a safe conflict/unavailable response rather than stale compatibility. No shared snapshot across pages is promised. Application operations are read-only.

## API and UI

Factory: `createRewardCampaignReviewService({db,env,loadContext,clock})` with `offers({page?})` and `review({offerId,revision,page?})`.

GET `/api/retail-rewards/campaign-review/offers?page` returns `{ok,offers:[{id,title,revision,startsAt,endsAt,shopCount}],page,hasMore,checkedAt,reviewOnly:true}`.

POST `/api/retail-rewards/campaign-review/review` accepts only `{offerId,revision,page?}` and returns `{ok,offer,campaigns:[{id,name,publicationRevision,publishedAt,startsOn,endsOn,promoName}],page,hasMore,checkedAt,reviewOnly:true}`.

Both responses are strict whitelists with private no-store/nosniff headers. POST requires same-origin bounded JSON, current IP/principal throttling and independent service authorization. The existing HTTP authentication and rate limiter may update operational Session/RateLimitBucket records; coupon, campaign, schedule, audit and playback business data remain unchanged. No client-provided organisation, entitlement, shop list, hash or media URL is accepted. Errors are sanitised.

The screen selects a published coupon, explicitly reviews its campaigns and pages the results. It clears stale results after filter/revision changes and ignores delayed/aborted responses. It states that this is a review only, not saved association or evidence of audio delivery. There are no inactive Save/Start buttons. Use synthetic local fixtures and actual responsive React/browser tests without live accounts or network services.

## Persistence deliberately reserved for RR-06b

A later optional selection belongs to an offer draft and must be pinned ONLY when publishing a new immutable coupon revision. Existing claims must not acquire retroactive campaign attribution. Store association metadata outside shopper-visible offer terms. Draft and immutable attribution tables, historical deletion behavior, audit and report presentation require a separate small additive implementation; no schema change is made here.

## Verification

Exercise default-off behavior, exact tenant/shop/action scopes and roles, published revision consistency, legacy cross-tenant FK paths, malformed targets, stale hashes/topology, unapproved/non-audio assets, dates/DST, row caps, current revocation/republishing, strict HTTP, stale UI and unchanged records. Use owned disposable loopback PostgreSQL and built HTTP only. Schema and all 139 migrations remain identical; no new package or provider service is needed. Local PostgreSQL18 and fixture browser results do not establish PostgreSQL16 CI, production compatibility or live playback.
