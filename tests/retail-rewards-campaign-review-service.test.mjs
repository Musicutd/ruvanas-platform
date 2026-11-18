import test from "node:test";
import assert from "node:assert/strict";
import { createRewardCampaignReviewService } from "../lib/retail-rewards/campaign-review-service.mjs";
import { reviewCampaignHash } from "../lib/retail-rewards/campaign-review-adapter.mjs";
import { safeCampaignReviewResult } from "../lib/retail-rewards/campaign-review-dtos.mjs";

// Deliberately synthetic read adapters: these exercise the actual service and
// policies, not PostgreSQL execution or production data. No write method exists.
const NOW = new Date("2026-11-14T12:00:00.000Z"), START = new Date("2026-11-01T00:00:00.000Z"), END = new Date("2027-01-01T00:00:00.000Z");
const copy = value => structuredClone(value);
const ENV = { RUVANAS_RETAIL_REWARDS_ENABLED: "true", RUVANAS_RETAIL_REWARDS_CAMPAIGNS_ENABLED: "true" };
function terms(patch = {}) {
  return { schemaVersion: 1, title: "10% after spending EUR 50", description: "Synthetic offer", category: "FASHION", type: "PERCENT_OFF",
    percentBps: 1000, amountMinor: null, buyQuantity: null, getQuantity: null, currency: "EUR", minimumSpendMinor: 5000,
    exclusions: "", legalTerms: "Present to authorised shop staff.", combinable: false, startsAt: START.toISOString(), endsAt: END.toISOString(),
    timezone: "Europe/Malta", locationIds: ["shop-one"], usage: "REUSABLE", totalLimit: 100, perShopperLimit: 10,
    perShopperDailyLimit: 1, pausedClaimsPolicy: "HONOUR_ISSUED", ...patch };
}
function offer(id = "offer-one", patch = {}) {
  const t = terms(patch);
  return { id, organisationId: "org-one", state: "PUBLISHED", draft: copy(t), lastRevision: 1, publishedRevision: 1,
    publishedStartsAt: new Date(t.startsAt), publishedEndsAt: new Date(t.endsAt),
    locations: ["DRAFT", "PUBLISHED"].flatMap(scope => t.locationIds.map(locationId => ({ organisationId: "org-one", offerId: id, locationId, scope }))),
    revisions: [{ organisationId: "org-one", offerId: id, revision: 1, terms: copy(t) }] };
}
function campaign(id = "campaign-one", locationIds = ["shop-one"]) {
  return { id, organisationId: "org-one", name: `Sample ${id}`, status: "PUBLISHED", promoVersionId: "promo-version-one", priority: "NORMAL",
    schedulingMode: "INTERVAL", mandatory: false, respectOpeningHours: true, effectiveFrom: START, effectiveTo: new Date("2026-11-30T00:00:00.000Z"),
    maxPromoMinutesPerHour: 12, minSamePromoGapMinutes: 15, minAnyPromoGapMinutes: 2, publicationRevision: 1,
    publishedAt: START, publishedConfigurationHash: null,
    targets: locationIds.map(locationId => ({ campaignId: id, targetType: "LOCATION", brandId: null, locationGroupId: null, locationId, zoneId: null, stationId: null, channelId: null })),
    schedules: [{ weekday: 1, windowMode: "INTERVAL", startMinute: 540, endMinute: 1020, exactMinute: null, playsPerHour: null, intervalMinutes: 10 }],
    rule: { exactTimeHardStart: false, playsPerHour: null, intervalMinutes: 10 }, retailMediaOrder: null,
    promoVersion: { id: "promo-version-one", status: "APPROVED", promoAssetId: "promo-one", mediaAssetId: "media-one",
      promoAsset: { id: "promo-one", organisationId: "org-one", name: "Shop announcement", status: "ACTIVE", mediaType: "COMMERCIAL" },
      mediaAsset: { id: "media-one", organisationId: "org-one", status: "READY", mediaType: "COMMERCIAL", mimeType: "audio/mpeg" } } };
}
function matches(row, where = {}) {
  return Object.entries(where).every(([key, wanted]) => {
    const actual = row?.[key];
    if (key === "AND") return wanted.every(condition => matches(row, condition));
    if (key === "OR") return wanted.some(condition => matches(row, condition));
    if (wanted instanceof Date) return actual instanceof Date && actual.getTime() === wanted.getTime();
    if (wanted && typeof wanted === "object") {
      if (Object.hasOwn(wanted, "some") || Object.hasOwn(wanted, "every")) return Array.isArray(actual) &&
        (!wanted.some || actual.some(item => matches(item, wanted.some))) && (!wanted.every || actual.every(item => matches(item, wanted.every)));
      if (Object.hasOwn(wanted, "is")) return wanted.is === null ? actual === null : matches(actual, wanted.is);
      if (Object.hasOwn(wanted, "in")) return wanted.in.includes(actual);
      if (Object.hasOwn(wanted, "not")) return actual !== wanted.not;
      if (Object.hasOwn(wanted, "gt")) return actual > wanted.gt;
      return actual != null && matches(actual, wanted);
    }
    return actual === wanted;
  });
}
function sorted(rows, orderBy) {
  if (!orderBy) return [...rows];
  const [key, direction] = Object.entries(orderBy)[0];
  return [...rows].sort((a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0) * (direction === "desc" ? -1 : 1));
}
function project(row, select) {
  if (row == null) return null;
  if (!select) return copy(row);
  return Object.fromEntries(Object.entries(select).map(([key, choice]) => {
    const value = row[key];
    if (choice === true) return [key, copy(value)];
    if (Array.isArray(value)) return [key, sorted(value.filter(item => matches(item, choice.where)), choice.orderBy).slice(0, choice.take ?? value.length).map(item => project(item, choice.select))];
    return [key, project(value, choice.select)];
  }));
}
function fixture({ role = "OWNER" } = {}) {
  const member = { id: "member-one", userId: "user-one", organisationId: "org-one", role };
  const data = {
    context: { user: { id: "user-one", role }, session: { id: "session-one", userId: "user-one", activeOrganisationId: "org-one", authMethod: "PASSWORD", expiresAt: END, revokedAt: null },
      membership: { ...member, organisation: { id: "org-one", subscription: { id: "sub-one", organisationId: "org-one", status: "ACTIVE", plan: { code: "RETAIL_START", active: true, retailRadioEnabled: true } } } }, memberships: [{ ...member }] },
    programs: [{ id: "program-one", organisationId: "org-one", status: "ACTIVE" }],
    grants: [{ id: "grant-one", organisationId: "org-one", subscriptionId: "sub-one", capability: "RETAIL_REWARDS", source: "MANUAL_INTERNAL", tier: "REWARDS_STARTER",
      status: "ACTIVE", startsAt: START, expiresAt: END, revokedAt: null, limitsVersion: 1, activeOffers: 100, locations: 10, staffSeats: 3, monthlyRedemptions: 100,
      analyticsRetentionDays: 30, exportEnabled: false, brandingEnabled: false }],
    staff: [{ id: "staff-one", organisationId: "org-one", organisationMemberId: "member-one", scope: "LOCATIONS", locationId: "shop-one", capabilities: ["READ", "MANAGE_OFFERS"], startsAt: START, expiresAt: END, revokedAt: null }],
    locations: [{ id: "shop-one", organisationId: "org-one", status: "ACTIVE", name: "First shop", timezone: "Europe/Malta", zones: [{ id: "zone-one", name: "Main area", locationId: "shop-one", status: "ACTIVE" }] },
      { id: "shop-two", organisationId: "org-one", status: "ACTIVE", name: "Second shop", timezone: "UTC", zones: [{ id: "zone-two", name: "Main area", locationId: "shop-two", status: "ACTIVE" }] },
      { id: "other-shop", organisationId: "other-org", status: "ACTIVE", name: "Private other shop", timezone: "UTC", zones: [] }],
    offers: [offer()], campaigns: [campaign()]
  };
  const env = { ...ENV }, calls = [], txOptions = []; let currentTime = NOW, transactions = 0, afterTransaction, contextTransform;
  function hash(row) { row.publishedConfigurationHash = reviewCampaignHash(row, data.locations.filter(l => row.targets.some(t => t.locationId === l.id)).sort((a, b) => a.name.localeCompare(b.name))); }
  data.campaigns.forEach(hash);
  function client(source, inTransaction = false) {
    function delegate(model) {
      return {
        async findFirst(args = {}) { calls.push({ model, method: "findFirst", inTransaction, ...copy(args) }); return project(source[model].find(row => matches(row, args.where)), args.select); },
        async findMany(args = {}) { calls.push({ model, method: "findMany", inTransaction, ...copy(args) }); return sorted(source[model].filter(row => matches(row, args.where)), args.orderBy).slice(0, args.take).map(row => project(row, args.select)); }
      };
    }
    return { source, rewardProgram: delegate("programs"), rewardEntitlementGrant: delegate("grants"), rewardStaffGrant: delegate("staff"),
      location: delegate("locations"), rewardOffer: delegate("offers"), campaign: delegate("campaigns") };
  }
  const db = { ...client(data), async $transaction(operation, options) {
    txOptions.push(copy(options)); const number = ++transactions, snapshot = copy(data);
    const result = await operation(client(snapshot, true)); afterTransaction?.(number); return result;
  } };
  let contexts = 0;
  const service = createRewardCampaignReviewService({ db, env, clock: () => new Date(currentTime),
    loadContext: async source => { const context = copy(source.source.context); return contextTransform?.(context, ++contexts) || context; } });
  return { data, calls, txOptions, service, env, hash, setAfterTransaction: fn => { afterTransaction = fn; }, setContextTransform: fn => { contextTransform = fn; },
    setTime: date => { currentTime = date; }, addOffer: (id, patch) => data.offers.push(offer(id, patch)),
    addCampaign: (id, locations) => { const row = campaign(id, locations); hash(row); data.campaigns.push(row); } };
}
const input = { offerId: "offer-one", revision: 1 };

