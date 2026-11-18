import test from "node:test";
import assert from "node:assert/strict";
import { createShopperMobilePreview } from "./fixtures/shopper-mobile-preview.mjs";

const fixture = () => createShopperMobilePreview({ clock: () => new Date("2026-11-18T11:00:00.000Z"), delayMs: 0 });
const offerPath = "/api/rewards/discovery/shops/urban-edit/offers/urban-edit-ten";
const claimOptions = key => ({ method: "POST", body: JSON.stringify({ shopSlug: "urban-edit", offerSlug: "urban-edit-ten", expectedRevision: 1, idempotencyKey: key }) });

test("local fixture filters town, category and search independently with bounded location pages", async () => {
  const preview = fixture();
  const cities = await preview.transport("/api/rewards/discovery/locations?page=1");
  assert.deepEqual(cities.locations.map(row => row.locality), ["Sliema", "Valletta", "Hamrun"]);
  assert.equal(cities.hasMore, true);
  const matching = await preview.transport("/api/rewards/discovery/locations?search=mosta");
  assert.deepEqual(matching.locations, [{ locality: "Mosta", countryCode: "MT" }]);
  const shops = await preview.transport("/api/rewards/discovery/shops?locality=Sliema&countryCode=MT&category=HOME&search=corner");
  assert.deepEqual(shops.shops.map(row => row.slug), ["home-corner"]);
  assert.equal((await preview.transport("/api/rewards/discovery/shops?locality=Valletta&category=HOME")).shops.length, 0);
});

test("issuing and showing a demo coupon never consumes a use; only simulated cashier confirmation changes the count", async () => {
  const preview = fixture();
  assert.equal((await preview.transport(offerPath)).offer.usage.remaining, 7);
  const issued = await preview.transport("/api/rewards/claims", claimOptions("sample-request-1"));
  const retry = await preview.transport("/api/rewards/claims", claimOptions("sample-request-1"));
  assert.equal(issued.claim.id, retry.claim.id);
  assert.equal("_offerSlug" in retry.claim, false);
  const first = await preview.transport(`/api/rewards/claims/${issued.claim.id}/credential`, { method: "POST", body: "{}" });
  const rotated = await preview.transport(`/api/rewards/claims/${issued.claim.id}/credential`, { method: "POST", body: "{}" });
  assert.match(first.token, /^[a-f0-9]{64}$/); assert.notEqual(first.token, rotated.token);
  assert.equal((await preview.transport(offerPath)).offer.usage.remaining, 7);
  assert.equal(preview.redeemLatest(), true);
  assert.equal((await preview.transport(offerPath)).offer.usage.remaining, 6);
  assert.equal(preview.redeemLatest(), false);
  assert.equal((await preview.transport(`/api/rewards/claims/${issued.claim.id}/credential`, { method: "POST" })).ok, false);
  const wallet = preview.initialWallet();
  assert.equal(wallet.claims[0].status, "REDEEMED"); assert.equal(wallet.claims[0].receipt.discountMinor, 600);
  assert.equal(JSON.stringify(preview.requests).includes(first.token), false);
});

test("preview fails closed for unsupported or external paths and can model empty and missing-usage reads", async () => {
  const preview = fixture();
  await assert.rejects(() => preview.transport("https://www.ruvanas.com/api/rewards/claims"), /in-memory/);
  await assert.rejects(() => preview.transport("//www.ruvanas.com/api/rewards/claims"), /in-memory/);
  assert.equal((await preview.transport("/api/rewards/activation", { method: "POST" })).ok, false);
  preview.state.emptyLocations = true;
  assert.deepEqual((await preview.transport("/api/rewards/discovery/locations")).locations, []);
  preview.state.missingUsage = true;
  assert.equal("usage" in (await preview.transport(offerPath)).offer, false);
});
