import { z } from "zod";
import { rewardIdSchema } from "./contracts.mjs";

export const SAVINGS_CURRENCIES = Object.freeze(["EUR", "USD", "GBP", "CAD"]);
export const SAVINGS_MAX_RECEIPTS = 10000;
export const SAVINGS_MAX_EVENTS = 10000;
const currency = z.enum(SAVINGS_CURRENCIES);
const money = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const count = z.number().int().min(0).max(SAVINGS_MAX_RECEIPTS);
const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/).refine(value => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
});
const row = z.object({ currency, couponSavingsMinor: money, valuedRedemptions: count, unvaluedRedemptions: count,
  subscriptionPaidMinor: money.nullable(), netBenefitMinor: z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER).nullable() }).strict();
const snapshotSchema = z.object({ ok: z.literal(true), checkedAt: iso,
  period: z.object({ kind: z.literal("ALL_TIME"), through: iso }).strict(),
  paymentEvidence: z.enum(["UNAVAILABLE", "VERIFIED_COMPLETE"]), currencies: z.array(row).max(SAVINGS_CURRENCIES.length)
}).strict().superRefine((value, context) => {
  const fail = () => context.addIssue({ code: "custom", message: "Inconsistent savings snapshot." });
  if (value.period.through !== value.checkedAt || new Set(value.currencies.map(item => item.currency)).size !== value.currencies.length) fail();
  let receiptCount = 0;
  for (const item of value.currencies) {
    receiptCount += item.valuedRedemptions + item.unvaluedRedemptions;
    if (item.valuedRedemptions === 0 && item.couponSavingsMinor !== 0) fail();
    if (value.paymentEvidence === "UNAVAILABLE") {
      if (item.subscriptionPaidMinor !== null || item.netBenefitMinor !== null) fail();
    } else {
      if (item.subscriptionPaidMinor === null) fail();
      const expected = item.unvaluedRedemptions > 0 ? null : item.couponSavingsMinor - item.subscriptionPaidMinor;
      if (item.netBenefitMinor !== expected || (expected !== null && !Number.isSafeInteger(expected))) fail();
    }
  }
  if (receiptCount > SAVINGS_MAX_RECEIPTS) fail();
});

// Validates a server projection, never authentication or payment provenance.
export function safeShopperSavingsSnapshot(value) {
  const parsed = snapshotSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

const receiptSchema = z.object({ id: rewardIdSchema, shopperId: rewardIdSchema, currency,
  discountMinor: money.nullable(), occurredAt: iso, reversedAt: iso.nullable() }).strict();
const paymentEvent = z.object({ id: rewardIdSchema, paymentId: rewardIdSchema,
  kind: z.enum(["PAYMENT", "REFUND"]), status: z.literal("SETTLED"),
  currency, amountMinor: money.refine(value => value > 0), occurredAt: iso }).strict();
const paymentEvidence = z.object({ status: z.literal("VERIFIED_COMPLETE"), shopperId: rewardIdSchema,
  coverage: z.literal("ALL_SHOPPER_MEMBERSHIP_PAYMENTS"), through: iso,
  events: z.array(paymentEvent).max(SAVINGS_MAX_EVENTS) }).strict();

function add(a, b) {
  const sum = a + b;
  if (!Number.isSafeInteger(sum) || sum < 0) throw new Error("Savings amount is unavailable.");
  return sum;
}

function unique(rows) {
  const found = new Map();
  for (const value of rows) {
    const previous = found.get(value.id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(value)) throw new Error("Conflicting financial evidence.");
    found.set(value.id, value);
  }
  return [...found.values()];
}

/** Pure, internal projection contract for future verified payment adapters.
 * No HTTP input may provide this evidence. A marker does not verify a payment:
 * its future adapter must establish complete, settled shopper-only provenance.
 * The runtime service deliberately supplies null until that integration exists.
 */
export function projectShopperSavings({ shopperId, receipts, checkedAt, payments = null }) {
  rewardIdSchema.parse(shopperId); iso.parse(checkedAt);
  const values = z.array(receiptSchema).max(SAVINGS_MAX_RECEIPTS).parse(receipts);
  const buckets = new Map();
  const bucket = code => {
    if (!buckets.has(code)) buckets.set(code, { currency: code, couponSavingsMinor: 0, valuedRedemptions: 0,
      unvaluedRedemptions: 0, subscriptionPaidMinor: payments === null ? null : 0, netBenefitMinor: null });
    return buckets.get(code);
  };
  for (const receipt of unique(values)) {
    if (receipt.shopperId !== shopperId || receipt.occurredAt > checkedAt ||
      receipt.reversedAt && receipt.reversedAt < receipt.occurredAt) throw new Error("Receipt scope or time is unavailable.");
    if (receipt.reversedAt && receipt.reversedAt <= checkedAt) continue;
    const target = bucket(receipt.currency);
    if (receipt.discountMinor === null) target.unvaluedRedemptions++;
    else { target.valuedRedemptions++; target.couponSavingsMinor = add(target.couponSavingsMinor, receipt.discountMinor); }
  }
  if (payments !== null) {
    const proof = paymentEvidence.parse(payments);
    if (proof.shopperId !== shopperId || proof.through !== checkedAt) throw new Error("Payment coverage is unavailable.");
    const events = unique(proof.events), captures = new Map(), refunds = new Map();
    for (const event of events) {
      if (event.occurredAt > checkedAt) throw new Error("Payment time is unavailable.");
      if (event.kind === "PAYMENT") {
        if (captures.has(event.paymentId)) throw new Error("Duplicate payment identity.");
        captures.set(event.paymentId, event);
      }
    }
    for (const event of events.filter(item => item.kind === "REFUND")) {
      const original = captures.get(event.paymentId);
      if (!original || original.currency !== event.currency || event.occurredAt < original.occurredAt) throw new Error("Refund linkage is unavailable.");
      const total = add(refunds.get(event.paymentId) || 0, event.amountMinor);
      if (total > original.amountMinor) throw new Error("Refund exceeds payment.");
      refunds.set(event.paymentId, total);
    }
    for (const event of captures.values()) {
      const target = bucket(event.currency);
      target.subscriptionPaidMinor = add(target.subscriptionPaidMinor, event.amountMinor - (refunds.get(event.paymentId) || 0));
    }
    for (const value of buckets.values()) value.netBenefitMinor = value.unvaluedRedemptions ? null : value.couponSavingsMinor - value.subscriptionPaidMinor;
  }
  const snapshot = safeShopperSavingsSnapshot({ ok: true, checkedAt, period: { kind: "ALL_TIME", through: checkedAt },
    paymentEvidence: payments === null ? "UNAVAILABLE" : "VERIFIED_COMPLETE",
    currencies: SAVINGS_CURRENCIES.filter(code => buckets.has(code)).map(code => buckets.get(code)) });
  if (!snapshot) throw new Error("Savings snapshot is unavailable.");
  return snapshot;
}
