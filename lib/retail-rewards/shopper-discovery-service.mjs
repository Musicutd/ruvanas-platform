import { z } from "zod";
import { rewardIdSchema } from "./contracts.mjs";
import { offerTermsSchema, REWARD_CATEGORIES } from "./offer-contracts.mjs";
import { readShopperFeaturePolicy, shopperBrowseSchema, publicSlugSchema, shopperOfferTerms } from "./shopper-contracts.mjs";
import { createRewardsDatabaseAdapter } from "./database-adapter.mjs";
import { resolveRewardsEntitlements } from "./entitlements.mjs";
import { rewardsDenied } from "./errors.mjs";
import { pilotPreviewOrganisationAllowed, pilotPreviewOrganisationWhere } from "./pilot-preview-policy.mjs";

const PAGE_SIZE = 25;
const categories = REWARD_CATEGORIES.map(item => item.value);
const date = z.date().refine(value => Number.isFinite(value.getTime()));
const publicText = max => z.string().max(max).refine(value => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value));
const profileSchema = z.object({
  id: rewardIdSchema, organisationId: rewardIdSchema, locationId: rewardIdSchema,
  publicSlug: publicSlugSchema, displayName: publicText(140).min(1), description: publicText(2000),
  locality: publicText(120), countryCode: z.string().regex(/^[A-Z]{2}$/),
  status: z.literal("PUBLISHED"), networkOptIn: z.literal(true), publishedAt: date, revokedAt: z.null(),
  location: z.object({ id: rewardIdSchema, organisationId: rewardIdSchema, status: z.literal("ACTIVE") }).strict()
}).strict();
const profileSelect = Object.freeze({
  id: true, organisationId: true, locationId: true, publicSlug: true, displayName: true,
  description: true, locality: true, countryCode: true, status: true, networkOptIn: true,
  publishedAt: true, revokedAt: true,
  location: { select: { id: true, organisationId: true, status: true } }
});
const listingSelect = Object.freeze({
  id: true, organisationId: true, offerId: true, revision: true, publicSlug: true,
  discoverable: true, approvedAt: true, revokedAt: true,
  publishedSnapshot: { select: { organisationId: true, offerId: true, revision: true, terms: true } },
  offer: { select: { id: true, organisationId: true, programId: true, state: true, publishedRevision: true,
    publishedStartsAt: true, publishedEndsAt: true,
    locations: { where: { scope: "PUBLISHED" }, orderBy: { locationId: "asc" }, take: 501,
      select: { organisationId: true, offerId: true, locationId: true, scope: true } } } }
});
const accessSchema = z.object({ ok: z.literal(true), shopperId: rewardIdSchema, sessionId: rewardIdSchema, membershipId: rewardIdSchema }).strict();
const sameAccess = (a, b) => a.shopperId === b.shopperId && a.sessionId === b.sessionId && a.membershipId === b.membershipId;
const sameIds = (a, b) => {
  if (a.length !== b.length || new Set(a).size !== a.length || new Set(b).size !== b.length) return false;
  const first = [...a].sort(), second = [...b].sort();
  return first.every((item, index) => item === second[index]);
};
const finiteDate = value => value instanceof Date && Number.isFinite(value.getTime());
const unavailable = () => rewardsDenied("OFFER_UNAVAILABLE");

class DiscoveryAbort extends Error {
  constructor(result) { super(result.code); this.result = result; }
}

function currentTime(clock) {
  const value = clock();
  if (!finiteDate(value)) throw new Error("Invalid clock.");
  return new Date(value.getTime());
}

function publicProfileWhere(now) {
  return { status: "PUBLISHED", networkOptIn: true, publishedAt: { lte: now }, revokedAt: null,
    location: { status: "ACTIVE" } };
}

function snapshotFilter(query) {
  return { ...(query.category ? { terms: { path: ["category"], equals: query.category } } : {}),
    ...(query.search ? { OR: ["title", "description"].map(field => ({ terms: {
      path: [field], string_contains: query.search, mode: "insensitive" } })) } : {}) };
}

