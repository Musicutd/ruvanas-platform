import { z } from "zod";
import { rewardIdSchema } from "./contracts.mjs";
import { readShopperFeaturePolicy, publicSlugSchema } from "./shopper-contracts.mjs";
import { createShopperDiscoveryService } from "./shopper-discovery-service.mjs";
import { rewardsDenied } from "./errors.mjs";
import { savedVoucherPairSchema, savedWalletQuerySchema, savedWalletStatusSchema, safeSavedWalletResult } from "./shopper-saved-wallet-contracts.mjs";

const accessSchema = z.object({ ok: z.literal(true), shopperId: rewardIdSchema, sessionId: rewardIdSchema, membershipId: rewardIdSchema }).strict();
const select = { id: true, shopperId: true, shopProfileId: true, offerId: true, organisationId: true, createdAt: true,
  shopProfile: { select: { id: true, organisationId: true, publicSlug: true } },
  offer: { select: { id: true, organisationId: true, discovery: { select: { offerId: true, organisationId: true, publicSlug: true } } } } };
class Abort extends Error { constructor(result) { super(result.code); this.result = result; } }
const fail = code => { throw new Abort(rewardsDenied(code)); };
const sameAccess = (a, b) => a.shopperId === b.shopperId && a.sessionId === b.sessionId && a.membershipId === b.membershipId;

/** Bookmarks are scoped solely to the authenticated shopper. Each item is
 * re-projected through current public discovery; no private snapshot is stored
 * or returned. Saving does not issue claims, reserve uses or redeem anything. */