test("service reviews published immutable terms through two read-only bounded snapshots", async () => {
  const f = fixture(); f.data.offers[0].draft.title = "Unpublished private text"; const before = copy(f.data);
  const list = await f.service.offers(); assert.equal(list.ok, true, JSON.stringify(list)); assert.equal(list.offers[0].title, "10% after spending EUR 50");
  const result = await f.service.review(input); assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.campaigns.length, 1);
  assert.equal(safeCampaignReviewResult("review", result)?.ok, true); assert.equal(JSON.stringify(result).includes("Unpublished private text"), false);
  assert.equal(JSON.stringify(result).includes("ConfigurationHash"), false); assert.equal(JSON.stringify(result).includes("media-one"), false);
  assert.deepEqual(f.data, before); assert.equal(f.txOptions.length, 4);
  assert.ok(f.txOptions.every(o => o.isolationLevel === "RepeatableRead" && o.timeout === 10000 && o.maxWait === 5000));
  assert.ok(f.calls.filter(c => ["offers", "campaigns"].includes(c.model)).every(c => c.take === 101 && c.where.organisationId === "org-one"));
});

test("valid published UTC terms without milliseconds normalize consistently for review DTOs", async () => {
  const f = fixture(); f.data.offers = [offer("offer-one", { startsAt: "2026-11-01T00:00:00Z", endsAt: "2027-01-01T00:00:00Z" })];
  const list = await f.service.offers(), result = await f.service.review(input);
  assert.equal(list.ok, true, JSON.stringify(list)); assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.offer.startsAt, START.toISOString()); assert.equal(result.offer.endsAt, END.toISOString());
  assert.equal(safeCampaignReviewResult("offers", list)?.ok, true); assert.equal(safeCampaignReviewResult("review", result)?.ok, true);
});

