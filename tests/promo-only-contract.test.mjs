import assert from "node:assert/strict";
import { test } from "node:test";
import { PromoOnlyApiClient, PromoOnlyTokenManager } from "../lib/promo-only-client.mjs";

const config = {
  userId: "42",
  apiKey: "test-key",
  apiSecret: "test-secret",
  requestTimeoutMs: 1_000,
  retryMax: 0
};

function jsonResponse(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json", ...headers } });
}

test("documented absolute token expiry rejects stale response instead of caching it", async () => {
  const now = 1_700_000_000_000;
  let calls = 0;
  const manager = new PromoOnlyTokenManager(config, {
    now: () => now,
    fetchImpl: async (url, options) => {
      calls += 1;
      assert.equal(String(url), "https://api.promoonly.com/user/authenticate");
      assert.equal(options.method, "POST");
      assert.equal(options.headers.authorization, "Basic " + Buffer.from("test-key:test-secret").toString("base64"));
      assert.equal(String(options.body), "userid=42");
      return jsonResponse({ userid: 42, token: "test-token-" + calls, expires: Math.floor(now / 1000) + (calls === 1 ? -1 : 90) });
    }
  });
  await assert.rejects(manager.getToken(), { code: "PROMOONLY_AUTH_EXPIRY_INVALID" });
  assert.equal(manager.cached, null);
  assert.equal(await manager.getToken(), "test-token-2");
  assert.equal(await manager.getToken(), "test-token-2");
  assert.equal(calls, 2);
});

test("missing, malformed, or zero token expiry is not invented as five minutes", async () => {
  const now = 1_700_000_000_000;
  for (const expiry of [undefined, "not-a-timestamp", Math.floor(now / 1000)]) {
    const payload = { userid: 42, token: "test-token", ...(expiry === undefined ? {} : { expires: expiry }) };
    const manager = new PromoOnlyTokenManager(config, { now: () => now, fetchImpl: async () => jsonResponse(payload) });
    await assert.rejects(manager.getToken(), { code: "PROMOONLY_AUTH_EXPIRY_INVALID" });
    assert.equal(manager.cached, null);
  }
});

test("documented download-success response confirms the exact signed-off request", async () => {
  const calls = [];
  const client = new PromoOnlyApiClient(config, {
    tokenManager: { getToken: async () => "test-token" },
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return jsonResponse({ releaseid: 55, result: "success", titleid: 22, type: "mp3" });
    }
  });
  const response = await client.confirmDownload({ trackid: 91, serverid: 7, dl_token: "test-grant" });
  assert.equal(response.result, "success");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.promoonly.com/download/success");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers.authorization, "Bearer " + Buffer.from("42:test-token").toString("base64"));
  assert.equal(String(calls[0].options.body), "trackid=91&serverid=7&dl_token=test-grant");
});

test("HTTP 200 without a positive download-success result remains unconfirmed", async () => {
  for (const payload of [{ result: "failed" }, { result: "successfully queued" }, { Result: "success" }, {}]) {
    const client = new PromoOnlyApiClient(config, {
      tokenManager: { getToken: async () => "test-token" },
      fetchImpl: async () => jsonResponse(payload)
    });
    await assert.rejects(client.confirmDownload({ trackid: 91, serverid: 7, dl_token: "test-grant" }), {
      code: "PROMOONLY_DOWNLOAD_ACK_REJECTED"
    });
  }
});

test("malformed supplier JSON produces a bounded error code", async () => {
  const client = new PromoOnlyApiClient(config, {
    tokenManager: { getToken: async () => "test-token" },
    fetchImpl: async () => new Response("{", { headers: { "content-type": "application/json" } })
  });
  await assert.rejects(client.track("91"), { code: "PROMOONLY_RESPONSE_INVALID_JSON" });
});

test("retryable metadata GET respects bounded Retry-After seconds without refreshing auth", async () => {
  let calls = 0;
  const forces = [];
  const delays = [];
  const client = new PromoOnlyApiClient({ ...config, retryMax: 2 }, {
    tokenManager: { getToken: async ({ force }) => { forces.push(force); return "test-token"; } },
    sleep: async (milliseconds) => { delays.push(milliseconds); },
    fetchImpl: async () => {
      calls += 1;
      return calls === 1
        ? jsonResponse({ error: "slow down" }, 429, { "retry-after": "3" })
        : jsonResponse({ trackid: 91 });
    }
  });
  assert.equal((await client.track("91")).trackid, 91);
  assert.deepEqual(delays, [3_000]);
  assert.deepEqual(forces, [false, false]);
  assert.equal(calls, 2);
});

