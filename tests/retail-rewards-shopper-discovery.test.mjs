import test from "node:test";
import assert from "node:assert/strict";
import { createShopperDiscoveryService } from "../lib/retail-rewards/shopper-discovery-service.mjs";
import { pilotPreviewEnvironment } from "./fixtures/rewards-pilot-preview.mjs";

const NOW = new Date("2026-11-14T12:00:00Z"), START = new Date("2026-11-01T00:00:00Z"), END = new Date("2026-12-01T00:00:00Z");
const ENV = { RUVANAS_RETAIL_REWARDS_ENABLED: "true", RUVANAS_RETAIL_REWARDS_SHOPPER_ENABLED: "true" };
const ACCESS = { ok: true, shopperId: "shopper-one", sessionId: "shopper-session", membershipId: "shopper-membership" };
const clone = value => structuredClone(value);
function terms(patch = {}) {
  return { schemaVersion: 1, title: "Published home coupon", description: "Save ten percent", category: "HOME",
    type: "PERCENT_OFF", percentBps: 1000, amountMinor: null, buyQuantity: null, getQuantity: null,
    currency: "EUR", minimumSpendMinor: 5000, exclusions: "Gift cards", legalTerms: "Synthetic offer terms.",
    combinable: false, startsAt: START.toISOString(), endsAt: END.toISOString(), timezone: "Europe/Malta",
    locationIds: ["private-location"], usage: "REUSABLE", totalLimit: 100, perShopperLimit: 10,
    perShopperDailyLimit: 1, pausedClaimsPolicy: "HONOUR_ISSUED", ...patch };
}
function fixture() {
  const data = {
    organisation: { id: "private-org", name: "Secret legal name", email: "private@example.invalid",
      subscription: { id: "private-subscription", organisationId: "private-org", status: "ACTIVE",
        plan: { code: "RETAIL_START", active: true, retailRadioEnabled: true } } },
    program: { id: "private-program", organisationId: "private-org", status: "ACTIVE", networkOptIn: true },
    grant: { id: "private-grant", organisationId: "private-org", subscriptionId: "private-subscription", capability: "RETAIL_REWARDS",
      source: "MANUAL_INTERNAL", tier: "REWARDS_STARTER", status: "ACTIVE", startsAt: START, expiresAt: END, revokedAt: null,
      limitsVersion: 1, activeOffers: 10, locations: 10, staffSeats: 1, monthlyRedemptions: 100, analyticsRetentionDays: 30,
      exportEnabled: false, brandingEnabled: false },
    profiles: [{ id: "private-profile", organisationId: "private-org", locationId: "private-location", publicSlug: "home-shop",
      displayName: "Public Home Shop", description: "Approved shop description", locality: "Valletta", countryCode: "MT",
      status: "PUBLISHED", networkOptIn: true, publishedAt: START, revokedAt: null,
      location: { id: "private-location", organisationId: "private-org", status: "ACTIVE", addressLine1: "Private address" } }],
    redemptions: [],
    listings: [{ id: "private-listing", organisationId: "private-org", offerId: "private-offer", revision: 1, publicSlug: "home-coupon",
      discoverable: true, approvedAt: START, revokedAt: null,
      publishedSnapshot: { organisationId: "private-org", offerId: "private-offer", revision: 1, terms: terms(), actorUserId: "private-owner" },
      offer: { id: "private-offer", organisationId: "private-org", programId: "private-program", state: "PUBLISHED", publishedRevision: 1,
        publishedStartsAt: START, publishedEndsAt: END, draft: terms({ category: "FASHION", title: "Private unreleased draft" }),
        locations: [{ organisationId: "private-org", offerId: "private-offer", locationId: "private-location", scope: "PUBLISHED" }] } }]
  };
  const calls = []; let authCount = 0, afterAuth, time = NOW;
  function matches(row, where = {}) {
    if (!row) return false;
    return Object.entries(where).every(([key, value]) => {
      if (key === "OR") return value.some(item => matches(row, item));
      if (key === "AND") return value.every(item => matches(row, item));
      if (value === null || typeof value !== "object") return row[key] === value;
      const actual = row[key];
      if (Array.isArray(value.in)) return value.in.includes(actual);
      if (Object.hasOwn(value, "not") && actual === value.not) return false;
      if (value.path) {
        const text = value.path.reduce((current, part) => current?.[part], actual);
        return value.equals !== undefined ? text === value.equals : String(text).toLowerCase().includes(value.string_contains.toLowerCase());
      }
      if (Object.hasOwn(value, "equals")) return value.mode === "insensitive"
        ? String(actual).toLowerCase() === String(value.equals).toLowerCase() : actual === value.equals;
      if (value.some) return Array.isArray(actual) && actual.some(item => matches(item, value.some));
      if (value.lte !== undefined) return actual <= value.lte;
      if (value.gt !== undefined) return actual > value.gt;
      if (value.contains !== undefined) return String(actual).toLowerCase().includes(value.contains.toLowerCase());
      if (Object.hasOwn(value, "not")) return true;
      return matches(actual, value);
    });
  }
  function project(row, select) {
    if (!row) return null;
    return Object.fromEntries(Object.entries(select).map(([field, spec]) => {
      if (spec === true || spec.include) return [field, clone(row[field])];
      if (Array.isArray(row[field])) return [field, row[field].filter(item => matches(item, spec.where)).map(item => project(item, spec.select))];
      return [field, project(row[field], spec.select)];
    }));
  }
  function expandedProfile(row) {
    return { ...row, location: { ...row.location,
      rewardOfferLocations: data.listings.filter(item => item.offer.locations.some(target => target.locationId === row.locationId))
        .flatMap(item => item.offer.locations.map(target => ({ ...target, offer: expandedListing(item).offer }))) } };
  }
  function expandedListing(row) {
    const currentSnapshot = { ...row.publishedSnapshot, revision: row.offer.publishedRevision,
      discoveryListings: row.revision === row.offer.publishedRevision ? [row] : [] };
    return { ...row, offer: { ...row.offer, discovery: row, publishedSnapshot: currentSnapshot } };
  }
  const db = {
    organisation: { async findUnique(query) { calls.push(["organisation", query]); return query.where.id === data.organisation.id ? project(data.organisation, query.select) : null; } },
    rewardProgram: { async findFirst(query) { calls.push(["program", query]); return matches(data.program, query.where) ? project(data.program, query.select) : null; } },
    rewardEntitlementGrant: { async findFirst(query) { calls.push(["grant", query]); return matches(data.grant, query.where) ? project(data.grant, query.select) : null; } },
    rewardPublicShopProfile: {
      async findFirst(query) { calls.push(["profile", query]); return project(data.profiles.map(expandedProfile).find(row => matches(row, query.where)), query.select); },
      async findMany(query) { calls.push(["profiles", query]); return data.profiles.map(expandedProfile).filter(row => matches(row, query.where))
        .sort((a, b) => a.publicSlug.localeCompare(b.publicSlug)).slice(query.skip, query.skip + query.take).map(row => project(row, query.select)); }
    },
    rewardOfferDiscovery: { async findMany(query) { calls.push(["listings", query]); return data.listings.map(expandedListing).filter(row => matches(row, query.where))
      .sort((a, b) => a.publicSlug.localeCompare(b.publicSlug)).slice(query.skip, query.skip + query.take).map(row => project(row, query.select)); } },
    rewardRedemption: { async count(query) { calls.push(["usage", query]); return data.redemptions.filter(row => matches(row, query.where)).length; } }
  };
  const env = { ...ENV };
  const service = createShopperDiscoveryService({ db, env, clock: () => time,
    loadShopper: async passedDb => { assert.equal(passedDb, db); authCount++; const result = afterAuth?.(authCount); return result || clone(ACCESS); } });
  return { data, calls, service, env, db, setAfterAuth: value => { afterAuth = value; }, setClock: value => { time = value; } };
}

