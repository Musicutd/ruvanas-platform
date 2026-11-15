import assert from "node:assert/strict";
import { test } from "node:test";
import { readPromoOnlyAudioSampleConfig } from "../lib/promo-only-audio-sample.mjs";
import { checkPromoOnlyAudioSampleTransport } from "../lib/promo-only-audio-sample-transport.mjs";

const NOW = Date.parse("2026-10-12T12:00:00Z");
const ENV = Object.freeze({
  PROMOONLY_AUDIO_SAMPLE_ENABLED: "true",
  RUVANAS_ENVIRONMENT: "PRIVATE_PREVIEW",
  RUVANAS_PRIVATE_PREVIEW_ENABLED: "1",
  RUVANAS_PUBLIC_URL: "https://ruvanas-private-preview-20261011.onrender.com",
  RENDER_SERVICE_ID: "srv-db5l9d7lk1mc73ad8v7g",
  DATABASE_URL: "postgresql://fixture:fixture@dpg-db5kurijnfac73arripg-a/ruvanas_private_preview_20261011",
  PROMOONLY_ENABLED: "false", PROMOONLY_MODE: "OFF",
  PROMOONLY_AUDIO_DOWNLOAD_ENABLED: "false", PROMOONLY_ALLOW_HTTP_MEDIA_TEST: "false",
  PROMOONLY_USER_ID: "42", PROMOONLY_API_KEY: "synthetic-key", PROMOONLY_API_SECRET: "synthetic-secret",
  R2_ACCOUNT_ID: "8aac840009a163d4a099f06744cdf691",
  R2_ENDPOINT: "https://8aac840009a163d4a099f06744cdf691.r2.cloudflarestorage.com",
  R2_BUCKET_NAME: "ruvanas-preview-audio-20261011",
  R2_ACCESS_KEY_ID: "a".repeat(32), R2_SECRET_ACCESS_KEY: "b".repeat(64)
});

function config() {
  const value = readPromoOnlyAudioSampleConfig(ENV);
  assert.equal(value.ready, true);
  return value;
}

function mockFetch(servers = [{ id: 0, host: "uk01.promoonly.com" }], head = new Response(null, { status: 200 })) {
  const calls = [];
  const fetchImpl = async (input, options) => {
    calls.push({ url: String(input), ...options });
    const index = calls.length - 1;
    if (index === 2) {
      if (head instanceof Error) throw head;
      return head;
    }
    const payload = index === 0
      ? { token: "synthetic-token", expires: Math.floor(NOW / 1000) + 300 }
      : servers;
    return new Response(JSON.stringify(payload), { status: 200,
      headers: { "content-type": "application/json" } });
  };
  return { fetchImpl, calls };
}

test("default-off and counterfeit configs refuse before network", async () => {
  let calls = 0;
  const fetchImpl = () => { calls += 1; throw new Error("unexpected"); };
  const off = readPromoOnlyAudioSampleConfig({ ...ENV, PROMOONLY_AUDIO_SAMPLE_ENABLED: "false" });
  for (const value of [off, { ...config() }, null]) {
    await assert.rejects(checkPromoOnlyAudioSampleTransport(value, { fetchImpl }), {
      code: "PROMOONLY_AUDIO_TRANSPORT_NOT_READY", apiRequestCount: 0, headRequestCount: 0
    });
  }
  assert.equal(calls, 0);
});

test("exact auth, server list, one anonymous HTTPS root HEAD; no queue/media/ACK", async () => {
  const fixture = mockFetch();
  const result = await checkPromoOnlyAudioSampleTransport(config(), { ...fixture, now: () => NOW });
  assert.deepEqual(result, { ready: true, reachable: true, httpStatus: 200, causeCode: null,
    apiRequestCount: 2, headRequestCount: 1 });
  assert.deepEqual(fixture.calls.map((call) => [call.url, call.method || "GET"]), [
    ["https://api.promoonly.com/user/authenticate", "POST"],
    ["https://api.promoonly.com/download/server/713637", "GET"],
    ["https://uk01.promoonly.com/", "HEAD"]
  ]);
  assert.equal(fixture.calls[0].redirect, "error");
  assert.equal(fixture.calls[1].redirect, "error");
  assert.equal(fixture.calls[1].body, undefined);
  assert.equal(fixture.calls[2].redirect, "error");
  assert.equal(fixture.calls[2].credentials, "omit");
  assert.equal(fixture.calls[2].body, undefined);
  assert.deepEqual(fixture.calls[2].headers, { accept: "*/*" });
  assert.equal(JSON.stringify(result).includes("promoonly.com"), false);
  assert.equal(JSON.stringify(result).includes("synthetic-token"), false);
});

