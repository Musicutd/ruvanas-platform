import assert from "node:assert/strict";
import { test } from "node:test";
import {
  fetchPromoOnlyAudioSample, getPromoOnlyAudioSampleReadiness,
  readPromoOnlyAudioSampleConfig
} from "../lib/promo-only-audio-sample.mjs";

const NOW = Date.parse("2026-10-11T12:00:00.000Z");
const TOKEN = "synthetic-session-token";
const DL_TOKEN = "0123456789abcdef0123456789abcdef";
const BASE_ENV = Object.freeze({
  PROMOONLY_AUDIO_SAMPLE_ENABLED: "true",
  RUVANAS_ENVIRONMENT: "PRIVATE_PREVIEW",
  RUVANAS_PRIVATE_PREVIEW_ENABLED: "1",
  RUVANAS_PUBLIC_URL: "https://ruvanas-private-preview-20261011.onrender.com",
  RENDER_SERVICE_ID: "srv-db5l9d7lk1mc73ad8v7g",
  DATABASE_URL: "postgresql://fixture:fixture@dpg-db5kurijnfac73arripg-a/ruvanas_private_preview_20261011",
  PROMOONLY_ENABLED: "false", PROMOONLY_MODE: "OFF",
  PROMOONLY_AUDIO_DOWNLOAD_ENABLED: "false", PROMOONLY_ALLOW_HTTP_MEDIA_TEST: "false",
  PROMOONLY_USER_ID: "42", PROMOONLY_API_KEY: "fixture-supplier-key",
  PROMOONLY_API_SECRET: "fixture-supplier-secret",
  R2_ACCOUNT_ID: "8aac840009a163d4a099f06744cdf691",
  R2_ENDPOINT: "https://8aac840009a163d4a099f06744cdf691.r2.cloudflarestorage.com",
  R2_BUCKET_NAME: "ruvanas-preview-audio-20261011",
  R2_ACCESS_KEY_ID: "a".repeat(32), R2_SECRET_ACCESS_KEY: "b".repeat(64)
});
const audioBytes = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(64, 0x22)]);

function readyConfig() {
  const config = readPromoOnlyAudioSampleConfig(BASE_ENV);
  assert.equal(config.ready, true);
  return config;
}
function payloads(overrides = {}) {
  return [
    { token: TOKEN, expires: Math.floor(NOW / 1000) + 300, server_time: Math.floor(NOW / 1000) },
    { id: 713637, releaseid: 122500, media_type: 2, title: "Synthetic" },
    [{ id: 9, host: "uk01.promoonly.com" }],
    { Result: "Track successfully queued for download.", trackid: 713637,
      releaseid: 122500, media_type: 2, file_type: "mp3", queueid: 13,
      dl_token: DL_TOKEN, servers: ["uk01.promoonly.com"] },
    audioBytes,
    { result: "success", releaseid: 122500, titleid: 88, type: "mp3" }
  ].map((item, index) => overrides[index] ?? item);
}
function supplierFixture(responses = payloads()) {
  const calls = [];
  const fetchImpl = async (input, options) => {
    const index = calls.length;
    calls.push({ url: String(input), method: options.method || "GET", redirect: options.redirect,
      authorization: options.headers?.authorization, body: options.body });
    const item = responses[index];
    if (item instanceof Error) throw item;
    if (item instanceof Response || item?.headers?.get && item?.body?.getReader) return item;
    return index === 4
      ? new Response(item, { headers: { "content-type": "audio/mpeg", "content-length": String(item.length) } })
      : new Response(JSON.stringify(item), { headers: { "content-type": "application/json" } });
  };
  return { fetchImpl, calls };
}

