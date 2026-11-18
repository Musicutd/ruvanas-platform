import test from "node:test";
import assert from "node:assert/strict";
import { createRewardReportingService } from "../lib/retail-rewards/reporting-service.mjs";
import { readReportsPolicy, reportQuerySchema } from "../lib/retail-rewards/reports-contracts.mjs";
import { fixture, clone, NOW, terms } from "./fixtures/rewards-checkout.mjs";

function setup() {
  const f = fixture();
  f.env = { RUVANAS_RETAIL_REWARDS_ENABLED: "true", RUVANAS_RETAIL_REWARDS_REPORTS_ENABLED: "true" };
  f.data.snapshots.forEach(row => { row.campaignLink = null; });
  f.data.programs[0].timezone = "Europe/Malta"; f.data.grants[0].exportEnabled = true;
  f.data.claims[0].createdAt = new Date("2026-11-10T10:00:00Z");
  f.data.receipts = [{ id: "receipt-one", organisationId: "org-one", locationId: "shop-one", offerId: "offer-one", claimId: "claim-one",
    shopperId: "must-not-leak", actorUserId: "private-staff", tokenHash: "private-hash", eligibleSpendMinor: 9000, currency: "EUR", discountMinor: 900,
    occurredAt: new Date("2026-11-10T10:01:00Z") }];
  function matches(row, where = {}) {
    return !!row && Object.entries(where).every(([key, value]) => {
      const actual = row[key];
      if (value === null || typeof value !== "object") return actual === value;
      if (value instanceof Date) return actual?.getTime() === value.getTime();
      if (value.in) return value.in.includes(actual);
      return Object.entries(value).every(([operator, operand]) => ({ gt: actual > operand, gte: actual >= operand, lt: actual < operand, lte: actual <= operand })[operator]);
    });
  }
  function project(row, select) {
    if (row == null) return row;
    return select ? Object.fromEntries(Object.entries(select).map(([key, choice]) => [key, choice === true ? clone(row[key]) : project(row[key], choice.select)])) : clone(row);
  }
  function client(source) {
    function expand(key, row) {
      if (key === "claims") return { ...row, publishedSnapshot: source.snapshots.find(s => s.offerId === row.offerId && s.revision === row.revision) };
      if (key !== "receipts") return row;
      const claim = source.claims.find(c => c.id === row.claimId);
      return { ...row, claim: claim ? { ...claim, publishedSnapshot: source.snapshots.find(s => s.offerId === claim.offerId && s.revision === claim.revision) } : null,
        reversal: source.reversals.find(c => c.redemptionId === row.id) || null };
    }
    const delegate = key => ({
      async findFirst({ where, select } = {}) { f.calls.push([key, "read", clone(where)]); return project(source[key].find(row => matches(row, where)), select); },
      async findMany({ where, select, orderBy = [], skip = 0, take } = {}) {
        f.calls.push([key, "list", clone(where), { take, skip }]);
        return source[key].filter(row => matches(row, where)).sort((a, b) => {
          for (const entry of Array.isArray(orderBy) ? orderBy : [orderBy]) { const [field, direction] = Object.entries(entry)[0]; if (a[field] !== b[field]) {
            const compare = a[field] > b[field] ? 1 : a[field] < b[field] ? -1 : 0; if (compare) return direction === "desc" ? -compare : compare;
          } } return 0;
        }).slice(skip, take === undefined ? undefined : skip + take).map(row => project(expand(key, row), select));
      }
    });
    return { rewardProgram: delegate("programs"), rewardEntitlementGrant: delegate("grants"), rewardStaffGrant: delegate("staff"), location: delegate("locations"),
      rewardClaim: delegate("claims"), rewardRedemption: delegate("receipts") };
  }
  f.db = { ...client(f.data), async $transaction(fn, options) {
    f.calls.push(["transaction", clone(options)]); f.beforeTransaction?.();
    const result = await fn(client(clone(f.data))); await f.afterTransaction?.(); return result;
  } };
  f.authCalls = 0;
  f.service = createRewardReportingService({ db: f.db, env: f.env, clock: () => f.now,
    loadContext: async () => { f.authCalls++; f.onAuth?.(f.authCalls); return clone(f.context); } });
  f.query = { locationId: "shop-one", fromDate: "2026-11-08", toDate: "2026-11-14" };
  return f;
}

