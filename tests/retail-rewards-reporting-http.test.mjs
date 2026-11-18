import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseString } from "@fast-csv/parse";
import { createReportingHttp } from "../lib/retail-rewards/reporting-http.mjs";
import { safeReportingResult } from "../lib/retail-rewards/reporting-dtos.mjs";
import { buildReportingCsv, REPORT_CSV_FILENAME, REPORT_CSV_HEADERS, CLAIMS_CSV_FILENAME, CLAIMS_CSV_HEADERS } from "../lib/retail-rewards/reporting-csv.mjs";

const origin = "https://www.ruvanas.com", env = { NODE_ENV: "production", RUVANAS_PUBLIC_URL: origin,
  RUVANAS_RETAIL_REWARDS_ENABLED: "true", RUVANAS_RETAIL_REWARDS_REPORTS_ENABLED: "true" };
const query = { locationId: "shop-A", fromDate: "2026-11-13", toDate: "2026-11-14" };
function report() { return { ok: true, view: "REDEMPTIONS", claims: [], location: { id: "shop-A", name: "Shop A" },
  filters: { fromDate: query.fromDate, toDate: query.toDate, timezone: "Europe/Malta" },
  window: { fromInclusive: "2026-11-12T23:00:00.000Z", toExclusive: "2026-11-14T23:00:00.000Z" },
  asOf: "2026-11-14T10:00:00.000Z", checkedAt: "2026-11-14T10:00:02.000Z",
  summary: { issued: 7, successfulUses: 2, correctedUses: 1, netUses: 1 },
  receipts: [
    { id: "receipt-2", redeemedAt: "2026-11-14T09:00:00.000Z", offerTitle: "Ten percent", revision: 1, shopName: "Shop A", campaignAssociation: null, status: "REDEEMED", correction: null },
    { id: "receipt-1", redeemedAt: "2026-11-13T09:00:00.000Z", offerTitle: "Old offer", revision: 2, shopName: "Old shop name", campaignAssociation: null, status: "CORRECTED",
      correction: { reversedAt: "2026-11-14T09:30:00.000Z", reason: "WRONG_COUPON" } }
  ], page: 1, hasMore: false, totalRows: 2, exportAllowed: true }; }
const locations = { ok: true, locations: [{ id: "shop-A", name: "Shop A", canExport: true }], page: 1, hasMore: false,
  defaults: { fromDate: "2026-11-08", toDate: "2026-11-14" }, bounds: { earliestDate: "2026-10-16", latestDate: "2026-11-14", maxRangeDays: 31 },
  timezone: "Europe/Malta", checkedAt: "2026-11-14T10:00:00.000Z" };
function request(data, options = {}) {
  const { path = "/api/retail-rewards/reports/query", headers = {}, ...rest } = options;
  return new Request(origin + path, { method: data === undefined ? "GET" : "POST", ...rest,
    headers: { origin, ...(data === undefined ? {} : { "content-type": "application/json" }), ...headers },
    ...(data === undefined ? {} : { body: typeof data === "string" || data instanceof Uint8Array ? data : JSON.stringify(data) }) });
}
function fixture(overrides = {}) {
  const calls = [], service = { locations: async () => locations, report: async () => report(), exportReport: async () => report() };
  const http = createReportingHttp({ env,
    authorizeStaff: async (op, id) => { calls.push(["auth", op, id]); return { ok: true, organisationId: "org-A", userId: "staff-A" }; },
    rateLimit: async ({ operation, principal }) => { calls.push(["limit", operation, principal]); return { allowed: true }; },
    loadService: async () => { calls.push(["service"]); return service; }, ...overrides });
  return { calls, service, http };
}
const csvRows = text => new Promise((resolve, reject) => { const rows = []; parseString(text, { headers: true }).on("error", reject).on("data", row => rows.push(row)).on("end", () => resolve(rows)); });