test("HTTP status proves transport reachability without asserting media access", async () => {
  const fixture = mockFetch(undefined, new Response(null, { status: 403 }));
  const result = await checkPromoOnlyAudioSampleTransport(config(), { ...fixture, now: () => NOW });
  assert.equal(result.reachable, true);
  assert.equal(result.httpStatus, 403);
  assert.equal(result.causeCode, null);
});

test("malformed, duplicate, or non-bare server list refuses before HEAD", async () => {
  for (const servers of [[], [{ id: -1, host: "uk01.promoonly.com" }],
    [{ id: 0, host: "https://uk01.promoonly.com" }],
    [{ id: 0, host: "uk01.promoonly.com/path" }],
    [{ id: 0, host: "private.local" }],
    [{ id: 0, host: "uk01.promoonly.com" }, { id: 1, host: "uk02.promoonly.com" }]]) {
    const fixture = mockFetch(servers);
    await assert.rejects(checkPromoOnlyAudioSampleTransport(config(), { ...fixture, now: () => NOW }), {
      code: "PROMOONLY_AUDIO_TRANSPORT_SERVERS_INVALID", apiRequestCount: 2, headRequestCount: 0
    });
    assert.equal(fixture.calls.length, 2);
  }
});

test("API rejection, oversize JSON and no refresh remain fixed and bounded", async () => {
  const calls = [];
  const denied = async (input, options) => {
    calls.push(String(input));
    if (calls.length === 1) return new Response(JSON.stringify({ token: "t", expires: Math.floor(NOW / 1000) + 300 }),
      { headers: { "content-type": "application/json" } });
    return new Response("{}", { status: 401, headers: { "content-type": "application/json" } });
  };
  await assert.rejects(checkPromoOnlyAudioSampleTransport(config(), { fetchImpl: denied, now: () => NOW }), {
    code: "PROMOONLY_AUDIO_TRANSPORT_API_FAILED", apiRequestCount: 2, headRequestCount: 0
  });
  assert.equal(calls.length, 2);
  const oversized = async () => new Response("{}", { headers: {
    "content-type": "application/json", "content-length": String(2 * 1024 * 1024 + 1)
  } });
  await assert.rejects(checkPromoOnlyAudioSampleTransport(config(), { fetchImpl: oversized, now: () => NOW }), {
    code: "PROMOONLY_AUDIO_TRANSPORT_API_FAILED", apiRequestCount: 1, headRequestCount: 0
  });
});

test("nested Node TLS and network errors return only fixed cause enums", async () => {
  for (const [code, expected] of [
    ["UNABLE_TO_VERIFY_LEAF_SIGNATURE", "TLS_LEAF_UNVERIFIED"],
    ["UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "TLS_ISSUER"],
    ["CERT_HAS_EXPIRED", "TLS_EXPIRED"],
    ["ERR_TLS_CERT_ALTNAME_INVALID", "TLS_NAME"],
    ["ENOTFOUND", "DNS"], ["UND_ERR_CONNECT_TIMEOUT", "CONNECT_TIMEOUT"],
    ["ECONNRESET", "RESET"], ["EHOSTUNREACH", "NETWORK"], ["UNKNOWN", "OTHER"]
  ]) {
    const secretError = Object.assign(new Error("do not expose media host or credentials"), { code });
    const fixture = mockFetch(undefined, Object.assign(new Error("outer"), { cause: new AggregateError([secretError]) }));
    const result = await checkPromoOnlyAudioSampleTransport(config(), { ...fixture, now: () => NOW });
    assert.equal(result.reachable, false);
    assert.equal(result.httpStatus, null);
    assert.equal(result.causeCode, expected);
    assert.equal(result.apiRequestCount, 2);
    assert.equal(result.headRequestCount, 1);
    assert.equal(JSON.stringify(result).includes("host"), false);
    assert.equal(JSON.stringify(result).includes("credentials"), false);
  }
});

test("redirect-like HEAD response is not followed or marked reachable", async () => {
  const fixture = mockFetch(undefined, { status: 302, redirected: false });
  const result = await checkPromoOnlyAudioSampleTransport(config(), { ...fixture, now: () => NOW });
  assert.equal(result.reachable, false);
  assert.equal(result.causeCode, "OTHER");
  assert.equal(fixture.calls.length, 3);
});