test("reports are strictly default off before auth, time or DB and independent of checkout", async () => {
  const no = () => { throw new Error("Forbidden access"); };
  for (const env of [{}, { RUVANAS_RETAIL_REWARDS_ENABLED: "true" }, { RUVANAS_RETAIL_REWARDS_ENABLED: "true", RUVANAS_RETAIL_REWARDS_REPORTS_ENABLED: true }]) {
    const service = createRewardReportingService({ db: new Proxy({}, { get: no }), env, loadContext: no, clock: no });
    for (const result of await Promise.all([service.locations(), service.report({}), service.exportReport({})])) assert.equal(result.code, "FEATURE_DISABLED");
  }
  assert.deepEqual(readReportsPolicy({ RUVANAS_RETAIL_REWARDS_ENABLED: "true", RUVANAS_RETAIL_REWARDS_REPORTS_ENABLED: "true", RUVANAS_RETAIL_REWARDS_CHECKOUT_ENABLED: "false" }), { enabled: true, valid: true });
  const f = setup(); assert.equal((await f.service.report(f.query)).ok, true);
});

test("query contracts reject invalid/foreign scope and noncanonical dates before dependencies", async () => {
  const f = setup();
  for (const patch of [{ organisationId: "foreign" }, { timezone: "UTC" }, { fromDate: "2026-02-30" }, { fromDate: "1969-12-31" }, { page: 0 },
    { page: "01" }, { asOf: "2026-11-14T12:00:00Z" }, { asOf: "not-a-date" }]) {
    assert.equal((await f.service.report({ ...f.query, ...patch })).code, "INVALID_REQUEST");
  }
  assert.equal((await f.service.exportReport({ ...f.query, page: 1 })).code, "INVALID_REQUEST");
  assert.equal((await f.service.locations({ tenant: "foreign" })).code, "INVALID_REQUEST");
  assert.equal(f.calls.length, 0); assert.equal(f.authCalls, 0);
  assert.equal(reportQuerySchema.parse({ ...f.query, page: "2" }).page, 2);
});

test("scoped reports are one bounded read-only snapshot and expose only pinned immutable labels", async () => {
  const f = setup(), before = clone(f.data), result = await f.service.report(f.query);
  assert.equal(result.ok, true, JSON.stringify(result)); assert.deepEqual(result.summary, { issued: 1, successfulUses: 1, correctedUses: 0, netUses: 1 });
  assert.deepEqual(result.receipts[0], { id: "receipt-one", redeemedAt: "2026-11-10T10:01:00.000Z", offerTitle: "Issued home offer", revision: 1,
    shopName: "Public Home Shop", campaignAssociation: null, status: "REDEEMED", correction: null });
  assert.equal(result.totalRows, 1); assert.equal(result.hasMore, false); assert.equal(result.exportAllowed, true);
  assert.deepEqual(result.window, { fromInclusive: "2026-11-07T23:00:00.000Z", toExclusive: "2026-11-14T23:00:00.000Z" });
  assert.deepEqual(f.calls.find(c => c[0] === "transaction")[1], { isolationLevel: "RepeatableRead", maxWait: 5000, timeout: 10000 });
  assert.deepEqual(f.data, before);
  for (const field of ["must-not-leak", "private-staff", "private-hash", "shopperId", "actorUserId", "currency", "eligibleSpendMinor", "Unpublished confidential draft", "publicShopSlug"])
    assert.equal(JSON.stringify(result).includes(field), false, field);
});

test("cohort corrections include later-period corrections only through asOf, never unrelated events", async () => {
  const f = setup(); f.query.toDate = "2026-11-10";
  f.data.reversals = [{ id: "correction", redemptionId: "receipt-one", organisationId: "org-one", reason: "WRONG_COUPON", occurredAt: new Date("2026-11-11T09:00:00Z") },
    { id: "unrelated", redemptionId: "not-in-window", organisationId: "org-one", reason: "PURCHASE_CANCELLED", occurredAt: NOW }];
  const result = await f.service.report(f.query);
  assert.deepEqual(result.summary, { issued: 1, successfulUses: 1, correctedUses: 1, netUses: 0 });
  assert.equal(result.receipts[0].status, "CORRECTED");
  f.data.reversals[0].occurredAt = new Date(NOW.getTime() - 60_000);
  const prior = await f.service.report({ ...f.query, asOf: new Date(NOW.getTime() - 120_000).toISOString() });
  assert.equal(prior.summary.correctedUses, 0); assert.equal(prior.receipts[0].correction, null);
});

