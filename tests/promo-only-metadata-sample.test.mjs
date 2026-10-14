import assert from "node:assert/strict";
import { test } from "node:test";
import {
  fetchPromoOnlyMetadataSample,
  readPromoOnlyMetadataSampleConfig
} from "../lib/promo-only-metadata-sample.mjs";
import {
  fetchPromoOnlyAudioSample,
  readPromoOnlyAudioSampleConfig
} from "../lib/promo-only-audio-sample.mjs";

const NOW = Date.parse("2026-10-11T12:00:00.000Z");
const DAY = "2026-10-10";
const DAY_TS = Date.parse(`${DAY}T00:00:00.000Z`) / 1000;
const env = Object.freeze({
  PROMOONLY_METADATA_SAMPLE_ENABLED: "true",
  RUVANAS_ENVIRONMENT: "PRIVATE_PREVIEW",
  RUVANAS_PRIVATE_PREVIEW_ENABLED: "1",
  RUVANAS_PUBLIC_URL: "https://ruvanas-private-preview-20261011.onrender.com",
  RENDER_SERVICE_ID: "srv-db5l9d7lk1mc73ad8v7g",
  DATABASE_URL: "postgresql://fixture:fixture@dpg-db5kurijnfac73arripg-a/ruvanas_private_preview_20261011",
  PROMOONLY_ENABLED: "false",
  PROMOONLY_MODE: "OFF",
  PROMOONLY_AUDIO_DOWNLOAD_ENABLED: "false",
  PROMOONLY_ALLOW_HTTP_MEDIA_TEST: "false",
  PROMOONLY_USER_ID: "42",
  PROMOONLY_API_KEY: "fixture-key",
  PROMOONLY_API_SECRET: "fixture-secret"
});
const paidEnv = Object.freeze({
  ...env,
  RUVANAS_PUBLIC_URL: "https://ruvanas-platform.onrender.com",
  RENDER_SERVICE_ID: "srv-da03b5lbedkc739q74k0"
});

function fixtures() {
  return [
    { token: "fixture-token", expires: Math.floor(NOW / 1000) + 300, server_time: Math.floor(NOW / 1000) },
    [{ date: DAY, ts: DAY_TS, releases: [{ id: 55, type: 2, release: "Synthetic release" }] }],
    { id: 55, date: DAY, release: "Synthetic release", tracks: [{ trackid: 91, media_type: 2 }] },
    { id: 91, releaseid: 55, media_type: 2, title: "Synthetic track", artist: "Synthetic artist",
      media: "mp3,m4a", release_date: DAY, modified: DAY_TS + 36_000 }
  ];
}

function mockFetch(payloads, calls) {
  return async (input, options) => {
    calls.push({ url: String(input), method: options.method, redirect: options.redirect, signal: options.signal });
    const payload = payloads[calls.length - 1];
    return payload instanceof Response ? payload : new Response(JSON.stringify(payload), {
      headers: { "content-type": "application/json" }
    });
  };
}

function readyConfig() {
  const config = readPromoOnlyMetadataSampleConfig(env);
  assert.equal(config.ready, true);
  return config;
}

test("metadata sampling accepts only the two pinned preview service/origin pairs", async () => {
  assert.equal(readPromoOnlyMetadataSampleConfig(env).ready, true);
  const paidConfig = readPromoOnlyMetadataSampleConfig(paidEnv);
  assert.equal(paidConfig.ready, true);
  const calls = [];
  const result = await fetchPromoOnlyMetadataSample(paidConfig, {
    fetchImpl: mockFetch(fixtures(), calls), now: NOW
  });
  assert.equal(result.requestCount, 4);
  assert.equal(calls.length, 4);

  for (const changed of [
    { RUVANAS_PUBLIC_URL: env.RUVANAS_PUBLIC_URL },
    { RENDER_SERVICE_ID: env.RENDER_SERVICE_ID },
    { RUVANAS_PUBLIC_URL: "https://other.onrender.com" },
    { RENDER_SERVICE_ID: "srv-other" },
    { RUVANAS_PUBLIC_URL: `${paidEnv.RUVANAS_PUBLIC_URL}/` },
    { DATABASE_URL: "postgresql://fixture:fixture@other/ruvanas_private_preview_20261011" },
    { PROMOONLY_AUDIO_DOWNLOAD_ENABLED: "true" },
    { PROMOONLY_ENABLED: "true" }
  ]) {
    const config = readPromoOnlyMetadataSampleConfig({ ...paidEnv, ...changed });
    assert.equal(config.ready, false);
    await assert.rejects(fetchPromoOnlyMetadataSample(config, {
      fetchImpl: () => { throw Error("must not fetch"); }
    }), { code: "PROMOONLY_SAMPLE_NOT_READY", requestCount: 0 });
  }
});

