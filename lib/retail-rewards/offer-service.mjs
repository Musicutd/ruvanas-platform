import { randomUUID } from "node:crypto";
import { requireRetailRewardsAccess } from "./access.mjs";
import { createRewardsDatabaseAdapter } from "./database-adapter.mjs";
import { readRewardsFeaturePolicy } from "./feature-policy.mjs";
import { rewardsDenied } from "./errors.mjs";
import { rewardIdSchema } from "./contracts.mjs";
import { createOfferSchema, updateOfferSchema, offerTransitionSchema, offerListSchema,
  offerTermsSchema, offerDisplayState } from "./offer-contracts.mjs";
import { runSerializableTransaction, isRetryableTransactionError } from "../transaction-retry.mjs";
import { campaignLinkReviewSchema, campaignLinkSaveSchema } from "./campaign-link-contracts.mjs";
import { createCampaignLinkOperations } from "./campaign-link-service.mjs";

const PAGE_SIZE = 25;
const MAX_COUNTER = 2_147_483_646;
const TRANSITIONS = new Set(["PUBLISH", "PAUSE", "RESUME", "CANCEL"]);
const include = Object.freeze({
  locations: { select: { organisationId: true, offerId: true, locationId: true, scope: true } },
  revisions: { orderBy: { revision: "desc" }, take: 1,
    select: { organisationId: true, offerId: true, revision: true, terms: true } }
});

class OfferAbort extends Error {
  constructor(result) { super(result.code); this.result = result; }
}
const abort = code => { throw new OfferAbort(rewardsDenied(code)); };
const requireAllowed = result => { if (!result.ok) throw new OfferAbort(result); return result; };
const sorted = ids => [...new Set(ids)].sort();
const sameIds = (a, b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
const sameActor = (a, b) => a.ok === true && b.ok === true && a.organisationId === b.organisationId &&
  a.userId === b.userId && a.organisationMemberId === b.organisationMemberId;
const iso = value => { const date = new Date(value); if (!Number.isFinite(date.getTime())) abort("UNAVAILABLE"); return date.toISOString(); };

function nowAt(clock) {
  const now = clock();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) abort("UNAVAILABLE");
  return new Date(now.getTime());
}

function scopeWhere(access) {
  // Requiring every target (including the still-live revision) prevents a shop
  // manager from reading or modifying a multi-shop offer using one allowed shop.
  return { organisationId: access.organisationId, locations: {
    some: { scope: "DRAFT" },
    every: { organisationId: access.organisationId,
      ...(access.locationScope.kind === "LOCATIONS" ? { locationId: { in: access.locationScope.locationIds } } : {}) }
  } };
}

function targetIds(row, scope) {
  return row.locations.filter(location => location.scope === scope).map(location => location.locationId);
}

function inspectOffer(row, access) {
  if (!row || row.organisationId !== access.organisationId) abort("OFFER_UNAVAILABLE");
  if (!Array.isArray(row.locations) || row.locations.length === 0 || row.locations.some(location =>
    location.organisationId !== access.organisationId || location.offerId !== row.id ||
    !["DRAFT", "PUBLISHED"].includes(location.scope) ||
    (access.locationScope.kind === "LOCATIONS" && !access.locationScope.locationIds.includes(location.locationId)))) abort("OFFER_UNAVAILABLE");
  const draft = offerTermsSchema.safeParse(row.draft);
  if (!draft.success || !sameIds(draft.data.locationIds, targetIds(row, "DRAFT"))) abort("UNAVAILABLE");
  let publishedTerms = null;
  if (row.publishedRevision !== null) {
    const revision = row.revisions?.[0];
    if (!revision || revision.organisationId !== row.organisationId || revision.offerId !== row.id ||
      revision.revision !== row.publishedRevision || row.lastRevision !== row.publishedRevision) abort("UNAVAILABLE");
    const terms = offerTermsSchema.safeParse(revision.terms);
    if (!terms.success || !sameIds(terms.data.locationIds, targetIds(row, "PUBLISHED")) ||
      iso(terms.data.startsAt) !== iso(row.publishedStartsAt) || iso(terms.data.endsAt) !== iso(row.publishedEndsAt)) abort("UNAVAILABLE");
    publishedTerms = terms.data;
  } else if (row.lastRevision !== 0 || row.revisions?.length || targetIds(row, "PUBLISHED").length) abort("UNAVAILABLE");
  return { draft: draft.data, publishedTerms };
}

