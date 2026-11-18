import test from "node:test";
import assert from "node:assert/strict";
import { readShopperFeaturePolicy, shopperBrowseSchema, shopperLocationsSchema, publicSlugSchema, shopperOfferTerms } from "../lib/retail-rewards/shopper-contracts.mjs";

const ON = { RUVANAS_RETAIL_REWARDS_ENABLED: "true", RUVANAS_RETAIL_REWARDS_SHOPPER_ENABLED: "true" };
test("shopper discovery is independently gated and never enables claims", () => {
  for (const env of [{}, { RUVANAS_RETAIL_REWARDS_SHOPPER_ENABLED: "true" }, { RUVANAS_RETAIL_REWARDS_ENABLED: "true" },
    { ...ON, RUVANAS_RETAIL_REWARDS_SHOPPER_ENABLED: "TRUE" }, { ...ON, RUVANAS_RETAIL_REWARDS_PUBLIC_CLAIMS_ENABLED: "1" }])
    assert.equal(readShopperFeaturePolicy(env).enabled, false);
  assert.deepEqual(readShopperFeaturePolicy(ON), { enabled: true, valid: true, claimsEnabled: false });
  assert.equal(readShopperFeaturePolicy({ ...ON, RUVANAS_RETAIL_REWARDS_PUBLIC_CLAIMS_ENABLED: "true" }).claimsEnabled, false);
});
test("browse input is bounded and rejects internal authority parameters", () => {
  assert.equal(shopperBrowseSchema.safeParse({ category: "FASHION", search: "  summer  ", page: 2 }).data.search, "summer");
  for (const input of [{ organisationId: "org" }, { shopperId: "someone" }, { category: "private" }, { page: 0 }, { page: 1001 }, { search: "x".repeat(101) }])
    assert.equal(shopperBrowseSchema.safeParse(input).success, false);
  for (const slug of ["a", "UPPER", "../shop", "a/b", "x-", "x--shop", "x".repeat(97)])
    assert.equal(publicSlugSchema.safeParse(slug).success, false);
  assert.equal(publicSlugSchema.safeParse("sample-fashion-shop").success, true);
});
test("shopper terms keep disclosed rules while removing internal location identifiers", () => {
  const terms = { schemaVersion: 1, title: "10% above €50", description: "Sample", category: "FASHION", type: "PERCENT_OFF",
    percentBps: 1000, amountMinor: null, buyQuantity: null, getQuantity: null, currency: "EUR", minimumSpendMinor: 5000,
    exclusions: "Gift cards", legalTerms: "Sample terms", combinable: false, startsAt: "2026-11-14T00:00:00Z", endsAt: "2026-12-14T00:00:00Z",
    timezone: "Europe/Malta", locationIds: ["private-location-id"], usage: "REUSABLE", totalLimit: 100,
    perShopperLimit: 10, perShopperDailyLimit: 1, pausedClaimsPolicy: "HONOUR_ISSUED" };
  const result = shopperOfferTerms(terms);
  assert.equal(result.minimumSpendMinor, 5000); assert.equal(result.perShopperDailyLimit, 1);
  assert.equal(Object.hasOwn(result, "locationIds"), false); assert.equal(JSON.stringify(result).includes("private-location"), false);
  assert.equal(shopperOfferTerms({ ...terms, organisationId: "private" }), null);
  assert.equal(shopperOfferTerms({ ...terms, percentBps: 10001 }), null);
  assert.deepEqual(terms.locationIds, ["private-location-id"]);
});

test("location filters accept public town and country only with bounded paging", () => {
  assert.deepEqual(shopperBrowseSchema.parse({ locality: " Sliema ", countryCode: "MT", page: 2 }), { locality: "Sliema", countryCode: "MT", page: 2 });
  assert.deepEqual(shopperLocationsSchema.parse({ search: " Sli ", countryCode: "MT", page: 1 }), { search: "Sli", countryCode: "MT", page: 1 });
  for (const input of [{ locality: "" }, { locality: "\n" }, { locality: "Sli\u0000ema" }, { locality: "x".repeat(121) }, { countryCode: "mt" }, { countryCode: "MTA" }]) {
    assert.equal(shopperBrowseSchema.safeParse(input).success, false);
  }
  for (const input of [{ locationId: "private-location" }, { organisationId: "private-org" }, { shopperId: "other-shopper" },
    { locality: "Sliema" }, { category: "FASHION" }, { page: 1001 }, { countryCode: "mt" }, { search: "x".repeat(101) }]) {
    assert.equal(shopperLocationsSchema.safeParse(input).success, false);
  }
});