test("paid metadata readiness does not enable audio when its separate switch stays off", async () => {
  const metadata = readPromoOnlyMetadataSampleConfig(paidEnv);
  assert.equal(metadata.ready, true);
  const validSyntheticAudioEnvironment = {
    ...paidEnv,
    R2_ACCOUNT_ID: "8aac840009a163d4a099f06744cdf691",
    R2_BUCKET_NAME: "ruvanas-preview-audio-20261011",
    R2_ENDPOINT: "https://8aac840009a163d4a099f06744cdf691.r2.cloudflarestorage.com",
    R2_ACCESS_KEY_ID: "a".repeat(32),
    R2_SECRET_ACCESS_KEY: "b".repeat(64)
  };
  assert.equal(readPromoOnlyAudioSampleConfig({
    ...validSyntheticAudioEnvironment,
    PROMOONLY_AUDIO_SAMPLE_ENABLED: "true"
  }).ready, true);
  const audio = readPromoOnlyAudioSampleConfig({
    ...validSyntheticAudioEnvironment,
    PROMOONLY_AUDIO_SAMPLE_ENABLED: "false"
  });
  assert.equal(audio.enabled, false);
  assert.equal(audio.ready, false);
  let supplierCalls = 0;
  await assert.rejects(fetchPromoOnlyAudioSample(audio, {
    fetchImpl: () => { supplierCalls += 1; throw Error("must not fetch"); }
  }), { code: "PROMOONLY_AUDIO_SAMPLE_NOT_READY", supplierRequestCount: 0 });
  assert.equal(supplierCalls, 0);
});

test("disabled and wrong-preview configurations fail before fetch", async () => {
  const disabled = readPromoOnlyMetadataSampleConfig({ ...env, PROMOONLY_METADATA_SAMPLE_ENABLED: "TRUE" });
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.ready, false);
  for (const changed of [
    { RUVANAS_ENVIRONMENT: "PRODUCTION" },
    { RUVANAS_PUBLIC_URL: "https://www.ruvanas.com" },
    { RENDER_SERVICE_ID: "srv-other" },
    { DATABASE_URL: "postgresql://fixture:fixture@other/ruvanas_private_preview_20261011" },
    { PROMOONLY_ENABLED: "true" },
    { PROMOONLY_MODE: "AUDIO_TEST" },
    { PROMOONLY_AUDIO_DOWNLOAD_ENABLED: "true" },
    { PROMOONLY_ALLOW_HTTP_MEDIA_TEST: "true" },
    { PROMOONLY_USER_ID: "0" },
    { PROMOONLY_API_SECRET: "" }
  ]) {
    const config = readPromoOnlyMetadataSampleConfig({ ...env, ...changed });
    assert.equal(config.enabled, true);
    assert.equal(config.ready, false);
    await assert.rejects(fetchPromoOnlyMetadataSample(config, { fetchImpl: () => { throw Error("must not fetch"); } }),
      { code: "PROMOONLY_SAMPLE_NOT_READY", requestCount: 0 });
  }
  await assert.rejects(fetchPromoOnlyMetadataSample({ ...readyConfig() }, { fetchImpl: () => { throw Error("must not fetch"); } }),
    { code: "PROMOONLY_SAMPLE_NOT_READY" });
});

test("the pinned internal DB accepts only its single optional connection limit", () => {
  assert.equal(readPromoOnlyMetadataSampleConfig({ ...env,
    DATABASE_URL: `${env.DATABASE_URL}?connection_limit=3`
  }).ready, true);
  for (const query of [
    "?connection_limit=4", "?connection_limit=3&connection_limit=3",
    "?connection_limit=3&schema=public", "?pgbouncer=true", "?connection_limit=3&"
  ]) {
    assert.equal(readPromoOnlyMetadataSampleConfig({ ...env,
      DATABASE_URL: `${env.DATABASE_URL}${query}`
    }).ready, false);
  }
  assert.equal(readPromoOnlyMetadataSampleConfig({ ...env,
    DATABASE_URL: `${env.DATABASE_URL}#override`
  }).ready, false);
  assert.equal(readPromoOnlyMetadataSampleConfig({ ...env,
    DATABASE_URL: `${env.DATABASE_URL}?connection_limit=3#`
  }).ready, false);
});

