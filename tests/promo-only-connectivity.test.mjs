import assert from "node:assert/strict";
import { test } from "node:test";
import { checkPromoOnlyConnectivity } from "../scripts/promo-only-connectivity.mjs";

const env = { PROMOONLY_USER_ID: "42", PROMOONLY_API_KEY: "fixture-key", PROMOONLY_API_SECRET: "fixture-secret" };

test("connectivity preflight makes no request and never returns credentials", async () => {
  const noFetch = async () => { throw new Error("must not fetch"); };
  assert.equal((await checkPromoOnlyConnectivity({ env: {}, live: true, fetchImpl: noFetch })).code, "PROMOONLY_CREDENTIALS_REQUIRED");
  const result = await checkPromoOnlyConnectivity({ env, fetchImpl: noFetch });
  assert.equal(result.status, "READY");
  assert.equal(result.networkAttempted, false);
  assert.doesNotMatch(JSON.stringify(result), /fixture-key|fixture-secret/);
});

test("explicit live mode uses only documented authentication and token validation with safe output", async () => {
  const calls = [];
  const result = await checkPromoOnlyConnectivity({ env, live: true, fetchImpl: async (url, options) => {
    calls.push(String(url));
    if (calls.length === 1) return Response.json({ token: "fixture-token", expires: Math.floor(Date.now() / 1000) + 300 });
    assert.equal(String(url), "https://api.promoonly.com/user/token/validate");
    assert.equal(options.method, "POST");
    assert.equal(String(options.body), "userid=42&token=fixture-token");
    assert.equal(options.headers.authorization, undefined);
    return Response.json({ token: "valid" });
  } });
  assert.equal(result.status, "PASS");
  assert.deepEqual(calls, ["https://api.promoonly.com/user/authenticate", "https://api.promoonly.com/user/token/validate"]);
  assert.equal(result.catalogueQueried, false);
  assert.equal(result.audioDownloaded, false);
  assert.doesNotMatch(JSON.stringify(result), /fixture-key|fixture-secret|fixture-token/);
});

test("invalid validation result fails closed without exposing supplier response", async () => {
  let calls = 0;
  const result = await checkPromoOnlyConnectivity({ env, live: true, fetchImpl: async () => ++calls === 1
    ? Response.json({ token: "fixture-token", expires: Math.floor(Date.now() / 1000) + 300 })
    : Response.json({ token: "invalid", secret: "must-not-return" }) });
  assert.equal(result.code, "PROMOONLY_TOKEN_NOT_VALID");
  assert.doesNotMatch(JSON.stringify(result), /must-not-return|fixture-token/);
});
