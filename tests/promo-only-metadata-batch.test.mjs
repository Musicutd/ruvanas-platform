import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchPromoOnlyMetadataBatch, readPromoOnlyMetadataBatchConfig } from "../lib/promo-only-metadata-batch.mjs";

const NOW = Date.parse("2026-10-14T12:00:00.000Z");
const DAY = "2026-10-10";
const DAY_TS = Date.parse(`${DAY}T00:00:00.000Z`) / 1000;
const env = Object.freeze({
  PROMOONLY_METADATA_SAMPLE_ENABLED: "true", RUVANAS_ENVIRONMENT: "PRIVATE_PREVIEW",
  RUVANAS_PRIVATE_PREVIEW_ENABLED: "1", RUVANAS_PUBLIC_URL: "https://ruvanas-platform.onrender.com",
  RENDER_SERVICE_ID: "srv-da03b5lbedkc739q74k0",
  DATABASE_URL: "postgresql://fixture:fixture@dpg-db5kurijnfac73arripg-a/ruvanas_private_preview_20261011",
  PROMOONLY_ENABLED: "false", PROMOONLY_MODE: "OFF", PROMOONLY_AUDIO_DOWNLOAD_ENABLED: "false",
  PROMOONLY_AUDIO_SAMPLE_ENABLED: "false", PROMOONLY_ALLOW_HTTP_MEDIA_TEST: "false",
  PROMOONLY_USER_ID: "42", PROMOONLY_API_KEY: "fixture-key", PROMOONLY_API_SECRET: "fixture-secret"
});

function fixtures(count = 3) {
  const ids = Array.from({ length: count }, (_, index) => 91 + index);
  return [
    { token: "fixture-token", expires: Math.floor(NOW / 1000) + 300 },
    [{ date: DAY, ts: DAY_TS, releases: [{ id: 54, type: 1 }, { id: 55, type: 2 }, { id: 56, type: 2 }] }],
    { id: 55, date: DAY, release: "Synthetic release", tracks: ids.map((trackid) => ({ trackid, media_type: 2 })) },
    ...ids.slice(0, 25).map((id) => ({ id, releaseid: 55, media_type: 2, title: `Synthetic track ${id}`,
      artist: "Synthetic artist", genre: "Pop", media: "mp3,m4a", release_date: DAY, modified: DAY_TS + 36_000 }))
  ];
}
function mockFetch(payloads, calls) {
  return async (input, options) => {
    calls.push({ url: String(input), method: options.method, redirect: options.redirect, signal: options.signal });
    const payload = payloads[calls.length - 1];
    return payload instanceof Response ? payload : new Response(JSON.stringify(payload), { headers: { "content-type": "application/json" } });
  };
}
function readyConfig(changes = {}) {
  const config = readPromoOnlyMetadataBatchConfig({ ...env, ...changes });
  assert.equal(config.ready, true);
  return config;
}
async function rejectsPayload(payloads, code, count) {
  const calls = [];
  await assert.rejects(fetchPromoOnlyMetadataBatch(readyConfig(), { fetchImpl: mockFetch(payloads, calls), now: NOW }), { code, requestCount: count });
  assert.equal(calls.length, count);
  return calls;
}

test("manual batch config is sealed, credential-safe and hard-capped", () => {
  const config = readyConfig();
  assert.equal(Object.isFrozen(config), true);
  assert.equal(config.maxTracks, 25);
  assert.equal(config.maxRequests, 28);
  assert.equal(config.totalTimeoutMs, 90_000);
  assert.equal(config.retryMax, 0);
  assert.equal(config.manualOnly, true);
  assert.equal(config.audioDownloadEnabled, false);
  assert.equal(config.autoCreateGenres, false);
  for (const secret of [env.PROMOONLY_USER_ID, env.PROMOONLY_API_KEY, env.PROMOONLY_API_SECRET]) assert.equal(JSON.stringify(config).includes(secret), false);
});

