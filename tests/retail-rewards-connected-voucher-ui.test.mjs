import test from "node:test";
import assert from "node:assert/strict";
import { connectedVoucherCard, connectedVoucherKey, connectedSavingsPill, connectedWalletCards, connectedRequest } from "../lib/retail-rewards/connected-voucher-ui.mjs";
import { createShopperMobilePreview } from "./fixtures/shopper-mobile-preview.mjs";

const preview = createShopperMobilePreview({ delayMs: 0, clock: () => new Date("2026-11-22T12:00:00.000Z") });
const data = await preview.transport("/api/rewards/discovery/shops/urban-edit?page=1", {});

test("real public DTO becomes the same vivid card without transferring credentials or private IDs", () => {
  const card = connectedVoucherCard({ ...data.shop, organisationId: "private", logoUrl: "https://private.invalid/secret" }, { ...data.offers[0], token: "secret", code: "secret" });
  assert.equal(card.id, "urban-edit/urban-edit-ten"); assert.equal(card.shopName, "Urban Edit"); assert.equal(card.benefit, "10% off");
  assert.equal(card.usesLeft, 7); assert.equal(card.usesLabel, "7 of 10 uses left");
  assert.match(card.terms, /€50\.00/); assert.match(card.number, /^RUV\d{10}$/);
  for (const key of ["token", "code", "qrPayload", "credentialExpiresAt", "organisationId", "logoUrl"]) assert.equal(card[key], undefined);
  assert.equal(connectedVoucherCard(data.shop, data.offers[0]).number, card.number);
});

test("card identity includes both public shop and offer, and bad DTOs fail closed", () => {
  assert.notEqual(connectedVoucherKey("shop-one", "offer-one"), connectedVoucherKey("shop-two", "offer-one"));
  assert.equal(connectedVoucherKey("../secret", "offer-one"), null);
  assert.equal(connectedVoucherCard(data.shop, { ...data.offers[0], revision: 0 }), null);
  assert.equal(connectedVoucherCard(data.shop, { ...data.offers[0], terms: { ...data.offers[0].terms, timezone: "invalid" } }), null);
});

test("missing or inconsistent use evidence does not invent remaining uses", () => {
  const card = connectedVoucherCard(data.shop, { ...data.offers[0], usage: null });
  assert.equal(card.usesLeft, undefined); assert.equal(card.disabled, false); assert.match(card.usesLabel, /Up to 10/);
  const exhausted = connectedVoucherCard(data.shop, { ...data.offers[0], usage: { ...data.offers[0].usage, used: 10, remaining: 0 } });
  assert.equal(exhausted.disabled, true); assert.equal(exhausted.usesLeft, 0);
});

test("wallet projection only renders currently available public offers", () => {
  assert.deepEqual(connectedWalletCards([{ id: "private-id", status: "UNAVAILABLE", shop: data.shop, offer: data.offers[0] }]), []);
  const cards = connectedWalletCards([{ id: "saved-one", status: "AVAILABLE", shop: data.shop, offer: data.offers[0] }]);
  assert.equal(cards.length, 1); assert.equal(cards[0].savedId, "saved-one");
});

test("savings uses server currency totals, never combines currencies or treats unknown savings as zero", () => {
  preview.state.savingsMode = "unavailable";
  assert.deepEqual(connectedSavingsPill(preview.initialSavings()), { totalSavedMinor: 2500, currency: "EUR" });
  preview.state.savingsMode = "multiple";
  assert.deepEqual(connectedSavingsPill(preview.initialSavings()), { totalSavedMinor: null, savingsLabel: "View currencies" });
  preview.state.savingsMode = "unknown";
  assert.equal(connectedSavingsPill(preview.initialSavings()).savingsLabel, "View savings");
  preview.state.savingsMode = "empty";
  assert.equal(connectedSavingsPill(preview.initialSavings()).savingsLabel, "No savings yet");
  assert.equal(connectedSavingsPill({ ok: true, totalSaved: 2500 }).savingsLabel, "Not available");
});

test("requests keep shopper credentials same-origin, disable caching and propagate server denial", async () => {
  let call;
  await connectedRequest(async (path, options) => { call = { path, options }; return Response.json({ ok: true }); }, "/api/rewards/saved-wallet", { method: "POST", body: { shopSlug: "urban-edit", offerSlug: "urban-edit-ten" } });
  assert.equal(call.options.credentials, "same-origin"); assert.equal(call.options.cache, "no-store");
  assert.deepEqual(JSON.parse(call.options.body), { shopSlug: "urban-edit", offerSlug: "urban-edit-ten" });
  await assert.rejects(connectedRequest(async () => Response.json({ ok: false, code: "UNAUTHENTICATED", error: "private error" }, { status: 401 }), "/api/rewards/saved-wallet"), error => error.code === "UNAUTHENTICATED" && !error.message.includes("private"));
});