test("default-off, exact private preview and fixed R2 gates refuse before network", async () => {
  const off = readPromoOnlyAudioSampleConfig({ ...BASE_ENV, PROMOONLY_AUDIO_SAMPLE_ENABLED: "FALSE" });
  assert.equal(off.enabled, false);
  assert.equal(getPromoOnlyAudioSampleReadiness(off).code, "PROMOONLY_AUDIO_SAMPLE_DISABLED");
  for (const changed of [
    { RUVANAS_ENVIRONMENT: "PRODUCTION" }, { RENDER_SERVICE_ID: "srv-other" },
    { DATABASE_URL: "postgresql://fixture:fixture@production/ruvanas_private_preview_20261011" },
    { PROMOONLY_ENABLED: "true" }, { PROMOONLY_MODE: "AUDIO_TEST" },
    { PROMOONLY_ALLOW_HTTP_MEDIA_TEST: "true" }, { PROMOONLY_API_SECRET: "" },
    { R2_ACCOUNT_ID: "other" }, { R2_BUCKET_NAME: "production" },
    { R2_ENDPOINT: "http://8aac840009a163d4a099f06744cdf691.r2.cloudflarestorage.com" },
    { R2_ACCESS_KEY_ID: "" }, { R2_ACCESS_KEY_ID: "z".repeat(32) },
    { R2_ACCESS_KEY_ID: "a".repeat(31) },
    { R2_SECRET_ACCESS_KEY: "short" }, { R2_SECRET_ACCESS_KEY: "g".repeat(64) },
    { R2_SECRET_ACCESS_KEY: "b".repeat(63) }
  ]) {
    const config = readPromoOnlyAudioSampleConfig({ ...BASE_ENV, ...changed });
    assert.equal(config.ready, false);
    await assert.rejects(fetchPromoOnlyAudioSample(config, { fetchImpl: () => { throw Error("must not fetch"); } }),
      { code: "PROMOONLY_AUDIO_SAMPLE_NOT_READY", supplierRequestCount: 0 });
  }
  await assert.rejects(fetchPromoOnlyAudioSample({ ...readyConfig() }, { fetchImpl: () => { throw Error("must not fetch"); } }),
    { code: "PROMOONLY_AUDIO_SAMPLE_NOT_READY" });
});

test("ready config and readiness never enumerate supplier or R2 secrets", () => {
  const config = readyConfig();
  const readiness = getPromoOnlyAudioSampleReadiness(config);
  assert.equal(readiness.ready, true);
  assert.equal(readiness.trackId, "713637");
  assert.equal(readiness.releaseId, "122500");
  assert.equal(readiness.supplierCredentialsConfigured, true);
  assert.equal(readiness.storageCredentialsConfigured, true);
  const serialized = JSON.stringify(config) + JSON.stringify(readiness);
  for (const secret of [BASE_ENV.PROMOONLY_API_KEY, BASE_ENV.PROMOONLY_API_SECRET,
    BASE_ENV.R2_ACCESS_KEY_ID, BASE_ENV.R2_SECRET_ACCESS_KEY]) assert.equal(serialized.includes(secret), false);
  assert.equal(getPromoOnlyAudioSampleReadiness({ ...config }).code, "PROMOONLY_AUDIO_SAMPLE_CONFIG_INVALID");
});

test("exact one auth/read-only preflight/queue/HTTPS media and one-shot acknowledgement", async () => {
  const f = supplierFixture();
  const result = await fetchPromoOnlyAudioSample(readyConfig(), { fetchImpl: f.fetchImpl, now: () => NOW });
  assert.equal(result.supplierRequestCount, 5);
  assert.deepEqual(f.calls.map((call) => call.url), [
    "https://api.promoonly.com/user/authenticate",
    "https://api.promoonly.com/track/713637",
    "https://api.promoonly.com/download/server/713637",
    "https://api.promoonly.com/downloads/queue/713637",
    `https://uk01.promoonly.com/pool/v5/download/${DL_TOKEN}`
  ]);
  assert.deepEqual(f.calls.map((call) => call.method), ["POST", "GET", "GET", "GET", "GET"]);
  assert.ok(f.calls.every((call) => call.redirect === "error"));
  assert.equal(result.audio.buffer.equals(audioBytes), true);
  assert.equal(result.audio.fileName, "promo-only-713637.mp3");
  assert.equal(result.audio.contentType, "audio/mpeg");
  assert.equal(result.audio.serverId, 9);
  assert.equal(result.audio.downloadToken, DL_TOKEN);
  assert.equal(JSON.stringify(result).includes(DL_TOKEN), false);
  const ack = await result.acknowledge();
  assert.deepEqual(ack, { status: "ACKNOWLEDGED", supplierRequestCount: 6 });
  assert.equal(f.calls.at(-1).url, "https://api.promoonly.com/download/success");
  assert.equal(f.calls.at(-1).method, "POST");
  assert.deepEqual(Object.fromEntries(f.calls.at(-1).body), {
    trackid: "713637", serverid: "9", dl_token: DL_TOKEN
  });
  assert.equal(f.calls.length, 6);
  await assert.rejects(result.acknowledge(), { code: "PROMOONLY_AUDIO_SAMPLE_ACK_ALREADY_ATTEMPTED" });
  assert.equal(f.calls.length, 6);
  result.dispose();
});