test("both action scopes are applied before candidate counting and foreign records stay hidden", async () => {
  const f = fixture({ role: "MANAGER" }); f.addOffer("offer-two", { locationIds: ["shop-two"] });
  const foreign = offer("other-offer", { locationIds: ["other-shop"] }); foreign.organisationId = "other-org"; f.data.offers.push(foreign);
  const result = await f.service.offers(); assert.equal(result.ok, true); assert.deepEqual(result.offers.map(o => o.id), ["offer-one"]);
  const query = f.calls.find(c => c.model === "offers"); assert.deepEqual(query.where.locations.every.locationId, { in: ["shop-one"] });
  assert.equal((await f.service.review({ offerId: "other-offer", revision: 1 })).code, "OFFER_UNAVAILABLE");
  f.data.staff = [{ ...f.data.staff[0], capabilities: ["READ"] }, { ...f.data.staff[0], id: "staff-two", locationId: "shop-two", capabilities: ["MANAGE_OFFERS"] }];
  const disjoint = await f.service.offers(); assert.equal(disjoint.ok, true); assert.deepEqual(disjoint.offers, []);
});

test("cashier, preview identity and inconsistent READ/MANAGE authority cannot review", async () => {
  const cashier = fixture({ role: "VIEWER" }); assert.equal((await cashier.service.offers()).code, "FORBIDDEN");
  const preview = fixture(); preview.data.context.user.privatePreviewAccess = { userId: "user-one" }; assert.equal((await preview.service.offers()).code, "FORBIDDEN");
  const mismatch = fixture(); mismatch.setContextTransform((context, count) => {
    if (count === 2) { context.membership.role = "MANAGER"; context.memberships[0].role = "MANAGER"; } return context;
  }); assert.equal((await mismatch.service.review(input)).code, "FORBIDDEN");
});

