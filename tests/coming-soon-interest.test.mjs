import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import { test } from "node:test";
import { createInterestServer, INTEREST_PILLARS } from "../coming-soon/interest-server.mjs";

const validEnv = {
  NOTIFICATION_EMAIL_ENDPOINT: "https://mail.example.com/send",
  NOTIFICATION_EMAIL_TOKEN: "t".repeat(32),
  NOTIFICATION_EMAIL_FROM: "notifications@example.com",
  RUVANAS_INTEREST_RECIPIENT: "team@example.com"
};
const validInterest = {
  name: "Ada Lovelace",
  organisation: "Analytical Society",
  email: "ada@example.com",
  pillar: "Ruvanas School"
};

async function startServer(t, options = {}) {
  const server = createInterestServer({
    env: validEnv,
    dnsLookup: async () => [{ address: "8.8.8.8", family: 4 }],
    fetchImpl: async () => ({ ok: true, status: 202 }),
    ...options
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  return `http://127.0.0.1:${server.address().port}`;
}

async function submit(baseUrl, input = validInterest, headers = { "content-type": "application/json" }) {
  return fetch(`${baseUrl}/api/interest`, {
    method: "POST",
    headers: { origin: baseUrl, ...headers },
    body: typeof input === "string" ? input : JSON.stringify(input)
  });
}

test("serves only the coming-soon page without exposing mail configuration", async (t) => {
  const baseUrl = await startServer(t);
  const response = await fetch(baseUrl);
  const page = await response.text();
  assert.equal(response.status, 200);
  assert.match(page, /Coming soon/i);
  assert.doesNotMatch(page, /team@example\.com|t{32}/);
  assert.equal((await fetch(`${baseUrl}/lib/notification-email.mjs`)).status, 404);
  assert.equal((await fetch(`${baseUrl}/dashboard`)).status, 404);
  assert.equal((await fetch(`${baseUrl}/login`)).status, 404);
});

test("delivers a valid registration to the configured recipient before confirming success", async (t) => {
  const calls = [];
  const baseUrl = await startServer(t, {
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, status: 202 };
    }
  });
  const response = await submit(baseUrl);
  const result = await response.json();
  assert.equal(response.status, 202);
  assert.deepEqual(result, { ok: true, message: "Thank you. Your interest has been registered." });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, validEnv.NOTIFICATION_EMAIL_ENDPOINT);
  assert.equal(calls[0].options.redirect, "error");
  assert.equal(calls[0].options.headers.authorization, `Bearer ${validEnv.NOTIFICATION_EMAIL_TOKEN}`);
  const message = JSON.parse(calls[0].options.body);
  assert.equal(message.to, validEnv.RUVANAS_INTEREST_RECIPIENT);
  assert.equal(message.from, validEnv.NOTIFICATION_EMAIL_FROM);
  assert.match(message.text, /Ada Lovelace.*\nOrganisation: Analytical Society.*\nEmail: ada@example\.com.*\nPillar: Ruvanas School/s);
  assert.equal(message.idempotencyKey, calls[0].options.headers["x-idempotency-key"]);
  assert.doesNotMatch(JSON.stringify(result), /team@example\.com|t{32}/);
});

test("accepts only the seven named pillars and the four expected form fields", async (t) => {
  assert.deepEqual(INTEREST_PILLARS, [
    "Ruvanas Retail", "Ruvanas School", "Ruvanas Online Radio", "Ruvanas Health",
    "Ruvanas Faith", "Ruvanas Organisations", "Ruvanas Inside"
  ]);
  const baseUrl = await startServer(t);
  for (const input of [
    { ...validInterest, pillar: "Other" },
    { ...validInterest, extra: "ignore me" },
    { ...validInterest, organisation: "" },
    { ...validInterest, email: "a@example.com\r\nBcc: stolen@example.com" }
  ]) {
    const response = await submit(baseUrl, input);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { ok: false, message: "Please check the form and try again." });
  }
});

test("caps requests, requires JSON, and limits repeated submissions", async (t) => {
  const baseUrl = await startServer(t);
  assert.equal((await submit(baseUrl, validInterest, { "content-type": "text/plain" })).status, 415);
  assert.equal((await submit(baseUrl, "x".repeat(4097))).status, 413);
  assert.equal((await submit(baseUrl, "not json")).status, 400);
  assert.equal((await submit(baseUrl, validInterest)).status, 202);
  assert.equal((await submit(baseUrl, validInterest)).status, 202);
  assert.equal((await submit(baseUrl, validInterest)).status, 202);
  assert.equal((await submit(baseUrl, validInterest)).status, 429);
  for (let index = 0; index < 12; index += 1) {
    assert.equal((await submit(baseUrl, { ...validInterest, email: `visitor${index}@example.com` })).status, 202);
  }
});

test("caps chunked bodies without a content-length header", async (t) => {
  const baseUrl = await startServer(t);
  const result = await new Promise((resolve, reject) => {
    const request = http.request(`${baseUrl}/api/interest`, {
      method: "POST",
      headers: { origin: baseUrl, "content-type": "application/json", "transfer-encoding": "chunked" }
    }, (response) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode));
    });
    request.on("error", reject);
    request.end("x".repeat(4097));
  });
  assert.equal(result, 413);
});

test("accepts only requests from the same browser origin", async (t) => {
  let calls = 0;
  const baseUrl = await startServer(t, {
    fetchImpl: async () => { calls += 1; return { ok: true, status: 202 }; }
  });
  const crossOrigin = await submit(baseUrl, validInterest, {
    "content-type": "application/json",
    origin: "https://other.example.com"
  });
  assert.equal(crossOrigin.status, 403);
  const missingOrigin = await fetch(`${baseUrl}/api/interest`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(validInterest)
  });
  assert.equal(missingOrigin.status, 403);
  assert.equal(calls, 0);
  assert.equal((await submit(baseUrl)).status, 202);
  assert.equal(calls, 1);
});

test("fails closed when recipient or provider configuration is missing", async (t) => {
  let calls = 0;
  const baseUrl = await startServer(t, {
    env: { ...validEnv, RUVANAS_INTEREST_RECIPIENT: "" },
    fetchImpl: async () => { calls += 1; return { ok: true, status: 202 }; }
  });
  const response = await submit(baseUrl);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).ok, false);
  assert.equal(calls, 0);

  const otherBaseUrl = await startServer(t, { env: { RUVANAS_INTEREST_RECIPIENT: "team@example.com" } });
  assert.equal((await submit(otherBaseUrl)).status, 503);
});

test("never confirms success when the provider fails or resolves privately", async (t) => {
  const failedProviderUrl = await startServer(t, {
    fetchImpl: async () => ({ ok: false, status: 503 })
  });
  const failedResponse = await submit(failedProviderUrl);
  assert.equal(failedResponse.status, 503);
  assert.deepEqual(await failedResponse.json(), {
    ok: false,
    message: "We couldn't register your interest right now. Please try again later."
  });

  let calls = 0;
  const privateUrl = await startServer(t, {
    dnsLookup: async () => [{ address: "127.0.0.1", family: 4 }],
    fetchImpl: async () => { calls += 1; return { ok: true, status: 202 }; }
  });
  assert.equal((await submit(privateUrl)).status, 503);
  assert.equal(calls, 0);
});
