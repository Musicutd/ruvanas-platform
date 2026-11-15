# RR-03a — separate shopper identity and discovery

Local, disabled engineering milestone following the owner's three-account clarification and request to continue. Preserve RR-02. No live deployment, registration, charges, claims, redemption, staff validation, audio or other-pillar changes. This is a small prerequisite to RR-03 claims/redemption, with the agreed category → shop → coupons journey brought forward for local testing. It is not a public marketplace launch.

## Ownership

Database agent: schema/additive migration/isolated database tests and harness, reset compatibility. Service agent: shopper-session guard and read-only discovery service/tests. UI agent: real shopper React component, CSS, UI helpers/tests and synthetic preview. Root: contracts/feature gate, HTTP/server/page integration, build/HTTP acceptance, docs/evidence.

## Models (no application provisioning writes in this milestone)

- Reuse existing `RewardProgram.networkOptIn`, which defaults to false. Do not add or backfill another programme flag.
- `RewardShopper`: opaque id, optional displayName (80 max), status DISABLED/ACTIVE/SUSPENDED default DISABLED, authVersion positive default1, createdAt/updatedAt. Independent of User, OrganisationMember and client Subscription. No email/password/consumer pricing added before onboarding policy is agreed.
- `RewardShopperSession`: id, shopperId, unique tokenHash (64 lowercase hex), authVersion, createdAt, expiresAt, revokedAt nullable. Session expires after at most24hours. Restrict deletion; no cascade from a merchant. Hash a256-bit token with a shopper-specific HMAC domain and existing server SESSION_SECRET. No raw token is persisted or exposed.
- `RewardShopperMembership`: id, shopperId unique, status DISABLED/ACTIVE/SUSPENDED default DISABLED, source MANUAL_INTERNAL only, startsAt, expiresAt, revokedAt nullable, version positive default1, createdAt/updatedAt. No paid tier, charge, client subscription, organisation or Stripe reference. ACTIVE means explicit internal access, never proof of payment.
- `RewardPublicShopProfile`: id, organisationId, locationId, publicSlug unique, displayName (140), description (2000), locality (120), countryCode (2 uppercase), status DRAFT/PUBLISHED default DRAFT, networkOptIn false, publishedAt nullable, revokedAt nullable, createdAt/updatedAt. Unique locationId. Composite same-tenant Location FK. Public text is explicitly entered, never auto-copied from private Location or Organisation fields. Require publishedAt for PUBLISHED.
- `RewardOfferDiscovery`: id, organisationId, offerId unique, revision positive, publicSlug unique, discoverable false, approvedAt nullable, revokedAt nullable, createdAt/updatedAt. Composite same-tenant FK to exact RewardOfferRevision and Offer. Discoverable requires approvedAt. A new offer revision is hidden until this record is separately updated to that revision.

Finite timestamps, strict lengths/identifier/slug/hash/country constraints, positive versions, expiry ordering and composite tenant FKs in SQL. Preserve immutable history. No changes to prior migrations or implicit shopper deletion during merchant reset. No signup/bootstrap/opt-in write endpoints yet; only synthetic fixtures create these rows.

## Gating and identity

Root supplies `shopper-contracts.mjs`: `readShopperFeaturePolicy(env)`, `shopperBrowseSchema`, `publicSlugSchema`, redacted `shopperOfferTerms(terms)` helper. Shopper gate requires valid existing Rewards flags plus exact `RUVANAS_RETAIL_REWARDS_SHOPPER_ENABLED=true`; missing/false/malformed disables. Public claims flag remains false and grants no power to this milestone.

Service agent supplies `shopper-access.mjs`: `requireRewardShopperAccess({db, env, token, clock})`, `hashShopperSessionToken(token, secret)` and `SHOPPER_COOKIE="ruvanas_rewards_shopper"`. Hash domain `ruvanas-rewards-shopper:v1:`; token exactly64lowercase hex, secret>=32characters. Disabled gate before any token/auth/database work. Validate ACTIVE shopper, authVersion match, current unrevoked session, finite creation<=now<expiry and max24hours; require ACTIVE unrevoked current membership. No business cookie, matching email, client session, role or tenant fallback. Return internal `{ok:true,shopperId,sessionId,membershipId}` or safe `{ok:false,status,code,error}`. Do not expose IDs/token hashes in discovery responses. Read-only, no lastSeen writes.