test("all preview/database/normal-sync/audio ON or ambiguous gates fail before any request", async () => {
  for (const changes of [
    { PROMOONLY_METADATA_SAMPLE_ENABLED: "false" }, { PROMOONLY_METADATA_SAMPLE_ENABLED: "TRUE" },
    { RUVANAS_ENVIRONMENT: "PRODUCTION" }, { RUVANAS_PRIVATE_PREVIEW_ENABLED: "0" },
    { RUVANAS_PUBLIC_URL: "https://www.ruvanas.com" }, { RENDER_SERVICE_ID: "srv-other" },
    { RUVANAS_PUBLIC_URL: "https://ruvanas-private-preview-20261011.onrender.com" },
    { DATABASE_URL: "postgresql://fixture:fixture@original/original" },
    { DATABASE_URL: `${env.DATABASE_URL}?schema=public` }, { DATABASE_URL: `${env.DATABASE_URL}#` },
    { PROMOONLY_ENABLED: "true" }, { PROMOONLY_MODE: "METADATA" },
    { PROMOONLY_AUDIO_DOWNLOAD_ENABLED: "true" }, { PROMOONLY_ALLOW_HTTP_MEDIA_TEST: "true" },
    { PROMOONLY_AUDIO_SAMPLE_ENABLED: "true" }, { PROMOONLY_AUDIO_SAMPLE_ENABLED: "FALSE" },
    { PROMOONLY_AUDIO_SAMPLE_ENABLED: undefined }, { PROMOONLY_USER_ID: "0" },
    { PROMOONLY_API_SECRET: "" }, { PROMOONLY_API_KEY: "invalid:key" }
  ]) {
    const config = readPromoOnlyMetadataBatchConfig({ ...env, ...changes });
    assert.equal(config.ready, false);
    let calls = 0;
    await assert.rejects(fetchPromoOnlyMetadataBatch(config, { fetchImpl: () => { calls += 1; } }), { code: "PROMOONLY_BATCH_NOT_READY", requestCount: 0 });
    assert.equal(calls, 0);
  }
  for (const config of [{ ...readyConfig() }, Object.create(readyConfig())]) {
    await assert.rejects(fetchPromoOnlyMetadataBatch(config, { fetchImpl: () => assert.fail("must not fetch") }), { code: "PROMOONLY_BATCH_NOT_READY" });
  }
});

test("exact old-preview pair and optional single DB connection limit remain valid", () => {
  assert.equal(readyConfig({ RUVANAS_PUBLIC_URL: "https://ruvanas-private-preview-20261011.onrender.com", RENDER_SERVICE_ID: "srv-db5l9d7lk1mc73ad8v7g" }).ready, true);
  assert.equal(readyConfig({ DATABASE_URL: `${env.DATABASE_URL}?connection_limit=3` }).ready, true);
});

test("www metadata batches inherit the explicit same-domain paid-host guard without enabling downloads", async () => {
  const publicEnvironment = { ...env,
    NODE_ENV: "production",
    RUVANAS_PUBLIC_URL: "https://www.ruvanas.com", RUVANAS_PRIVATE_PREVIEW_PUBLIC_SITE: "1",
    RUVANAS_PRIVATE_PREVIEW_ADMIN_EMAIL: "owner@example.test",
    RUVANAS_PRIVATE_PREVIEW_ALLOWED_EMAILS: "owner@example.test"
  };
  const config = readPromoOnlyMetadataBatchConfig(publicEnvironment);
  assert.equal(config.ready, true);
  assert.equal(config.maxTracks, 25);
  assert.equal(config.maxRequests, 28);
  assert.equal(config.audioDownloadEnabled, false);
  const calls = [];
  await fetchPromoOnlyMetadataBatch(config, { fetchImpl: mockFetch(fixtures(2), calls), now: NOW });
  assert.equal(calls.length, 5);
  assert.ok(calls.every(({ url }) => !/queue|download|acknowledge/i.test(url)));
  for (const changes of [{ RUVANAS_PRIVATE_PREVIEW_PUBLIC_SITE: undefined },
    { RUVANAS_PRIVATE_PREVIEW_ADMIN_EMAIL: "outside@example.test" },
    { RENDER_SERVICE_ID: "srv-other" }, { PROMOONLY_AUDIO_SAMPLE_ENABLED: "true" },
    { PROMOONLY_AUDIO_DOWNLOAD_ENABLED: "true" }]) {
    assert.equal(readPromoOnlyMetadataBatchConfig({ ...publicEnvironment, ...changes }).ready, false);
  }
});

