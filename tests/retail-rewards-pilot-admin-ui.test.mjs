import test from "node:test";
import assert from "node:assert/strict";
import { pilotOrganisations, pilotOverview, pilotMutationResult, pilotExpiry, pilotFormLimits } from "../lib/retail-rewards/pilot-admin-ui.mjs";

const until = "2026-11-30T12:00:00.000Z";
const limits = { activeOffers: 5, locations: 2, staffSeats: 2, monthlyRedemptions: 100, analyticsRetentionDays: 30, exportEnabled: false, brandingEnabled: false };
function overview() { return { ok: true, organisation: { id: "pilot-one", name: "Sample shop" }, program: { id: "program-one", status: "ACTIVE", timezone: "Europe/Malta", networkOptIn: true }, grant: { id: "grant-one", tier: "REWARDS_STARTER", status: "TRIAL", expiresAt: until, limits }, locations: [{ id: "shop-one", name: "Sample shop", status: "ACTIVE", profile: null }], offers: [{ id: "offer-one", title: "Save 10%", revision: 2, startsAt: "2026-11-14T00:00:00.000Z", endsAt: until, locationIds: ["shop-one"], discovery: null }], shoppers: [{ shopperId: "shopper-one", displayName: "Test shopper", status: "DISABLED", invitationStatus: "PENDING", invitationExpiresAt: "2026-11-15T08:00:00.000Z", membershipExpiresAt: until }], preparedShoppers: [], audit: [], checkedAt: "2026-11-14T08:00:00.000Z" }; }

test("pilot overview is bound to its requested organisation and rejects secrets or duplicate rows", () => {
  const valid = overview(); assert.equal(pilotOverview(valid, "pilot-one"), valid);
  assert.equal(pilotOverview(valid, "pilot-two"), null);
  const secret = structuredClone(valid); secret.shoppers[0].emailCanonical = "private@example.test"; assert.equal(pilotOverview(secret, "pilot-one"), null);
  const duplicate = structuredClone(valid); duplicate.locations.push(duplicate.locations[0]); assert.equal(pilotOverview(duplicate, "pilot-one"), null);
  const badDate = structuredClone(valid); badDate.checkedAt = "11/14/2026"; assert.equal(pilotOverview(badDate, "pilot-one"), null);
});
test("organisation choices reject unbounded, duplicate and extra authority fields", () => {
  assert.equal(pilotOrganisations([{ id: "one", name: "One" }]).length, 1);
  assert.equal(pilotOrganisations([{ id: "one", name: "One", admin: true }]).length, 0);
  assert.equal(pilotOrganisations([{ id: "one", name: "One" }, { id: "one", name: "Two" }]).length, 0);
  assert.equal(pilotOrganisations(Array.from({ length: 11 }, (_, i) => ({ id: `org-${i}`, name: "Sample" }))).length, 0);
});
test("one-time responses require exact token shape and expected pending shopper", () => {
  const response = { ok: true, shopperId: "shopper-one", invitationToken: "a".repeat(64), invitationExpiresAt: "2026-11-15T08:00:00.000Z", membershipExpiresAt: until };
  assert.equal(pilotMutationResult("invite", response), response);
  assert.equal(pilotMutationResult("reissue", response, { shopperId: "someone-else" }), null);
  assert.equal(pilotMutationResult("invite", { ...response, email: "private@example.test" }), null);
  assert.equal(pilotMutationResult("invite", { ...response, invitationToken: "not-a-code" }), null);
  assert.equal(pilotMutationResult("approveOffer", { ok: true, offerId: "offer-one", revision: 3 }, { offerId: "offer-one", revision: 2 }), null);
});
test("Malta expiry is explicit, limited and never silently shifts DST ambiguity", () => {
  const now = new Date("2026-11-14T08:00:00Z");
  assert.equal(pilotExpiry("2026-11-20T09:00", now), "2026-11-20T08:00:00.000Z");
  assert.throws(() => pilotExpiry("2026-11-14T08:00", now));
  assert.throws(() => pilotExpiry("2027-01-01T09:00", now));
  assert.throws(() => pilotExpiry("2026-11-20T09:00", now, "2026-11-19T08:00:00.000Z"));
  assert.throws(() => pilotExpiry("2027-03-28T02:30", new Date("2027-03-20T08:00:00Z")));
});
test("allowances are explicit whole numbers and not tier-derived", () => {
  const form = Object.fromEntries(Object.entries(limits).map(([k, v]) => [k, typeof v === "number" ? String(v) : v]));
  assert.deepEqual(pilotFormLimits(form), limits);
  for (const bad of ["", "1.5", "-1", "1e2", "1000000001"]) assert.throws(() => pilotFormLimits({ ...form, locations: bad }));
});

test("prepared shopper overview pins provenance and rejects duplicate or credential-bearing rows", () => {
  const valid = overview();
  valid.preparedShoppers = [{ shopperId: "prepared-one", email: "prepared@example.invalid", displayName: "Prepared shopper", authVersion: 1, preparedAt: "2026-11-14T07:00:00.000Z" }];
  valid.locations[0].status = "DRAFT";
  assert.equal(pilotOverview(valid, "pilot-one"), valid);
  for (const change of [v => v.preparedShoppers[0].authVersion = 2, v => v.preparedShoppers[0].passwordHash = "private", v => v.preparedShoppers[0].shopperId = "shopper-one", v => v.preparedShoppers.push(v.preparedShoppers[0]), v => v.locations[0].status = "ARCHIVED"]) {
    const changed = structuredClone(valid); change(changed); assert.equal(pilotOverview(changed, "pilot-one"), null);
  }
});

test("new pilot operation results are bound to the exact selected shopper and location", () => {
  const invite = { ok: true, shopperId: "prepared-one", invitationToken: "a".repeat(64), invitationExpiresAt: "2026-11-15T08:00:00.000Z", membershipExpiresAt: until };
  assert.equal(pilotMutationResult("invitePrepared", invite, { shopperId: "prepared-one" }), invite);
  assert.equal(pilotMutationResult("invitePrepared", invite, { shopperId: "foreign" }), null);
  assert.equal(pilotMutationResult("invitePrepared", { ...invite, invitationExpiresAt: "2026-12-01T00:00:00.000Z" }), null);
  const location = { ok: true, locationId: "shop-one", status: "ACTIVE" };
  assert.equal(pilotMutationResult("activateLocation", location, { locationId: "shop-one" }), location);
  assert.equal(pilotMutationResult("activateLocation", location, { locationId: "foreign" }), null);
  assert.equal(pilotMutationResult("activateLocation", { ...location, channelId: "unexpected" }, { locationId: "shop-one" }), null);
});