test("discovery disabled and invalid input never load shopper or database", async () => {
  const f = fixture(); f.env.RUVANAS_RETAIL_REWARDS_SHOPPER_ENABLED = "false";
  f.setAfterAuth(() => { throw new Error("auth forbidden"); });
  assert.equal((await f.service.shops()).code, "FEATURE_DISABLED");
  assert.equal((await f.service.shop("home-shop")).code, "FEATURE_DISABLED");
  assert.equal((await f.service.offer("home-shop", "home-coupon")).code, "FEATURE_DISABLED");
  assert.equal((await f.service.locations()).code, "FEATURE_DISABLED");
  f.env.RUVANAS_RETAIL_REWARDS_SHOPPER_ENABLED = "true";
  assert.equal((await f.service.shops({ organisationId: "private-org" })).code, "INVALID_REQUEST");
  assert.equal((await f.service.shops({ page: 1001 })).code, "INVALID_REQUEST");
  assert.equal((await f.service.locations({ shopperId: "someone" })).code, "INVALID_REQUEST");
  assert.equal((await f.service.locations({ page: 1001 })).code, "INVALID_REQUEST");
  assert.equal(f.calls.length, 0);
});

test("shopper discovery uses only explicit public fields and redacted immutable terms", async () => {
  const f = fixture();
  const shops = await f.service.shops({ category: "HOME", search: "valletta" });
  assert.equal(shops.ok, true); assert.equal(shops.shops.length, 1); assert.deepEqual(shops.shops[0].categories, ["HOME"]);
  const result = await f.service.offer("home-shop", "home-coupon");
  assert.equal(result.ok, true); assert.equal(result.offer.terms.title, "Published home coupon");
  assert.equal(result.offer.terms.percentBps, 1000); assert.equal(result.offer.revision, 1);
  assert.ok(!Object.hasOwn(result.offer.terms, "locationIds"));
  const encoded = JSON.stringify(result);
  for (const privateValue of ["private-", "Private address", "Private unreleased", "actorUserId", "organisationId", "authVersion", "subscription", "tokenHash"]) {
    assert.ok(!encoded.includes(privateValue), privateValue);
  }
  assert.ok(!JSON.stringify(f.calls).includes('"draft"'));
});