test("reports are disabled before bodies, authentication, rate limits or database dependencies", async () => {
  for (const flags of [{}, { ...env, RUVANAS_RETAIL_REWARDS_ENABLED: "false" }, { ...env, RUVANAS_RETAIL_REWARDS_REPORTS_ENABLED: "TRUE" }]) {
    const f = fixture({ env: flags });
    for (const op of ["locations", "report", "exportReport"]) {
      const result = await f.http[op](request()); assert.equal(result.status, 403);
      assert.match(result.headers.get("cache-control"), /private.*no-store/);
    }
    assert.deepEqual(f.calls, []);
  }
});
test("method, foreign origin, cross-site request and query smuggling fail before dependencies", async () => {
  const f = fixture();
  assert.equal((await f.http.locations(request(query))).status, 405);
  assert.equal((await f.http.locations(request(undefined, { headers: { "sec-fetch-site": "cross-site" } }))).status, 403);
  for (const op of ["report", "exportReport"]) {
    assert.equal((await f.http[op](request())).status, 405);
    for (const headers of [{ origin: "https://foreign.invalid" }, { origin: "null" }, { origin: "" }, { "sec-fetch-site": "cross-site" }])
      assert.equal((await f.http[op](request(query, { headers }))).status, 403);
    assert.equal((await f.http[op](request(query, { path: "/reports?locationId=other" }))).status, 400);
  }
  assert.deepEqual(f.calls, []);
});
test("bounded strict inputs reject forged tenants, identities, dates, output columns and body tricks", async () => {
  const f = fixture();
  for (const body of [{ ...query, organisationId: "other" }, { ...query, shopperId: "other" }, { ...query, columns: ["email"] },
    { ...query, fromDate: "2026-02-30" }, { ...query, asOf: "2026-11-14T10:00:00Z" }, "{broken", " ".repeat(8193), new Uint8Array([0xff])])
    assert.equal((await f.http.report(request(body))).status, 400);
  for (const headers of [{ "content-length": "8193" }, { "content-length": "NaN" }, { "content-type": "text/plain" }])
    assert.equal((await f.http.report(request(query, { headers }))).status, 400);
  assert.equal((await f.http.report(request(" ".repeat(8193), { headers: { "content-length": "1" } }))).status, 400);
  assert.equal((await f.http.exportReport(request({ ...query, page: 2 }))).status, 400);
  assert.ok(!f.calls.some(([name]) => ["auth", "service"].includes(name)));
});
test("locations only accept one canonical bounded page", async () => {
  const f = fixture();
  for (const suffix of ["?page=1&page=2", "?page=01", "?page=0", "?page=1001", "?page=-1", "?page=1.5", "?token=private", "?organisationId=other"])
    assert.equal((await f.http.locations(request(undefined, { path: "/locations" + suffix }))).status, 400);
  assert.ok(!f.calls.some(([name]) => name === "auth"));
  assert.equal((await f.http.locations(request(undefined, { path: "/locations?page=1" }))).status, 200);
});
test("export and reports retain independent authority with private no-store responses", async () => {
  const f = fixture({ authorizeStaff: async operation => operation === "exportReport" ? { ok: false, code: "FORBIDDEN", error: "secret" } : { ok: true, organisationId: "org-A", userId: "staff-A" } });
  assert.equal((await f.http.exportReport(request(query))).status, 403); assert.ok(!f.calls.some(([name]) => name === "service"));
  const response = await f.http.report(request(query)); assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /private.*no-store/); assert.equal(response.headers.get("vary"), "Cookie");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff"); assert.equal(response.headers.get("access-control-allow-origin"), null);
  assert.deepEqual(await response.json(), report());
});
test("IP and current-principal throttles run before the expensive service", async () => {
  for (const principalOnly of [false, true]) {
    const f = fixture({ rateLimit: async ({ principal }) => ({ allowed: principalOnly && !principal, retryAfterSeconds: 12 }) });
    const response = await f.http.report(request(query)); assert.equal(response.status, 429); assert.equal(response.headers.get("retry-after"), "12");
    assert.ok(!f.calls.some(([name]) => name === "service"));
  }
});
test("strict response whitelist fails closed on private joins, malformed summaries or incomplete export", async () => {
  assert.ok(safeReportingResult("report", report())); assert.ok(safeReportingResult("exportReport", report()));
  for (const mutate of [r => { r.shopperId = "private"; }, r => { r.receipts[0].email = "private"; },
    r => { r.receipts[1].correction.actorUserId = "private"; }, r => { r.summary.netUses = 2; }, r => { r.totalRows = 3; },
    r => { r.window.fromInclusive = "2026-11-12T00:00:00.000Z"; }, r => { r.receipts[0].redeemedAt = r.window.toExclusive; },
    r => { r.receipts[0].correction = { reversedAt: r.asOf, reason: "WRONG_COUPON" }; }, r => { r.receipts[1].correction.reversedAt = "2026-11-15T00:00:00.000Z"; },
    r => { r.receipts[1].id = r.receipts[0].id; }, r => { r.hasMore = true; }, r => { r.checkedAt = "2026-11-14T10:16:00.000Z"; }]) {
    const r = report(); mutate(r); assert.equal(safeReportingResult("report", r), null);
    const f = fixture(); f.service.report = async () => r; assert.equal((await f.http.report(request(query))).status, 503);
  }
  const deniedExport = report(); deniedExport.exportAllowed = false; assert.equal(buildReportingCsv(deniedExport), null);
  const partial = report(); partial.receipts.pop(); assert.equal(buildReportingCsv(partial), null);
  assert.equal(safeReportingResult("locations", { ...locations, token: "private" }), null);
});
test("CSV round trips hostile fields through an independent parser without formulas or private data", async () => {
  const r = report(); r.receipts[0].offerTitle = '\t=HYPERLINK("https://foreign.invalid","click")';
  r.receipts[0].shopName = '\uFEFF +SUM(1,2)'; r.receipts[1].offerTitle = 'Quoted "offer", with\nnewline\u0000';
  const csv = buildReportingCsv(r), rows = await csvRows(csv);
  assert.equal(rows.length, 2); assert.deepEqual(Object.keys(rows[0]), REPORT_CSV_HEADERS);
  assert.equal(rows[0].offer, '\' =HYPERLINK("https://foreign.invalid","click")'); assert.ok(rows[0].shop.startsWith("'"));
  assert.equal(rows[1].offer, 'Quoted "offer", with newline ');
  assert.equal(rows[1].correction_reason, "WRONG_COUPON"); assert.ok(!csv.includes("\u0000"));
  for (const prefix of ["=", "+", "-", "@", "\r=", "\n@", " \t+"]) { const v = report(); v.receipts[0].offerTitle = prefix + "test";
    assert.ok((await csvRows(buildReportingCsv(v)))[0].offer.startsWith("'")); }
});
test("CSV download has fixed filename, complete scoped rows and no JSON fallback", async () => {
  const f = fixture(), response = await f.http.exportReport(request(query));
  assert.equal(response.status, 200); assert.equal(response.headers.get("content-type"), "text/csv; charset=utf-8");
  assert.equal(response.headers.get("content-disposition"), `attachment; filename="${REPORT_CSV_FILENAME}"`);
  assert.match(response.headers.get("cache-control"), /private.*no-store/); assert.equal((await csvRows(await response.text())).length, 2);
  assert.ok(f.calls.some(([name, op, id]) => name === "auth" && op === "exportReport" && id === "shop-A"));
});
test("exceptions and unknown failure codes reveal no diagnostics or secrets", async () => {
  const f = fixture();
  for (const result of [{ ok: false, code: "SQL_DETAILS", error: "private", rows: ["private"] }, null, { ok: true, ...report(), token: "private" }]) {
    f.service.report = async () => result; const response = await f.http.report(request(query));
    assert.equal(response.status, 503); assert.ok(!(await response.text()).includes("private"));
  }
  f.service.report = async () => { throw new Error("database secret"); };
  assert.ok(!(await (await f.http.report(request(query))).text()).includes("secret"));
});
test("reports navigation is independent of offer editing and checkout flags; page fails closed", () => {
  const read = file => readFileSync(new URL("../" + file, import.meta.url), "utf8");
  const home = read("app/dashboard/retail/page.js"), offers = read("app/dashboard/retail/rewards/page.js"), page = read("app/dashboard/retail/rewards/reports/page.js");
  assert.match(home, /if \(readReportsPolicy\(process\.env\)\.enabled\)/); assert.match(home, /rewardsAvailable \|\| reportsAvailable/);
  assert.ok(offers.indexOf("authorizeRewardReports") < offers.indexOf("if (!result.ok)")); assert.match(offers, /<p>\{reportsLink\}<\/p>/);
  assert.ok(page.indexOf("notFound();") < page.indexOf('await import("@/lib/retail-rewards/reporting-server")'));
});
function claimsReport() {
  const r=report();r.view="CLAIMS";r.summary.issued=2;
  r.claims=r.receipts.map((row,i)=>({id:`claim-${i+1}`,issuedAt:row.redeemedAt,offerTitle:row.offerTitle,revision:row.revision,shopName:row.shopName,
    campaignAssociation:i===0?{campaignName:"Autumn promotion",promoName:"Shop message",campaignRevision:3}:null}));
  r.receipts=[];return r;
}

