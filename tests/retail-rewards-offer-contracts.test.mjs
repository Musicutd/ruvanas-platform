import test from "node:test";
import assert from "node:assert/strict";
import { offerTermsSchema, createOfferSchema, updateOfferSchema, offerTransitionSchema, validateOfferTerms, offerDisplayState } from "../lib/retail-rewards/offer-contracts.mjs";

export const terms = () => ({ schemaVersion: 1, title: "10% off when you spend €50", description: "A reusable offer for our shop.", category: "HOME", type: "PERCENT_OFF", percentBps: 1000, amountMinor: null, buyQuantity: null, getQuantity: null, currency: "EUR", minimumSpendMinor: 5000, exclusions: "Gift cards", legalTerms: "Valid at participating locations during the offer dates.", combinable: false, startsAt: "2026-12-01T09:00:00.000Z", endsAt: "2026-12-31T19:00:00.000Z", timezone: "Europe/Malta", locationIds: ["shop-one"], usage: "REUSABLE", totalLimit: 1000, perShopperLimit: 10, perShopperDailyLimit: 1, pausedClaimsPolicy: "HONOUR_ISSUED" });

test("agreed percentage, reusable, fixed and buy/get offers validate without money rounding", () => {
  assert.equal(validateOfferTerms(terms()).ok, true);
  assert.equal(validateOfferTerms({ ...terms(), usage: "SINGLE_USE", perShopperLimit: 1 }).ok, true);
  assert.equal(validateOfferTerms({ ...terms(), type: "FIXED_AMOUNT", percentBps: null, amountMinor: 1299 }).ok, true);
  assert.equal(validateOfferTerms({ ...terms(), type: "BOGO", percentBps: null, buyQuantity: 1, getQuantity: 1 }).ok, true);
  assert.equal(offerTermsSchema.parse({ ...terms(), title: "  A coupon  " }).title, "A coupon");
});

test("rules reject fractional or conflicting values, invalid times and limit combinations", () => {
  for (const patch of [
    { percentBps: 10.5 }, { percentBps: 10001 }, { percentBps: 0 }, { amountMinor: 500 }, { percentBps: null },
    { minimumSpendMinor: -1 }, { minimumSpendMinor: 12.99 }, { currency: "XYZ" }, { minimumSpendMinor: Infinity },
    { endsAt: terms().startsAt }, { startsAt: "2026-02-30T10:00:00Z" }, { startsAt: "2026-12-01T10:00:00+01:00" },
    { timezone: "Not/AZone" }, { locationIds: [] }, { locationIds: ["shop-one", "shop-one"] },
    { locationIds: ["../shop"] }, { category: "<script>" }, { title: "\u0000bad" }, { legalTerms: " " },
    { totalLimit: 0 }, { perShopperLimit: 1001 }, { perShopperDailyLimit: 11 }, { usage: "SINGLE_USE" },
    { pausedClaimsPolicy: null }, { organisationId: "foreign" }, { approved: true }, { schemaVersion: 2 }
  ]) assert.equal(validateOfferTerms({ ...terms(), ...patch }).ok, false, JSON.stringify(patch));
});

test("requests reject untrusted authority and require optimistic versions", () => {
  assert.equal(createOfferSchema.safeParse({ terms: terms(), organisationId: "foreign" }).success, false);
  assert.equal(updateOfferSchema.safeParse({ terms: terms() }).success, false);
  assert.equal(updateOfferSchema.safeParse({ terms: terms(), expectedVersion: 2 }).success, true);
  for (const expectedVersion of [0, 1.5, "1", 2147483647]) assert.equal(offerTransitionSchema.safeParse({ expectedVersion }).success, false);
  assert.equal(offerTransitionSchema.safeParse({ expectedVersion: 1, approvedBy: "admin" }).success, false);
});

test("display status uses immutable published dates, not later draft changes", () => {
  const offer = { state: "PUBLISHED", publishedRevision: 1, publishedStartsAt: "2026-12-01T09:00:00Z", publishedEndsAt: "2026-12-01T10:00:00Z", draft: { ...terms(), endsAt: "2027-01-01T00:00:00Z" } };
  assert.equal(offerDisplayState(offer, new Date("2026-12-01T08:59:59Z")), "SCHEDULED");
  assert.equal(offerDisplayState(offer, new Date("2026-12-01T09:00:00Z")), "ACTIVE");
  assert.equal(offerDisplayState(offer, new Date("2026-12-01T10:00:00Z")), "EXPIRED");
  assert.equal(offerDisplayState({ ...offer, state: "PAUSED" }, new Date("2026-12-01T09:05:00Z")), "PAUSED");
  assert.equal(offerDisplayState({ ...offer, state: "CANCELLED" }), "CANCELLED");
  assert.equal(offerDisplayState({ state: "DRAFT", publishedRevision: null }), "DRAFT");
});
