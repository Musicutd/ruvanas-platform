import { z } from "zod";
import { rewardIdSchema } from "./contracts.mjs";
import { readShopperFeaturePolicy } from "./shopper-contracts.mjs";
import { rewardsDenied } from "./errors.mjs";
import { projectShopperSavings, SAVINGS_MAX_RECEIPTS, SAVINGS_CURRENCIES } from "./shopper-savings-contracts.mjs";

const accessSchema = z.object({ ok: z.literal(true), shopperId: rewardIdSchema, sessionId: rewardIdSchema, membershipId: rewardIdSchema }).strict();
const sameAccess = (a, b) => a.shopperId === b.shopperId && a.sessionId === b.sessionId && a.membershipId === b.membershipId;
const date = z.date().refine(value => Number.isFinite(value.getTime()));
const scope = { id: rewardIdSchema, organisationId: rewardIdSchema, offerId: rewardIdSchema, shopperId: rewardIdSchema, locationId: rewardIdSchema };
const receiptSchema = z.object({ ...scope, claimId: rewardIdSchema, currency: z.enum(SAVINGS_CURRENCIES),
  discountMinor: z.number().int().min(0).max(100_000_000).nullable(), occurredAt: date,
  claim: z.object(scope).strict(),
  reversal: z.object({ redemptionId: rewardIdSchema, organisationId: rewardIdSchema, occurredAt: date }).strict().nullable()
}).strict();
const select = Object.freeze({ id: true, organisationId: true, offerId: true, shopperId: true, locationId: true, claimId: true,
  currency: true, discountMinor: true, occurredAt: true,
  claim: { select: { id: true, organisationId: true, offerId: true, shopperId: true, locationId: true } },
  reversal: { select: { redemptionId: true, organisationId: true, occurredAt: true } } });
class Abort extends Error { constructor(result) { super(result.code); this.result = result; } }
function now(clock) { const value = clock(); if (!date.safeParse(value).success) throw new Error("Invalid clock."); return new Date(value); }

/** Shopper-owned, read-only history. No merchant/client billing is consulted.
 * Bound every pass; excess activity fails rather than displaying a partial sum.
 * Until a reviewed shopper payment adapter exists, paid/net totals stay unknown.
 */
export function createShopperSavingsService({ db, env = {}, loadShopper, clock = () => new Date() } = {}) {
  const enabled = () => readShopperFeaturePolicy(env).enabled;
  async function guard(previous) {
    if (!enabled()) throw new Abort(rewardsDenied("FEATURE_DISABLED"));
    const value = await loadShopper(db), parsed = accessSchema.safeParse(value);
    if (!parsed.success) throw new Abort(rewardsDenied(value?.ok === false ? value.code : "UNAUTHENTICATED"));
    if (previous && !sameAccess(previous, parsed.data)) throw new Abort(rewardsDenied("UNAUTHENTICATED"));
    return parsed.data;
  }
  async function read(access, at) {
    const rows = await db.rewardRedemption.findMany({ where: { shopperId: access.shopperId, occurredAt: { lte: at } },
      select, orderBy: [{ occurredAt: "asc" }, { id: "asc" }], take: SAVINGS_MAX_RECEIPTS + 1 });
    if (!Array.isArray(rows) || rows.length > SAVINGS_MAX_RECEIPTS) throw new Error("Savings history exceeds the bounded read.");
    const ids = new Set();
    return rows.map(value => {
      const row = receiptSchema.parse(value);
      if (ids.has(row.id) || row.shopperId !== access.shopperId || row.claim.id !== row.claimId ||
        ["organisationId", "offerId", "shopperId", "locationId"].some(key => row[key] !== row.claim[key]) || row.occurredAt > at ||
        row.reversal && (row.reversal.redemptionId !== row.id || row.reversal.organisationId !== row.organisationId || row.reversal.occurredAt < row.occurredAt)) {
        throw new Error("Receipt authority is unavailable.");
      }
      ids.add(row.id);
      return { id: row.id, shopperId: row.shopperId, currency: row.currency, discountMinor: row.discountMinor,
        occurredAt: row.occurredAt.toISOString(), reversedAt: row.reversal?.occurredAt.toISOString() || null };
    });
  }
  return Object.freeze({ async inspect() {
    try {
      if (!enabled()) return rewardsDenied("FEATURE_DISABLED");
      const access = await guard(), started = now(clock);
      await read(access, started);
      await guard(access);
      const observed = now(clock); if (observed < started) return rewardsDenied("UNAVAILABLE");
      const receipts = await read(access, observed);
      await guard(access);
      const finished = now(clock); if (finished < observed || finished - started > 20000) return rewardsDenied("UNAVAILABLE");
      if (!enabled()) return rewardsDenied("FEATURE_DISABLED");
      // Use the read's own cut-off, not the later response time. A snapshot is
      // not a guarantee against a correction committed after that observation.
      return projectShopperSavings({ shopperId: access.shopperId, receipts, checkedAt: observed.toISOString(), payments: null });
    } catch (error) { return error instanceof Abort ? error.result : rewardsDenied("UNAVAILABLE"); }
  } });
}