function liveOfferWhere(now, query = {}) {
  const consent = { discoverable: true, approvedAt: { lte: now }, revokedAt: null };
  return { state: "PUBLISHED", publishedStartsAt: { lte: now }, publishedEndsAt: { gt: now },
    discovery: consent,
    // Discovery.offerId is unique and the revision FK includes that offer. A
    // listing on the current published snapshot therefore proves the exact
    // current revision before pagination, rather than letting stale listings
    // fill a candidate window and hide later currently published coupons.
    publishedSnapshot: { ...snapshotFilter(query), discoveryListings: { some: consent } } };
}

function matchesQuery(terms, query) {
  return (!query.category || terms.category === query.category) && (!query.search ||
    `${terms.title}\n${terms.description}`.toLocaleLowerCase("en").includes(query.search.toLocaleLowerCase("en")));
}

function inspectListing(row, profile, authority, now, query = {}) {
  const offer = row?.offer, snapshot = row?.publishedSnapshot;
  if (!row || row.organisationId !== profile.organisationId || !rewardIdSchema.safeParse(row.id).success ||
    !publicSlugSchema.safeParse(row.publicSlug).success || row.discoverable !== true || row.revokedAt !== null ||
    !finiteDate(row.approvedAt) || row.approvedAt > now || !Number.isSafeInteger(row.revision) || row.revision < 1 ||
    !offer || offer.organisationId !== profile.organisationId || offer.id !== row.offerId ||
    offer.programId !== authority.program.id || offer.state !== "PUBLISHED" || row.revision !== offer.publishedRevision ||
    !finiteDate(offer.publishedStartsAt) || !finiteDate(offer.publishedEndsAt) ||
    offer.publishedStartsAt > now || offer.publishedEndsAt <= now || offer.publishedStartsAt >= offer.publishedEndsAt ||
    !snapshot || snapshot.organisationId !== profile.organisationId || snapshot.offerId !== offer.id || snapshot.revision !== row.revision) return null;
  const parsed = offerTermsSchema.safeParse(snapshot.terms);
  if (!parsed.success || !matchesQuery(parsed.data, query)) return null;
  const terms = parsed.data, targets = offer.locations;
  if (!Array.isArray(targets) || targets.length < 1 || targets.length > 500 || targets.some(target =>
    target.organisationId !== profile.organisationId || target.offerId !== offer.id || target.scope !== "PUBLISHED" ||
    !rewardIdSchema.safeParse(target.locationId).success) || !sameIds(terms.locationIds, targets.map(target => target.locationId)) ||
    !terms.locationIds.includes(profile.locationId) || new Date(terms.startsAt).getTime() !== offer.publishedStartsAt.getTime() ||
    new Date(terms.endsAt).getTime() !== offer.publishedEndsAt.getTime()) return null;
  const publicTerms = shopperOfferTerms(terms);
  return publicTerms ? { slug: row.publicSlug, revision: row.revision, terms: publicTerms } : null;
}

/** Read-only cross-client discovery of deliberately public profiles and pinned
 * offer revisions. No raw database row or Client Admin offer DTO is returned.
 * Pages are bounded candidate windows, so withdrawal/ineligible rows can leave
 * a short or empty page with hasMore=true. Categories describe the eligible
 * coupons observed in that bounded window; no total or exhaustive count is claimed. */