function present(row, access, now) {
  const terms = inspectOffer(row, access);
  return { id: row.id, version: row.version, state: row.state, displayState: offerDisplayState(row, now),
    ...terms, publishedRevision: row.publishedRevision, lastRevision: row.lastRevision,
    createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt) };
}

function stateWhere(state, now) {
  if (!state) return {};
  if (["DRAFT", "CANCELLED"].includes(state)) return { state };
  if (state === "EXPIRED") return { state: { in: ["PUBLISHED", "PAUSED"] }, publishedEndsAt: { lte: now } };
  if (state === "PAUSED") return { state: "PAUSED", publishedEndsAt: { gt: now } };
  if (state === "SCHEDULED") return { state: "PUBLISHED", publishedStartsAt: { gt: now } };
  return { state: "PUBLISHED", publishedStartsAt: { lte: now }, publishedEndsAt: { gt: now } };
}

/** Client Admin service. No activation, public claims, checkout or payments.
 * loadContext(tx) is a trusted server adapter that reloads session, user,
 * membership and business subscription in the supplied transaction. Request
 * bodies must never supply an organisation, actor, permission or entitlement.
 */
export function createRewardOfferService({ db, env = {}, loadContext, clock = () => new Date() } = {}) {
  const enabled = () => readRewardsFeaturePolicy(env).enabled;
  async function guard(client, action) {
    let context, rewardState, staffRows = [];
    const guardStartedAt = nowAt(clock);
    const adapter = createRewardsDatabaseAdapter(client);
    const access = await requireRetailRewardsAccess({ action }, { env, clock,
      loadContext: async () => { context = await loadContext(client); return context; },
      ...adapter,
      loadRewardsState: async input => { rewardState = await adapter.loadRewardsState(input); return rewardState; },
      loadStaffGrants: async input => { staffRows = await adapter.loadStaffGrants(input); return staffRows; } });
    if (!access.ok) return access;
    // Keep a conservative private deadline for compound READ/MANAGE checks.
    // An earlier action's scope may expire while a later action is being read.
    const checkedAt = nowAt(clock), expiries = [context.session.expiresAt, rewardState?.grant?.expiresAt,
      ...staffRows.filter(row => row.revokedAt === null && row.startsAt <= checkedAt && row.expiresAt > guardStartedAt &&
        row.capabilities.includes(action)).map(row => row.expiresAt)];
    const accessValidUntil = Math.min(...expiries.filter(value => value instanceof Date).map(value => value.getTime()));
    // Private lock targets come only from the context validated by the guard.
    // They are never accepted from a request or included in an HTTP result.
    return { ...access, accessValidUntil, authority: { sessionId: context.session.id,
      subscriptionId: context.membership.organisation.subscription.id, role: context.membership.role } };
  }
  async function safely(operation) {
    if (!enabled()) return rewardsDenied("FEATURE_DISABLED");
    try { return await operation(); }
    catch (error) {
      if (error instanceof OfferAbort) return error.result;
      return rewardsDenied(isRetryableTransactionError(error) ? "CONFLICT" : "UNAVAILABLE");
    }
  }
  async function locationsAvailable(tx, access, ids, { active = true } = {}) {
    const targets = sorted(ids);
    if (targets.length === 0 || targets.length > 1000 ||
      (access.locationScope.kind === "LOCATIONS" && targets.some(id => !access.locationScope.locationIds.includes(id)))) abort("LOCATION_UNAVAILABLE");
    // Lock exact target rows before validating their status. A change committed
    // since the SERIALIZABLE snapshot raises 40001 rather than using stale state.
    const locked = await tx.$queryRaw`SELECT "id" FROM "Location" WHERE "organisationId" = ${access.organisationId}
      AND "id" IN (SELECT jsonb_array_elements_text(${JSON.stringify(targets)}::jsonb)) FOR SHARE`;
    if (!Array.isArray(locked) || !sameIds(locked.map(row => row.id), targets)) abort("LOCATION_UNAVAILABLE");
    const rows = await tx.location.findMany({ where: { organisationId: access.organisationId, id: { in: targets },
      ...(active ? { status: "ACTIVE" } : {}) }, select: { id: true, organisationId: true } });
    if (rows.some(row => row.organisationId !== access.organisationId) || !sameIds(rows.map(row => row.id), targets)) abort("LOCATION_UNAVAILABLE");
  }
  async function lockAuthority(tx, access) {
    // Plain re-reads under SERIALIZABLE retain the transaction's old snapshot.
    // Locking each existing authority row makes a revocation committed while
    // waiting for the programme lock force a retry. A later revocation waits for
    // this offer commit, giving the two operations an explicit ordering.
    const rows = await tx.$queryRaw`SELECT s."id" FROM "Session" s
      JOIN "User" u ON u."id" = s."userId"
      JOIN "OrganisationMember" m ON m."userId" = u."id" AND m."id" = ${access.organisationMemberId}
      JOIN "Subscription" sub ON sub."organisationId" = m."organisationId" AND sub."id" = ${access.authority.subscriptionId}
      JOIN "Plan" p ON p."id" = sub."planId"
      JOIN "RewardEntitlementGrant" g ON g."organisationId" = m."organisationId" AND g."subscriptionId" = sub."id"
      WHERE s."id" = ${access.authority.sessionId} AND u."id" = ${access.userId}
        AND s."activeOrganisationId" = ${access.organisationId} AND m."organisationId" = ${access.organisationId}
      FOR SHARE OF s, u, m, sub, p, g`;
    if (!Array.isArray(rows) || rows.length !== 1 || rows[0].id !== access.authority.sessionId) abort("FORBIDDEN");
    if (access.authority.role !== "OWNER") {
      const staff = await tx.$queryRaw`SELECT "id" FROM "RewardStaffGrant"
        WHERE "organisationId" = ${access.organisationId} AND "organisationMemberId" = ${access.organisationMemberId}
        ORDER BY "id" LIMIT 1001 FOR SHARE`;
      if (!Array.isArray(staff) || staff.length === 0 || staff.length > 1000) abort("FORBIDDEN");
    }
    await tx.$queryRaw`SELECT "id" FROM "BillingContract" WHERE "subscriptionId" = ${access.authority.subscriptionId} FOR SHARE`;
    await tx.$queryRaw`SELECT "id" FROM "EnterpriseSecurityPolicy" WHERE "organisationId" = ${access.organisationId} FOR SHARE`;
    // These locks protect existing rows. Newly inserted optional deny policies
    // still follow PostgreSQL's serializable ordering; no global policy barrier
    // or gap-lock guarantee is claimed for those future configuration workflows.
  }
  async function write(action, operation) {
    return runSerializableTransaction(db, async tx => {
      if (!enabled()) abort("FEATURE_DISABLED");
      const initial = requireAllowed(await guard(tx, action));
      const locked = await tx.$queryRaw`SELECT "id" FROM "RewardProgram" WHERE "organisationId" = ${initial.organisationId} FOR UPDATE`;
      if (!Array.isArray(locked) || locked.length !== 1) abort("NOT_ENTITLED");
      await lockAuthority(tx, initial);
      const access = requireAllowed(await guard(tx, action));
      if (access.organisationId !== initial.organisationId || access.userId !== initial.userId ||
        access.organisationMemberId !== initial.organisationMemberId || access.authority.sessionId !== initial.authority.sessionId ||
        access.authority.subscriptionId !== initial.authority.subscriptionId) abort("FORBIDDEN");
      const finalChecks = [];
      const result = await operation(tx, access, locked[0].id, check => finalChecks.push(check));
      // Recheck the clock/expiry and feature gate before committing, and abort
      // the whole transaction if a fresh server context no longer authorises it.
      const finalAccess = requireAllowed(await guard(tx, action));
      if (finalAccess.organisationId !== access.organisationId || finalAccess.userId !== access.userId ||
        finalAccess.organisationMemberId !== access.organisationMemberId || finalAccess.authority.sessionId !== access.authority.sessionId ||
        finalAccess.authority.subscriptionId !== access.authority.subscriptionId) abort("FORBIDDEN");
      inspectOffer(result, finalAccess);
      for (const check of finalChecks) await check(tx, finalAccess, result);
      return { ok: true, offer: present(result, finalAccess, nowAt(clock)) };
    }, { maxAttempts: 3, retryDelayMs: 10 });
  }
  async function loadOffer(tx, access, id) {
    const row = await tx.rewardOffer.findFirst({ where: { ...scopeWhere(access), id }, include });
    inspectOffer(row, access);
    return row;
  }
  async function saveLocations(tx, access, offerId, scope, ids) {
    await tx.rewardOfferLocation.deleteMany({ where: { organisationId: access.organisationId, offerId, scope } });
    await tx.rewardOfferLocation.createMany({ data: ids.map(locationId => ({ organisationId: access.organisationId,
      offerId, locationId, scope })) });
  }
  async function audit(tx, access, offer, action) {
    await tx.rewardAuditEvent.create({ data: { organisationId: access.organisationId,
      actorUserId: access.userId, actorOrganisationMemberId: access.organisationMemberId,
      action, targetType: "OFFER", targetId: offer.id,
      metadata: { reasonCode: "OWNER_REQUEST", version: offer.version,
        ...(offer.publishedRevision !== null ? { revision: offer.publishedRevision } : {}) } } });
  }
  async function optimisticUpdate(tx, access, row, data) {
    if (row.version > MAX_COUNTER) abort("CONFLICT");
    const result = await tx.rewardOffer.updateMany({ where: { id: row.id, organisationId: access.organisationId,
      version: row.version }, data: { ...data, version: { increment: 1 }, updatedByUserId: access.userId } });
    if (result.count !== 1) abort("CONFLICT");
  }
  async function capacity(tx, access, id, terms, now) {
    const count = await tx.rewardOffer.count({ where: { organisationId: access.organisationId,
      id: { not: id }, state: { in: ["PUBLISHED", "PAUSED"] }, publishedEndsAt: { gt: now } } });
    if (!Number.isSafeInteger(count) || count < 0 || count >= access.limits.activeOffers) abort("LIMIT_REACHED");
    // Count on the server, never fetch an unbounded set of another shop's data.
    // Scheduled and paused offers reserve capacity, so pause cannot evade quotas.
    const result = await tx.$queryRaw`SELECT count(DISTINCT targets.location)::bigint AS count FROM (
      SELECT ol."locationId" AS location FROM "RewardOfferLocation" ol
      JOIN "RewardOffer" o ON o."id" = ol."offerId" AND o."organisationId" = ol."organisationId"
      WHERE ol."organisationId" = ${access.organisationId} AND ol."scope" = 'PUBLISHED'
        AND o."id" <> ${id} AND o."state" IN ('PUBLISHED', 'PAUSED') AND o."publishedEndsAt" > ${now}
      UNION ALL SELECT jsonb_array_elements_text(${JSON.stringify(terms.locationIds)}::jsonb)
    ) targets`;
    const locations = Number(result?.[0]?.count);
    if (!Number.isSafeInteger(locations) || locations < 1) abort("UNAVAILABLE");
    if (locations > access.limits.locations) abort("LIMIT_REACHED");
  }
  const campaignLinks = createCampaignLinkOperations({ env, clock, guard, loadOffer, inspectOffer, abort });

  return Object.freeze({
    campaignLinks(input) {
      if (!campaignLinks.enabled()) return Promise.resolve(rewardsDenied("FEATURE_DISABLED"));
      return safely(async () => {
        const parsed = campaignLinkReviewSchema.safeParse(input);
        if (!parsed.success) abort("INVALID_REQUEST");
        const initial = await campaignLinks.accessFor(db), options = { isolationLevel: "RepeatableRead", maxWait: 5000, timeout: 10000 };
        const before = await db.$transaction(tx => campaignLinks.collect(tx, parsed.data, initial[0]), options);
        const after = await db.$transaction(tx => campaignLinks.collect(tx, parsed.data, initial[0]), options);
        const final = await campaignLinks.accessFor(db, initial[0]), checkedAt = campaignLinks.nowAt();
        if (before.fingerprint !== after.fingerprint || JSON.stringify(before.access) !== JSON.stringify(after.access) ||
          JSON.stringify(final) !== JSON.stringify(after.access) || new Date(after.expiresAt) <= checkedAt) abort("CONFLICT");
        return { ...after.view, checkedAt: checkedAt.toISOString() };
      });
    },
    saveCampaignLink(input) {
      if (!campaignLinks.enabled()) return Promise.resolve(rewardsDenied("FEATURE_DISABLED"));
      return safely(async () => {
        const parsed = campaignLinkSaveSchema.safeParse(input);
        if (!parsed.success) abort("INVALID_REQUEST");
        return write("MANAGE_OFFERS", async (tx, access, _programId, addFinalCheck) => {
          const row = await loadOffer(tx, access, parsed.data.offerId);
          addFinalCheck((client, current, result) => campaignLinks.assertFinal(client, current, [row, result]));
          await campaignLinks.save(tx, access, row, parsed.data);
          await optimisticUpdate(tx, access, row, {});
          const saved = await loadOffer(tx, access, row.id);
          await audit(tx, access, saved, parsed.data.campaignId === null ? "OFFER_CAMPAIGN_DRAFT_CLEARED" : "OFFER_CAMPAIGN_DRAFT_SAVED");
          return saved;
        });
      });
    },
    list(input = {}) {
      return safely(async () => {
        const parsed = offerListSchema.safeParse(input);
        if (!parsed.success) abort("INVALID_REQUEST");
        const query = parsed.data, page = query.page ?? 1, now = nowAt(clock);
        const access = requireAllowed(await guard(db, "READ"));
        const [manage, publish] = await Promise.all([guard(db, "MANAGE_OFFERS"), guard(db, "PUBLISH_OFFERS")]);
        const where = { ...scopeWhere(access), ...stateWhere(query.state, now),
          ...(query.category ? { draft: { path: ["category"], equals: query.category } } : {}),
          ...(query.search ? { OR: ["title", "description"].map(field => ({ draft: {
            path: [field], string_contains: query.search, mode: "insensitive" } })) } : {}) };
        const rows = await db.rewardOffer.findMany({ where, include,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: PAGE_SIZE + 1, skip: (page - 1) * PAGE_SIZE });
        const locations = await db.location.findMany({ where: { organisationId: access.organisationId, status: "ACTIVE",
          ...(access.locationScope.kind === "LOCATIONS" ? { id: { in: access.locationScope.locationIds } } : {}) },
          select: { id: true, name: true, organisationId: true }, orderBy: [{ name: "asc" }, { id: "asc" }], take: 501 });
        if (locations.some(location => location.organisationId !== access.organisationId)) abort("UNAVAILABLE");
        const finalAccess = requireAllowed(await guard(db, "READ"));
        if (!sameActor(finalAccess, access)) abort("FORBIDDEN");
        if (finalAccess.locationScope.kind === "LOCATIONS" &&
          locations.some(location => !finalAccess.locationScope.locationIds.includes(location.id))) abort("FORBIDDEN");
        return { ok: true, offers: rows.slice(0, PAGE_SIZE).map(row => present(row, finalAccess, nowAt(clock))), page,
          hasMore: rows.length > PAGE_SIZE, locations: locations.slice(0, 500).map(({ id, name }) => ({ id, name })),
          locationSelectionTruncated: locations.length > 500,
          capabilities: { manage: sameActor(manage, finalAccess), publish: sameActor(publish, finalAccess) }, limits: finalAccess.limits };
      });
    },
    create(input) {
      return safely(async () => {
        const parsed = createOfferSchema.safeParse(input);
        if (!parsed.success) abort("INVALID_REQUEST");
        return write("MANAGE_OFFERS", async (tx, access, programId) => {
          const terms = parsed.data.terms;
          await locationsAvailable(tx, access, terms.locationIds);
          const row = await tx.rewardOffer.create({ data: { id: randomUUID(), organisationId: access.organisationId,
            programId, draft: terms, state: "DRAFT", version: 1, lastRevision: 0,
            createdByUserId: access.userId, updatedByUserId: access.userId } });
          await saveLocations(tx, access, row.id, "DRAFT", terms.locationIds);
          const saved = await loadOffer(tx, access, row.id);
          await audit(tx, access, saved, "OFFER_CREATED");
          return saved;
        });
      });
    },
    update(id, input) {
      return safely(async () => {
        const parsed = updateOfferSchema.safeParse(input);
        if (!rewardIdSchema.safeParse(id).success || !parsed.success) abort("INVALID_REQUEST");
        return write("MANAGE_OFFERS", async (tx, access) => {
          const row = await loadOffer(tx, access, id);
          if (row.version !== parsed.data.expectedVersion || row.state === "CANCELLED") abort("CONFLICT");
          await locationsAvailable(tx, access, parsed.data.terms.locationIds);
          await optimisticUpdate(tx, access, row, { draft: parsed.data.terms });
          await saveLocations(tx, access, id, "DRAFT", parsed.data.terms.locationIds);
          const saved = await loadOffer(tx, access, id);
          await audit(tx, access, saved, "OFFER_DRAFT_SAVED");
          return saved;
        });
      });
    },
    transition(id, action, input) {
      return safely(async () => {
        const parsed = offerTransitionSchema.safeParse(input);
        if (!rewardIdSchema.safeParse(id).success || !TRANSITIONS.has(action) || !parsed.success) abort("INVALID_REQUEST");
        return write("PUBLISH_OFFERS", async (tx, access, _programId, addFinalCheck) => {
          const row = await loadOffer(tx, access, id);
          if (row.version !== parsed.data.expectedVersion || row.state === "CANCELLED") abort("CONFLICT");
          const { draft, publishedTerms } = inspectOffer(row, access), now = nowAt(clock);
          if (action === "PUBLISH") {
            if (row.lastRevision >= MAX_COUNTER || new Date(draft.endsAt) <= now) abort("INVALID_REQUEST");
            await locationsAvailable(tx, access, draft.locationIds);
            await capacity(tx, access, id, draft, now);
            const campaignPin = await campaignLinks.preparePin(tx, access, row);
            if (campaignPin) addFinalCheck((client, current, result) => campaignLinks.assertFinal(client, current, [row, result]));
            const revision = row.lastRevision + 1;
            await tx.rewardOfferRevision.create({ data: { organisationId: access.organisationId, offerId: id,
              revision, terms: draft, actorUserId: access.userId } });
            await campaignLinks.pin(tx, access, campaignPin, revision, row);
            await optimisticUpdate(tx, access, row, { state: "PUBLISHED", lastRevision: revision,
              publishedRevision: revision, publishedStartsAt: new Date(draft.startsAt), publishedEndsAt: new Date(draft.endsAt) });
            await saveLocations(tx, access, id, "PUBLISHED", draft.locationIds);
          } else if (action === "RESUME") {
            if (row.state !== "PAUSED" || !publishedTerms || new Date(publishedTerms.endsAt) <= now) abort("CONFLICT");
            await locationsAvailable(tx, access, publishedTerms.locationIds);
            await capacity(tx, access, id, publishedTerms, now);
            await optimisticUpdate(tx, access, row, { state: "PUBLISHED" });
          } else {
            if (action === "PAUSE" && (row.state !== "PUBLISHED" || !publishedTerms)) abort("CONFLICT");
            // Inactive shops can still have stale offers paused/cancelled. Their
            // tenant ownership and the caller's complete location scope remain required.
            await locationsAvailable(tx, access, row.locations.map(location => location.locationId), { active: false });
            await optimisticUpdate(tx, access, row, { state: action === "PAUSE" ? "PAUSED" : "CANCELLED" });
          }
          const saved = await loadOffer(tx, access, id);
          await audit(tx, access, saved, { PUBLISH: "OFFER_PUBLISHED", PAUSE: "OFFER_PAUSED",
            RESUME: "OFFER_RESUMED", CANCEL: "OFFER_CANCELLED" }[action]);
          return saved;
        });
      });
    }
  });
}
