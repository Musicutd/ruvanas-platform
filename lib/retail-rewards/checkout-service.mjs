import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { pilotPreviewOrganisationAllowed, pilotPreviewOrganisationWhere } from "./pilot-preview-policy.mjs";
import { pilotPreviewShopperAllowed } from "./pilot-preview-shopper.mjs";
import { readCheckoutPolicy, createClaimSchema, walletQuerySchema, staffValidateSchema, staffRedeemSchema } from "./checkout-contracts.mjs";
import { rewardIdSchema } from "./contracts.mjs";
import { offerTermsSchema } from "./offer-contracts.mjs";
import { shopperOfferTerms } from "./shopper-contracts.mjs";
import { createShopperDiscoveryService } from "./shopper-discovery-service.mjs";
import { createRewardsDatabaseAdapter } from "./database-adapter.mjs";
import { requireRetailRewardsAccess } from "./access.mjs";
import { resolveRewardsEntitlements } from "./entitlements.mjs";
import { rewardsDenied } from "./errors.mjs";
import { REVERSAL_REASONS } from "./reversal-contracts.mjs";
import { runSerializableTransaction, isRetryableTransactionError } from "../transaction-retry.mjs";

const PAGE = 25, DAY = 86_400_000, TOKEN_LIFETIME = 300_000;
const TOKEN = /^[a-f0-9]{64}$/;
const accessSchema = z.object({ ok: z.literal(true), shopperId: rewardIdSchema, sessionId: rewardIdSchema, membershipId: rewardIdSchema }).strict();
const claimInclude = Object.freeze({ publishedSnapshot: { select: { organisationId: true, offerId: true, revision: true, terms: true } },
  redemption: { include: { reversal: true } }, usagePolicy: true });
class CheckoutAbort extends Error { constructor(result) { super(result.code); this.result = result; } }
const abort = code => { throw new CheckoutAbort(rewardsDenied(code)); };
const requireAllowed = result => { if (!result?.ok) throw new CheckoutAbort(rewardsDenied(result?.code)); return result; };
const finiteDate = value => value instanceof Date && Number.isFinite(value.getTime());
const iso = value => { if (!finiteDate(value)) abort("UNAVAILABLE"); return value.toISOString(); };
const sameShopper = (a, b) => a.shopperId === b.shopperId && a.sessionId === b.sessionId && a.membershipId === b.membershipId;
const sameStaff = (a, b) => a.organisationId === b.organisationId && a.userId === b.userId &&
  a.organisationMemberId === b.organisationMemberId && a.authority.sessionId === b.authority.sessionId &&
  a.authority.subscriptionId === b.authority.subscriptionId && a.authority.role === b.authority.role;
const fingerprint = fields => createHash("sha256").update(JSON.stringify(fields)).digest("hex");

function mac(value, secret, domain) {
  if (typeof secret !== "string" || secret.length < 32) throw new Error("Checkout configuration unavailable.");
  return createHmac("sha256", secret).update(`${domain}${value}`).digest("hex");
}
export function hashRewardCheckoutToken(token, secret) {
  if (typeof token !== "string" || !TOKEN.test(token)) throw new Error("Invalid checkout code.");
  return mac(token, secret, "ruvanas-rewards-checkout:v1:");
}
function termsFor(claim) {
  const snapshot = claim?.publishedSnapshot;
  if (!claim || !snapshot || snapshot.organisationId !== claim.organisationId || snapshot.offerId !== claim.offerId || snapshot.revision !== claim.revision) abort("CLAIM_UNAVAILABLE");
  const parsed = offerTermsSchema.safeParse(snapshot.terms);
  if (!parsed.success || !parsed.data.locationIds.includes(claim.locationId) ||
    !finiteDate(claim.createdAt) || !finiteDate(claim.expiresAt) || claim.createdAt >= claim.expiresAt || claim.expiresAt - claim.createdAt > DAY ||
    claim.expiresAt.getTime() > Date.parse(parsed.data.endsAt) || claim.createdAt.getTime() < Date.parse(parsed.data.startsAt) ||
    !claim.usagePolicy || claim.usagePolicy.offerId !== claim.offerId || claim.usagePolicy.organisationId !== claim.organisationId ||
    claim.usagePolicy.timezone !== parsed.data.timezone) abort("CLAIM_UNAVAILABLE");
  return parsed.data;
}
function receiptView(receipt, claim, terms) {
  if (!receipt || receipt.claimId !== claim.id || receipt.organisationId !== claim.organisationId || receipt.offerId !== claim.offerId ||
    receipt.shopperId !== claim.shopperId || receipt.locationId !== claim.locationId) abort("CLAIM_UNAVAILABLE");
  const reversal = receipt.reversal;
  if (reversal && (reversal.redemptionId !== receipt.id || reversal.organisationId !== receipt.organisationId ||
    !REVERSAL_REASONS.includes(reversal.reason) || !finiteDate(reversal.occurredAt) || reversal.occurredAt < receipt.occurredAt)) abort("CLAIM_UNAVAILABLE");
  return { id: receipt.id, redeemedAt: iso(receipt.occurredAt), shopName: claim.publicShopName, offerTitle: terms.title,
    revision: claim.revision, currency: receipt.currency, eligibleSpendMinor: receipt.eligibleSpendMinor, discountMinor: receipt.discountMinor,
    reversal: reversal ? { id: reversal.id, reversedAt: iso(reversal.occurredAt), reason: reversal.reason } : null };
}
function claimView(claim, terms, now, available = true, usage) {
  return { id: claim.id, status: claim.redemption?.reversal ? "REVERSED" : claim.redemption ? "REDEEMED" : claim.expiresAt <= now ? "EXPIRED" : available ? "READY" : "UNAVAILABLE",
    shop: { slug: claim.publicShopSlug, name: claim.publicShopName }, revision: claim.revision, terms: shopperOfferTerms(terms),
    createdAt: iso(claim.createdAt), expiresAt: iso(claim.expiresAt), receipt: claim.redemption ? receiptView(claim.redemption, claim, terms) : null, usage };
}