test("session, grants and feature revocations after the first snapshot are rechecked", async () => {
  for (const [mutate, expected] of [
    [f => { f.data.context.session.revokedAt = NOW; }, "UNAUTHENTICATED"],
    [f => { f.data.grants[0].revokedAt = NOW; }, "NOT_ENTITLED"],
    [f => { f.env.RUVANAS_RETAIL_REWARDS_CAMPAIGNS_ENABLED = "false"; }, "FEATURE_DISABLED"]
  ]) { const f = fixture(); f.setAfterTransaction(n => { if (n === 1) mutate(f); }); assert.equal((await f.service.review(input)).code, expected); }
  const staff = fixture({ role: "MANAGER" }); staff.setAfterTransaction(n => { if (n === 1) staff.data.staff[0].capabilities = ["READ"]; });
  assert.equal((await staff.service.review(input)).code, "FORBIDDEN");
});

test("paused, expired, mismatched revision and inactive shop offers fail closed", async () => {
  for (const [mutate, expected] of [
    [f => { f.data.offers[0].state = "PAUSED"; }, "OFFER_UNAVAILABLE"],
    [f => { f.data.offers[0].publishedEndsAt = NOW; }, "OFFER_UNAVAILABLE"],
    [f => { f.data.offers[0].publishedRevision = 2; }, "CONFLICT"],
    [f => { f.data.locations[0].status = "CLOSED"; }, "LOCATION_UNAVAILABLE"],
    [f => { f.data.offers[0].revisions[0].organisationId = "other-org"; }, "UNAVAILABLE"],
    [f => { f.data.offers[0].locations[0].locationId = "shop-two"; }, "UNAVAILABLE"]
  ]) { const f = fixture(); mutate(f); assert.equal((await f.service.review(input)).code, expected); }
});

test("campaign tenant, direct target, publication hash and audio asset chain are required", async () => {
  for (const mutate of [
    r => { r.organisationId = "other-org"; }, r => { r.status = "DRAFT"; }, r => { r.mandatory = true; }, r => { r.retailMediaOrder = { id: "order" }; },
    r => { r.targets[0].targetType = "ALL_LOCATIONS"; r.targets[0].locationId = null; }, r => { r.targets[0].locationId = "shop-two"; },
    r => { r.targets[0].stationId = "station"; }, r => { r.publicationRevision = 0; }, r => { r.publishedAt = END; },
    r => { r.publishedConfigurationHash = "stale"; }, r => { r.name = "Unsaved publication change"; },
    r => { r.promoVersion.status = "DRAFT"; }, r => { r.promoVersion.id = "mismatched-version"; },
    r => { r.promoVersion.promoAsset.organisationId = "other-org"; }, r => { r.promoVersion.promoAsset.status = "ARCHIVED"; },
    r => { r.promoVersion.mediaAsset.organisationId = "other-org"; }, r => { r.promoVersion.mediaAsset.status = "PROCESSING"; },
    r => { r.promoVersion.mediaAsset.mediaType = "MUSIC"; },
    r => { r.promoVersion.mediaAsset.mimeType = "video/mp4"; }
  ]) { const f = fixture(); mutate(f.data.campaigns[0]); const result = await f.service.review(input); assert.equal(result.ok, true, JSON.stringify(result)); assert.deepEqual(result.campaigns, []); }
});