test("VIEW_INSIGHTS and EXPORT each enforce exact tenant/shop scopes and role ceilings", async () => {
  const f = setup(); f.context.membership.role = f.context.memberships[0].role = "MANAGER";
  f.data.staff[0].capabilities = ["VIEW_INSIGHTS"];
  f.data.staff.push({ ...clone(f.data.staff[0]), id: "export-grant", locationId: "shop-two", capabilities: ["EXPORT"] });
  assert.equal((await f.service.report(f.query)).exportAllowed, false);
  assert.equal((await f.service.exportReport(f.query)).code, "LOCATION_UNAVAILABLE");
  assert.equal((await f.service.report({ ...f.query, locationId: "shop-two" })).code, "LOCATION_UNAVAILABLE");
  const locations = await f.service.locations(); assert.deepEqual(locations.locations, [{ id: "shop-one", name: "Public Home Shop", canExport: false }]);
  f.data.staff[0].capabilities = ["VIEW_INSIGHTS", "EXPORT"];
  assert.equal((await f.service.exportReport(f.query)).ok, true);
  f.context.membership.role = f.context.memberships[0].role = "CONTENT_EDITOR";
  assert.equal((await f.service.report(f.query)).ok, true); assert.equal((await f.service.exportReport(f.query)).code, "FORBIDDEN");
  f.context.membership.role = f.context.memberships[0].role = "VIEWER";
  assert.equal((await f.service.report(f.query)).code, "FORBIDDEN");
  f.context.membership.role = f.context.memberships[0].role = "OWNER";
  f.data.locations.push({ id: "foreign-shop", organisationId: "other-org", name: "Secret shop", status: "ACTIVE" });
  assert.equal((await f.service.report({ ...f.query, locationId: "foreign-shop" })).code, "LOCATION_UNAVAILABLE");
});

test("locations provide current calendar bounds/defaults; huge retentions clamp safely to 1970", async () => {
  const f = setup(), result = await f.service.locations();
  assert.deepEqual(result.bounds, { earliestDate: "2026-10-16", latestDate: "2026-11-14", maxRangeDays: 31 });
  assert.deepEqual(result.defaults, { fromDate: "2026-11-08", toDate: "2026-11-14" }); assert.equal(result.timezone, "Europe/Malta");
  f.data.grants[0].analyticsRetentionDays = 1;
  assert.deepEqual((await f.service.locations()).defaults, { fromDate: "2026-11-14", toDate: "2026-11-14" });
  f.data.grants[0].analyticsRetentionDays = 1_000_000_000;
  assert.equal((await f.service.locations()).bounds.earliestDate, "1970-01-01");
  f.data.grants[0].analyticsRetentionDays = 0;
  assert.equal((await f.service.locations()).code, "NOT_ENTITLED");
});

test("retention uses current clock and asOf cannot bypass its cutoff or 15-minute lifetime", async () => {
  const f = setup();
  assert.equal((await f.service.report({ ...f.query, fromDate: "2026-10-15" })).code, "REPORT_EXPIRED");
  assert.equal((await f.service.report({ ...f.query, fromDate: "2026-11-15", toDate: "2026-11-15" })).code, "INVALID_REQUEST");
  assert.equal((await f.service.report({ ...f.query, fromDate: "2026-11-15" })).code, "INVALID_REQUEST");
  f.data.grants[0].analyticsRetentionDays = 100;
  assert.equal((await f.service.report({ ...f.query, fromDate: "2026-10-14" })).code, "INVALID_REQUEST");
  assert.equal((await f.service.report({ ...f.query, asOf: new Date(NOW.getTime() + 1).toISOString() })).code, "INVALID_REQUEST");
  assert.equal((await f.service.report({ ...f.query, asOf: new Date(NOW - 900_001).toISOString() })).code, "REPORT_EXPIRED");
  assert.equal((await f.service.report({ ...f.query, asOf: new Date(NOW - 900_000).toISOString() })).ok, true);
});

test("Malta local dates have correct DST boundaries without assuming 24-hour days", async () => {
  for (const [day, now, expectedStart, expectedEnd, hours] of [
    ["2026-10-25", "2026-10-26T12:00:00Z", "2026-10-24T22:00:00.000Z", "2026-10-25T23:00:00.000Z", 25],
    ["2026-03-29", "2026-03-30T12:00:00Z", "2026-03-28T23:00:00.000Z", "2026-03-29T22:00:00.000Z", 23]
  ]) {
    const f = setup(); f.now = new Date(now); f.data.grants[0].startsAt = new Date("2026-01-01T00:00:00Z"); f.data.staff[0].startsAt = f.data.grants[0].startsAt;
    const result = await f.service.report({ locationId: "shop-one", fromDate: day, toDate: day });
    assert.equal(result.ok, true, JSON.stringify(result)); assert.deepEqual(result.window, { fromInclusive: expectedStart, toExclusive: expectedEnd });
    assert.equal((Date.parse(expectedEnd) - Date.parse(expectedStart)) / 3600_000, hours);
  }
});