test("one audio release uses only auth, first date page, selected release and ordered track reads", async () => {
  const calls = [];
  const result = await fetchPromoOnlyMetadataBatch(readyConfig(), { fetchImpl: mockFetch(fixtures(), calls), now: () => NOW });
  assert.deepEqual(calls.map(({ method, url }) => [method, url]), [
    ["POST", "https://api.promoonly.com/user/authenticate"], ["GET", "https://api.promoonly.com/releases/date/1"],
    ["GET", "https://api.promoonly.com/release/55"], ["GET", "https://api.promoonly.com/track/91"],
    ["GET", "https://api.promoonly.com/track/92"], ["GET", "https://api.promoonly.com/track/93"]
  ]);
  assert.ok(calls.every((call) => call.redirect === "error" && call.signal instanceof AbortSignal));
  assert.equal(result.requestCount, 6);
  assert.equal(result.releaseCount, 3);
  assert.equal(result.selectedReleaseId, "55");
  assert.equal(result.truncatedCount, 0);
  assert.deepEqual(result.metadata.map((track) => track.externalTrackId), ["91", "92", "93"]);
  for (const track of result.metadata) {
    assert.equal(track.externalReleaseId, "55");
    assert.equal(track.mediaType, "2");
    assert.equal(track.sourceGenre, "Pop");
    assert.deepEqual(track.audioFormats, ["mp3", "m4a"]);
    assert.equal(track.releaseDate.toISOString().slice(0, 10), DAY);
    for (const field of ["rights", "territories", "licenceWindow", "supplierTierEntitlement", "offlineCachingPermission"]) assert.ok(track.unsupportedFields.includes(field));
    for (const field of ["permittedTerritories", "permittedUses", "minimumCatalogueLevel", "licenceStartsAt", "licenceExpiresAt"]) assert.equal(Object.hasOwn(track, field), false);
  }
  assert.ok(calls.every((call) => !/downloads|download\/|formats|servers|tracks\/date\/2|releases\/date\/2/.test(call.url)));
  for (const secret of [env.PROMOONLY_API_KEY, env.PROMOONLY_API_SECRET, "fixture-token"]) assert.equal(JSON.stringify(result).includes(secret), false);
});

test("release over 25 tracks is visibly truncated and makes no more than 28 requests", async () => {
  const calls = [];
  const result = await fetchPromoOnlyMetadataBatch(readyConfig(), { fetchImpl: mockFetch(fixtures(30), calls), now: NOW });
  assert.equal(result.metadata.length, 25);
  assert.equal(result.truncatedCount, 5);
  assert.equal(result.requestCount, 28);
  assert.equal(calls.length, 28);
  assert.equal(calls.at(-1).url, "https://api.promoonly.com/track/115");
});

test("empty/no-audio/malformed/duplicate first page rejects before release reads or pagination", async () => {
  const malformed = [
    [[], "PROMOONLY_BATCH_EMPTY_RELEASE_LIST"],
    [[{ date: DAY, ts: DAY_TS, releases: [{ id: 55, type: 1 }] }], "PROMOONLY_BATCH_NO_AUDIO_RELEASE"],
    [{ releases: [] }, "PROMOONLY_BATCH_LIST_SCHEMA"],
    [[{ date: "2026-02-30", ts: DAY_TS, releases: [] }], "PROMOONLY_BATCH_LIST_SCHEMA"],
    [[{ date: DAY, ts: DAY_TS - 86_400, releases: [] }], "PROMOONLY_BATCH_LIST_SCHEMA"],
    [[{ date: DAY, ts: DAY_TS, releases: [{ id: "../../downloads", type: 2 }] }], "PROMOONLY_BATCH_LIST_SCHEMA"],
    [[{ date: DAY, ts: DAY_TS, releases: [{ id: 55, type: "2" }] }], "PROMOONLY_BATCH_LIST_SCHEMA"],
    [[{ date: DAY, ts: DAY_TS, releases: [{ id: 55, type: 2, media_type: 1 }] }], "PROMOONLY_BATCH_LIST_SCHEMA"],
    [[{ date: DAY, ts: DAY_TS, releases: [{ id: 55, type: 2 }, { id: 55, type: 2 }] }], "PROMOONLY_BATCH_DUPLICATE_RELEASE"],
    [[{ date: DAY, ts: DAY_TS, releases: Array.from({ length: 501 }, (_, index) => ({ id: index + 1, type: 2 })) }], "PROMOONLY_BATCH_LIST_SCHEMA"]
  ];
  for (const [list, code] of malformed) {
    const payloads = fixtures(); payloads[1] = list;
    await rejectsPayload(payloads, code, 2);
  }
});