test("category and coupon search cannot use unpublished draft terms", async () => {
  const f = fixture();
  assert.deepEqual((await f.service.shops({ category: "FASHION" })).shops, []);
  assert.deepEqual((await f.service.shop("home-shop", { search: "unreleased" })).offers, []);
  const result = await f.service.shop("home-shop", { search: "published", category: "HOME" });
  assert.equal(result.offers.length, 1);
  assert.equal((await f.service.shops({ search: "Secret legal name" })).shops.length, 0);
});

test("business identity and revoked shopper cannot authorise discovery", async () => {
  const f = fixture(); f.setAfterAuth(() => ({ ok: true, userId: "owner", role: "SUPER_ADMIN" }));
  assert.equal((await f.service.shops()).code, "UNAUTHENTICATED"); assert.equal(f.calls.length, 0);
  const g = fixture(); g.setAfterAuth(count => count >= 2 ? { ok: false, code: "UNAUTHENTICATED" } : null);
  assert.equal((await g.service.offer("home-shop", "home-coupon")).code, "UNAUTHENTICATED");
});

test("hidden, foreign and incorrect public paths all return uniform404", async () => {
  const f = fixture();
  const cases = [await f.service.offer("other-shop", "home-coupon"), await f.service.offer("home-shop", "foreign-coupon"),
    await f.service.offer("../private", "home-coupon")];
  f.data.listings[0].organisationId = "foreign-org";
  cases.push(await f.service.offer("home-shop", "home-coupon"));
  for (const result of cases) { assert.equal(result.status, 404); assert.equal(result.code, "OFFER_UNAVAILABLE"); }
});

test("programme, profile, location and merchant entitlement must independently allow public discovery", async () => {
  const changes = [data => { data.program.networkOptIn = false; }, data => { data.program.status = "PAUSED"; },
    data => { data.profiles[0].networkOptIn = false; }, data => { data.profiles[0].status = "DRAFT"; },
    data => { data.profiles[0].revokedAt = NOW; }, data => { data.profiles[0].publishedAt = END; },
    data => { data.profiles[0].location.status = "CLOSED"; }, data => { data.grant.revokedAt = NOW; },
    data => { data.grant.expiresAt = NOW; }, data => { data.organisation.subscription.status = "CANCELLED"; },
    data => { data.organisation.subscription.plan.retailRadioEnabled = false; }];
  for (const change of changes) {
    const f = fixture(); change(f.data);
    assert.equal((await f.service.offer("home-shop", "home-coupon")).status, 404);
    assert.deepEqual((await f.service.shops()).shops, []);
  }
});