test("campaign targets must equal every published shop and topology is part of the hash", async () => {
  const f = fixture(); f.data.offers = [offer("offer-one", { locationIds: ["shop-one", "shop-two"] })];
  assert.deepEqual((await f.service.review(input)).campaigns, []);
  f.data.campaigns = []; f.addCampaign("both-shops", ["shop-one", "shop-two"]); assert.equal((await f.service.review(input)).campaigns.length, 1);
  f.data.locations[1].zones.push({ id: "new-zone", locationId: "shop-two", name: "New area", status: "ACTIVE" });
  assert.deepEqual((await f.service.review(input)).campaigns, []);
});

test("fresh source revalidation detects republish, asset edits, target and timezone changes", async () => {
  for (const [mutate, expected] of [
    [f => { f.data.offers[0].publishedRevision = 2; }, "CONFLICT"],
    [f => { f.data.campaigns[0].promoVersion.promoAsset.name = "Changed promotion"; }, "CONFLICT"],
    [f => { f.data.campaigns[0].publishedConfigurationHash = "changed"; }, "CONFLICT"],
    [f => { f.data.campaigns[0].targets[0].locationId = "shop-two"; }, "CONFLICT"],
    [f => { f.data.locations[0].timezone = "UTC"; }, "CONFLICT"],
    [f => { f.data.locations[0].status = "CLOSED"; }, "LOCATION_UNAVAILABLE"]
  ]) { const f = fixture(); f.setAfterTransaction(n => { if (n === 1) mutate(f); }); assert.equal((await f.service.review(input)).code, expected); }
});

test("offer and campaign paging uses 25 accepted rows while candidate sets stop at 101", async () => {
  const f = fixture(); for (let i = 0; i < 26; i++) f.addOffer(`offer-extra-${String(i).padStart(2, "0")}`);
  const first = await f.service.offers(), second = await f.service.offers({ page: 2 });
  assert.equal(first.offers.length, 25); assert.equal(first.hasMore, true); assert.equal(second.offers.length, 2); assert.equal(second.hasMore, false);
  assert.equal(new Set([...first.offers, ...second.offers].map(o => o.id)).size, 27);
  for (let i = 0; i < 26; i++) f.addCampaign(`campaign-extra-${String(i).padStart(2, "0")}`);
  const p1 = await f.service.review(input), p2 = await f.service.review({ ...input, page: 2 });
  assert.equal(p1.campaigns.length, 25); assert.equal(p1.hasMore, true); assert.equal(p2.campaigns.length, 2); assert.equal(p2.hasMore, false);
  assert.equal(new Set([...p1.campaigns, ...p2.campaigns].map(c => c.id)).size, 27);
  const offersCap = fixture(); for (let i = 0; i < 100; i++) offersCap.addOffer(`offer-cap-${i}`); assert.equal((await offersCap.service.offers()).code, "REVIEW_TOO_LARGE");
  const campaignCap = fixture(); for (let i = 0; i < 100; i++) campaignCap.addCampaign(`campaign-cap-${i}`); assert.equal((await campaignCap.service.review(input)).code, "REVIEW_TOO_LARGE");
});

test("invalid zones and unsupported timezones fail safely without a partial review", async () => {
  const invalid = fixture(); invalid.data.locations[0].timezone = "not-a-zone"; assert.equal((await invalid.service.review(input)).code, "UNAVAILABLE");
  const oversized = fixture(); oversized.data.locations[0].zones = Array.from({ length: 1001 }, (_, i) => ({ id: `zone-${i}`, name: `Area ${i}`, locationId: "shop-one", status: "ACTIVE" }));
  assert.equal((await oversized.service.review(input)).code, "REVIEW_TOO_LARGE");
});