test("release mismatch, malformed IDs, duplicates (including past the cap) and non-audio reject before track requests", async () => {
  for (const [release, code] of [
    [{ ...fixtures()[2], id: 56 }, "PROMOONLY_BATCH_RELEASE_ID_MISMATCH"],
    [{ ...fixtures()[2], tracks: [] }, "PROMOONLY_BATCH_EMPTY_RELEASE_TRACKS"],
    [{ ...fixtures()[2], tracks: Array.from({ length: 501 }, (_, index) => ({ trackid: index + 1, media_type: 2 })) }, "PROMOONLY_BATCH_RELEASE_SCHEMA"],
    [{ ...fixtures()[2], tracks: [{ trackid: "../../queue", media_type: 2 }] }, "PROMOONLY_BATCH_RELEASE_SCHEMA"],
    [{ ...fixtures()[2], tracks: [{ trackid: 91, media_type: 2, releaseid: 56 }] }, "PROMOONLY_BATCH_RELEASE_SCHEMA"],
    [{ ...fixtures()[2], tracks: [{ trackid: 91, media_type: 1 }] }, "PROMOONLY_BATCH_TRACK_NOT_AUDIO"],
    [{ ...fixtures()[2], tracks: [{ trackid: 91, media_type: 2 }, { trackid: 91, media_type: 2 }] }, "PROMOONLY_BATCH_DUPLICATE_TRACK"],
    [{ ...fixtures(26)[2], tracks: [...fixtures(25)[2].tracks, { trackid: 91, media_type: 2 }] }, "PROMOONLY_BATCH_DUPLICATE_TRACK"]
  ]) {
    const payloads = fixtures(); payloads[2] = release;
    await rejectsPayload(payloads, code, 3);
  }
});

test("direct-track identity/media/date/formats/incomplete data fail closed with no partial batch returned", async () => {
  for (const [changes, code] of [
    [{ id: 92 }, "PROMOONLY_BATCH_TRACK_ID_MISMATCH"],
    [{ releaseid: 56 }, "PROMOONLY_BATCH_TRACK_RELEASE_ID_MISMATCH"],
    [{ media_type: 1 }, "PROMOONLY_BATCH_TRACK_NOT_AUDIO"],
    [{ media_type: "2" }, "PROMOONLY_BATCH_TRACK_SCHEMA"],
    [{ release_date: "2026-02-30" }, "PROMOONLY_BATCH_METADATA_INVALID"],
    [{ modified: "invalid" }, "PROMOONLY_BATCH_METADATA_INVALID"],
    [{ media: "http://download" }, "PROMOONLY_BATCH_METADATA_INVALID"],
    [{ artist: "" }, "PROMOONLY_BATCH_METADATA_INCOMPLETE"],
    [{ trackid: 99 }, "PROMOONLY_BATCH_NORMALIZATION_UNSTABLE"]
  ]) {
    const payloads = fixtures(); payloads[3] = { ...payloads[3], ...changes };
    await rejectsPayload(payloads, code, 4);
  }
  const payloads = fixtures(); payloads[4] = { ...payloads[4], id: 91 };
  await rejectsPayload(payloads, "PROMOONLY_BATCH_TRACK_ID_MISMATCH", 5);
});

test("rights or licence claims are rejected instead of creating any entitlement", async () => {
  for (const field of ["rights", "territories", "licenceWindow", "supplierTierEntitlement", "offlineCachingPermission", "permittedTerritories", "permittedUses", "minimumCatalogueLevel", "licenceStartsAt", "licenceExpiresAt"]) {
    const payloads = fixtures(); payloads[3] = { ...payloads[3], [field]: "unverified" };
    await rejectsPayload(payloads, "PROMOONLY_BATCH_RIGHTS_UNSAFE", 4);
  }
  const payloads = fixtures(); payloads[2] = { ...payloads[2], permittedUses: ["broadcast"] };
  await rejectsPayload(payloads, "PROMOONLY_BATCH_RIGHTS_UNSAFE", 3);
});

test("401/429 are not retried or reauthenticated", async () => {
  for (const status of [401, 429]) {
    const payloads = fixtures(); payloads[1] = new Response("no", { status, headers: { "content-type": "application/json" } });
    const calls = await rejectsPayload(payloads, `PROMOONLY_BATCH_HTTP_${status}`, 2);
    assert.equal(calls.filter((call) => call.method === "POST").length, 1);
  }
});

