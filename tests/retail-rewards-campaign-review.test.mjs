import test from "node:test";
import assert from "node:assert/strict";
import { readCampaignReviewPolicy, campaignReviewQuerySchema } from "../lib/retail-rewards/campaign-review-contracts.mjs";
import { createRewardCampaignReviewService } from "../lib/retail-rewards/campaign-review-service.mjs";
import { createCampaignReviewHttp } from "../lib/retail-rewards/campaign-review-http.mjs";
import { safeCampaignReviewResult } from "../lib/retail-rewards/campaign-review-dtos.mjs";
import { campaignDatesOverlap, reviewCampaignInput } from "../lib/retail-rewards/campaign-review-adapter.mjs";
import { readFileSync } from "node:fs";
const origin = "https://www.ruvanas.com", env = { NODE_ENV: "production", RUVANAS_PUBLIC_URL: origin, RUVANAS_RETAIL_REWARDS_ENABLED: "true", RUVANAS_RETAIL_REWARDS_CAMPAIGNS_ENABLED: "true" };
const query = { offerId: "offer-one", revision: 1 };
const offer = { id: "offer-one", title: "Ten percent", revision: 1, startsAt: "2026-11-01T00:00:00.000Z", endsAt: "2026-12-01T00:00:00.000Z", shopCount: 1 };
const common = { ok: true, page: 1, hasMore: false, checkedAt: "2026-11-14T12:00:00.000Z", reviewOnly: true };
const offers = { ...common, offers: [offer] };
const review = { ...common, offer, campaigns: [{ id: "campaign-one", name: "November promotion", publicationRevision: 1,
  publishedAt: "2026-11-01T00:00:00.000Z", startsOn: "2026-11-01", endsOn: "2026-11-30", promoName: "Shop announcement" }] };