Shopper access grants READ_DISCOVERY only. Existing client/admin APIs keep requiring their own existing business session. Registration stays closed. No authentication issuance/recovery/upgrade endpoints are implemented here; future invite/onboarding must establish verified identity separately.

## Discovery service

`createShopperDiscoveryService({db,env,loadShopper,clock})` exposes `shops(input={})`, `shop(publicSlug,input={})`, `offer(shopSlug,offerSlug)`.

All require shopper gate and a valid shopper via `loadShopper(db)` before reads; recheck shopper authority and time after loading data before returning. Existing ordinary client/admin sessions never authorise these methods.

Eligibility: explicitly opted-in PUBLISHED/unrevoked public profile with approvedAt/publishedAt<=now; ACTIVE Location; ACTIVE RewardProgram with networkOptIn; current Retail client eligibility and current Rewards grant resolved through existing `resolveRewardsEntitlements` for READ, including subscription/client-plan/billing and grant dates/status; offer PUBLISHED with startsAt<=now<endsAt; opted-in approved/unrevoked listing; listing revision==current publishedRevision; exact immutable published snapshot and matching PUBLISHED target. Validate snapshot/date/location integrity. No draft read for category/search/terms. Recheck eligibility at the end to avoid returning data after withdrawal observed during the read. Invalid/inactive/hidden/foreign/unavailable routes return one uniform404.

Input: category from existing REWARD_CATEGORIES, search<=100, page integer1..1000. Deterministic bounded results. No approximate total counts labelled as exact. Public category taxonomy may be static. If bounded candidate windows require another page, expose hasMore without private IDs or hidden-row counts; document this. No unrestricted collection scans.

DTOs (explicit allowlist only):
- `shops`: `{ok:true, shops:[{slug,name,description,locality,countryCode,categories:[category]}], page, hasMore}`.
- `shop`: `{ok:true, shop:{slug,name,description,locality,countryCode,categories:[category]}, offers:[{slug,revision,terms}], page, hasMore}`.
- `offer`: `{ok:true,shop:{...},offer:{slug,revision,terms}}`.
- `terms` is validated published offer terms with **locationIds removed**. Selected public shop identifies where the displayed offer applies. No internal organisation/location/offer/shopper/session/member/grant/plan/audit/actor IDs, no drafts or customer records. No public DTO derived by spreading database records.

## HTTP/UI

Root: read-only GET `/api/rewards/discovery/shops`, `/api/rewards/discovery/shops/[shopSlug]`, `/api/rewards/discovery/shops/[shopSlug]/offers/[offerSlug]`; no-store/private, bounded query validation, read rate limit, strict safe errors. Server route `/rewards` outside business dashboard; no business-session fallback, no public signup, no middleware broad exemption. With legacy private-preview middleware on, denial may remain; local acceptance uses its supported off value while registration stays blocked. Feature off yields403 on new handlers and no shopper/discovery reads; page unavailable.

UI agent: `app/rewards/ShopperDiscoveryClient.js` and `shopper-discovery.module.css`. Props `initialData` (shops DTO), `apiBase="/api/rewards/discovery"`, optional `transport=fetch`, `previewOnly=false`. Distinct Shopper header, categories/search→shop→multiple published coupons→readable full terms, accessible mobile navigation/back actions. No Client Admin tools. Clear notice that saving/claiming/redemption is not available in this stage; no fake active claim/QR buttons. Price/membership tier undecided, do not invent. Synthetic preview uses the real component with in-memory read transport, no external requests or actual shopper sessions.

## Verification

Unit rules and auth confusion, expired/revoked/disabled identity/membership, authVersion mismatch, no disabled queries, private DTO leak detection, draft-vs-published filter separation, opt-in withdrawal/revision mismatch/time boundaries, cross-client publication isolation. Owned PostgreSQL fresh136 migration replay and135→136 upgrade with legacy synthetic rows unchanged, reset keeps global shoppers, same-tenant FKs and expiry/identity constraints. Real built HTTP tests with dedicated synthetic shopper cookie vs business cookie and registration403. Desktop/mobile synthetic browser checks and full build. No production services or credentials.