test("documented auth/date buckets/direct release/direct track use exactly four allowed calls", async () => {
  const config = readyConfig();
  const calls = [];
  const result = await fetchPromoOnlyMetadataSample(config, { fetchImpl: mockFetch(fixtures(), calls), now: () => NOW });
  assert.deepEqual(calls.map((call) => [call.method, call.url]), [
    ["POST", "https://api.promoonly.com/user/authenticate"],
    ["GET", "https://api.promoonly.com/releases/date/1"],
    ["GET", "https://api.promoonly.com/release/55"],
    ["GET", "https://api.promoonly.com/track/91"]
  ]);
  assert.ok(calls.every((call) => call.redirect === "error" && call.signal instanceof AbortSignal));
  assert.equal(result.requestCount, 4);
  assert.equal(result.releaseCount, 1);
  assert.equal(result.metadata.externalReleaseId, "55");
  assert.equal(result.metadata.externalTrackId, "91");
  assert.equal(result.metadata.mediaType, "2");
  assert.deepEqual(result.metadata.audioFormats, ["mp3", "m4a"]);
  assert.equal(result.metadata.releaseDate.toISOString().slice(0, 10), DAY);
  assert.equal(result.metadata.sourceModifiedAt.toISOString().slice(0, 10), DAY);
  for (const field of ["rights", "territories", "licenceWindow", "supplierTierEntitlement", "offlineCachingPermission"]) {
    assert.ok(result.metadata.unsupportedFields.includes(field));
  }
  for (const field of ["permittedTerritories", "permittedUses", "minimumCatalogueLevel", "licenceStartsAt", "licenceExpiresAt"]) {
    assert.equal(Object.hasOwn(result.metadata, field), false);
  }
  assert.equal(JSON.stringify(config).includes("fixture-secret"), false);
  assert.equal(JSON.stringify(config).includes("fixture-key"), false);
  assert.equal(JSON.stringify(config).includes("42"), false);
});

test("empty first page or no audio release stops without pagination", async () => {
  for (const [list, code] of [
    [[], "PROMOONLY_SAMPLE_EMPTY_RELEASE_LIST"],
    [[{ date: DAY, ts: DAY_TS, releases: [{ id: 55, type: 1 }] }], "PROMOONLY_SAMPLE_NO_AUDIO_RELEASE"]
  ]) {
    const payloads = fixtures();
    payloads[1] = list;
    const calls = [];
    await assert.rejects(fetchPromoOnlyMetadataSample(readyConfig(), { fetchImpl: mockFetch(payloads, calls), now: NOW }),
      { code, requestCount: 2 });
    assert.equal(calls.length, 2);
  }
});

test("list date and item bounds reject malformed or oversized date buckets", async () => {
  for (const badList of [
    [{ date: DAY, ts: DAY_TS - 86_400, releases: [{ id: 55, type: 2 }] }],
    [{ date: "2026-02-30", ts: DAY_TS, releases: [] }],
    [{ date: DAY, ts: DAY_TS, releases: Array.from({ length: 501 }, (_, index) => ({ id: index + 1, type: 2 })) }],
    [{ date: DAY, ts: DAY_TS, releases: [{ id: 0, type: 2 }] }],
    [{ date: DAY, ts: DAY_TS, releases: [{ id: 55, type: "2" }] }]
  ]) {
    const payloads = fixtures();
    payloads[1] = badList;
    const calls = [];
    await assert.rejects(fetchPromoOnlyMetadataSample(readyConfig(), { fetchImpl: mockFetch(payloads, calls), now: NOW }),
      { code: "PROMOONLY_SAMPLE_LIST_SCHEMA", requestCount: 2 });
    assert.equal(calls.length, 2);
  }
});

test("outer release and direct track identities fail closed", async () => {
  for (const [slot, replacement, code, count] of [
    [2, { ...fixtures()[2], id: 56 }, "PROMOONLY_SAMPLE_RELEASE_ID_MISMATCH", 3],
    [2, { ...fixtures()[2], tracks: [{ trackid: 91, media_type: 2, releaseid: 56 }] }, "PROMOONLY_SAMPLE_RELEASE_SCHEMA", 3],
    [3, { ...fixtures()[3], id: 92 }, "PROMOONLY_SAMPLE_TRACK_ID_MISMATCH", 4],
    [3, { ...fixtures()[3], releaseid: 56 }, "PROMOONLY_SAMPLE_TRACK_RELEASE_ID_MISMATCH", 4],
    [3, { ...fixtures()[3], media_type: 1 }, "PROMOONLY_SAMPLE_TRACK_NOT_AUDIO", 4]
  ]) {
    const payloads = fixtures();
    payloads[slot] = replacement;
    const calls = [];
    await assert.rejects(fetchPromoOnlyMetadataSample(readyConfig(), { fetchImpl: mockFetch(payloads, calls), now: NOW }),
      { code, requestCount: count });
    assert.equal(calls.length, count);
  }
});

