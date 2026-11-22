import test from "node:test";
import assert from "node:assert/strict";
import { projectShopperSavings, safeShopperSavingsSnapshot, SAVINGS_MAX_RECEIPTS } from "../lib/retail-rewards/shopper-savings-contracts.mjs";

const AT = "2026-11-22T12:00:00.000Z", BEFORE = "2026-11-20T12:00:00.000Z";
const receipt = (extra = {}) => ({ id: "receipt-one", shopperId: "shopper-one", currency: "EUR", discountMinor: 2500,
  occurredAt: BEFORE, reversedAt: null, ...extra });
const event = (extra = {}) => ({ id: "event-one", paymentId: "payment-one", kind: "PAYMENT", status: "SETTLED",
  currency: "EUR", amountMinor: 1500, occurredAt: BEFORE, ...extra });
const proof = events => ({ status: "VERIFIED_COMPLETE", shopperId: "shopper-one", coverage: "ALL_SHOPPER_MEMBERSHIP_PAYMENTS", through: AT, events });
const project = (extra = {}) => projectShopperSavings({ shopperId: "shopper-one", checkedAt: AT, receipts: [receipt()], ...extra });

test("actual receipts never invent subscription payments or positive benefit", () => {
  const value = project();
  assert.equal(value.paymentEvidence, "UNAVAILABLE");
  assert.deepEqual(value.currencies, [{ currency: "EUR", couponSavingsMinor: 2500, valuedRedemptions: 1, unvaluedRedemptions: 0,
    subscriptionPaidMinor: null, netBenefitMinor: null }]);
  assert.equal(value.period.through, AT);
  assert.deepEqual(project({ receipts: [] }).currencies, []);
});
test("verified complete shopper payments produce the requested 15 paid, 25 saved, 10 net example", () => {
  const value = project({ payments: proof([event()]) });
  assert.equal(value.paymentEvidence, "VERIFIED_COMPLETE");
  assert.equal(value.currencies[0].subscriptionPaidMinor, 1500);
  assert.equal(value.currencies[0].netBenefitMinor, 1000);
  assert.equal(JSON.stringify(value).includes("payment-one"), false);
  assert.equal(JSON.stringify(value).includes("shopper-one"), false);
});
test("zero and negative net values remain signed; fully verified zero payments are explicit", () => {
  assert.equal(project({ payments: proof([event({ amountMinor: 2500 })]) }).currencies[0].netBenefitMinor, 0);
  assert.equal(project({ payments: proof([event({ amountMinor: 3000 })]) }).currencies[0].netBenefitMinor, -500);
  assert.equal(project({ payments: proof([]) }).currencies[0].netBenefitMinor, 2500);
  assert.equal(project({ receipts: [], payments: proof([event()]) }).currencies[0].netBenefitMinor, -1500);
});
test("settled partial refunds adjust paid totals, while exact duplicate events and receipts count once", () => {
  const payment = event(), refund = event({ id: "refund-one", kind: "REFUND", amountMinor: 500, occurredAt: AT });
  const value = project({ receipts: [receipt(), receipt()], payments: proof([refund, payment, payment, refund]) });
  assert.equal(value.currencies[0].valuedRedemptions, 1);
  assert.equal(value.currencies[0].subscriptionPaidMinor, 1000);
  assert.equal(value.currencies[0].netBenefitMinor, 1500);
  assert.equal(project({ payments: proof([event(), event({ id: "refund-all", kind: "REFUND", amountMinor: 1500 })]) }).currencies[0].subscriptionPaidMinor, 0);
});
test("conflicting IDs, double captures, excess refunds, foreign currency and orphan refunds are rejected", () => {
  for (const events of [
    [event(), event({ amountMinor: 1000 })],
    [event(), event({ id: "duplicate-capture" })],
    [event(), event({ id: "refund", kind: "REFUND", amountMinor: 1501 })],
    [event(), event({ id: "refund", kind: "REFUND", currency: "USD" })],
    [event({ id: "refund", kind: "REFUND" })],
    [event(), event({ id: "refund", kind: "REFUND", occurredAt: "2026-11-19T12:00:00.000Z" })]
  ]) assert.throws(() => project({ payments: proof(events) }));
  assert.throws(() => project({ receipts: [receipt(), receipt({ discountMinor: 1 })] }));
});
test("reversed receipts do not contribute savings and unknown-value discounts are separately counted", () => {
  const value = project({ receipts: [receipt({ reversedAt: AT }), receipt({ id: "manual", discountMinor: null })], payments: proof([event()]) });
  assert.deepEqual(value.currencies[0], { currency: "EUR", couponSavingsMinor: 0, valuedRedemptions: 0,
    unvaluedRedemptions: 1, subscriptionPaidMinor: 1500, netBenefitMinor: null });
  assert.equal(project({ receipts: [receipt({ reversedAt: "2026-11-23T12:00:00.000Z" })] }).currencies[0].couponSavingsMinor, 2500);
});
test("currencies are never converted or combined and monetary totals cannot overflow", () => {
  const value = project({ receipts: [receipt(), receipt({ id: "usd-receipt", currency: "USD", discountMinor: 100 })],
    payments: proof([event(), event({ id: "usd-payment", paymentId: "usd", currency: "USD", amountMinor: 50 })]) });
  assert.deepEqual(value.currencies.map(row => [row.currency, row.netBenefitMinor]), [["EUR", 1000], ["USD", 50]]);
  assert.throws(() => project({ receipts: [receipt({ discountMinor: Number.MAX_SAFE_INTEGER }), receipt({ id: "over", discountMinor: 1 })] }));
  assert.throws(() => project({ payments: proof([event({ amountMinor: Number.MAX_SAFE_INTEGER }), event({ id: "extra", paymentId: "extra", amountMinor: 1 })]) }));
});
test("foreign shopper, incomplete payment coverage, unsettled events and future records fail closed", () => {
  assert.throws(() => project({ receipts: [receipt({ shopperId: "other" })] }));
  assert.throws(() => project({ receipts: [receipt({ occurredAt: "2026-11-23T12:00:00.000Z" })] }));
  for (const payments of [
    { ...proof([]), shopperId: "other" }, { ...proof([]), coverage: "PARTIAL" },
    { ...proof([]), through: BEFORE }, { ...proof([]), status: "PENDING" },
    proof([event({ status: "PENDING" })]), proof([event({ occurredAt: "2026-11-23T12:00:00.000Z" })]),
    { ...proof([]), subscriptionPrice: 1500 }
  ]) assert.throws(() => project({ payments }));
});
test("snapshot rejects invented proof, hidden identifiers, duplicate currency rows and arithmetic inconsistencies", () => {
  const good = project(), paid = project({ payments: proof([event()]) });
  assert.ok(safeShopperSavingsSnapshot(good));
  for (const value of [
    { ...good, shopperId: "private" }, { ...good, checkedAt: BEFORE },
    { ...good, currencies: [...good.currencies, ...good.currencies] },
    { ...good, paymentEvidence: "VERIFIED_COMPLETE" },
    { ...good, currencies: [{ ...good.currencies[0], subscriptionPaidMinor: 0 }] },
    { ...good, currencies: [{ ...good.currencies[0], couponSavingsMinor: -1 }] },
    { ...good, currencies: [{ ...good.currencies[0], valuedRedemptions: 0 }] },
    { ...paid, currencies: [{ ...paid.currencies[0], netBenefitMinor: 999 }] },
    { ...paid, currencies: [{ ...paid.currencies[0], unvaluedRedemptions: 1 }] },
    { ...good, currencies: [{ ...good.currencies[0], valuedRedemptions: SAVINGS_MAX_RECEIPTS, unvaluedRedemptions: 1 }] }
  ]) assert.equal(safeShopperSavingsSnapshot(value), null);
});
test("bounded projection refuses oversized evidence and invalid timestamps", () => {
  assert.throws(() => project({ receipts: Array(SAVINGS_MAX_RECEIPTS + 1).fill(receipt()) }));
  assert.throws(() => project({ checkedAt: "+020026-11-22T12:00:00.000Z" }));
  assert.throws(() => project({ checkedAt: "2026-99-99T12:00:00.000Z" }));
  assert.throws(() => project({ receipts: [receipt({ reversedAt: "2026-11-19T12:00:00.000Z" })] }));
});
