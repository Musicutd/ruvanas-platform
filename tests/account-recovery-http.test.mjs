import test from "node:test";
import assert from "node:assert/strict";
import { createAccountRecoveryHttp } from "../lib/account-recovery-http.mjs";
import { createAccountRecoveryService, accountRecoveryMode } from "../lib/account-recovery-service.mjs";
import { ACCOUNT_RECOVERY_MESSAGE, validateRecoveryPassword } from "../lib/account-recovery.mjs";
import { pilotPreviewEnvironment } from "./fixtures/rewards-pilot-preview.mjs";

const NOW = new Date("2026-11-25T12:00:00.000Z");
const environment = () => ({ ...pilotPreviewEnvironment(), RUVANAS_RETAIL_REWARDS_ENABLED: "false",
  RUVANAS_PRIVATE_PREVIEW_ACCOUNT_RECOVERY_ENABLED: "true",
  RUVANAS_PRIVATE_PREVIEW_ACCOUNT_RECOVERY_ACCOUNTS: '[{"userId":"owner-one","organisationId":"org-one","email":"shop@example.invalid"}]',
  RUVANAS_PRIVATE_PREVIEW_ACCOUNT_RECOVERY_EXPIRES_AT: "2026-11-25T13:00:00.000Z" });
const input = (operation, body, extra = {}) => new Request(`https://preview.example.invalid/api/auth/password-recovery/${operation}`, {
  method: "POST", headers: { Origin: "https://preview.example.invalid", "Content-Type": "application/json", ...extra }, body: JSON.stringify(body) });
const reset = { token: "a".repeat(64), password: "SyntheticRecovery42", confirmation: "SyntheticRecovery42" };
function fixture(env = environment(), overrides = {}) {
  const seen = [], waits = [], rates = [];
  const http = createAccountRecoveryHttp({ env, clock: () => NOW, wait: async ms => waits.push(ms),
    rateLimit: async args => { rates.push(args); return { allowed: true }; },
    loadService: async () => ({ request: async data => { seen.push(data); return { ok: true, message: ACCOUNT_RECOVERY_MESSAGE, token: "never-serialize" }; },
      reset: async data => { seen.push(data); return { ok: true, message: "Reset completed", destination: null, passwordHash: "never-serialize" }; } }), ...overrides });
  return { http, seen, waits, rates };
}

test("preview recovery defaults closed without database or email work, including malformed configuration", async () => {
  for (const patch of [{ RUVANAS_PRIVATE_PREVIEW_ACCOUNT_RECOVERY_ENABLED: undefined },
    { RUVANAS_PRIVATE_PREVIEW_ACCOUNT_RECOVERY_ENABLED: "TRUE" },
    { RUVANAS_PRIVATE_PREVIEW_ACCOUNT_RECOVERY_EXPIRES_AT: NOW.toISOString() },
    { RUVANAS_PRIVATE_PREVIEW_ACCOUNT_RECOVERY_ACCOUNTS: "[]" }]) {
    const env = { ...environment(), ...patch }, f = fixture(env);
    assert.equal((await f.http.request(input("request", { email: "shop@example.invalid" }))).status, 404);
    assert.equal((await f.http.reset(input("reset", reset))).status, 404);
    assert.equal(f.seen.length, 0); assert.equal(f.rates.length, 0);
    const service = createAccountRecoveryService({ env, clock: () => NOW,
      db: new Proxy({}, { get() { assert.fail("Database cannot be loaded while recovery is closed"); } }),
      sendEmail() { assert.fail("No email while closed"); } });
    assert.equal((await service.request({ email: "shop@example.invalid" })).code, "FEATURE_DISABLED");
    assert.equal((await service.reset(reset)).code, "FEATURE_DISABLED");
  }
});

test("recovery can work with Rewards off, with neutral confirmation and no secret response or cookie", async () => {
  const env = environment(), before = structuredClone(env), f = fixture(env);
  assert.equal(accountRecoveryMode(env, NOW), "PREVIEW");
  const response = await f.http.request(input("request", { email: " SHOP@Example.invalid " }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, message: ACCOUNT_RECOVERY_MESSAGE });
  assert.equal(f.seen[0].email, "shop@example.invalid"); assert.equal(f.rates.length, 2);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.match(response.headers.get("cache-control"), /no-store/);
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(f.waits.length, 1);
  const result = await f.http.reset(input("reset", reset));
  assert.deepEqual(await result.json(), { ok: true, message: "Reset completed", destination: null });
  assert.deepEqual(env, before, "No product flags or credentials are altered by HTTP handling");
});