test("a release without a bounded audio track cannot trigger a track request", async () => {
  for (const [tracks, code] of [
    [[], "PROMOONLY_SAMPLE_EMPTY_RELEASE_TRACKS"],
    [[{ trackid: 91, media_type: 1 }], "PROMOONLY_SAMPLE_NO_AUDIO_TRACK"],
    [Array.from({ length: 501 }, (_, index) => ({ trackid: index + 1, media_type: 2 })), "PROMOONLY_SAMPLE_RELEASE_SCHEMA"]
  ]) {
    const payloads = fixtures();
    payloads[2] = { ...payloads[2], tracks };
    const calls = [];
    await assert.rejects(fetchPromoOnlyMetadataSample(readyConfig(), { fetchImpl: mockFetch(payloads, calls), now: NOW }),
      { code, requestCount: 3 });
    assert.equal(calls.length, 3);
  }
});

test("429, malformed JSON, content type and 2 MiB cap do not retry or leak secrets", async () => {
  const variants = [
    [new Response("no", { status: 429, headers: { "content-type": "application/json" } }), "PROMOONLY_SAMPLE_HTTP_429"],
    [new Response("{broken", { headers: { "content-type": "application/json" } }), "PROMOONLY_SAMPLE_RESPONSE_INVALID_JSON"],
    [new Response("text", { headers: { "content-type": "text/plain" } }), "PROMOONLY_SAMPLE_RESPONSE_NOT_JSON"],
    [new Response("{}", { headers: { "content-type": "application/json", "content-length": String(2 * 1024 * 1024 + 1) } }), "PROMOONLY_SAMPLE_RESPONSE_TOO_LARGE"],
    [new Response("x".repeat(2 * 1024 * 1024 + 1), { headers: { "content-type": "application/json" } }), "PROMOONLY_SAMPLE_RESPONSE_TOO_LARGE"]
  ];
  for (const [response, code] of variants) {
    const payloads = fixtures();
    payloads[1] = response;
    const calls = [];
    const error = await fetchPromoOnlyMetadataSample(readyConfig(), { fetchImpl: mockFetch(payloads, calls), now: NOW })
      .then(() => null, (caught) => caught);
    assert.equal(error.code, code);
    assert.equal(error.requestCount, 2);
    assert.equal(calls.length, 2);
    assert.equal(JSON.stringify(error).includes("fixture-secret"), false);
    assert.equal(String(error).includes("fixture-key"), false);
  }
});

test("short or suddenly stale token is rejected without a second authentication request", async () => {
  const shortPayloads = fixtures();
  shortPayloads[0] = { ...shortPayloads[0], expires: Math.floor(NOW / 1000) + 20 };
  const shortCalls = [];
  await assert.rejects(fetchPromoOnlyMetadataSample(readyConfig(), {
    fetchImpl: mockFetch(shortPayloads, shortCalls), now: NOW
  }), { code: "PROMOONLY_SAMPLE_TOKEN_EXPIRY_TOO_SHORT", requestCount: 1 });
  assert.equal(shortCalls.length, 1);

  const staleCalls = [];
  await assert.rejects(fetchPromoOnlyMetadataSample(readyConfig(), {
    fetchImpl: mockFetch(fixtures(), staleCalls), now: () => (staleCalls.length < 2 ? NOW : NOW + 280_000)
  }), { code: "PROMOONLY_SAMPLE_TOKEN_EXPIRY_TOO_SHORT", requestCount: 2 });
  assert.deepEqual(staleCalls.map((call) => call.url), [
    "https://api.promoonly.com/user/authenticate",
    "https://api.promoonly.com/releases/date/1"
  ]);
});

test("an already-expired total deadline prevents all network calls", async () => {
  const controller = new AbortController();
  controller.abort();
  const calls = [];
  await assert.rejects(fetchPromoOnlyMetadataSample(readyConfig(), {
    fetchImpl: mockFetch(fixtures(), calls), now: NOW, abortSignal: controller.signal
  }), { code: "PROMOONLY_SAMPLE_DEADLINE", requestCount: 0 });
  assert.equal(calls.length, 0);
});