test("wrong track identity and too-short token stop before queue", async () => {
  for (const response of [
    payloads({ 1: { id: 713638, releaseid: 122500, media_type: 2 } }),
    payloads({ 1: { id: 713637, releaseid: 122501, media_type: 2 } }),
    payloads({ 1: { id: 713637, releaseid: 122500, media_type: 1 } })
  ]) {
    const f = supplierFixture(response);
    await assert.rejects(fetchPromoOnlyAudioSample(readyConfig(), { fetchImpl: f.fetchImpl, now: () => NOW }),
      { code: "PROMOONLY_AUDIO_SAMPLE_TRACK_MISMATCH", supplierRequestCount: 2 });
    assert.equal(f.calls.length, 2);
  }
  const short = supplierFixture(payloads({ 0: { token: TOKEN, expires: Math.floor(NOW / 1000) + 90 } }));
  await assert.rejects(fetchPromoOnlyAudioSample(readyConfig(), { fetchImpl: short.fetchImpl, now: () => NOW }),
    { code: "PROMOONLY_AUDIO_SAMPLE_TOKEN_EXPIRY_TOO_SHORT", supplierRequestCount: 1 });
  assert.equal(short.calls.length, 1);
});

test("queue grant mismatch, HTTP host and unavailable server never fetch media", async () => {
  const base = payloads()[3];
  for (const grant of [
    { ...base, trackid: 713638 }, { ...base, releaseid: 122501 },
    { ...base, media_type: 1 }, { ...base, file_type: "720 mp4" },
    { ...base, Result: "not queued" },
    { ...base, servers: ["http://uk01.promoonly.com"] },
    { ...base, servers: ["other.promoonly.com"] }
  ]) {
    const f = supplierFixture(payloads({ 3: grant }));
    await assert.rejects(fetchPromoOnlyAudioSample(readyConfig(), { fetchImpl: f.fetchImpl, now: () => NOW }),
      { supplierRequestCount: 4 });
    assert.equal(f.calls.length, 4);
  }
});

test("octet-stream transport is handed to catalogue as signature-backed canonical audio", async () => {
  const media = new Response(audioBytes, { headers: { "content-type": "application/octet-stream",
    "content-disposition": "attachment; filename=untrusted.bin" } });
  const f = supplierFixture(payloads({ 4: media }));
  const result = await fetchPromoOnlyAudioSample(readyConfig(), { fetchImpl: f.fetchImpl, now: () => NOW });
  assert.equal(result.audio.contentType, "audio/mpeg");
  assert.equal(result.audio.fileName, "promo-only-713637.mp3");
  assert.equal(result.audio.buffer.equals(audioBytes), true);
  result.dispose();
});

test("transport audio MIME must agree with the queued file format", async () => {
  const media = new Response(audioBytes, { headers: { "content-type": "audio/wav" } });
  const f = supplierFixture(payloads({ 4: media }));
  await assert.rejects(fetchPromoOnlyAudioSample(readyConfig(), { fetchImpl: f.fetchImpl, now: () => NOW }),
    { code: "PROMOONLY_AUDIO_SAMPLE_MEDIA_INVALID", supplierRequestCount: 5 });
  assert.equal(f.calls.length, 5);
});

test("ambiguous queue failure and 401 do not retry or refresh authentication", async () => {
  const thrown = supplierFixture(payloads({ 3: new Error("hidden supplier response") }));
  await assert.rejects(fetchPromoOnlyAudioSample(readyConfig(), { fetchImpl: thrown.fetchImpl, now: () => NOW }),
    { supplierRequestCount: 4 });
  assert.equal(thrown.calls.length, 4);
  const denied = supplierFixture(payloads({ 3: new Response(JSON.stringify({ result: "unauthorized" }), {
    status: 401, headers: { "content-type": "application/json" }
  }) }));
  await assert.rejects(fetchPromoOnlyAudioSample(readyConfig(), { fetchImpl: denied.fetchImpl, now: () => NOW }),
    { supplierRequestCount: 4 });
  assert.equal(denied.calls.length, 4);
});

