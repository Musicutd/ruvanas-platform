import test from "node:test";
import assert from "node:assert/strict";
import { checkoutAmountMinor, checkoutAttempt, checkoutMessage, checkoutRequest } from "../lib/retail-rewards/checkout-ui.mjs";

test("checkout amounts use exact integer cents and reject ambiguous purchase input", () => {
  for (const [input, expected] of [["0", 0], ["50", 5000], [" 50.10 ", 5010], ["0.01", 1], ["1000000.00", 100000000]]) assert.equal(checkoutAmountMinor(input), expected);
  for (const input of ["", ".5", "1e3", "-5", "50,00", "00.50", "12.345", "Infinity", "1000000.01", "9007199254740992", 50]) assert.equal(checkoutAmountMinor(input), null);
});
test("retry retains one ephemeral key for identical payload and creates another for changed payload", () => {
  let n = 0; const key = () => `sample-key-${++n}`;
  const first = checkoutAttempt(null, { shopSlug: "sample", expectedRevision: 1 }, key);
  assert.equal(checkoutAttempt(first, { shopSlug: "sample", expectedRevision: 1 }, key), first);
  const changed = checkoutAttempt(first, { shopSlug: "sample", expectedRevision: 2 }, key);
  assert.notEqual(changed.key, first.key); assert.equal(n, 2);
});
test("request errors use fixed messages rather than service text or secrets", async () => {
  await assert.rejects(checkoutRequest(async () => ({ ok: false, code: "LIMIT_REACHED", error: "private-token-here" }), "/api/rewards/claims"), error => error.code === "LIMIT_REACHED" && !error.message.includes("private-token"));
  assert.equal(checkoutMessage("PRIVATE-TOKEN"), checkoutMessage(undefined));
});
test("write adapter keeps token in JSON with same-origin credentials and no query authority", async () => {
  const calls = [];
  const result = await checkoutRequest(async (path, options) => { calls.push({ path, options }); return { ok: true }; }, "/api/retail-rewards/checkout/validate", { method: "POST", body: { token: "a".repeat(64), locationId: "sample-location" } });
  assert.equal(result.ok, true); assert.equal(calls[0].path.includes("?"), false); assert.equal(calls[0].options.credentials, "same-origin");
  assert.equal(calls[0].options.headers["Content-Type"], "application/json"); assert.equal(JSON.parse(calls[0].options.body).token.length, 64);
});