test("listing opt-in and exact current published revision are mandatory", async () => {
  const changes = [row => { row.discoverable = false; }, row => { row.revokedAt = NOW; }, row => { row.approvedAt = END; },
    row => { row.offer.publishedRevision = 2; }, row => { row.revision = 2; }, row => { row.publishedSnapshot.revision = 2; },
    row => { row.publishedSnapshot.organisationId = "foreign-org"; }, row => { row.offer.programId = "foreign-program"; },
    row => { row.offer.state = "PAUSED"; }, row => { row.offer.state = "CANCELLED"; }, row => { row.offer.state = "DRAFT"; }];
  for (const change of changes) { const f = fixture(); change(f.data.listings[0]); assert.equal((await f.service.offer("home-shop", "home-coupon")).status, 404); }
});

test("published snapshot dates and location targets cannot be substituted", async () => {
  const changes = [row => { row.publishedSnapshot.terms.locationIds = ["foreign-location"]; },
    row => { row.offer.locations[0].organisationId = "foreign-org"; }, row => { row.offer.locations[0].scope = "DRAFT"; },
    row => { row.offer.locations.push(clone(row.offer.locations[0])); }, row => { row.publishedSnapshot.terms.startsAt = NOW.toISOString(); },
    row => { row.offer.publishedEndsAt = NOW; }, row => { row.offer.publishedStartsAt = END; }];
  for (const change of changes) { const f = fixture(); change(f.data.listings[0]); assert.equal((await f.service.offer("home-shop", "home-coupon")).status, 404); }
});

test("withdrawal or republish committed during the initial read is rechecked", async () => {
  for (const change of [data => { data.program.networkOptIn = false; }, data => { data.profiles[0].revokedAt = NOW; },
    data => { data.grant.revokedAt = NOW; }, data => { data.listings[0].offer.publishedRevision = 2; }]) {
    const f = fixture(); f.setAfterAuth(count => { if (count === 2) change(f.data); });
    assert.equal((await f.service.offer("home-shop", "home-coupon")).status, 404);
  }
});

test("time is checked again before returning and shopper identity cannot change mid-read", async () => {
  const f = fixture(); f.setAfterAuth(count => { if (count === 3) f.setClock(END); });
  assert.equal((await f.service.offer("home-shop", "home-coupon")).status, 404);
  const g = fixture(); g.setAfterAuth(count => count >= 2 ? { ...ACCESS, shopperId: "different-shopper" } : null);
  assert.equal((await g.service.shop("home-shop")).code, "UNAUTHENTICATED");
});

test("bounded candidate pages preserve hasMore when safety checks omit rows", async () => {
  const f = fixture();
  for (let index = 1; index <= 26; index++) {
    const row = clone(f.data.listings[0]); row.id = `listing-${index}`; row.publicSlug = `coupon-${String(index).padStart(2, "0")}`;
    row.publishedSnapshot.terms.percentBps = 0; f.data.listings.push(row);
  }
  const first = await f.service.shop("home-shop");
  assert.equal(first.ok, true); assert.equal(first.offers.length, 0); assert.equal(first.hasMore, true);
  const second = await f.service.shop("home-shop", { page: 2 });
  assert.equal(second.offers.length, 1); assert.equal(second.hasMore, false);
  assert.ok(f.calls.filter(([kind]) => kind === "listings").every(([, query]) => query.take <= 26 && query.skip <= 25));
  assert.ok(!Object.hasOwn(first, "total"));
});

test("more than a page of stale listing revisions cannot hide a current published coupon", async () => {
  const f = fixture();
  for (let index = 1; index <= 26; index++) {
    const row = clone(f.data.listings[0]); row.id = `stale-${index}`; row.publicSlug = `coupon-${String(index).padStart(2, "0")}`;
    row.offerId = `stale-offer-${index}`; row.offer.id = row.offerId; row.publishedSnapshot.offerId = row.offerId;
    row.offer.locations[0].offerId = row.offerId;
    row.offer.publishedRevision = 2; // Listing consent remains pinned to revision1.
    f.data.listings.push(row);
  }
  const shops = await f.service.shops({ category: "HOME" });
  assert.equal(shops.shops.length, 1);
  const shop = await f.service.shop("home-shop", { category: "HOME" });
  assert.equal(shop.offers.length, 1); assert.equal(shop.offers[0].slug, "home-coupon");
  assert.equal(shop.hasMore, false);
  for (const [, query] of f.calls.filter(([kind]) => kind === "listings")) {
    assert.equal(query.where.offer.publishedSnapshot.discoveryListings.some.discoverable, true);
  }
});