test("Retry-After date is honored; an excessive delay fails without an early retry", async () => {
  const now = Date.parse("2026-10-10T12:00:00.000Z");
  const delays = [];
  let calls = 0;
  const client = new PromoOnlyApiClient({ ...config, retryMax: 2 }, {
    now: () => now,
    tokenManager: { getToken: async () => "test-token" },
    sleep: async (milliseconds) => { delays.push(milliseconds); },
    fetchImpl: async () => {
      calls += 1;
      return calls === 1
        ? jsonResponse({ error: "temporary" }, 503, { "retry-after": new Date(now + 10_000).toUTCString() })
        : jsonResponse({ trackid: 91 });
    }
  });
  assert.equal((await client.track("91")).trackid, 91);
  assert.deepEqual(delays, [10_000]);
  const tooLong = new PromoOnlyApiClient({ ...config, retryMax: 2 }, {
    tokenManager: { getToken: async () => "test-token" },
    sleep: async () => { throw new Error("must not sleep"); },
    fetchImpl: async () => jsonResponse({ error: "rate limited" }, 429, { "retry-after": "301" })
  });
  await assert.rejects(tooLong.track("91"), { code: "PROMOONLY_RATE_LIMITED" });
});

test("missing Retry-After keeps bounded backoff; only 401 forces a new token", async () => {
  const delays = [];
  const forces = [];
  let calls = 0;
  let cleared = 0;
  const client = new PromoOnlyApiClient({ ...config, retryMax: 2 }, {
    tokenManager: {
      getToken: async ({ force }) => { forces.push(force); return force ? "fresh-token" : "cached-token"; },
      clear: () => { cleared += 1; }
    },
    sleep: async (milliseconds) => { delays.push(milliseconds); },
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return jsonResponse({ error: "temporary" }, 503);
      if (calls === 2) return jsonResponse({ error: "expired" }, 401);
      return jsonResponse({ trackid: 91 });
    }
  });
  assert.equal((await client.track("91")).trackid, 91);
  assert.equal(delays.length, 1);
  assert.ok(delays[0] >= 800 && delays[0] <= 1_200);
  assert.deepEqual(forces, [false, false, true]);
  assert.equal(cleared, 1);
});

test("download queue and confirmation never replay ambiguous network or server failures", async () => {
  for (const operation of ["queueDownload", "confirmDownload"]) {
    for (const failure of ["network", "server"]) {
      let calls = 0;
      const client = new PromoOnlyApiClient({ ...config, retryMax: 3 }, {
        tokenManager: { getToken: async () => "test-token" },
        sleep: async () => { throw new Error("mutating request must not retry"); },
        fetchImpl: async () => {
          calls += 1;
          if (failure === "network") throw new Error("synthetic lost response");
          return jsonResponse({ error: "temporary" }, 503, { "retry-after": "2" });
        }
      });
      const request = operation === "queueDownload"
        ? client.queueDownload("91")
        : client.confirmDownload({ trackid: 91, serverid: 7, dl_token: "test-grant" });
      await assert.rejects(request, { code: failure === "network" ? "PROMOONLY_API_NETWORK" : "PROMOONLY_HTTP_503" });
      assert.equal(calls, 1);
    }
  }
});

test("supplier JSON is limited to 2 MiB with and without Content-Length", async () => {
  const max = 2 * 1024 * 1024;
  const advertised = new PromoOnlyApiClient(config, {
    tokenManager: { getToken: async () => "test-token" },
    fetchImpl: async () => new Response("{}", { headers: { "content-type": "application/json", "content-length": String(max + 1) } })
  });
  await assert.rejects(advertised.track("91"), { code: "PROMOONLY_RESPONSE_TOO_LARGE" });
  const streamed = new PromoOnlyApiClient(config, {
    tokenManager: { getToken: async () => "test-token" },
    fetchImpl: async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(max + 1));
        controller.close();
      }
    }), { headers: { "content-type": "application/json" } })
  });
  await assert.rejects(streamed.track("91"), { code: "PROMOONLY_RESPONSE_TOO_LARGE" });
});