/** Private, default-off checkout. Every write serializes against the tenant's
 * existing programme and rechecks exact authority under locks. Codes are short
 * lived bearer secrets; claim IDs and read-only validation reserve nothing. */
export function createRewardCheckoutService({ db, env = {}, loadShopper, loadContext, clock = () => new Date() } = {}) {
  const enabled = () => readCheckoutPolicy(env).enabled;
  function nowAt(earliest) {
    const now = clock();
    if (!finiteDate(now) || (earliest && now < earliest)) abort("UNAVAILABLE");
    return new Date(now.getTime());
  }
  function checkTime(earliest) { if (!enabled()) abort("FEATURE_DISABLED"); return nowAt(earliest); }
  async function safely(operation) {
    if (!enabled()) return rewardsDenied("FEATURE_DISABLED");
    try { return await operation(); }
    catch (error) { return error instanceof CheckoutAbort ? error.result : rewardsDenied(isRetryableTransactionError(error) ? "CONFLICT" : "UNAVAILABLE"); }
  }
  async function shopperGuard(client, previous) {
    if (!enabled()) abort("FEATURE_DISABLED");
    if (typeof loadShopper !== "function") abort("UNAUTHENTICATED");
    const result = requireAllowed(await loadShopper(client)), parsed = accessSchema.safeParse(result);
    if (!parsed.success || (previous && !sameShopper(previous, parsed.data))) abort("UNAUTHENTICATED");
    return parsed.data;
  }
  async function staffGuard(client, locationId, previous) {
    let context;
    const access = requireAllowed(await requireRetailRewardsAccess({ action: "REDEEM", locationId }, {
      env, clock, loadContext: async () => { context = await loadContext(client); return context; }, ...createRewardsDatabaseAdapter(client) }));
    const value = { ...access, authority: { sessionId: context.session.id, subscriptionId: context.membership.organisation.subscription.id,
      role: context.membership.role } };
    if (previous && !sameStaff(previous, value)) abort("FORBIDDEN");
    return value;
  }
  async function lockProgramOffer(tx, organisationId, offerId) {
    const program = await tx.$queryRaw`SELECT "id" FROM "RewardProgram" WHERE "organisationId" = ${organisationId} FOR UPDATE`;
    if (!Array.isArray(program) || program.length !== 1) abort("CLAIM_UNAVAILABLE");
    const offer = await tx.$queryRaw`SELECT "id" FROM "RewardOffer" WHERE "organisationId" = ${organisationId} AND "id" = ${offerId} FOR UPDATE`;
    if (!Array.isArray(offer) || offer.length !== 1 || offer[0].id !== offerId) abort("CLAIM_UNAVAILABLE");
  }
  async function lockMerchant(tx, organisationId) {
    const rows = await tx.$queryRaw`SELECT sub."id" FROM "Subscription" sub
      JOIN "Plan" p ON p."id" = sub."planId"
      JOIN "RewardEntitlementGrant" g ON g."organisationId" = sub."organisationId" AND g."subscriptionId" = sub."id"
      WHERE sub."organisationId" = ${organisationId} FOR SHARE OF sub, p, g`;
    if (!Array.isArray(rows) || rows.length !== 1) abort("CLAIM_UNAVAILABLE");
    await tx.$queryRaw`SELECT "id" FROM "BillingContract" WHERE "subscriptionId" = ${rows[0].id} FOR SHARE`;
    await tx.$queryRaw`SELECT "id" FROM "EnterpriseSecurityPolicy" WHERE "organisationId" = ${organisationId} FOR SHARE`;
  }
  async function lockStaff(tx, access) {
    const rows = await tx.$queryRaw`SELECT s."id" FROM "Session" s
      JOIN "User" u ON u."id" = s."userId"
      JOIN "OrganisationMember" m ON m."userId" = u."id" AND m."id" = ${access.organisationMemberId}
      WHERE s."id" = ${access.authority.sessionId} AND s."activeOrganisationId" = ${access.organisationId}
        AND u."id" = ${access.userId} AND m."organisationId" = ${access.organisationId} FOR SHARE OF s, u, m`;
    if (!Array.isArray(rows) || rows.length !== 1) abort("FORBIDDEN");
    if (access.authority.role !== "OWNER") {
      const staff = await tx.$queryRaw`SELECT "id" FROM "RewardStaffGrant" WHERE "organisationId" = ${access.organisationId}
        AND "organisationMemberId" = ${access.organisationMemberId} ORDER BY "id" LIMIT 1001 FOR SHARE`;
      if (!Array.isArray(staff) || staff.length < 1 || staff.length > 1000) abort("FORBIDDEN");
    }
  }
  async function lockShopper(tx, shopperId, access) {
    const rows = await tx.$queryRaw`SELECT "id" FROM "RewardShopper" WHERE "id" = ${shopperId} FOR UPDATE`;
    if (!Array.isArray(rows) || rows.length !== 1) abort("CLAIM_UNAVAILABLE");
    const members = await tx.$queryRaw`SELECT "id" FROM "RewardShopperMembership" WHERE "shopperId" = ${shopperId} FOR SHARE`;
    if (!Array.isArray(members) || members.length !== 1) abort("CLAIM_UNAVAILABLE");
    if (access) {
      const sessions = await tx.$queryRaw`SELECT "id" FROM "RewardShopperSession" WHERE "id" = ${access.sessionId} AND "shopperId" = ${shopperId} FOR SHARE`;
      if (!Array.isArray(sessions) || sessions.length !== 1 || members[0].id !== access.membershipId) abort("UNAUTHENTICATED");
    }
  }
  async function lockLocation(tx, organisationId, locationId) {
    const rows = await tx.$queryRaw`SELECT "id" FROM "Location" WHERE "id" = ${locationId} AND "organisationId" = ${organisationId} FOR SHARE`;
    if (!Array.isArray(rows) || rows.length !== 1) abort("CLAIM_UNAVAILABLE");
  }
  async function shopperState(client, shopperId, now, authVersion) {
    if (!await pilotPreviewShopperAllowed({ db: client, env, shopperId })) abort("CLAIM_UNAVAILABLE");
    const shopper = await client.rewardShopper.findUnique({ where: { id: shopperId }, select: { id: true, status: true, authVersion: true,
      membership: { select: { shopperId: true, status: true, source: true, startsAt: true, expiresAt: true, revokedAt: true, version: true } } } });
    const m = shopper?.membership;
    if (!shopper || shopper.id !== shopperId || shopper.status !== "ACTIVE" || !Number.isSafeInteger(shopper.authVersion) || shopper.authVersion < 1 ||
      (authVersion !== undefined && shopper.authVersion !== authVersion) || !m || m.shopperId !== shopperId || m.status !== "ACTIVE" || m.source !== "MANUAL_INTERNAL" ||
      m.revokedAt !== null || !finiteDate(m.startsAt) || !finiteDate(m.expiresAt) || m.startsAt > now || m.expiresAt <= now || m.startsAt >= m.expiresAt ||
      !Number.isSafeInteger(m.version) || m.version < 1) abort("CLAIM_UNAVAILABLE");
    return shopper;
  }
  async function merchantState(client, organisationId, now) {
    if (!pilotPreviewOrganisationAllowed(env, organisationId)) abort("CLAIM_UNAVAILABLE");
    const organisation = await client.organisation.findUnique({ where: { id: organisationId },
      select: { id: true, subscription: { include: { plan: true, billingContract: true } } } });
    if (organisation?.id !== organisationId || !organisation.subscription || organisation.subscription.organisationId !== organisationId) abort("CLAIM_UNAVAILABLE");
    const state = await createRewardsDatabaseAdapter(client).loadRewardsState({ organisationId, subscriptionId: organisation.subscription.id });
    const result = resolveRewardsEntitlements({ organisationId, subscription: organisation.subscription, grant: state.grant,
      program: state.program, action: "REDEEM", now });
    if (!result.allowed) abort("CLAIM_UNAVAILABLE");
    return { ...state, limits: result.limits };
  }
  async function issuedEligibility(client, claim, now, { consumed = false } = {}) {
    const terms = termsFor(claim);
    if (!consumed && claim.redemption) abort("ALREADY_REDEEMED");
    if (claim.expiresAt <= now || now.getTime() >= Date.parse(terms.endsAt)) abort("CLAIM_EXPIRED");
    if (claim.createdAt > now || now.getTime() < Date.parse(terms.startsAt)) abort("CLAIM_UNAVAILABLE");
    const shopper = await shopperState(client, claim.shopperId, now, claim.shopperAuthVersion);
    const merchant = await merchantState(client, claim.organisationId, now);
    const location = await client.location.findFirst({ where: { id: claim.locationId, organisationId: claim.organisationId, status: "ACTIVE" }, select: { id: true } });
    const offer = await client.rewardOffer.findFirst({ where: { id: claim.offerId, organisationId: claim.organisationId },
      select: { id: true, programId: true, state: true } });
    if (!location || !offer || offer.programId !== merchant.program.id ||
      !(offer.state === "PUBLISHED" || (offer.state === "PAUSED" && terms.pausedClaimsPolicy === "HONOUR_ISSUED"))) abort("CLAIM_UNAVAILABLE");
    return { terms, shopper, merchant };
  }
  async function capacity(client, organisationId, offerId, shopperId, terms, timezone, limits, now) {
    // SQL calendar conversion handles 23/25-hour local days without resetting
    // usage at a revision boundary. The timezone was pinned at first issuance.
    const rows = await client.$queryRaw`SELECT count(*)::bigint AS total,
      count(*) FILTER (WHERE "shopperId" = ${shopperId})::bigint AS personal,
      count(*) FILTER (WHERE "shopperId" = ${shopperId} AND
        ("occurredAt" AT TIME ZONE ${timezone})::date = (${now}::timestamptz AT TIME ZONE ${timezone})::date)::bigint AS daily
      FROM "RewardRedemption" receipt WHERE "offerId" = ${offerId} AND "organisationId" = ${organisationId}
        AND NOT EXISTS (SELECT 1 FROM "RewardRedemptionReversal" correction
          WHERE correction."redemptionId" = receipt."id" AND correction."organisationId" = receipt."organisationId")`;
    const usage = rows?.[0];
    for (const field of ["total", "personal", "daily"]) if (!usage || !Number.isSafeInteger(Number(usage[field])) || Number(usage[field]) < 0) abort("UNAVAILABLE");
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const monthly = await client.rewardRedemption.count({ where: { organisationId, occurredAt: { gte: start, lt: end } } });
    if (!Number.isSafeInteger(monthly) || monthly < 0) abort("UNAVAILABLE");
    if (Number(usage.total) >= terms.totalLimit || Number(usage.personal) >= terms.perShopperLimit ||
      Number(usage.daily) >= terms.perShopperDailyLimit || monthly >= limits.monthlyRedemptions) abort("LIMIT_REACHED");
  }
  async function ownClaim(client, id, shopperId) {
    const row = await client.rewardClaim.findFirst({ where: { id, shopperId, ...pilotPreviewOrganisationWhere(env) }, include: claimInclude });
    if (!row || row.shopperId !== shopperId || !pilotPreviewOrganisationAllowed(env, row.organisationId)) abort("CLAIM_UNAVAILABLE");
    termsFor(row); return row;
  }
  async function tokenClaim(client, tokenHash, access, now, { checkExpiry = true } = {}) {
    const token = await client.rewardClaimToken.findFirst({ where: { tokenHash,
      claim: { organisationId: access.organisationId, locationId: access.locationId } }, include: { claim: { include: claimInclude } } });
    if (!token || token.tokenHash !== tokenHash || token.claim?.organisationId !== access.organisationId || token.claim.locationId !== access.locationId || token.claim.id !== token.claimId) abort("CLAIM_UNAVAILABLE");
    if (!finiteDate(token.createdAt) || !finiteDate(token.expiresAt) || token.createdAt >= token.expiresAt || token.expiresAt - token.createdAt > TOKEN_LIFETIME ||
      token.createdAt > now || token.expiresAt > token.claim.expiresAt) abort("CLAIM_UNAVAILABLE");
    if (checkExpiry && token.expiresAt <= now) abort("CLAIM_EXPIRED");
    return token;
  }
  async function personalUsage(client, row, terms, now, counts) {
    // Stable offer identity spans revisions and locations. Claims and checkout
    // codes reserve nothing; only this shopper's non-reversed receipts use the
    // issued allowance. Cache only within this one bounded wallet response.
    const key = JSON.stringify([row.organisationId, row.offerId, row.shopperId]);
    let observation = counts?.get(key);
    if (!observation) {
      const used = await client.rewardRedemption.count({ where: { organisationId: row.organisationId,
        offerId: row.offerId, shopperId: row.shopperId, reversal: null } });
      if (!Number.isSafeInteger(used) || used < 0) abort("UNAVAILABLE");
      observation = { used, asOf: iso(checkTime(now)) };
      counts?.set(key, observation);
    }
    checkTime(now);
    const limit = terms.perShopperLimit;
    return { ...observation, limit, remaining: Math.max(0, limit - observation.used) };
  }
  async function presentOwn(client, row, now, counts) {
    if (!row || !pilotPreviewOrganisationAllowed(env, row.organisationId)) abort("CLAIM_UNAVAILABLE");
    const terms = termsFor(row); let available = true;
    if (!row.redemption && row.expiresAt > now) {
      try { await issuedEligibility(client, row, now); }
      catch (error) { if (!(error instanceof CheckoutAbort) || !["CLAIM_UNAVAILABLE", "CLAIM_EXPIRED"].includes(error.result.code)) throw error; available = false; }
    }
    const usage = await personalUsage(client, row, terms, now, counts);
    return claimView(row, terms, checkTime(now), available, usage);
  }

  return Object.freeze({
    claim(input) { return safely(async () => {
      const parsed = createClaimSchema.safeParse(input); if (!parsed.success) abort("INVALID_REQUEST");
      const values = parsed.data, initial = await shopperGuard(db), started = nowAt();
      const keyHash = mac(values.idempotencyKey, env.SESSION_SECRET, "ruvanas-rewards-claim-request:v1:");
      const requestHash = fingerprint([values.shopSlug, values.offerSlug, values.expectedRevision]);
      // Completed retry mappings are checked before discovery: a withdrawn
      // listing does not create a second coupon or erase the original result.
      const previous = await db.rewardClaimRequest.findUnique({ where: { shopperId_idempotencyKeyHash: { shopperId: initial.shopperId, idempotencyKeyHash: keyHash } }, include: { claim: { include: claimInclude } } });
      if (previous) {
        if (previous.requestHash !== requestHash) abort("CONFLICT");
        await shopperGuard(db, initial); if (previous.claim?.shopperId !== initial.shopperId) abort("CLAIM_UNAVAILABLE");
        const claim = await presentOwn(db, previous.claim, checkTime(started));
        await shopperGuard(db, initial); checkTime(started); return { ok: true, claim };
      }
      const profile = await db.rewardPublicShopProfile.findUnique({ where: { publicSlug: values.shopSlug }, select: { id: true, organisationId: true, locationId: true } });
      const listing = await db.rewardOfferDiscovery.findUnique({ where: { publicSlug: values.offerSlug }, select: { id: true, organisationId: true, offerId: true } });
      if (!profile || !listing || profile.organisationId !== listing.organisationId || !pilotPreviewOrganisationAllowed(env, profile.organisationId)) abort("CLAIM_UNAVAILABLE");
      return runSerializableTransaction(db, async tx => {
        await lockProgramOffer(tx, profile.organisationId, listing.offerId); await lockMerchant(tx, profile.organisationId);
        await lockShopper(tx, initial.shopperId, initial); await shopperGuard(tx, initial);
        const retry = await tx.rewardClaimRequest.findUnique({ where: { shopperId_idempotencyKeyHash: { shopperId: initial.shopperId, idempotencyKeyHash: keyHash } }, include: { claim: { include: claimInclude } } });
        if (retry) {
          if (retry.requestHash !== requestHash) abort("CONFLICT");
          if (retry.claim?.shopperId !== initial.shopperId) abort("CLAIM_UNAVAILABLE");
          const result = await presentOwn(tx, retry.claim, checkTime(started)); await shopperGuard(tx, initial); checkTime(started); return { ok: true, claim: result };
        }
        await lockLocation(tx, profile.organisationId, profile.locationId);
        const profiles = await tx.$queryRaw`SELECT "id" FROM "RewardPublicShopProfile" WHERE "id" = ${profile.id} AND "organisationId" = ${profile.organisationId} FOR SHARE`;
        const listings = await tx.$queryRaw`SELECT "id" FROM "RewardOfferDiscovery" WHERE "id" = ${listing.id} AND "organisationId" = ${profile.organisationId} FOR SHARE`;
        if (profiles.length !== 1 || listings.length !== 1) abort("CLAIM_UNAVAILABLE");
        const currentProfile = await tx.rewardPublicShopProfile.findUnique({ where: { id: profile.id },
          select: { id: true, organisationId: true, locationId: true, publicSlug: true } });
        if (!currentProfile || currentProfile.id !== profile.id || currentProfile.organisationId !== profile.organisationId ||
          currentProfile.locationId !== profile.locationId || currentProfile.publicSlug !== values.shopSlug) abort("CLAIM_UNAVAILABLE");
        const discovery = createShopperDiscoveryService({ db: tx, env, clock, loadShopper: client => loadShopper(client) });
        const visible = requireAllowed(await discovery.offer(values.shopSlug, values.offerSlug));
        if (visible.offer.revision !== values.expectedRevision) abort("CONFLICT");
        const currentListing = await tx.rewardOfferDiscovery.findUnique({ where: { id: listing.id },
          select: { offerId: true, organisationId: true, revision: true, publishedSnapshot: { select: { terms: true } } } });
        const parsedTerms = offerTermsSchema.safeParse(currentListing?.publishedSnapshot?.terms);
        if (!parsedTerms.success || currentListing.offerId !== listing.offerId || currentListing.organisationId !== profile.organisationId ||
          currentListing.revision !== values.expectedRevision || !parsedTerms.data.locationIds.includes(profile.locationId)) abort("CLAIM_UNAVAILABLE");
        const terms = parsedTerms.data, now = checkTime(started), shopper = await shopperState(tx, initial.shopperId, now);
        const merchant = await merchantState(tx, profile.organisationId, now);
        let policy = await tx.rewardOfferUsagePolicy.findUnique({ where: { offerId: listing.offerId } });
        if (policy && (policy.organisationId !== profile.organisationId || policy.timezone !== terms.timezone)) abort("CONFLICT");
        if (!policy) policy = await tx.rewardOfferUsagePolicy.create({ data: { offerId: listing.offerId, organisationId: profile.organisationId, timezone: terms.timezone } });
        const active = await tx.rewardClaim.findMany({ where: { offerId: listing.offerId, shopperId: initial.shopperId, expiresAt: { gt: now }, redemption: null },
          include: claimInclude, take: 2 });
        if (active.length > 1) abort("CONFLICT");
        let claim = active[0];
        if (claim && (claim.revision !== values.expectedRevision || claim.locationId !== profile.locationId)) abort("CONFLICT");
        if (claim) await issuedEligibility(tx, claim, now);
        else {
          await capacity(tx, profile.organisationId, listing.offerId, initial.shopperId, terms, policy.timezone, merchant.limits, now);
          const expiresAt = new Date(Math.min(now.getTime() + DAY, Date.parse(terms.endsAt), shopper.membership.expiresAt.getTime()));
          if (expiresAt <= now) abort("CLAIM_EXPIRED");
          claim = await tx.rewardClaim.create({ data: { id: randomUUID(), organisationId: profile.organisationId, offerId: listing.offerId,
            revision: values.expectedRevision, shopperId: initial.shopperId, shopperAuthVersion: shopper.authVersion, locationId: profile.locationId,
            publicShopName: visible.shop.name, publicShopSlug: visible.shop.slug, createdAt: now, expiresAt }, include: claimInclude });
        }
        await tx.rewardClaimRequest.create({ data: { shopperId: initial.shopperId, idempotencyKeyHash: keyHash, requestHash, claimId: claim.id } });
        const issuedTerms = termsFor(claim), usage = await personalUsage(tx, claim, issuedTerms, now);
        await shopperGuard(tx, initial); const final = checkTime(now); await issuedEligibility(tx, claim, final);
        return { ok: true, claim: claimView(claim, issuedTerms, final, true, usage) };
      }, { maxAttempts: 3, retryDelayMs: 10 });
    }); },

    wallet(input = {}) { return safely(async () => {
      const parsed = walletQuerySchema.safeParse(input); if (!parsed.success) abort("INVALID_REQUEST");
      const access = await shopperGuard(db), started = nowAt(), page = parsed.data.page || 1;
      const read = () => db.rewardClaim.findMany({ where: { shopperId: access.shopperId, ...pilotPreviewOrganisationWhere(env) }, include: claimInclude,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * PAGE, take: PAGE + 1 });
      await read(); await shopperGuard(db, access); const rows = await read();
      if (rows.length > PAGE + 1 || rows.some(row => row.shopperId !== access.shopperId || !pilotPreviewOrganisationAllowed(env, row.organisationId))) abort("UNAVAILABLE");
      const claims = [], counts = new Map(); for (const row of rows.slice(0, PAGE)) claims.push(await presentOwn(db, row, checkTime(started), counts));
      await shopperGuard(db, access); checkTime(started); return { ok: true, claims, page, hasMore: rows.length > PAGE };
    }); },

    credential(claimId) { return safely(async () => {
      if (!rewardIdSchema.safeParse(claimId).success) abort("CLAIM_UNAVAILABLE");
      const initial = await shopperGuard(db), started = nowAt(), candidate = await ownClaim(db, claimId, initial.shopperId);
      return runSerializableTransaction(db, async tx => {
        await lockProgramOffer(tx, candidate.organisationId, candidate.offerId); await lockMerchant(tx, candidate.organisationId);
        await lockShopper(tx, initial.shopperId, initial); await lockLocation(tx, candidate.organisationId, candidate.locationId);
        await shopperGuard(tx, initial); const claim = await ownClaim(tx, claimId, initial.shopperId), now = checkTime(started);
        const state = await issuedEligibility(tx, claim, now);
        const token = randomBytes(32).toString("hex"), tokenExpiresAt = new Date(Math.min(now.getTime() + TOKEN_LIFETIME, claim.expiresAt.getTime()));
        const data = { tokenHash: hashRewardCheckoutToken(token, env.SESSION_SECRET), createdAt: now, expiresAt: tokenExpiresAt };
        await tx.rewardClaimToken.upsert({ where: { claimId }, create: { claimId, ...data }, update: data });
        const usage = await personalUsage(tx, claim, state.terms, now);
        await shopperGuard(tx, initial); const final = checkTime(now); await issuedEligibility(tx, claim, final);
        if (tokenExpiresAt <= final) abort("CLAIM_EXPIRED");
        return { ok: true, claim: claimView(claim, state.terms, final, true, usage), token, tokenExpiresAt: iso(tokenExpiresAt) };
      }, { maxAttempts: 3, retryDelayMs: 10 });
    }); },

    staffLocations(input = {}) { return safely(async () => {
      const parsed = walletQuerySchema.safeParse(input); if (!parsed.success) abort("INVALID_REQUEST");
      if (typeof loadContext !== "function") abort("UNAUTHENTICATED");
      const context = await loadContext(db), now = nowAt(), session = context?.session, member = context?.membership;
      if (!session || session.userId !== context.user?.id || !finiteDate(session.expiresAt) || session.expiresAt <= now || session.revokedAt !== null) abort("UNAUTHENTICATED");
      if (context.user.privatePreviewAccess != null || !member || member.userId !== session.userId || member.organisationId !== session.activeOrganisationId ||
        !["OWNER", "MANAGER", "VIEWER"].includes(member.role) || !rewardIdSchema.safeParse(member.organisationId).success) abort("FORBIDDEN");
      const page = parsed.data.page || 1, rows = await db.location.findMany({ where: { organisationId: member.organisationId, status: "ACTIVE" },
        orderBy: [{ name: "asc" }, { id: "asc" }], skip: (page - 1) * PAGE, take: PAGE + 1, select: { id: true, name: true, organisationId: true } });
      const locations = [];
      for (const row of rows.slice(0, PAGE)) {
        if (row.organisationId !== member.organisationId) abort("UNAVAILABLE");
        try { const access = await staffGuard(db, row.id); if (access.organisationId !== member.organisationId || access.userId !== session.userId) abort("FORBIDDEN");
          await staffGuard(db, row.id, access); locations.push({ id: row.id, name: row.name }); }
        catch (error) { if (!(error instanceof CheckoutAbort) || error.result.code !== "LOCATION_UNAVAILABLE") throw error; }
      }
      checkTime(now); return { ok: true, locations, page, hasMore: rows.length > PAGE };
    }); },

    validate(input) { return safely(async () => {
      const parsed = staffValidateSchema.safeParse(input); if (!parsed.success) abort("INVALID_REQUEST");
      const values = parsed.data, access = await staffGuard(db, values.locationId), started = nowAt();
      const tokenHash = hashRewardCheckoutToken(values.token, env.SESSION_SECRET);
      await tokenClaim(db, tokenHash, access, started); await staffGuard(db, values.locationId, access);
      const now = checkTime(started), token = await tokenClaim(db, tokenHash, access, now), claim = token.claim;
      const state = await issuedEligibility(db, claim, now);
      await capacity(db, claim.organisationId, claim.offerId, claim.shopperId, state.terms, claim.usagePolicy.timezone, state.merchant.limits, now);
      await staffGuard(db, values.locationId, access); const final = checkTime(now);
      if (token.expiresAt <= final || claim.expiresAt <= final) abort("CLAIM_EXPIRED");
      await issuedEligibility(db, claim, final);
      return { ok: true, review: { shopName: claim.publicShopName, offerTitle: state.terms.title, revision: claim.revision,
        terms: shopperOfferTerms(state.terms), claimExpiresAt: iso(claim.expiresAt), tokenExpiresAt: iso(token.expiresAt) } };
    }); },

    redeem(input) { return safely(async () => {
      const parsed = staffRedeemSchema.safeParse(input); if (!parsed.success) abort("INVALID_REQUEST");
      const values = parsed.data, initial = await staffGuard(db, values.locationId), started = nowAt();
      const tokenHash = hashRewardCheckoutToken(values.token, env.SESSION_SECRET);
      const keyHash = mac(values.idempotencyKey, env.SESSION_SECRET, "ruvanas-rewards-redemption-request:v1:");
      const requestHash = fingerprint([tokenHash, values.locationId, values.eligibleSpendMinor, values.currency, true]);
      const receiptWhere = { organisationId_actorOrganisationMemberId_idempotencyKeyHash: {
        organisationId: initial.organisationId, actorOrganisationMemberId: initial.organisationMemberId, idempotencyKeyHash: keyHash } };
      const previous = await db.rewardRedemption.findUnique({ where: receiptWhere, include: { reversal: true, claim: { include: claimInclude } } });
      if (previous) {
        if (previous.requestHash !== requestHash) abort("CONFLICT");
        await staffGuard(db, values.locationId, initial); checkTime(started);
        return { ok: true, receipt: receiptView(previous, previous.claim, termsFor(previous.claim)) };
      }
      const candidate = await tokenClaim(db, tokenHash, initial, started, { checkExpiry: false });
      return runSerializableTransaction(db, async tx => {
        await lockProgramOffer(tx, initial.organisationId, candidate.claim.offerId); await lockMerchant(tx, initial.organisationId);
        await lockStaff(tx, initial); await lockShopper(tx, candidate.claim.shopperId); await lockLocation(tx, initial.organisationId, values.locationId);
        await staffGuard(tx, values.locationId, initial);
        const replay = await tx.rewardRedemption.findUnique({ where: receiptWhere, include: { reversal: true, claim: { include: claimInclude } } });
        if (replay) {
          if (replay.requestHash !== requestHash) abort("CONFLICT");
          await staffGuard(tx, values.locationId, initial); checkTime(started);
          return { ok: true, receipt: receiptView(replay, replay.claim, termsFor(replay.claim)) };
        }
        await tx.$queryRaw`SELECT "claimId" FROM "RewardClaimToken" WHERE "claimId" = ${candidate.claimId} FOR UPDATE`;
        const now = checkTime(started), token = await tokenClaim(tx, tokenHash, initial, now, { checkExpiry: false }), claim = token.claim;
        if (claim.redemption) abort("ALREADY_REDEEMED");
        if (token.expiresAt <= now) abort("CLAIM_EXPIRED");
        const state = await issuedEligibility(tx, claim, now), terms = state.terms;
        if (values.currency !== terms.currency || values.eligibleSpendMinor < terms.minimumSpendMinor) abort("INVALID_REQUEST");
        await capacity(tx, claim.organisationId, claim.offerId, claim.shopperId, terms, claim.usagePolicy.timezone, state.merchant.limits, now);
        const discountMinor = terms.type === "PERCENT_OFF" ? Math.floor(values.eligibleSpendMinor * terms.percentBps / 10000) :
          terms.type === "FIXED_AMOUNT" ? Math.min(values.eligibleSpendMinor, terms.amountMinor) : null;
        const receipt = await tx.rewardRedemption.create({ data: { id: randomUUID(), organisationId: claim.organisationId, offerId: claim.offerId,
          shopperId: claim.shopperId, locationId: claim.locationId, claimId: claim.id, actorUserId: initial.userId,
          actorOrganisationMemberId: initial.organisationMemberId, idempotencyKeyHash: keyHash, requestHash,
          eligibleSpendMinor: values.eligibleSpendMinor, currency: values.currency, discountMinor, occurredAt: now } });
        await staffGuard(tx, values.locationId, initial); const final = checkTime(now);
        if (token.expiresAt <= final) abort("CLAIM_EXPIRED");
        await issuedEligibility(tx, claim, final);
        return { ok: true, receipt: receiptView(receipt, claim, terms) };
      }, { maxAttempts: 3, retryDelayMs: 10 });
    }); }
  });
}
