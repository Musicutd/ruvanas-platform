import assert from "node:assert/strict";
import test from "node:test";
import { shopperCouponSummary, shopperInitials, shopperMoney, shopperReadPath, mergeShopperLocations, shopperVoucherUsage, shopperShortExpiry } from "../lib/retail-rewards/shopper-ui.mjs";

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

test("town pages merge without duplicates while retaining distinct countries", () => {
  const previous = [{ locality: "Sliema", countryCode: "MT" }];
  const next = [{ locality: "SLIEMA", countryCode: "MT" }, { locality: "Sliema", countryCode: "IT" }, { locality: "Ħamrun", countryCode: "MT" }];
  assert.equal(mergeShopperLocations(previous, next).length, 3);
  assert.equal(previous.length, 1);
  assert.equal(next.length, 3);
});

test("town navigation carries an encoded locality and country to server filtering", () => {
  assert.equal(shopperReadPath("/api/rewards/discovery", { locations: true, search: " Sliema ", page: 2 }), "/api/rewards/discovery/locations?page=2&search=Sliema");
  const url = new URL(shopperReadPath("/api/rewards/discovery", { locality: "Ħamrun & Centre", countryCode: "MT", category: "FASHION", search: "Edit", page: 3 }), "https://local.invalid");
  assert.equal(url.searchParams.get("locality"), "Ħamrun & Centre");
  assert.equal(url.searchParams.get("countryCode"), "MT");
  assert.equal(url.searchParams.get("page"), "3");
});

test("remaining uses render server redemptions without treating claims or missing data as uses", () => {
  const offer = { terms: { ...terms, usage: "REUSABLE", perShopperLimit: 10 }, usage: { limit: 10, used: 3, remaining: 7, asOf: "2026-11-18T12:00:00.000Z" } };
  assert.equal(shopperVoucherUsage(offer).label, "7 of 10 uses left");
  assert.equal(shopperVoucherUsage(offer).exhausted, false);
  assert.equal(shopperVoucherUsage({ ...offer, claims: [1, 2, 3, 4] }).remaining, 7);
  assert.equal(shopperVoucherUsage({ terms: offer.terms }).known, false);
  for (const bad of [{ ...offer.usage, remaining: 10 }, { ...offer.usage, limit: 11 }, { ...offer.usage, used: -1 }, { ...offer.usage, asOf: "invalid" }]) {
    assert.equal(shopperVoucherUsage({ ...offer, usage: bad }).known, false);
  }
  assert.equal(shopperVoucherUsage({ ...offer, usage: { ...offer.usage, used: 12, remaining: 0 } }).exhausted, true);
  assert.equal(shopperVoucherUsage({ terms, usage: { limit: 1, used: 0, remaining: 1, asOf: offer.usage.asOf } }).label, "1 of 1 use left");
});

test("compact expiry uses the offer's timezone rather than the device timezone", () => {
  assert.equal(shopperShortExpiry({ ...terms, endsAt: "2026-12-31T23:30:00.000Z", timezone: "Europe/Malta" }), "1 Jan 2027");
});