test("claim rows and receipt rows cap independently without silent truncation", async () => {
  for (const key of ["claims", "receipts"]) {
    const f = setup(), template = clone(f.data[key][0]); f.data[key] = Array.from({ length: 1001 }, (_, i) => ({ ...clone(template), id: `event-${i}` }));
    assert.equal((await f.service.report(f.query)).code, "REPORT_TOO_LARGE");
    assert.equal((await f.service.exportReport(f.query)).code, "REPORT_TOO_LARGE");
    for (const call of f.calls.filter(c => ["claims", "receipts"].includes(c[0]) && c[1] === "list")) assert.equal(call[3].take, 1001);
  }
});

test("pagination is 25 per page, export includes the entire bounded receipt cohort", async () => {
  const f = setup(), row = f.data.receipts[0]; f.data.receipts = Array.from({ length: 26 }, (_, i) => ({ ...clone(row), id: `receipt-${String(i).padStart(2, "0")}` }));
  const first = await f.service.report(f.query), second = await f.service.report({ ...f.query, page: 2, asOf: first.asOf });
  assert.equal(first.receipts.length, 25); assert.equal(first.hasMore, true); assert.equal(first.totalRows, 26);
  assert.equal(second.receipts.length, 1); assert.equal(second.hasMore, false); assert.equal(new Set([...first.receipts, ...second.receipts].map(r => r.id)).size, 26);
  const exported = await f.service.exportReport({ ...f.query, asOf: first.asOf }); assert.equal(exported.receipts.length, 26); assert.equal(exported.hasMore, false);
  assert.deepEqual(exported.summary, first.summary);
});

test("final outside-snapshot checks reject revoked authority, role/scope/limit changes and timezone changes", async () => {
  for (const [mutate, expected] of [
    [f => { f.context.session.revokedAt = f.now; }, "UNAUTHENTICATED"],
    [f => { f.context.membership.role = f.context.memberships[0].role = "MANAGER"; f.data.staff[0].capabilities = ["VIEW_INSIGHTS", "EXPORT"]; }, "FORBIDDEN"],
    [f => { f.data.grants[0].revokedAt = f.now; }, "NOT_ENTITLED"],
    [f => { f.data.grants[0].analyticsRetentionDays = 1; }, "FORBIDDEN"],
    [f => { f.data.locations[0].status = "INACTIVE"; }, "LOCATION_UNAVAILABLE"],
    [f => { f.data.programs[0].timezone = "UTC"; }, "REPORT_EXPIRED"],
    [f => { f.env.RUVANAS_RETAIL_REWARDS_REPORTS_ENABLED = "false"; }, "FEATURE_DISABLED"]
  ]) {
    const f = setup(); f.afterTransaction = () => mutate(f);
    assert.equal((await f.service.report(f.query)).code, expected, expected);
  }
  const f = setup(); f.context.membership.role = f.context.memberships[0].role = "MANAGER"; f.data.staff[0].capabilities = ["VIEW_INSIGHTS"];
  f.afterTransaction = () => { f.data.staff[0].scope = "ALL_LOCATIONS"; f.data.staff[0].locationId = null; };
  assert.equal((await f.service.report(f.query)).code, "FORBIDDEN");
});

test("final clock/asOf checks fail closed and no private database errors escape", async () => {
  for (const [mutate, expected] of [[f => { f.now = new Date(NOW - 1); }, "UNAVAILABLE"], [f => { f.now = new Date(NOW.getTime() + 900_001); }, "REPORT_EXPIRED"]]) {
    const f = setup(); f.afterTransaction = () => mutate(f); assert.equal((await f.service.report(f.query)).code, expected);
  }
  const f = setup(); f.db.$transaction = async () => { throw new Error("database password must-not-leak"); };
  const result = await f.service.report(f.query); assert.equal(result.code, "UNAVAILABLE"); assert.equal(JSON.stringify(result).includes("password"), false);
});