test("claim reports and exports use strict selected-cohort DTOs and filenames", async () => {
  const r=claimsReport();assert.ok(safeReportingResult("report",r));assert.ok(safeReportingResult("exportReport",r));
  const f=fixture();f.service.report=async()=>r;f.service.exportReport=async()=>r;
  const response=await f.http.report(request({...query,view:"CLAIMS"}));assert.equal(response.status,200);assert.deepEqual(await response.json(),r);
  const exported=await f.http.exportReport(request({...query,view:"CLAIMS"}));assert.equal(exported.status,200);
  assert.equal(exported.headers.get("content-disposition"),`attachment; filename="${CLAIMS_CSV_FILENAME}"`);
  const rows=await csvRows(await exported.text());assert.equal(rows.length,2);assert.deepEqual(Object.keys(rows[0]),CLAIMS_CSV_HEADERS);
  assert.equal(rows[0].campaign,"Autumn promotion");assert.equal(rows[0].campaign_revision,"3");assert.equal(rows[0].promotion,"Shop message");
  assert.equal(rows[1].campaign,"");assert.equal(rows[1].campaign_revision,"");assert.equal(rows[1].promotion,"");
  assert.equal((await f.http.report(request(query))).status,503,"A claims response cannot satisfy a redemption request");
  assert.equal((await f.http.exportReport(request(query))).status,503);
});

