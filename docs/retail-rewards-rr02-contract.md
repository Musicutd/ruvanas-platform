# RR-02 local implementation contract

14 November 2026. Client Admin offer management only; Rewards stays disabled. No production deployment, activation, shopper registration, claims, redemption, billing, streaming or other-pillar changes in this milestone.

The agreed account terminology is in `retail-rewards-account-model.md`. Existing business subscriptions remain business subscriptions. Categories and reusable-offer rules prepare for shopper discovery without implementing public discovery or consumer memberships now.

## Offers and revisions

`RewardOffer`: id, organisationId, programId, state (DRAFT/PUBLISHED/PAUSED/CANCELLED), version (positive optimistic-lock counter), draft (JSON terms), lastRevision (nonnegative), publishedRevision (nullable positive integer), publishedStartsAt/publishedEndsAt (nullable), createdByUserId/updatedByUserId (historical string IDs), createdAt/updatedAt. Program and offer relations use composite tenant keys. Current draft editing never alters a published snapshot or its effective dates. Cancel retains all history; no destructive delete endpoint.

`RewardOfferLocation`: organisationId, offerId, locationId, scope (DRAFT/PUBLISHED), composite primary key (offerId, scope, locationId); composite same-tenant foreign keys for offer and location. Draft targets and published targets are stored separately. A multi-location offer is visible/editable only when every target in both sets is within the caller's action scope. Target locations must be ACTIVE.

`RewardOfferRevision`: id, organisationId, offerId, revision, terms (JSON snapshot), actorUserId, createdAt; unique (offerId, revision), composite tenant offer FK. Published revisions are immutable at both application and database layers, including DELETE/TRUNCATE protection. Append revision and audit atomically with publication.

Audit actions: OFFER_CREATED, OFFER_DRAFT_SAVED, OFFER_PUBLISHED, OFFER_PAUSED, OFFER_RESUMED, OFFER_CANCELLED. Target type OFFER. Safe metadata uses existing permitted fields only, or narrowly adds version/revision. No consumer PII.

## Terms v1 (strict JSON)

- schemaVersion: 1; title (1–140), description (0–2000), category: FASHION/RESTAURANTS/HOME/BEAUTY/HEALTH/LEISURE/GROCERY/SERVICES/OTHER.
- type: PERCENT_OFF/FIXED_AMOUNT/BOGO; percentBps integer 1–10000 only for PERCENT_OFF, amountMinor integer 1–100000000 only for FIXED_AMOUNT; other value fields must be null. BOGO uses buyQuantity/getQuantity integers 1–100 only for BOGO, otherwise null.
- currency: EUR/USD/GBP/CAD; minimumSpendMinor integer 0–100000000; exclusions (0–2000), legalTerms (1–5000), combinable boolean.
- startsAt/endsAt ISO UTC strings with explicit Z, endsAt after startsAt; timezone valid IANA name.
- locationIds: explicit unique IDs, at least one, max 500. No implicit all-shops expansion.
- usage: SINGLE_USE/REUSABLE; totalLimit positive integer <=100000000; perShopperLimit positive integer <=1000000; perShopperDailyLimit positive <=perShopperLimit. SINGLE_USE requires both per-shopper limits =1. Reusable benefit requires a fresh validated claim for each use in RR-03; no reusable redemption credential is implemented here.
- pausedClaimsPolicy: HONOUR_ISSUED/BLOCK_WHILE_PAUSED, explicit in terms for later claim enforcement.

Root supplies `lib/retail-rewards/offer-contracts.mjs`: offerTermsSchema, createOfferSchema ({terms}), updateOfferSchema ({expectedVersion,terms}), offerTransitionSchema ({expectedVersion}), REWARD_CATEGORIES, offerDisplayState(offer, now), validateOfferTerms(input). All request objects strict; no tenant/actor/entitlement values from request bodies.

## Service and HTTP contract

`createRewardOfferService({ db, env, loadContext, clock })` in `offer-service.mjs` returns list({search?,category?,state?,page?}), create(input), update(id,input), transition(id,action,input); transition action PUBLISH/PAUSE/RESUME/CANCEL. Root integrates auth/routes. `loadContext(tx?)` must freshly revalidate the authenticated session, membership and business subscription inside each write transaction. Existing Rewards access guard and database adapter are used against the transaction. Feature gate runs before any auth/database operation. Writes serializable with bounded retries, per-tenant program lock, authority recheck, optimistic version match, tenant/location scoping, quota checks and atomic audit. Resume uses the existing immutable revision, does not publish a changed draft. Publishing/resuming reserve quota for scheduled, active and paused non-expired published offers; cancellations/expired offers release capacity. Count unique published locations across those offers against the location quota.

Responses: {ok:true, offer} for mutation; list {ok:true, offers, page, hasMore, locations:[{id,name}], capabilities:{manage,publish}, limits}. Each offer exposes id, version, state, displayState, draft, publishedTerms (nullable snapshot), publishedRevision, lastRevision, createdAt, updatedAt. Safe errors {ok:false,status,code,error}; missing/foreign/out-of-scope offers share OFFER_UNAVAILABLE (404), stale writes CONFLICT (409). No raw database details. List may omit inaccessible offers without exposing counts; pagination must be bounded and deterministic.

HTTP: GET/POST /api/retail-rewards/offers; PATCH /api/retail-rewards/offers/[offerId]; POST /api/retail-rewards/offers/[offerId]/[action] where action publish/pause/resume/cancel. No-store responses. Existing middleware origin checks apply; handlers also enforce same-origin mutations, bounded JSON and strict schemas. Root owns handlers and server auth adapter.

Authority concurrency: repeated reads alone share a serializable snapshot. After the programme lock, the service locks the exact existing session/user/member/subscription/plan/grant authority rows, applicable staff and existing optional policy rows, then rechecks access. A prior committed change forces retry; a later change against held rows waits until commit. Target locations are likewise locked before validation. Newly inserted optional deny policies retain PostgreSQL serializable ordering; this is not a global policy insertion barrier.

Client UI: `/dashboard/retail/rewards` with separate Client Admin heading, list/search/category/state filters, create/edit draft, terms preview, explicit publish confirmation, pause/resume/cancel confirmation, clear version/conflict errors. Never claim publish creates a working shopper coupon at this stage. Categories and terms use the above fields. Synthetic local preview clearly labelled; no live account/grant changes. Root owns server page gating; UI agent owns client component/CSS/fixture preview.

## Verification

Tests must cover malformed monetary/rule/time input, cross-tenant and partial-location denial, disabled zero reads/writes, member revocation, expiry, roles, optimistic conflicts, immutable revisions and concurrent publication at capacity in isolated PostgreSQL. Use only an owned disposable local fixture or existing dedicated CI service; never a production connection. Unit tests alone cannot establish transaction guarantees.