test("malformed relational evidence cannot leak or silently distort receipt totals", async () => {
  for (const mutate of [f => { f.data.snapshots[0].organisationId = "foreign"; }, f => { f.data.snapshots[0].terms = terms({ locationIds: ["shop-two"] }); },
    f => { f.data.claims[0].publicShopName = ""; }, f => { f.data.receipts.push(clone(f.data.receipts[0])); },
    f => { f.data.reversals.push({ redemptionId: "receipt-one", organisationId: "foreign", reason: "WRONG_COUPON", occurredAt: NOW }); }]) {
    const f = setup(); mutate(f); assert.equal((await f.service.report(f.query)).code, "UNAVAILABLE");
  }
});
function addLinkedClaim(f) {
  const claim = { ...clone(f.data.claims[0]), id: "claim-linked", revision: 2, createdAt: new Date("2026-11-10T10:00:30Z") };
  const campaignLink = { organisationId: "org-one", offerId: "offer-one", revision: 2, campaignPublicationRevision: 7,
    pinnedAt: new Date("2026-11-10T09:59:00Z"), snapshot: { schemaVersion: 1, campaignName: "Original autumn campaign", promoName: "Original shop message",
      publishedAt: "2026-11-10T09:00:00.000Z", startsOn: "2026-11-01", endsOn: "2026-11-30", locationIds: ["shop-one"] },
    campaignId: "PRIVATE_CAMPAIGN_ID", actorUserId: "PRIVATE_ACTOR", campaignConfigurationHash: "PRIVATE_HASH" };
  f.data.snapshots.push({ organisationId: "org-one", offerId: "offer-one", revision: 2, terms: terms({title:"Linked issued coupon"}), campaignLink });
  f.data.claims.push(claim);
  f.data.receipts.push({ ...clone(f.data.receipts[0]), id: "receipt-linked", claimId: claim.id, occurredAt: new Date("2026-11-10T10:01:30Z") });
  return { claim, campaignLink };
}
const association = { campaignName: "Original autumn campaign", promoName: "Original shop message", campaignRevision: 7 };

test("claim and redemption reports use the issued version's association with editing disabled", async () => {
  const f = setup(); addLinkedClaim(f);
  f.env.RUVANAS_RETAIL_REWARDS_CAMPAIGNS_ENABLED = "false";
  f.env.RUVANAS_RETAIL_REWARDS_CAMPAIGN_LINKS_ENABLED = "false";
  f.data.offers[0].publishedRevision = 99;
  f.data.currentCampaign = { name: "PRIVATE_CURRENT_RENAME", status: "ARCHIVED", publicationRevision: 500 };
  const before = clone(f.data), claims = await f.service.report({ ...f.query, view: "CLAIMS" }), receipts = await f.service.report(f.query);
  assert.equal(claims.ok, true, JSON.stringify(claims)); assert.equal(claims.view, "CLAIMS"); assert.deepEqual(claims.receipts, []);
  assert.equal(receipts.view, "REDEMPTIONS"); assert.deepEqual(receipts.claims, []);
  assert.deepEqual(claims.claims.find(row => row.id === "claim-linked").campaignAssociation, association);
  assert.deepEqual(receipts.receipts.find(row => row.id === "receipt-linked").campaignAssociation, association);
  assert.equal(claims.claims.find(row => row.id === "claim-one").campaignAssociation, null);
  assert.equal(receipts.receipts.find(row => row.id === "receipt-one").campaignAssociation, null);
  assert.deepEqual(claims.summary, { issued: 2, successfulUses: 2, correctedUses: 0, netUses: 2 });
  assert.deepEqual(receipts.summary, claims.summary); assert.deepEqual(f.data, before);
  for (const forbidden of ["PRIVATE_", "campaignId", "campaignConfigurationHash", "actorUserId", "locationIds", "shopperId"])
    assert.ok(!JSON.stringify([claims, receipts]).includes(forbidden), forbidden);
});

test("corrected redemptions keep their original association and independent claim cohort", async () => {
  const f = setup(); const { claim, campaignLink } = addLinkedClaim(f);
  claim.createdAt = new Date("2026-11-09T10:00:30Z"); campaignLink.pinnedAt = new Date("2026-11-08T09:00:00Z");
  campaignLink.snapshot.publishedAt = "2026-11-08T08:00:00.000Z";
  f.query.fromDate = "2026-11-10"; f.query.toDate = "2026-11-10";
  f.data.reversals.push({ id: "correction-linked", organisationId: "org-one", redemptionId: "receipt-linked", occurredAt: new Date("2026-11-11T10:00:00Z"), reason: "WRONG_COUPON" });
  const receipts = await f.service.report(f.query), claims = await f.service.report({ ...f.query, view: "CLAIMS" });
  assert.equal(receipts.ok, true, JSON.stringify(receipts)); assert.deepEqual(receipts.summary, { issued: 1, successfulUses: 2, correctedUses: 1, netUses: 1 });
  const corrected = receipts.receipts.find(row => row.id === "receipt-linked");
  assert.equal(corrected.status, "CORRECTED"); assert.deepEqual(corrected.campaignAssociation, association);
  assert.equal(claims.totalRows, 1); assert.equal(claims.claims[0].campaignAssociation, null); assert.deepEqual(claims.summary, receipts.summary);
});

