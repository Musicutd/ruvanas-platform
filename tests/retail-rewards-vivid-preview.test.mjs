import test from "node:test";
import assert from "node:assert/strict";
import { createVividShopperPreview, VIVID_PREVIEW_CARDS } from "./fixtures/shopper-vivid-preview.mjs";
import { parseCheckoutInput } from "../lib/retail-rewards/checkout-qr.mjs";
const fixture = () => createVividShopperPreview({ clock: () => new Date("2026-11-22T12:00:00.000Z") });

test("six reproducible public-demo cards never produce a live checkout credential", () => {
  assert.equal(VIVID_PREVIEW_CARDS.length, 6);
  assert.equal(new Set(VIVID_PREVIEW_CARDS.map(row => row.category)).size, 6);
  assert.deepEqual(fixture().listCards(), fixture().listCards());
  for (const row of VIVID_PREVIEW_CARDS) {
    assert.match(row.qrPayload, /^RUVANAS-DEMO:/); assert.equal(parseCheckoutInput(row.qrPayload), null);
    assert.equal(parseCheckoutInput(row.code), null); assert.ok(row.usesLeft > 0); assert.match(row.terms, /31 December 2027/);
  }
});
test("saving, preparation and cancellation never invent savings or consume uses", () => {
  const f = fixture(); assert.equal(f.totalSavedMinor(), 0); assert.equal(f.savedIDs().length, 3);
  assert.equal(f.toggleSave("demo-coffee"), true); assert.equal(f.toggleSave("demo-coffee"), false);
  const a = f.prepareRedemption("demo-dining"); assert.equal(a.ok, true);
  assert.equal(f.totalSavedMinor(), 0); assert.equal(f.listCards()[0].usesLeft, 10);
  assert.equal(f.cancelRedemption(a.attemptId), true);
  assert.equal(f.confirmDemoRedemption(a.attemptId, 6000).code, "STALE_ATTEMPT");
  assert.equal(f.totalSavedMinor(), 0); assert.equal(f.receipts().length, 0);
});
test("confirmed demo receipts alone increase totals and duplicate confirmation is idempotent", () => {
  const f = fixture(), a = f.prepareRedemption("demo-dining");
  const first = f.confirmDemoRedemption(a.attemptId, 6000);
  assert.equal(first.receipt.discountMinor, 1800); assert.equal(first.totalSavedMinor, 1800); assert.equal(first.usesLeft, 9);
  const again = f.confirmDemoRedemption(a.attemptId, 6000);
  assert.equal(again.repeated, true); assert.equal(again.receipt.id, first.receipt.id); assert.equal(f.receipts().length, 1);
  assert.equal(f.totalSavedMinor(), 1800); assert.equal(f.confirmDemoRedemption(a.attemptId, 6100).code, "IDEMPOTENCY_CONFLICT");
});
test("minimum spend, malformed numbers, stale preparations and unknown cards fail without counting", () => {
  const f = fixture(); assert.equal(f.prepareRedemption("other-shop").code, "NOT_FOUND");
  const a = f.prepareRedemption("demo-tech"), b = f.prepareRedemption("demo-tech");
  assert.equal(f.confirmDemoRedemption(a.attemptId, 25000).code, "STALE_ATTEMPT");
  assert.equal(f.confirmDemoRedemption(b.attemptId, 19999).code, "MINIMUM_SPEND");
  for (const amount of [NaN, Infinity, -1, 10.5, "25000", Number.MAX_SAFE_INTEGER]) assert.equal(f.confirmDemoRedemption(b.attemptId, amount).code, "INVALID_SPEND");
  assert.equal(f.totalSavedMinor(), 0); assert.equal(f.listCards()[1].usesLeft, 1);
});
test("single-use and repeat-use caps prevent additional receipts and require a fresh attempt", () => {
  const f = fixture(), one = f.prepareRedemption("demo-tech");
  assert.equal(f.confirmDemoRedemption(one.attemptId, 20000).receipt.discountMinor, 4000);
  assert.equal(f.prepareRedemption("demo-tech").code, "EXHAUSTED");
  for (let i = 0; i < 2; i++) { const a = f.prepareRedemption("demo-entertainment"); assert.equal(f.confirmDemoRedemption(a.attemptId, 2000).ok, true); }
  assert.equal(f.prepareRedemption("demo-entertainment").code, "EXHAUSTED");
  assert.equal(f.totalSavedMinor(), 4600); assert.equal(f.receipts().length, 3);
});
test("all six declared discounts are reproducible, bounded by spend and kept in EUR", () => {
  const f = fixture(), expected = [1800, 4000, 2000, 500, 600, 1500];
  for (const [index, card] of f.listCards().entries()) {
    const a = f.prepareRedemption(card.id), result = f.confirmDemoRedemption(a.attemptId, a.suggestedSpendMinor);
    assert.equal(result.receipt.discountMinor, expected[index]); assert.ok(result.receipt.discountMinor <= result.receipt.eligibleSpendMinor);
    assert.equal(result.receipt.currency, "EUR"); assert.equal(result.receipt.simulated, true);
  }
  assert.equal(f.totalSavedMinor(), 10400); assert.deepEqual(f.savingsByCurrency(), { EUR: 10400 });
});
test("external copies cannot modify fixture receipts, cards or saved state", () => {
  const f = fixture(); const cards = f.listCards(); cards[0].usesLeft = 0;
  const saved = f.savedIDs(); saved.length = 0; assert.equal(f.savedIDs().length, 3); assert.equal(f.listCards()[0].usesLeft, 10);
  const a = f.prepareRedemption("demo-dining"), result = f.confirmDemoRedemption(a.attemptId, 6000);
  result.receipt.discountMinor = 999999; f.receipts()[0].discountMinor = 999999;
  assert.equal(f.totalSavedMinor(), 1800); assert.equal(f.receipts()[0].discountMinor, 1800);
  assert.equal(fixture().totalSavedMinor(), 0);
});
test("an expired example cannot start or complete a new simulated redemption", () => {
  let now = new Date("2027-12-30T12:00:00.000Z"); const f = createVividShopperPreview({ clock: () => now });
  const a = f.prepareRedemption("demo-dining"); now = new Date("2028-01-01T12:00:00.000Z");
  assert.equal(f.prepareRedemption("demo-tech").code, "EXPIRED"); assert.equal(f.confirmDemoRedemption(a.attemptId, 6000).code, "EXPIRED");
  assert.equal(f.totalSavedMinor(), 0);
});