export function createShopperDiscoveryService({ db, env = {}, loadShopper, clock = () => new Date() } = {}) {
  const enabled = () => readShopperFeaturePolicy(env).enabled;
  async function guard(previous) {
    if (!enabled()) throw new DiscoveryAbort(rewardsDenied("FEATURE_DISABLED"));
    if (typeof loadShopper !== "function") throw new DiscoveryAbort(rewardsDenied("UNAVAILABLE"));
    const value = await loadShopper(db), parsed = accessSchema.safeParse(value);
    if (!parsed.success) throw new DiscoveryAbort(rewardsDenied(value?.ok === false ? value.code : "UNAUTHENTICATED"));
    if (previous && !sameAccess(previous, parsed.data)) throw new DiscoveryAbort(rewardsDenied("UNAUTHENTICATED"));
    return parsed.data;
  }

  async function authorityFor(organisationId) {
    if (!pilotPreviewOrganisationAllowed(env, organisationId)) return null;
    const organisation = await db.organisation.findUnique({ where: { id: organisationId },
      select: { id: true, subscription: { include: { plan: true, billingContract: true } } } });
    if (organisation?.id !== organisationId || !rewardIdSchema.safeParse(organisation.subscription?.id).success ||
      organisation.subscription.organisationId !== organisationId) return null;
    const program = await db.rewardProgram.findFirst({ where: { organisationId },
      select: { id: true, organisationId: true, status: true, networkOptIn: true } });
    if (!program || program.organisationId !== organisationId || program.networkOptIn !== true) return null;
    const state = await createRewardsDatabaseAdapter(db).loadRewardsState({ organisationId, subscriptionId: organisation.subscription.id });
    if (state.program?.id !== program.id) return null;
    return { organisationId, subscription: organisation.subscription, grant: state.grant, program: state.program,
      networkOptIn: program.networkOptIn };
  }

  function eligibleAuthority(authority, now) {
    return Boolean(authority && pilotPreviewOrganisationAllowed(env, authority.organisationId) && authority.networkOptIn === true && resolveRewardsEntitlements({
      organisationId: authority.organisationId, subscription: authority.subscription,
      grant: authority.grant, program: authority.program, action: "READ", now }).allowed);
  }

  async function readListings(profile, query, now, offerSlug) {
    const rows = await db.rewardOfferDiscovery.findMany({
      where: { organisationId: profile.organisationId, ...(offerSlug ? { publicSlug: offerSlug } : {}),
        discoverable: true, approvedAt: { lte: now }, revokedAt: null,
        publishedSnapshot: snapshotFilter(query),
        offer: { ...liveOfferWhere(now, query), organisationId: profile.organisationId,
          locations: { some: { organisationId: profile.organisationId, locationId: profile.locationId, scope: "PUBLISHED" } } } },
      select: listingSelect, orderBy: [{ publicSlug: "asc" }, { id: "asc" }],
      skip: offerSlug ? 0 : ((query.page || 1) - 1) * PAGE_SIZE, take: offerSlug ? 2 : PAGE_SIZE + 1
    });
    if (!Array.isArray(rows) || rows.length > (offerSlug ? 2 : PAGE_SIZE + 1)) throw new Error("Invalid listing projection.");
    return { rows: rows.slice(0, offerSlug ? 1 : PAGE_SIZE), hasMore: !offerSlug && rows.length > PAGE_SIZE };
  }

  async function readShop(slug, query, now, offerSlug) {
    const row = await db.rewardPublicShopProfile.findFirst({ where: { publicSlug: slug, ...publicProfileWhere(now), ...pilotPreviewOrganisationWhere(env) }, select: profileSelect });
    const parsed = profileSchema.safeParse(row);
    if (!parsed.success || parsed.data.publicSlug !== slug || parsed.data.publishedAt > now ||
      parsed.data.location.id !== parsed.data.locationId || parsed.data.location.organisationId !== parsed.data.organisationId) return null;
    const profile = parsed.data, authority = await authorityFor(profile.organisationId);
    if (!eligibleAuthority(authority, now)) return null;
    const listings = await readListings(profile, query, now, offerSlug);
    return { profile, authority, listings, query, offerSlug };
  }

  function projectShop(view, now) {
    if (!view || !eligibleAuthority(view.authority, now) || view.profile.publishedAt > now) return null;
    const offers = view.listings.rows.map(row => inspectListing(row, view.profile, view.authority, now, view.query)).filter(Boolean);
    const found = new Set(offers.map(offer => offer.terms.category));
    const p = view.profile;
    return { shop: { slug: p.publicSlug, name: p.displayName, description: p.description,
      locality: p.locality, countryCode: p.countryCode, categories: categories.filter(value => found.has(value)) },
      offers, hasMore: view.listings.hasMore };
  }

  async function perform(read, project) {
    try {
      if (!enabled()) return rewardsDenied("FEATURE_DISABLED");
      const access = await guard(), started = currentTime(clock);
      // A second fresh read observes a withdrawal, revision change or client
      // entitlement change committed during the first pass. This is a bounded
      // read, not a lock or guarantee against a change after the final read.
      await read(started);
      await guard(access);
      const observed = currentTime(clock);
      if (observed < started) return rewardsDenied("UNAVAILABLE");
      const latest = await read(observed);
      await guard(access);
      const finished = currentTime(clock);
      if (finished < observed) return rewardsDenied("UNAVAILABLE");
      if (!enabled()) return rewardsDenied("FEATURE_DISABLED");
      return project(latest, finished);
    } catch (error) {
      return error instanceof DiscoveryAbort ? error.result : rewardsDenied("UNAVAILABLE");
    }
  }

  return Object.freeze({
    async shops(input = {}) {
      if (!enabled()) return rewardsDenied("FEATURE_DISABLED");
      const parsed = shopperBrowseSchema.safeParse(input);
      if (!parsed.success) return rewardsDenied("INVALID_REQUEST");
      const query = parsed.data, page = query.page || 1;
      return perform(async now => {
        const rows = await db.rewardPublicShopProfile.findMany({
          where: { ...publicProfileWhere(now), ...pilotPreviewOrganisationWhere(env),
            ...(query.search ? { OR: ["displayName", "description", "locality"].map(field => ({ [field]: { contains: query.search, mode: "insensitive" } })) } : {}),
            location: { status: "ACTIVE", rewardOfferLocations: { some: { scope: "PUBLISHED", offer:
              liveOfferWhere(now, { category: query.category }) } } } },
          select: { publicSlug: true }, orderBy: [{ publicSlug: "asc" }, { id: "asc" }], skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE + 1
        });
        if (!Array.isArray(rows) || rows.length > PAGE_SIZE + 1) throw new Error("Invalid shop projection.");
        const views = [];
        for (const row of rows.slice(0, PAGE_SIZE)) {
          if (!publicSlugSchema.safeParse(row.publicSlug).success) continue;
          views.push(await readShop(row.publicSlug, { category: query.category }, now));
        }
        return { views, hasMore: rows.length > PAGE_SIZE };
      }, (data, now) => ({ ok: true, shops: data.views.map(view => projectShop(view, now))
        .filter(view => view && view.offers.length > 0).map(view => view.shop), page, hasMore: data.hasMore }));
    },
    async shop(slug, input = {}) {
      if (!enabled()) return rewardsDenied("FEATURE_DISABLED");
      if (!publicSlugSchema.safeParse(slug).success) return unavailable();
      const parsed = shopperBrowseSchema.safeParse(input);
      if (!parsed.success) return rewardsDenied("INVALID_REQUEST");
      const query = parsed.data;
      return perform(now => readShop(slug, query, now), (data, now) => {
        const value = projectShop(data, now);
        return value ? { ok: true, shop: value.shop, offers: value.offers, page: query.page || 1, hasMore: value.hasMore } : unavailable();
      });
    },
    async offer(shopSlug, offerSlug) {
      if (!enabled()) return rewardsDenied("FEATURE_DISABLED");
      if (!publicSlugSchema.safeParse(shopSlug).success || !publicSlugSchema.safeParse(offerSlug).success) return unavailable();
      return perform(now => readShop(shopSlug, {}, now, offerSlug), (data, now) => {
        const value = projectShop(data, now);
        return value?.offers.length === 1 && value.offers[0].slug === offerSlug
          ? { ok: true, shop: value.shop, offer: value.offers[0] } : unavailable();
      });
    }
  });
}