test("database faults yield safe unavailable response without private details", async () => {
  const f = fixture(); f.data.grant.limitsVersion = 999;
  const result = await f.service.offer("home-shop", "home-coupon");
  assert.equal(result.code, "UNAVAILABLE"); assert.ok(!JSON.stringify(result).includes("private-"));
});

test("private preview discovery is bounded to the pilot allowlist and reflects removal during a read", async () => {
  const f = fixture(); Object.assign(f.env, pilotPreviewEnvironment(["private-org"]));
  assert.equal((await f.service.shops()).shops.length, 1);
  assert.equal((await f.service.offer("home-shop", "home-coupon")).ok, true);
  assert.ok(f.calls.filter(([kind]) => ["profiles", "profile"].includes(kind)).every(([, query]) =>
    JSON.stringify(query.where.organisationId) === '{"in":["private-org"]}'));
  f.env.RUVANAS_RETAIL_REWARDS_PILOT_ORGANISATION_IDS = '["different-org"]';
  assert.equal((await f.service.shops()).shops.length, 0);
  assert.equal((await f.service.offer("home-shop", "home-coupon")).code, "OFFER_UNAVAILABLE");
  f.env.RUVANAS_RETAIL_REWARDS_PILOT_ORGANISATION_IDS = '["private-org"]';
  f.setAfterAuth(() => { f.env.RUVANAS_RETAIL_REWARDS_PILOT_PREVIEW_ENABLED = "false"; });
  assert.equal((await f.service.shops()).shops.length, 0);
});

function addShop(f, suffix, locality, countryCode = "MT") {
  const profile = clone(f.data.profiles[0]), listing = clone(f.data.listings[0]);
  profile.id = `profile-${suffix}`; profile.publicSlug = `shop-${suffix}`; profile.locality = locality; profile.countryCode = countryCode;
  profile.locationId = profile.location.id = `location-${suffix}`;
  listing.id = `listing-${suffix}`; listing.publicSlug = `coupon-${suffix}`;
  listing.offerId = listing.offer.id = listing.publishedSnapshot.offerId = `offer-${suffix}`;
  listing.offer.locations = [{ organisationId: "private-org", offerId: listing.offerId, locationId: profile.locationId, scope: "PUBLISHED" }];
  listing.publishedSnapshot.terms.locationIds = [profile.locationId];
  f.data.profiles.push(profile); f.data.listings.push(listing);
  return { profile, listing };
}

test("location search returns only opted-in eligible towns and countries without private fields", async () => {
  const f = fixture();
  addShop(f, "sliema-one", "Sliema"); addShop(f, "sliema-two", "Sliema"); addShop(f, "foreign", "Sliema", "GB");
  addShop(f, "withdrawn", "Hidden town").profile.networkOptIn = false;
  addShop(f, "invalid", "Invalid town").listing.publishedSnapshot.terms.percentBps = 0;
  addShop(f, "blank", "   ");
  const all = await f.service.locations();
  assert.equal(all.ok, true); assert.equal(all.hasMore, false);
  assert.deepEqual(all.locations, [{ locality: "Valletta", countryCode: "MT" }, { locality: "Sliema", countryCode: "GB" }, { locality: "Sliema", countryCode: "MT" }]);
  assert.equal(JSON.stringify(all).includes("private-"), false);
  const searched = await f.service.locations({ search: "sli", countryCode: "MT" });
  assert.deepEqual(searched.locations, [{ locality: "Sliema", countryCode: "MT" }]);
  assert.deepEqual((await f.service.locations({ search: "Public Home Shop" })).locations, []);
  assert.ok(f.calls.filter(([kind]) => kind === "profiles").every(([, q]) => q.take <= 26));
  assert.equal(f.calls.filter(([kind]) => kind === "usage").length, 0);
});