function request(data, options = {}) {
  const { path = "/api/retail-rewards/campaign-review/review", headers = {}, ...rest } = options;
  return new Request(origin + path, { method: data === undefined ? "GET" : "POST", ...rest,
    headers: { origin, ...(data === undefined ? {} : { "content-type": "application/json" }), ...headers },
    ...(data === undefined ? {} : { body: typeof data === "string" || data instanceof Uint8Array ? data : JSON.stringify(data) }) });
}
function setup(overrides = {}) {
  const calls = [], service = { offers: async () => structuredClone(offers), review: async () => structuredClone(review) };
  const http = createCampaignReviewHttp({ env,
    authorizeStaff: async () => { calls.push("auth"); return { ok: true, organisationId: "org-one", userId: "owner" }; },
    rateLimit: async () => { calls.push("limit"); return { allowed: true }; },
    loadService: async () => { calls.push("service"); return service; }, ...overrides }); return { http, service, calls };
}
test("campaign review strictly defaults off before all dependencies", async () => {
  const no = () => { throw new Error("must not be used"); };
  for (const flags of [{}, { ...env, RUVANAS_RETAIL_REWARDS_ENABLED: "false" }, { ...env, RUVANAS_RETAIL_REWARDS_CAMPAIGNS_ENABLED: true }, { ...env, RUVANAS_RETAIL_REWARDS_CAMPAIGNS_ENABLED: "TRUE" }]) {
    const svc = createRewardCampaignReviewService({ db: new Proxy({}, { get: no }), loadContext: no, clock: no, env: flags });
    assert.equal((await svc.offers()).code, "FEATURE_DISABLED"); assert.equal((await svc.review(query)).code, "FEATURE_DISABLED");
    const f = setup({ env: flags }); assert.equal((await f.http.offers(request())).status, 403); assert.deepEqual(f.calls, []);
  }
  assert.deepEqual(readCampaignReviewPolicy({ ...env, RUVANAS_RETAIL_REWARDS_CHECKOUT_ENABLED: "false" }), { enabled: true, valid: true });
});
test("strict revision/tenant contracts reject input before service access", async () => {
  const no = () => { throw new Error("must not be used"); };
  const svc = createRewardCampaignReviewService({ env, db: new Proxy({}, { get: no }), clock: no });
  for (const patch of [{ organisationId: "other" }, { revision: "1" }, { revision: 0 }, { locationIds: ["other"] }, { page: "01" }, { mediaUrl: origin }]) {
    assert.equal(campaignReviewQuerySchema.safeParse({ ...query, ...patch }).success, false);
    assert.equal((await svc.review({ ...query, ...patch })).code, "INVALID_REQUEST");
  }
});
test("method, origin and cross-site failures precede dependencies", async () => {
  const f = setup(); assert.equal((await f.http.offers(request(query))).status, 405); assert.equal((await f.http.review(request())).status, 405);
  for (const headers of [{ origin: "https://foreign.invalid" }, { origin: "null" }, { origin: "" }, { "sec-fetch-site": "cross-site" }])
    assert.equal((await f.http.review(request(query, { headers }))).status, 403);
  assert.equal((await f.http.offers(request(undefined, { headers: { "sec-fetch-site": "cross-site" } }))).status, 403);
  assert.equal((await f.http.review(request(query, { path: "/review?offerId=other" }))).status, 400); assert.deepEqual(f.calls, []);
});
test("query/body parsing rejects oversized UTF8, duplicate parameters and forged fields", async () => {
  const f = setup();
  for (const body of [{ ...query, organisationId: "other" }, { ...query, publishedConfigurationHash: "forged" }, "{bad", " ".repeat(8193), new Uint8Array([0xff])])
    assert.equal((await f.http.review(request(body))).status, 400);
  for (const headers of [{ "content-length": "8193" }, { "content-length": "NaN" }, { "content-type": "text/plain" }])
    assert.equal((await f.http.review(request(query, { headers }))).status, 400);
  assert.equal((await f.http.review(request(" ".repeat(8193), { headers: { "content-length": "1" } }))).status, 400);
  for (const suffix of ["?page=1&page=2", "?page=01", "?page=0", "?page=1001", "?organisationId=other"])
    assert.equal((await f.http.offers(request(undefined, { path: "/offers" + suffix }))).status, 400);
  assert.ok(!f.calls.includes("auth"));
});
test("authorization, principal throttling and dependency errors are sanitized", async () => {
  const f = setup({ authorizeStaff: async () => ({ ok: false, code: "FORBIDDEN", error: "private detail" }) });
  const denied = await f.http.review(request(query)); assert.equal(denied.status, 403); assert.ok(!(await denied.text()).includes("private detail")); assert.ok(!f.calls.includes("service"));
  for (const principalOnly of [false, true]) { const limited = setup({ rateLimit: async ({ principal }) => ({ allowed: principalOnly && !principal, retryAfterSeconds: 12 }) });
    const r = await limited.http.review(request(query)); assert.equal(r.status, 429); assert.equal(r.headers.get("retry-after"), "12"); assert.ok(!limited.calls.includes("service")); }
  const broken = setup({ loadService: async () => { throw new Error("private DB credentials"); } });
  assert.ok(!(await (await broken.http.review(request(query))).text()).includes("credentials"));
});
test("successful responses are private, uncached strict whitelists", async () => {
  const f = setup(); const r = await f.http.review(request(query)); assert.equal(r.status, 200); assert.deepEqual(await r.json(), review);
  assert.match(r.headers.get("cache-control"), /private.*no-store/); assert.equal(r.headers.get("vary"), "Cookie"); assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  assert.equal(r.headers.get("access-control-allow-origin"), null);
  for (const change of [r => r.hash = "secret", r => r.offer.draft = {}, r => r.campaigns[0].mediaUrl = origin,
    r => r.campaigns[0].startsOn = "2026-02-30", r => r.campaigns[0].publishedAt = "2027-01-01T00:00:00.000Z",
    r => r.offer.endsAt = r.checkedAt, r => r.campaigns.push({ ...r.campaigns[0] }), r => r.reviewOnly = false]) {
    const v = structuredClone(review); change(v); assert.equal(safeCampaignReviewResult("review", v), null);
    f.service.review = async () => v; assert.equal((await f.http.review(request(query))).status, 503);
  }
});
test("calendar overlap handles Malta DST and exclusive midnight end in every shop", () => {
  const row = { effectiveFrom: new Date("2026-10-26T00:00:00Z"), effectiveTo: new Date("2026-10-26T00:00:00Z") };
  const terms = { startsAt: "2026-10-24T22:00:00.000Z", endsAt: "2026-10-25T23:00:00.000Z" };
  assert.equal(campaignDatesOverlap(row, terms, [{ timezone: "Europe/Malta" }]), false);
  row.effectiveFrom = row.effectiveTo = new Date("2026-10-25T00:00:00Z");
  assert.equal(campaignDatesOverlap(row, terms, [{ timezone: "Europe/Malta" }]), true);
  assert.equal(campaignDatesOverlap(row, { startsAt: "2026-10-25T23:30:00Z", endsAt: "2026-10-25T23:59:00Z" }, [{ timezone: "UTC" }, { timezone: "Europe/Malta" }]), false);
  row.effectiveFrom = row.effectiveTo = new Date("2026-03-30T00:00:00Z");
  assert.equal(campaignDatesOverlap(row, { startsAt: "2026-03-28T23:00:00Z", endsAt: "2026-03-29T22:00:00Z" }, [{ timezone: "Europe/Malta" }]), false);
});
test("pure persisted projection matches the existing publisher, without its database import", () => {
  const source = readFileSync(new URL("../lib/campaign-service.js", import.meta.url), "utf8");
  const target = source.slice(source.indexOf("export function persistedTargetToInput"), source.indexOf("export async function loadCampaignTopology"));
  const reference = new Function(target.replaceAll("export function", "function") + "; return persistedCampaignToInput;")();
  const row = { organisationId: "org", promoVersionId: "promo", name: "Campaign", priority: "NORMAL", schedulingMode: "INTERVAL", mandatory: false,
    respectOpeningHours: true, effectiveFrom: new Date("2026-11-01"), effectiveTo: new Date("2026-12-01"), maxPromoMinutesPerHour: 12,
    minSamePromoGapMinutes: 15, minAnyPromoGapMinutes: 2, rule: { exactTimeHardStart: false, playsPerHour: null, intervalMinutes: 10 },
    targets: [{ targetType: "LOCATION", locationId: "shop" }], schedules: [{ weekday: 1, windowMode: "ALL_DAY", startMinute: null, endMinute: null, exactMinute: null, playsPerHour: null, intervalMinutes: 10 }] };
  assert.deepEqual(reviewCampaignInput(row), reference(row));
});