test("HTTPS failure never falls back to HTTP; announced >50 MiB is refused", async () => {
  const f = supplierFixture(payloads({ 4: new Error("TLS failed") }));
  await assert.rejects(fetchPromoOnlyAudioSample(readyConfig(), { fetchImpl: f.fetchImpl, now: () => NOW }),
    { supplierRequestCount: 5 });
  assert.equal(f.calls.length, 5);
  assert.ok(f.calls.every((call) => call.url.startsWith("https://")));
  const large = supplierFixture(payloads({ 4: new Response(audioBytes, {
    headers: { "content-type": "audio/mpeg", "content-length": String(50 * 1024 * 1024 + 1) }
  }) }));
  await assert.rejects(fetchPromoOnlyAudioSample(readyConfig(), { fetchImpl: large.fetchImpl, now: () => NOW }),
    { code: "PROMOONLY_AUDIO_SAMPLE_RESPONSE_TOO_LARGE", supplierRequestCount: 5 });
  assert.equal(large.calls.length, 5);
});

test("partial HTTP 206 media is rejected despite valid signature and no Range request", async () => {
  const partial = new Response(audioBytes, { status: 206,
    headers: { "content-type": "audio/mpeg", "content-range": `bytes 0-${audioBytes.length - 1}/999999` } });
  const f = supplierFixture(payloads({ 4: partial }));
  await assert.rejects(fetchPromoOnlyAudioSample(readyConfig(), { fetchImpl: f.fetchImpl, now: () => NOW }),
    { code: "PROMOONLY_AUDIO_SAMPLE_MEDIA_HTTP_STATUS_INVALID", supplierRequestCount: 5 });
  assert.equal(f.calls.length, 5);
  assert.equal(f.calls[4].url.startsWith("https://"), true);
});

test("media body length must match a supplied Content-Length", async () => {
  const truncated = new Response(audioBytes, { headers: { "content-type": "audio/mpeg",
    "content-length": String(audioBytes.length + 1) } });
  const f = supplierFixture(payloads({ 4: truncated }));
  await assert.rejects(fetchPromoOnlyAudioSample(readyConfig(), { fetchImpl: f.fetchImpl, now: () => NOW }),
    { code: "PROMOONLY_AUDIO_SAMPLE_MEDIA_LENGTH_MISMATCH", supplierRequestCount: 5 });
  assert.equal(f.calls.length, 5);
});

test("streamed over-limit media fails without awaiting a hanging reader cancellation", async () => {
  let cancelled = 0;
  const oversizedStream = {
    ok: true, status: 200, redirected: false,
    headers: new Headers({ "content-type": "audio/mpeg" }),
    body: { getReader() { return {
      read: async () => ({ done: false, value: { byteLength: 50 * 1024 * 1024 + 1 } }),
      cancel: () => { cancelled += 1; return new Promise(() => {}); }
    }; } }
  };
  const f = supplierFixture(payloads({ 4: oversizedStream }));
  await assert.rejects(fetchPromoOnlyAudioSample(readyConfig(), { fetchImpl: f.fetchImpl, now: () => NOW }),
    { code: "PROMOONLY_AUDIO_SAMPLE_RESPONSE_TOO_LARGE", supplierRequestCount: 5 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cancelled, 1);
  assert.equal(f.calls.length, 5);
});

test("bad media signature blocks storage handoff, and dispose blocks acknowledgement", async () => {
  for (const bytes of [Buffer.from("<html>not audio</html>"), Buffer.from("ID3")]) {
    const bad = supplierFixture(payloads({ 4: bytes }));
    await assert.rejects(fetchPromoOnlyAudioSample(readyConfig(), { fetchImpl: bad.fetchImpl, now: () => NOW }),
      { supplierRequestCount: 5 });
  }
  const good = supplierFixture();
  const result = await fetchPromoOnlyAudioSample(readyConfig(), { fetchImpl: good.fetchImpl, now: () => NOW });
  result.dispose();
  await assert.rejects(result.acknowledge(), { code: "PROMOONLY_AUDIO_SAMPLE_ACK_UNAVAILABLE" });
  assert.equal(good.calls.length, 5);
});

test("acknowledgement identity mismatch remains one-shot reconciliation, never a second POST", async () => {
  const f = supplierFixture(payloads({ 5: { result: "success", releaseid: 122501, type: "mp3" } }));
  const result = await fetchPromoOnlyAudioSample(readyConfig(), { fetchImpl: f.fetchImpl, now: () => NOW });
  await assert.rejects(result.acknowledge(), {
    code: "PROMOONLY_AUDIO_SAMPLE_ACK_REJECTED", supplierRequestCount: 6
  });
  await assert.rejects(result.acknowledge(), { code: "PROMOONLY_AUDIO_SAMPLE_ACK_ALREADY_ATTEMPTED" });
  assert.equal(f.calls.length, 6);
});