test("origin, methods, content type, body bounds and unexpected fields deny before the recovery service", async () => {
  const requests = [input("request", { email: "shop@example.invalid" }, { Origin: "https://foreign.invalid" }),
    input("request", { email: "shop@example.invalid" }, { "sec-fetch-site": "cross-site" }),
    input("request", { email: "shop@example.invalid" }, { "next-action": "action" }),
    input("request", { email: "shop@example.invalid" }, { "Content-Type": "text/plain" }),
    input("request", { email: "shop@example.invalid", organisationId: "foreign" }),
    input("request", { email: "x".repeat(9000) }),
    input("request", { email: "shop@example.invalid" }, { "Content-Length": "9000" }),
    new Request("https://preview.example.invalid/api/auth/password-recovery/request", { method: "GET" }),
    new Request("https://preview.example.invalid/api/auth/password-recovery/request?email=leak", { method: "POST", headers: { Origin: "https://preview.example.invalid", "Content-Type": "application/json" }, body: '{}' })];
  for (const request of requests) {
    const f = fixture(); const result = await f.http.request(request);
    assert.ok(result.status >= 400); assert.equal(f.seen.length, 0);
  }
});

test("IP and subject limits stop issuance and use distinct reset/request buckets", async () => {
  for (const denyAt of [1, 2]) {
    let count = 0;
    const f = fixture(environment(), { rateLimit: async () => ({ allowed: ++count !== denyAt, retryAfterSeconds: 60 }) });
    const result = await f.http.request(input("request", { email: "shop@example.invalid" }));
    assert.equal(result.status, 429); assert.equal(result.headers.get("retry-after"), "60"); assert.equal(f.seen.length, 0);
  }
  const f = fixture(); await f.http.reset(input("reset", reset));
  assert.equal(f.rates[0].operation, "reset"); assert.equal(f.rates[0].subject, undefined);
  assert.notEqual(f.rates[1].subject, reset.token); assert.match(f.rates[1].subject, /^[a-f0-9]{64}$/);
});

test("missing provider is an account-independent unavailable result and never queries users", async () => {
  const env = environment(); let reads = 0;
  const service = createAccountRecoveryService({ env, clock: () => NOW,
    db: new Proxy({}, { get() { reads++; throw Error("No user lookup expected"); } }),
    sendEmail() { assert.fail("No email without configuration"); } });
  for (const email of ["shop@example.invalid", "unknown@example.invalid"]) {
    const f = fixture(env, { loadService: async () => service });
    const response = await f.http.request(input("request", { email }));
    assert.equal(response.status, 503); assert.equal((await response.json()).code, "DELIVERY_UNAVAILABLE");
  }
  assert.equal(reads, 0);
});

test("reset validates the same UTF-8 boundary on the server as the client and pilot login", async () => {
  for (const password of ["a".repeat(71) + "1", "é".repeat(35) + "A1"]) assert.equal(validateRecoveryPassword({ password, confirmation: password }).ok, true);
  for (const password of ["a".repeat(72) + "1", "é".repeat(36) + "A1", "SyntheticReset42\0", "SyntheticReset42\ud800"]) {
    const f = fixture(); const response = await f.http.reset(input("reset", { ...reset, password, confirmation: password }));
    assert.equal(response.status, 400); assert.equal(f.seen.length, 0);
  }
  const f = fixture(); const result = await f.http.reset(input("reset", { ...reset, token: "bad" }));
  assert.equal(result.status, 410); assert.equal(f.seen.length, 0);
});

test("ordinary production recovery remains available without the preview bridge", () => {
  assert.equal(accountRecoveryMode({ NODE_ENV: "production", RUVANAS_PUBLIC_URL: "https://www.ruvanas.com" }, NOW), "ORDINARY");
});