test("locality and country filter shops before pagination and are rechecked on fresh reads", async () => {
  const f = fixture();
  for (let index = 0; index < 26; index++) addShop(f, `a-${String(index).padStart(2, "0")}`, "Another town");
  addShop(f, "zz-selected", "Sliema"); addShop(f, "zz-abroad", "Sliema", "GB");
  const selected = await f.service.shops({ locality: "sliema", countryCode: "MT" });
  assert.equal(selected.shops.length, 1); assert.equal(selected.shops[0].slug, "shop-zz-selected"); assert.equal(selected.hasMore, false);
  for (const [, query] of f.calls.filter(([kind]) => kind === "profiles")) {
    assert.deepEqual(query.where.locality, { equals: "sliema", mode: "insensitive" });
    assert.equal(query.where.countryCode, "MT"); assert.equal(query.skip, 0);
  }
  f.setAfterAuth(count => { if (count === 5) f.data.profiles.find(p => p.publicSlug === "shop-zz-selected").locality = "Changed town"; });
  assert.deepEqual((await f.service.shops({ locality: "Sliema", countryCode: "MT" })).shops, []);
});

test("location windows retain hasMore and a later town can be found directly by search", async () => {
  const f = fixture();
  for (let index = 0; index < 26; index++) addShop(f, `a-${String(index).padStart(2, "0")}`, "Sliema");
  addShop(f, "zz-last", "Zurrieq");
  const first = await f.service.locations(), next = await f.service.locations({ page: 2 });
  assert.equal(first.hasMore, true); assert.equal(next.hasMore, false);
  assert.ok(next.locations.some(row => row.locality === "Zurrieq"));
  assert.deepEqual((await f.service.locations({ search: "zurr" })).locations, [{ locality: "Zurrieq", countryCode: "MT" }]);
  assert.equal(Object.hasOwn(first, "total"), false);
  const g = fixture(); g.setAfterAuth(count => { if (count === 2) g.data.grant.revokedAt = NOW; });
  assert.deepEqual((await g.service.locations()).locations, []);
});

test("uses left is the current shopper's non-reversed redemption count across published revisions", async () => {
  const f = fixture();
  const redemption = patch => ({ organisationId: "private-org", offerId: "private-offer", shopperId: ACCESS.shopperId, reversal: null, ...patch });
  f.data.redemptions = [redemption({ revision: 1 }), redemption({ revision: 2 }), redemption({ revision: 3 }),
    redemption({ shopperId: "different-shopper" }), redemption({ organisationId: "different-org" }),
    redemption({ offerId: "different-offer" }), redemption({ reversal: { id: "correction" } })];
  const result = await f.service.offer("home-shop", "home-coupon");
  assert.deepEqual(result.offer.usage, { limit: 10, used: 3, remaining: 7, asOf: NOW.toISOString() });
  assert.deepEqual((await f.service.shop("home-shop")).offers[0].usage, result.offer.usage);
  for (const [, query] of f.calls.filter(([kind]) => kind === "usage")) {
    assert.deepEqual(query.where, { organisationId: "private-org", offerId: "private-offer", shopperId: ACCESS.shopperId, reversal: null });
  }
  assert.equal(JSON.stringify(result).includes(ACCESS.shopperId), false);
  f.data.redemptions[0].reversal = { id: "correction" };
  assert.equal((await f.service.offer("home-shop", "home-coupon")).offer.usage.remaining, 8);
  f.data.redemptions.push(...Array.from({ length: 12 }, () => redemption({})));
  assert.equal((await f.service.offer("home-shop", "home-coupon")).offer.usage.remaining, 0);
});

test("unknown usage fails closed and no count is inferred from claims or a changing identity", async () => {
  const f = fixture();
  f.data.claims = Array.from({ length: 10 }, () => ({ shopperId: ACCESS.shopperId, offerId: "private-offer" }));
  assert.equal((await f.service.offer("home-shop", "home-coupon")).offer.usage.remaining, 10);
  f.db.rewardRedemption.count = async () => { throw new Error("private database credentials"); };
  const failed = await f.service.offer("home-shop", "home-coupon");
  assert.equal(failed.code, "UNAVAILABLE"); assert.equal(JSON.stringify(failed).includes("credentials"), false);
  for (const count of [-1, NaN, 1.5, "3"]) {
    const g = fixture(); g.db.rewardRedemption.count = async () => count;
    assert.equal((await g.service.offer("home-shop", "home-coupon")).code, "UNAVAILABLE");
  }
  const h = fixture(); h.setAfterAuth(count => count === 3 ? { ...ACCESS, shopperId: "another-shopper" } : null);
  assert.equal((await h.service.offer("home-shop", "home-coupon")).code, "UNAUTHENTICATED");
});
