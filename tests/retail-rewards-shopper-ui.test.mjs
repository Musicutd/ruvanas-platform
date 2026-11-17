import assert from "node:assert/strict";
import test from "node:test";
import { shopperCouponSummary, shopperInitials, shopperMoney, shopperReadPath } from "../lib/retail-rewards/shopper-ui.mjs";

const terms = Object.freeze({ schemaVersion: 1, title: "15% off everything", description: "A sample offer.", category: "FASHION", type: "PERCENT_OFF", percentBps: 1500, amountMinor: null, buyQuantity: null, getQuantity: null, currency: "EUR", minimumSpendMinor: 0, exclusions: "Gift cards excluded.", legalTerms: "Applies at the selected shop.", combinable: false, startsAt: "2026-11-14T08:00:00.000Z", endsAt: "2026-12-14T08:00:00.000Z", timezone: "Europe/Malta", usage: "SINGLE_USE", totalLimit: 100, perShopperLimit: 1, perShopperDailyLimit: 1, pausedClaimsPolicy: "HONOUR_ISSUED" });

test("shopper summaries show saving, minimum and clear per-shopper limits", () => {
  assert.equal(shopperCouponSummary(terms).benefit, "15% off");
  assert.equal(shopperCouponSummary(terms).spend, "No minimum spend");
  assert.equal(shopperCouponSummary(terms).usage, "Once per shopper");
  assert.equal(shopperCouponSummary(terms).daily, "No repeat use by the same shopper");
  const reusable = { ...terms, percentBps: 1000, minimumSpendMinor: 5000, usage: "REUSABLE", perShopperLimit: 10, perShopperDailyLimit: 1 };
  const summary = shopperCouponSummary(reusable);
  assert.equal(summary.benefit, "10% off");
  assert.equal(summary.spend, "When you spend €50.00 or more");
  assert.equal(summary.usage, "Up to 10 uses per shopper");
  assert.equal(summary.daily, "No more than 1 use per day");
  assert.equal(reusable.minimumSpendMinor, 5000);
});

test("shopper validity uses the published timezone and currency precision", () => {
  assert.equal(shopperMoney(999, "EUR"), "€9.99");
  assert.match(shopperCouponSummary(terms).starts, /14 Nov 2026.*09:00/);
  assert.match(shopperCouponSummary(terms).ends, /14 Dec 2026.*09:00/);
  assert.equal(shopperCouponSummary({ ...terms, type: "FIXED_AMOUNT", percentBps: null, amountMinor: 999 }).benefit, "€9.99 off");
  assert.equal(shopperCouponSummary({ ...terms, type: "BOGO", percentBps: null, buyQuantity: 2, getQuantity: 1 }).benefit, "Buy 2, get 1 free");
});

test("selected shop and offer paths encode each public slug and use only GET query fields", () => {
  assert.equal(shopperReadPath("/api/rewards/discovery", { category: "FASHION", search: " Shop name ", page: 2 }), "/api/rewards/discovery/shops?page=2&category=FASHION&search=Shop+name");
  assert.equal(shopperReadPath("/api/rewards/discovery", { shopSlug: "shop-a", category: "FASHION" }), "/api/rewards/discovery/shops/shop-a?page=1&category=FASHION");
  assert.equal(shopperReadPath("/api/rewards/discovery", { shopSlug: "shop-a", offerSlug: "offer-a" }), "/api/rewards/discovery/shops/shop-a/offers/offer-a");
  assert.equal(shopperReadPath("/api/rewards/discovery", { shopSlug: "shop?admin", offerSlug: "../private" }), "/api/rewards/discovery/shops/shop%3Fadmin/offers/..%2Fprivate");
  assert.throws(() => shopperReadPath("/api/rewards/discovery", { offerSlug: "offer-a" }), /selected public shop/);
});

test("shop display initials are derived from public names without HTML", () => {
  assert.equal(shopperInitials("  Ħamrun   Fashion Store "), "ĦF");
  assert.equal(shopperInitials("Home"), "H");
  assert.equal(shopperInitials(""), "");
});
