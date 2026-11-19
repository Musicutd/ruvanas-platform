import assert from "node:assert/strict";
import test from "node:test";
import { decimalToMinor, minorToDecimal, wallTimeToIso, isoToWallTime, emptyOfferForm, termsToOfferForm, offerFormToTerms, offerBenefit } from "../lib/retail-rewards/offer-ui.mjs";
import { validateOfferTerms } from "../lib/retail-rewards/offer-contracts.mjs";

test("discount money is converted exactly without rounding a third decimal", () => {
  assert.equal(decimalToMinor("15"), 1500);
  assert.equal(decimalToMinor("0.29"), 29);
  assert.equal(decimalToMinor("50.00"), 5000);
  assert.equal(minorToDecimal(29), "0.29");
  for (const value of ["1.001", "1,25", "1e2", "-10", "Infinity", "", "1000001.00"]) assert.throws(() => decimalToMinor(value));
  assert.throws(() => decimalToMinor("100.01", { maximum: 10000 }));
});

test("Malta wall-clock dates use the selected timezone rather than device timezone", () => {
  assert.equal(wallTimeToIso("2026-11-14T09:00", "Europe/Malta"), "2026-11-14T08:00:00.000Z");
  assert.equal(wallTimeToIso("2026-07-14T09:00", "Europe/Malta"), "2026-07-14T07:00:00.000Z");
  assert.equal(isoToWallTime("2026-11-14T08:00:00.000Z", "Europe/Malta"), "2026-11-14T09:00");
  assert.equal(wallTimeToIso("2026-11-14T09:00", "Asia/Kathmandu"), "2026-11-14T03:15:00.000Z");
});

test("DST gaps, repeated hours, invalid dates and invalid zones are not silently shifted", () => {
  assert.throws(() => wallTimeToIso("2026-03-29T02:30", "Europe/Malta"), /does not exist/);
  assert.throws(() => wallTimeToIso("2026-10-25T02:30", "Europe/Malta"), /happens twice/);
  assert.throws(() => wallTimeToIso("2026-02-30T09:00", "Europe/Malta"), /valid date/);
  assert.throws(() => wallTimeToIso("2026-02-01T25:00", "Europe/Malta"), /valid date/);
  assert.throws(() => wallTimeToIso("2026-11-14T09:00", "Fake/Timezone"), /recognised timezone/);
});

function form(overrides = {}) {
  return { ...emptyOfferForm(new Date("2026-11-14T08:00:00Z")), title: "15% off everything", legalTerms: "Show the validated offer at checkout.", locationIds: ["shop-one"], ...overrides };
}

test("the three agreed examples become strict valid terms", () => {
  const examples = [form(), form({ title: "10% off", percent: "10" }), form({ title: "10% when spending €50", percent: "10", minimumSpend: "50.00", usage: "REUSABLE", perShopperLimit: "10", perShopperDailyLimit: "1" })];
  for (const example of examples) assert.equal(validateOfferTerms(offerFormToTerms(example)).ok, true);
  const reusable = offerFormToTerms(examples[2]);
  assert.equal(reusable.minimumSpendMinor, 5000);
  assert.equal(reusable.percentBps, 1000);
  assert.equal(reusable.perShopperLimit, 10);
  assert.equal(offerBenefit(reusable), "10% off");
});

test("switching offer types removes irrelevant value fields", () => {
  const fixed = offerFormToTerms(form({ type: "FIXED_AMOUNT", amount: "9.99" }));
  assert.equal(fixed.percentBps, null); assert.equal(fixed.amountMinor, 999); assert.equal(fixed.buyQuantity, null);
  assert.equal(validateOfferTerms(fixed).ok, true);
  const bogo = offerFormToTerms(form({ type: "BOGO", buyQuantity: "2", getQuantity: "1" }));
  assert.equal(bogo.amountMinor, null); assert.equal(bogo.percentBps, null); assert.equal(bogo.buyQuantity, 2);
  assert.equal(offerBenefit(bogo), "Buy 2, get 1 free");
  assert.equal(validateOfferTerms(bogo).ok, true);
});

test("single-use does not retain old reusable counts, invalid counts still fail strict rules", () => {
  const single = offerFormToTerms(form({ perShopperLimit: "10", perShopperDailyLimit: "3" }));
  assert.equal(single.perShopperLimit, 1); assert.equal(single.perShopperDailyLimit, 1);
  assert.throws(() => offerFormToTerms(form({ totalLimit: "1.5" })), /whole number/);
  assert.equal(validateOfferTerms(offerFormToTerms(form({ totalLimit: "0" }))).ok, false);
});

test("editing unrelated fields preserves saved time precision and does not mutate terms", () => {
  const source = offerFormToTerms(form());
  source.startsAt = "2026-11-14T08:00:23.123Z";
  const original = structuredClone(source);
  const editing = termsToOfferForm(source);
  editing.title = "Updated title";
  const result = offerFormToTerms(editing);
  assert.equal(result.startsAt, source.startsAt);
  assert.deepEqual(source, original);
  assert.equal(result.title, "Updated title");
  editing.startsAt = "2026-11-14T10:00";
  assert.equal(offerFormToTerms(editing).startsAt, "2026-11-14T09:00:00.000Z");
});