test("malformed, foreign, mismatched and missing association evidence fails closed in either view", async () => {
  const mutations = [
    p => { p.organisationId = "foreign"; }, p => { p.offerId = "other-offer"; }, p => { p.revision = 1; },
    p => { p.campaignPublicationRevision = 0; }, p => { p.campaignPublicationRevision = 2147483648; },
    p => { p.snapshot.schemaVersion = 2; }, p => { p.snapshot.campaignName = ""; }, p => { p.snapshot.promoName = "x".repeat(501); },
    p => { p.snapshot.locationIds = ["shop-two"]; }, p => { p.snapshot.locationIds.push("shop-two"); },
    p => { p.snapshot.locationIds.push("shop-one"); }, p => { p.snapshot.privateField = "private"; },
    p => { p.pinnedAt = new Date("2026-11-10T10:00:31Z"); }, p => { p.snapshot.publishedAt = "2026-11-10T10:00:00.000Z"; }
  ];
  for (const view of ["CLAIMS", "REDEMPTIONS"]) {
    for (const change of mutations) {
      const f = setup(), {campaignLink} = addLinkedClaim(f); change(campaignLink);
      assert.equal((await f.service.report({ ...f.query, view })).code, "UNAVAILABLE");
    }
    const f = setup(); addLinkedClaim(f); delete f.data.snapshots[1].campaignLink;
    assert.equal((await f.service.report({ ...f.query, view })).code, "UNAVAILABLE");
  }
});

test("claim details paginate and export separately while preserving whole-cohort totals", async () => {
  const f = setup(), row = f.data.claims[0];
  f.data.claims = Array.from({length:26}, (_, i) => ({...clone(row),id:`claim-${String(i).padStart(2,"0")}`}));
  f.data.receipts[0].claimId = f.data.claims[0].id;
  const first = await f.service.report({...f.query,view:"CLAIMS"});
  const second = await f.service.report({...f.query,view:"CLAIMS",page:2,asOf:first.asOf});
  const exported = await f.service.exportReport({...f.query,view:"CLAIMS",asOf:first.asOf});
  assert.equal(first.claims.length,25); assert.equal(second.claims.length,1); assert.equal(first.totalRows,26);
  assert.equal(first.hasMore,true); assert.equal(second.hasMore,false); assert.equal(exported.claims.length,26);
  assert.deepEqual(exported.receipts,[]); assert.deepEqual(first.summary,{issued:26,successfulUses:1,correctedUses:0,netUses:1});
  assert.equal(new Set([...first.claims,...second.claims].map(row=>row.id)).size,26);
  assert.deepEqual((await f.service.report({...f.query,view:"CLAIMS",page:3,asOf:first.asOf})).claims,[]);
});

test("VIEW_INSIGHTS expiring during the final independent EXPORT check cannot disclose results", async () => {
  for (const operation of ["locations", "report", "exportReport"]) {
    const f = setup(); addLinkedClaim(f); f.context.membership.role = f.context.memberships[0].role = "MANAGER";
    f.data.staff[0].capabilities = ["VIEW_INSIGHTS"]; f.data.staff[0].expiresAt = new Date(NOW.getTime()+50);
    f.data.staff.push({...clone(f.data.staff[0]),id:"export-valid",expiresAt:new Date(NOW.getTime()+10000),capabilities:["EXPORT"]});
    f.data.staff.push({...clone(f.data.staff[0]),id:"other-view-valid",locationId:"shop-two",expiresAt:new Date(NOW.getTime()+10000)});
    f.onAuth = count => { if(count===6) f.now = new Date(NOW.getTime()+100); };
    const before = clone(f.data), result = await f.service[operation](operation==="locations"?{}:{...f.query,view:"CLAIMS"});
    assert.equal(result.code,"FORBIDDEN",operation+JSON.stringify(result)); assert.deepEqual(f.data,before);
    assert.ok(!JSON.stringify(result).includes("Original autumn campaign"));
  }
});