test("malformed JSON/non-JSON/advertised and actual 2 MiB body limits are sanitized", async () => {
  for (const [response, code] of [
    [new Response("{invalid", { headers: { "content-type": "application/json" } }), "PROMOONLY_BATCH_RESPONSE_INVALID_JSON"],
    [new Response("fixture-secret", { headers: { "content-type": "text/plain" } }), "PROMOONLY_BATCH_RESPONSE_NOT_JSON"],
    [new Response("{}", { headers: { "content-type": "application/json", "content-length": String(2 * 1024 * 1024 + 1) } }), "PROMOONLY_BATCH_RESPONSE_TOO_LARGE"],
    [new Response("x".repeat(2 * 1024 * 1024 + 1), { headers: { "content-type": "application/json" } }), "PROMOONLY_BATCH_RESPONSE_TOO_LARGE"]
  ]) {
    const payloads = fixtures(); payloads[1] = response;
    await rejectsPayload(payloads, code, 2);
  }
});

test("redirect statuses and redirected responses fail without following them", async () => {
  const redirected = new Response("{}", { headers: { "content-type": "application/json" } });
  Object.defineProperty(redirected, "redirected", { value: true });
  for (const response of [redirected, new Response("no", { status: 302, headers: { location: "https://evil.example/", "content-type": "application/json" } })]) {
    const payloads = fixtures(); payloads[1] = response;
    await rejectsPayload(payloads, "PROMOONLY_BATCH_REDIRECT_BLOCKED", 2);
  }
});

test("short token rejects after auth without a refresh", async () => {
  const payloads = fixtures(); payloads[0] = { token: "fixture-token", expires: Math.floor(NOW / 1000) + 100 };
  await rejectsPayload(payloads, "PROMOONLY_BATCH_TOKEN_EXPIRY_TOO_SHORT", 1);
});

test("expired/cancelled deadline, invalid/backwards live clock stop all following calls", async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(fetchPromoOnlyMetadataBatch(readyConfig(), { fetchImpl: () => assert.fail("must not fetch"), now: NOW, abortSignal: controller.signal }), { code: "PROMOONLY_BATCH_DEADLINE", requestCount: 0 });
  await assert.rejects(fetchPromoOnlyMetadataBatch(readyConfig(), { fetchImpl: () => assert.fail("must not fetch"), now: NaN }), { code: "PROMOONLY_BATCH_CLOCK_INVALID", requestCount: 0 });
  for (const [later, code] of [[NOW + 90_000, "PROMOONLY_BATCH_DEADLINE"], [NOW - 1, "PROMOONLY_BATCH_CLOCK_INVALID"]]) {
    const calls = [];
    await assert.rejects(fetchPromoOnlyMetadataBatch(readyConfig(), { fetchImpl: mockFetch(fixtures(), calls), now: () => calls.length < 2 ? NOW : later }), { code, requestCount: 2 });
    assert.equal(calls.length, 2);
  }
});

test("cancellation bounds a stalled response body and never exposes supplier/error secrets", async () => {
  const controller = new AbortController();
  const calls = [];
  const stalled = new Response(new ReadableStream({ start() {} }), { headers: { "content-type": "application/json" } });
  const wrapped = mockFetch([fixtures()[0], stalled], calls);
  const result = fetchPromoOnlyMetadataBatch(readyConfig(), { now: NOW, abortSignal: controller.signal,
    fetchImpl: async (...args) => {
      const response = await wrapped(...args);
      if (calls.length === 2) setImmediate(() => controller.abort());
      return response;
    }
  });
  await assert.rejects(result, { code: "PROMOONLY_BATCH_DEADLINE", requestCount: 2 });
  assert.equal(calls.length, 2);
  const error = await fetchPromoOnlyMetadataBatch(readyConfig(), { now: NOW, fetchImpl: async () => {
    throw Object.assign(new Error("fixture-secret fixture-key fixture-token"), { code: "fixture-secret" });
  } }).catch((caught) => caught);
  assert.equal(error.code, "PROMOONLY_BATCH_NETWORK");
  for (const secret of [env.PROMOONLY_API_KEY, env.PROMOONLY_API_SECRET, "fixture-token"]) {
    assert.equal(String(error).includes(secret), false);
    assert.equal(JSON.stringify(error).includes(secret), false);
  }
});