test("invalid report views and forged campaign filters are rejected before authentication", async () => {
  const f=fixture();
  for(const view of [null,"claims","ALL",0,{},["CLAIMS"]])assert.equal((await f.http.report(request({...query,view}))).status,400);
  for(const patch of [{campaignId:"foreign"},{campaignName:"private"},{revision:5},{view:"CLAIMS",campaignAssociation:null}])
    assert.equal((await f.http.exportReport(request({...query,...patch}))).status,400);
  assert.ok(!f.calls.some(([name])=>name==="auth"));
});

test("strict claim association DTO rejects private fields, absent associations and mixed cohorts", () => {
  for(const mutate of [
    r=>{r.claims[0].shopperId="private";},r=>{r.claims[0].campaignAssociation.campaignId="private";},
    r=>{r.claims[0].campaignAssociation.campaignConfigurationHash="private";},r=>{r.claims[0].campaignAssociation.locationIds=["other"];},
    r=>{r.claims[0].campaignAssociation.campaignRevision=0;},r=>{r.claims[0].campaignAssociation.campaignName="";},
    r=>{r.claims[0].campaignAssociation.promoName="x".repeat(501);},r=>{delete r.claims[0].campaignAssociation;},
    r=>{r.claims[0].issuedAt=r.window.toExclusive;},r=>{r.claims[1].id=r.claims[0].id;},
    r=>{r.totalRows=1;},r=>{r.receipts=report().receipts;},r=>{r.summary.issued=3;},r=>{r.view="REDEMPTIONS";}
  ]) {const r=claimsReport();mutate(r);assert.equal(safeReportingResult("report",r),null);assert.equal(buildReportingCsv(r),null);}
  for(const mutate of [r=>{delete r.receipts[0].campaignAssociation;},r=>{r.receipts[0].campaignAssociation={campaignName:"a",promoName:"b",campaignRevision:2,actorUserId:"private"};}]) {
    const r=report();mutate(r);assert.equal(safeReportingResult("report",r),null);
  }
  const partial=claimsReport();partial.claims.pop();assert.equal(buildReportingCsv(partial),null);
});

test("campaign names and promotion labels are formula-neutralised in both CSV views", async () => {
  for(const view of ["CLAIMS","REDEMPTIONS"]){
    const r=view==="CLAIMS"?claimsReport():report(), rows=view==="CLAIMS"?r.claims:r.receipts;
    rows[0].campaignAssociation={campaignName:'\t=HYPERLINK("https://foreign.invalid","click")',promoName:'\uFEFF +SUM(1,2)\n"quoted"',campaignRevision:3};
    const decoded=await csvRows(buildReportingCsv(r));
    assert.equal(decoded[0].campaign,'\' =HYPERLINK("https://foreign.invalid","click")');assert.ok(decoded[0].promotion.startsWith("'"));
    assert.ok(decoded[0].promotion.includes(' "quoted"'));assert.equal(decoded[0].campaign_revision,"3");
    assert.equal(decoded[1].campaign,"");assert.equal(decoded[1].promotion,"");
    for(const text of ["=","+","-","@","\r=","\n@"," \t+"]){rows[0].campaignAssociation.campaignName=text+"test";assert.ok((await csvRows(buildReportingCsv(r)))[0].campaign.startsWith("'"));}
  }
});