export function createShopperSavedWalletService({ db, env = {}, loadShopper, clock = () => new Date() } = {}) {
  async function guard(tx, previous) {
    if (!readShopperFeaturePolicy(env).enabled) fail("FEATURE_DISABLED");
    if (typeof loadShopper !== "function") fail("UNAVAILABLE");
    const value = await loadShopper(tx), parsed = accessSchema.safeParse(value);
    if (!parsed.success) fail(value?.ok === false ? value.code : "UNAUTHENTICATED");
    if (previous && !sameAccess(previous, parsed.data)) fail("UNAUTHENTICATED");
    return parsed.data;
  }
  function inspectRow(row, shopperId) {
    if (!row || row.shopperId !== shopperId || [row.id, row.shopProfileId, row.offerId, row.organisationId].some(id => !rewardIdSchema.safeParse(id).success) ||
      !(row.createdAt instanceof Date) || !Number.isFinite(row.createdAt.getTime()) ||
      row.shopProfile?.id !== row.shopProfileId || row.shopProfile.organisationId !== row.organisationId ||
      row.offer?.id !== row.offerId || row.offer.organisationId !== row.organisationId ||
      !publicSlugSchema.safeParse(row.shopProfile.publicSlug).success) fail("UNAVAILABLE");
    const listing = row.offer.discovery;
    if (listing && (listing.offerId !== row.offerId || listing.organisationId !== row.organisationId || !publicSlugSchema.safeParse(listing.publicSlug).success)) fail("UNAVAILABLE");
    return row;
  }
  function discovery(tx, access) {
    return createShopperDiscoveryService({ db: tx, env, clock, loadShopper: async store => guard(store, access) });
  }
  async function project(tx, row, access) {
    inspectRow(row, access.shopperId);
    const basic = { id: row.id, savedAt: row.createdAt.toISOString() };
    if (!row.offer.discovery) return { ...basic, status: "UNAVAILABLE" };
    const current = await discovery(tx, access).offer(row.shopProfile.publicSlug, row.offer.discovery.publicSlug);
    if (!current?.ok) {
      if (current?.code === "OFFER_UNAVAILABLE") return { ...basic, status: "UNAVAILABLE" };
      fail(current?.code);
    }
    return { ...basic, status: "AVAILABLE", shop: current.shop, offer: current.offer };
  }
  async function run(operation, work) {
    if (!readShopperFeaturePolicy(env).enabled) return rewardsDenied("FEATURE_DISABLED");
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        return await db.$transaction(async tx => {
          const access = await guard(tx), value = await work(tx, access);
          await guard(tx, access);
          const result = safeSavedWalletResult(operation, value);
          if (!result) fail("UNAVAILABLE");
          return result;
        }, { isolationLevel: "Serializable", maxWait: 5000, timeout: 20000 });
      } catch (error) {
        if (error instanceof Abort) return error.result;
        if (!["P2034", "P2002"].includes(error?.code) || attempt === 3) return rewardsDenied("UNAVAILABLE");
      }
    }
    return rewardsDenied("UNAVAILABLE");
  }
  return Object.freeze({
    async list(input = {}) {
      if (!readShopperFeaturePolicy(env).enabled) return rewardsDenied("FEATURE_DISABLED");
      const parsed = savedWalletQuerySchema.safeParse(input); if (!parsed.success) return rewardsDenied("INVALID_REQUEST");
      const page = parsed.data.page || 1;
      return run("list", async (tx, access) => {
        const where = { shopperId: access.shopperId };
        const rows = await tx.rewardSavedVoucher.findMany({ where, select, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * 25, take: 26 });
        const savedCount = await tx.rewardSavedVoucher.count({ where });
        if (!Array.isArray(rows) || rows.length > 26 || !Number.isSafeInteger(savedCount) || savedCount < 0) fail("UNAVAILABLE");
        const items = []; for (const row of rows.slice(0, 25)) items.push(await project(tx, row, access));
        return { ok: true, items, page, hasMore: rows.length > 25, savedCount };
      });
    },
    async save(input) {
      if (!readShopperFeaturePolicy(env).enabled) return rewardsDenied("FEATURE_DISABLED");
      const parsed = savedVoucherPairSchema.safeParse(input); if (!parsed.success) return rewardsDenied("INVALID_REQUEST");
      return run("save", async (tx, access) => {
        const { shopSlug, offerSlug } = parsed.data;
        const current = await discovery(tx, access).offer(shopSlug, offerSlug);
        if (!current?.ok) fail(current?.code);
        const profile = await tx.rewardPublicShopProfile.findFirst({ where: { publicSlug: shopSlug }, select: { id: true, organisationId: true } });
        const listing = profile && await tx.rewardOfferDiscovery.findFirst({ where: { publicSlug: offerSlug, organisationId: profile.organisationId }, select: { offerId: true, organisationId: true, revision: true } });
        if (!profile || !listing || listing.organisationId !== profile.organisationId || listing.revision !== current.offer.revision ||
          [profile.id, profile.organisationId, listing.offerId].some(id => !rewardIdSchema.safeParse(id).success)) fail("OFFER_UNAVAILABLE");
        const keys = { shopperId: access.shopperId, shopProfileId: profile.id, offerId: listing.offerId };
        const row = await tx.rewardSavedVoucher.upsert({ where: { shopperId_shopProfileId_offerId: keys },
          create: { ...keys, organisationId: profile.organisationId }, update: {}, select });
        return { ok: true, item: await project(tx, row, access) };
      });
    },
    async remove(id) {
      if (!readShopperFeaturePolicy(env).enabled) return rewardsDenied("FEATURE_DISABLED");
      if (!rewardIdSchema.safeParse(id).success) return rewardsDenied("INVALID_REQUEST");
      return run("remove", async (tx, access) => {
        await tx.rewardSavedVoucher.deleteMany({ where: { id, shopperId: access.shopperId } });
        // Absent and foreign bookmarks intentionally share the same response.
        return { ok: true, removed: true };
      });
    },
    async status(input) {
      if (!readShopperFeaturePolicy(env).enabled) return rewardsDenied("FEATURE_DISABLED");
      const parsed = savedWalletStatusSchema.safeParse(input); if (!parsed.success) return rewardsDenied("INVALID_REQUEST");
      return run("status", async (tx, access) => {
        const pairs = parsed.data.offers;
        const rows = pairs.length ? await tx.rewardSavedVoucher.findMany({ where: { shopperId: access.shopperId,
          OR: pairs.map(pair => ({ shopProfile: { publicSlug: pair.shopSlug }, offer: { discovery: { publicSlug: pair.offerSlug } } })) }, select, take: 26 }) : [];
        if (!Array.isArray(rows) || rows.length > pairs.length) fail("UNAVAILABLE");
        const saved = new Map();
        for (const row of rows) { inspectRow(row, access.shopperId);
          if (!row.offer.discovery) fail("UNAVAILABLE");
          saved.set(`${row.shopProfile.publicSlug}/${row.offer.discovery.publicSlug}`, row.id); }
        return { ok: true, items: pairs.map(pair => ({ ...pair, savedId: saved.get(`${pair.shopSlug}/${pair.offerSlug}`) || null })) };
      });
    }
  });
}
