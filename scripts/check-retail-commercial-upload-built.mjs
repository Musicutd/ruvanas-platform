// Local compiled-route acceptance: only generated two-second audio, in-memory
// database/storage substitutes, and denied network access. Never use real data.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import net from "node:net";
import http from "node:http";
import https from "node:https";
import { createHash } from "node:crypto";
import { createSyntheticWav, parseRouteChunkIds, guardedExecFile } from "./check-catalogue-upload-probe.mjs";
import { PREVIEW_TESTER_PLAN, previewTesterOverrides } from "../lib/private-preview-account-policy.mjs";
import { RETAIL_SUBSCRIBER_ORGANISATION_ID as ORG, RETAIL_SUBSCRIBER_STATION_ID as STATION } from "../lib/retail-subscriber-access.mjs";
import { retailCommercialUploadView } from "../lib/retail-commercial-upload-ui.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."), clone = structuredClone;
const sensitive = ["DATABASE_URL", "DIRECT_URL", "R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_ENDPOINT", "R2_BUCKET_NAME"];
const ADDRESS = "https://www.ruvanas.com/api/programming/test-retail/commercial-audio";
function fixture() {
  const expires = new Date(Date.now() + 86_400_000);
  const subscription = { organisationId: ORG, plan: clone(PREVIEW_TESTER_PLAN), status: "TRIAL", billingContract: null,
    currentPeriodEnd: expires, complimentaryAccessActive: false, schoolPublicPublishingEnabled: false, retailMediaEnabled: false,
    digitalSignageEnabled: false, ...previewTesterOverrides(["RETAIL"]) };
  const organisation = { id: ORG, subscription, enterpriseSecurityPolicy: null }, membership = { organisationId: ORG, role: "OWNER", organisation };
  const user = { id: "synthetic-retail-user", email: "retail@manuelchircop.com", role: "OWNER", memberships: [membership],
    privatePreviewAccess: { userId: "synthetic-retail-user", organisationId: ORG, pillars: ["RETAIL"], enabled: true, passwordEnabled: true, expiresAt: expires } };
  const session = { id: "synthetic-session", userId: user.id, user, authMethod: "PREVIEW_PASSWORD", activeOrganisationId: ORG, expiresAt: expires, revokedAt: null };
  const d = { context: { user, session, membership, memberships: [membership] }, media: new Map(), promos: new Map(), versions: new Map(), audits: new Map(),
    objects: new Map(), puts: 0, gets: 0, deletes: 0, queries: 0, next: 0 };
  const count = () => { d.queries++; };
  const validMedia = where => [...d.media.values()].filter(x => x.organisationId === where.organisationId && x.libraryType === where.libraryType && where.status.in.includes(x.status));
  const selectVersions = where => { assert.equal(where.promoAsset.organisationId, ORG); assert.equal(where.mediaAsset.organisationId, ORG);
    return [...d.versions.values()].filter(v => (!where.id || v.id === where.id) && (!where.mediaAssetId || v.mediaAssetId === where.mediaAssetId) &&
      (!where.sourceReference || v.sourceReference.startsWith(where.sourceReference.startsWith))).map(v => ({ ...clone(v),
        promoAsset: clone(d.promos.get(v.promoAssetId)), mediaAsset: clone(d.media.get(v.mediaAssetId)) })); };
  const db = {
    station: { findFirst: async ({ where }) => { count(); assert.deepEqual(where, { id: STATION, organisationId: ORG }); return {
      id: STATION, organisationId: ORG, productFamily: "RETAIL", status: "DRAFT", publicPlayerEnabled: false,
      stationWebsiteEnabled: false, listenerRequestsEnabled: false, audiencePolicy: "INTERNAL" }; } }, channel: { findMany: async () => { count(); return []; } },
    mediaAsset: { aggregate: async ({ where }) => { count(); return { _sum: { sizeBytes: validMedia(where).reduce((n, x) => n + x.sizeBytes, 0n) } }; },
      count: async ({ where }) => { count(); return validMedia(where).length; },
      findUnique: async ({ where }) => { count(); return clone([...d.media.values()].find(x => where.storageKey ? x.storageKey === where.storageKey : x.id === where.id) || null); },
      create: async ({ data }) => { count(); const row = { id: `media-${++d.next}`, createdAt: new Date(), updatedAt: new Date(), ...clone(data) }; d.media.set(row.id, row); return clone(row); },
      update: async ({ where, data }) => { count(); const row = { ...d.media.get(where.id), ...clone(data) }; d.media.set(row.id, row); return clone(row); } },
    promoAsset: { create: async ({ data }) => { count(); const row = { id: `promo-${++d.next}`, status: "ACTIVE", currentApprovedVersionId: null, ...clone(data) }; d.promos.set(row.id, row); return clone(row); },
      updateMany: async ({ where, data }) => { count(); assert.equal(where.organisationId, ORG); const row = d.promos.get(where.id);
        if (!row || row.currentApprovedVersionId !== where.currentApprovedVersionId) return { count: 0 }; Object.assign(row, clone(data)); return { count: 1 }; } },
    promoVersion: { findMany: async ({ where, take }) => { count(); return selectVersions(where).slice(0, take); },
      findFirst: async ({ where }) => { count(); return selectVersions(where)[0] || null; },
      create: async ({ data }) => { count(); const row = { id: `version-${++d.next}`, reviewedAt: null, reviewedById: null, updatedAt: new Date(), processingJobs: [], ...clone(data) }; d.versions.set(row.id, row); return clone(row); },
      updateMany: async ({ where, data }) => { count(); assert.equal(where.promoAsset.organisationId, ORG); assert.equal(where.mediaAsset.organisationId, ORG); const row = d.versions.get(where.id);
        if (!row || row.status !== where.status || row.qcStatus !== where.qcStatus || +row.updatedAt !== +where.updatedAt || row.reviewedAt !== where.reviewedAt || row.reviewedById !== where.reviewedById) return { count: 0 };
        Object.assign(row, clone(data)); return { count: 1 }; } },
    auditLog: { findUnique: async ({ where }) => { count(); return clone(d.audits.get(where.id) || null); },
      create: async ({ data }) => { count(); assert.equal(d.audits.has(data.id), false); const row = { createdAt: new Date(), ...clone(data) }; d.audits.set(data.id, row); return clone(row); } },
    $executeRaw: async (_sql, ...values) => { count(); assert.equal(values[0], `retail-commercial-upload:${ORG}`); return 1; },
    $transaction: async (operation, options) => { assert.equal(options.isolationLevel, "Serializable"); return operation(db); }
  };
  const r2 = { bucketName: "synthetic-private-retail", client: { send: async command => {
    const data = command.input; assert.equal(data.Bucket, "synthetic-private-retail");
    assert.match(data.Key, new RegExp(`^organisations/${ORG}/promos/announcement/[a-f0-9]{64}\\.wav$`));
    if (data.Body) { d.puts++; assert.equal(data.Body.length, 32_044); d.objects.set(data.Key, Buffer.from(data.Body)); }
    else if (data.Range) {
      d.gets++; const match = /^bytes=(\d+)-(\d+)$/.exec(data.Range); assert.ok(match);
      const bytes = d.objects.get(data.Key).subarray(Number(match[1]), Number(match[2]) + 1);
      return { ContentLength: bytes.length, Body: new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }) };
    }
    else { d.deletes++; d.objects.delete(data.Key); }
    return {};
  } } };
  return { d, db, r2 };
}
function uploadRequest(origin = "https://www.ruvanas.com", extra = {}) {
  const form = new FormData(); form.append("file", new Blob([createSyntheticWav()], { type: "audio/wav" }), "synthetic.wav");
  form.append("name", "Local synthetic test only"); form.append("mediaType", "ANNOUNCEMENT"); form.append("languageCode", "und");
  form.append("requestId", "31400821-cc19-4c1d-bd7a-c723b8d35415"); form.append("rightsConfirmed", "true");
  for (const [key, value] of Object.entries(extra)) form.append(key, value);
  return new Request(ADDRESS, { method: "POST", headers: { origin }, body: form });
}
async function main() {
  assert.equal(process.argv.includes("--local-synthetic-only"), true, "LOCAL_FLAG_REQUIRED");
  assert.equal(sensitive.some(name => Object.hasOwn(process.env, name)), false, "CLEAN_ENV_REQUIRED");
  assert.equal(globalThis.prisma, undefined, "CLEAN_GLOBAL_REQUIRED");
  const appRequire = createRequire(path.join(ROOT, "package.json")), server = path.join(ROOT, ".next/server");
  const routePath = path.join(server, "app/api/programming/test-retail/commercial-audio/route.js");
  const reviewPath = path.join(server, "app/api/programming/test-retail/commercial-audio/review/route.js");
  const previewPath = path.join(server, "app/api/programming/test-retail/commercial-audio/preview/route.js");
  const source = await readFile(routePath, "utf8"), ids = parseRouteChunkIds(source), runtime = appRequire(path.join(server, "webpack-runtime.js"));
  const reviewSource = await readFile(reviewPath, "utf8"), reviewIds = parseRouteChunkIds(reviewSource);
  const previewSource = await readFile(previewPath, "utf8"), previewIds = parseRouteChunkIds(previewSource);
  const previousX = runtime.X; runtime.X = () => ({});
  try { appRequire(routePath); appRequire(reviewPath); appRequire(previewPath); } finally { runtime.X = previousX; }
  for (const id of new Set([...ids, ...reviewIds, ...previewIds])) await runtime.e(id);
  const findModule = needle => { const matches = Object.entries(runtime.m).filter(([, factory]) => factory.toString().includes(needle));
    assert.equal(matches.length, 1, `MODULE_NOT_UNIQUE:${needle}`); return Number(matches[0][0]); };
  // Next minifies webpack export names. Locate the small boundary modules by
  // their implementation, then replace their exported functions before loading
  // the route; the compiled request, service and native audio-probe code remain.
  const authId = findModule('randomBytes(32).toString("hex")'), r2Id = findModule('"Cloudflare R2"');
  const entryId = findModule('pathname:"/api/programming/test-retail/commercial-audio"');
  const reviewEntryId = findModule('pathname:"/api/programming/test-retail/commercial-audio/review"');
  const previewEntryId = findModule('pathname:"/api/programming/test-retail/commercial-audio/preview"');
  const exportNames = id => {
    const body = runtime.m[id].toString().match(/\.d\([^,]+,\{([^}]+)\}\)/)?.[1];
    assert.ok(body, "COMPILED_EXPORTS_REQUIRED");
    const names = [...body.matchAll(/([\w$]+):\(\)=>/g)].map(match => match[1]);
    assert.ok(names.length > 0, "COMPILED_EXPORT_NAMES_REQUIRED");
    return names;
  };
  const authExports = exportNames(authId), r2Exports = exportNames(r2Id);
  const f = fixture();
  runtime.m[authId] = (module, exports, webpack) => { webpack.r(exports); webpack.d(exports,
    Object.fromEntries(authExports.map(name => [name, () => async () => f.d.context]))); };
  runtime.m[r2Id] = (module, exports, webpack) => { webpack.r(exports); webpack.d(exports,
    Object.fromEntries(r2Exports.map(name => [name, () => () => f.r2]))); };
  const childProcess = appRequire("node:child_process"), originalExec = childProcess.execFile;
  const original = { fetch: globalThis.fetch, connect: net.Socket.prototype.connect, httpRequest: http.request, httpGet: http.get,
    httpsRequest: https.request, httpsGet: https.get };
  let networkAttempts = 0; const probes = [], denyNetwork = () => { networkAttempts++; throw Error("NETWORK_FORBIDDEN"); };
  globalThis.prisma = f.db; globalThis.fetch = denyNetwork; net.Socket.prototype.connect = denyNetwork;
  http.request = denyNetwork; http.get = denyNetwork; https.request = denyNetwork; https.get = denyNetwork;
  childProcess.execFile = guardedExecFile(originalExec, file => probes.push(file));
  try {
    // Execute the already registered entry. Requiring the route file again
    // would register its embedded modules again and replace the R2 substitute.
    const loaded = runtime(entryId), handlers = loaded.routeModule.userland;
    assert.equal(typeof handlers.POST, "function"); assert.equal(typeof handlers.GET, "function");
    const initial = await handlers.GET(new Request(ADDRESS)); assert.equal(initial.status, 200, `GET: ${await initial.clone().text()}`); assert.match(initial.headers.get("cache-control"), /no-store/);
    assert.deepEqual(retailCommercialUploadView(await initial.json()).uploads, []);
    assert.equal((await handlers.POST(uploadRequest("https://foreign.invalid"))).status, 403);
    const allowedContext = f.d.context; f.d.context = null;
    assert.equal((await handlers.GET(new Request(ADDRESS))).status, 403);
    const deniedPost = uploadRequest(); assert.equal((await handlers.POST(deniedPost)).status, 403); assert.equal(deniedPost.bodyUsed, false);
    f.d.context = allowedContext;
    assert.equal((await handlers.POST(uploadRequest(undefined, { organisationId: "foreign" }))).status, 400);
    const uploaded = await handlers.POST(uploadRequest()); assert.equal(uploaded.status, 200, `POST: ${await uploaded.clone().text()}`);
    const body = await uploaded.json(), view = retailCommercialUploadView(body); assert.equal(view.uploads.length, 1);
    assert.equal(view.uploads[0].durationSeconds, 2); assert.equal(view.uploads[0].status, "IN_REVIEW"); assert.equal(view.uploads[0].qcStatus, "PENDING");
    assert.equal(view.playbackConnected, false); assert.equal(view.adminApprovalRequired, false); assert.equal(view.subscriberApprovalRequired, true);
    const repeated = await handlers.POST(uploadRequest()); assert.equal(repeated.status, 200); assert.equal((await repeated.json()).duplicate, true);
    const final = retailCommercialUploadView(await (await handlers.GET(new Request(ADDRESS))).json()); assert.equal(final.uploads.length, 1);
    assert.equal(f.d.puts, 1); assert.equal(f.d.deletes, 0); assert.equal(f.d.versions.size, 1); assert.equal(networkAttempts, 0);
    const native = appRequire("ffprobe-static").path; assert.equal(probes.length, 2); assert.ok(probes.every(p => p === native && existsSync(p)));
    assert.equal([...f.d.promos.values()][0].currentApprovedVersionId, null);
    const preview = runtime(previewEntryId).routeModule.userland;
    const previewUrl = `${ADDRESS}/preview?versionId=${final.uploads[0].id}`;
    f.d.context = null;
    assert.equal((await preview.GET(new Request(previewUrl))).status, 403); assert.equal(f.d.gets, 0);
    f.d.context = allowedContext;
    assert.equal((await preview.GET(new Request(previewUrl, { headers: { "sec-fetch-site": "cross-site" } }))).status, 403);
    const head = await preview.HEAD(new Request(previewUrl, { method: "HEAD" })); assert.equal(head.status, 200);
    assert.equal(head.body, null); assert.equal(head.headers.get("content-length"), "32044"); assert.equal(f.d.gets, 0);
    const listening = await preview.GET(new Request(previewUrl, { headers: { range: "bytes=0-15", "sec-fetch-site": "same-origin" } }));
    assert.equal(listening.status, 206); assert.match(listening.headers.get("cache-control"), /private, no-store/);
    assert.equal(listening.headers.get("cross-origin-resource-policy"), "same-origin"); assert.equal(listening.headers.has("location"), false);
    assert.deepEqual(Buffer.from(await listening.arrayBuffer()), createSyntheticWav().subarray(0, 16)); assert.equal(f.d.gets, 1);
    const review = runtime(reviewEntryId).routeModule.userland.POST;
    const reviewRequest = (details, origin = "https://www.ruvanas.com") => new Request(`${ADDRESS}/review`, { method: "POST",
      headers: { origin, "content-type": "application/json" }, body: JSON.stringify(details) });
    const decision = { versionId: final.uploads[0].id, decision: "APPROVE", rightsConfirmed: true };
    assert.equal((await review(reviewRequest(decision, "https://foreign.invalid"))).status, 403);
    assert.equal((await review(reviewRequest({ ...decision, rightsConfirmed: false }))).status, 400);
    f.d.context = null;
    const deniedReview = reviewRequest(decision); assert.equal((await review(deniedReview)).status, 403); assert.equal(deniedReview.bodyUsed, false);
    f.d.context = allowedContext;
    const reviewed = await review(reviewRequest(decision)); assert.equal(reviewed.status, 200, `REVIEW: ${await reviewed.clone().text()}`);
    const reviewBody = await reviewed.json(), approved = retailCommercialUploadView(reviewBody);
    assert.equal(reviewBody.reviewedId, decision.versionId); assert.equal(reviewBody.decision, "APPROVE");
    assert.equal(approved.uploads[0].status, "APPROVED"); assert.equal(approved.uploads[0].qcStatus, "PASSED");
    assert.equal([...f.d.promos.values()][0].currentApprovedVersionId, decision.versionId);
    const retried = await review(reviewRequest(decision)); assert.equal(retried.status, 200); assert.equal((await retried.json()).duplicate, true);
    assert.equal(f.d.puts, 1); assert.equal(f.d.deletes, 0); assert.equal(networkAttempts, 0);
    return { check: "RETAIL_COMMERCIAL_COMPILED_UPLOAD_ROUTE", status: "PASS", routeHandlersInvoked: true, syntheticAudioOnly: true,
      compiledRouteSha256: createHash("sha256").update(source).digest("hex"), buildId: (await readFile(path.join(ROOT, ".next/BUILD_ID"), "utf8")).trim(),
      getStatus: 200, postStatus: 200, measuredSeconds: 2, approvalStatus: "IN_REVIEW", qcStatus: "PENDING", duplicateDidNotUploadAgain: true,
      compiledReviewRouteSha256: createHash("sha256").update(reviewSource).digest("hex"), subscriberReviewStatus: 200,
      explicitSubscriberApproval: "APPROVED", explicitSubscriberQc: "PASSED", repeatedReviewIdempotent: true,
      compiledPreviewRouteSha256: createHash("sha256").update(previewSource).digest("hex"), privatePreviewHeadStatus: 200,
      privatePreviewRangeStatus: 206, privatePreviewDeniedBeforeStorage: true, privatePreviewSyntheticBytesVerified: true,
      networkAttempts, realDbQueries: 0, realR2Requests: 0, simulatedQueries: f.d.queries, simulatedR2Puts: f.d.puts,
      simulatedR2Gets: f.d.gets,
      ffprobeInvocations: probes.length, packagedFfprobeVerified: true, musicOrSettingsChanged: false };
  } finally {
    childProcess.execFile = originalExec; delete globalThis.prisma; globalThis.fetch = original.fetch; net.Socket.prototype.connect = original.connect;
    http.request = original.httpRequest; http.get = original.httpGet; https.request = original.httpsRequest; https.get = original.httpsGet;
  }
}
try { process.stdout.write(`${JSON.stringify(await main())}\n`); }
catch (error) { process.stdout.write(`${JSON.stringify({ check: "RETAIL_COMMERCIAL_COMPILED_UPLOAD_ROUTE", status: "FAIL", failure: error instanceof assert.AssertionError ? error.message : error?.code || "COMPILED_ROUTE_FAILED" })}\n`); process.exitCode = 1; }
