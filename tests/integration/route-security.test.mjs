import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

const baseUrl = process.env.INTEGRATION_BASE_URL || "http://127.0.0.1:3100";

async function api(path, { method = "GET", body, cookie, origin = baseUrl } = {}) {
  const headers = {};
  if (origin !== null) headers.origin = origin;
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers["content-type"] = "application/json";

  return fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual"
  });
}

function sessionCookie(response) {
  return response.headers.get("set-cookie")?.split(";")[0] || "";
}

test("route-level origin, authentication, tenant, plan, and rate-limit controls", async () => {
  const missingOrigin = await api("/api/auth/login", {
    method: "POST",
    origin: null,
    body: { email: "nobody@example.invalid", password: "not-a-password" }
  });
  assert.equal(missingOrigin.status, 403);
  assert.ok(missingOrigin.headers.get("x-request-id"));

  const foreignOrigin = await api("/api/auth/login", {
    method: "POST",
    origin: "https://attacker.example",
    body: { email: "nobody@example.invalid", password: "not-a-password" }
  });
  assert.equal(foreignOrigin.status, 403);

  const suffix = randomUUID();
  const accountA = await api("/api/auth/register", {
    method: "POST",
    body: {
      name: "Integration Owner A",
      organisationName: `Integration A ${suffix}`,
      email: `integration-a-${suffix}@example.invalid`,
      password: "correct-horse-battery-staple"
    }
  });
  assert.equal(accountA.status, 201, await accountA.clone().text());
  const accountABody = await accountA.json();
  const cookieA = sessionCookie(accountA);
  assert.ok(cookieA);

  const me = await api("/api/me", { cookie: cookieA });
  assert.equal(me.status, 200);

  const unauthenticatedStation = await api("/api/stations", {
    method: "POST",
    body: { name: "Unauthenticated station" }
  });
  assert.equal(unauthenticatedStation.status, 401);

  const station = await api("/api/stations", {
    method: "POST",
    cookie: cookieA,
    body: { name: `Integration Station ${suffix}` }
  });
  assert.equal(station.status, 200, await station.text());

  const stationOverLimit = await api("/api/stations", {
    method: "POST",
    cookie: cookieA,
    body: { name: `Second Integration Station ${suffix}` }
  });
  assert.equal(stationOverLimit.status, 403);

  const accountB = await api("/api/auth/register", {
    method: "POST",
    body: {
      name: "Integration Owner B",
      organisationName: `Integration B ${suffix}`,
      email: `integration-b-${suffix}@example.invalid`,
      password: "correct-horse-battery-staple"
    }
  });
  assert.equal(accountB.status, 201, await accountB.clone().text());
  const cookieB = sessionCookie(accountB);

  const crossTenantStation = await api("/api/stations", {
    method: "POST",
    cookie: cookieB,
    body: {
      name: "Cross-tenant attempt",
      organisationId: accountABody.organisation.id
    }
  });
  assert.equal(crossTenantStation.status, 403);

  const ownerAdminAttempt = await api("/api/admin/stations", {
    method: "POST",
    cookie: cookieA,
    body: { name: "Forbidden admin action" }
  });
  assert.equal(ownerAdminAttempt.status, 403);

  const fakeAudio = new FormData();
  fakeAudio.set("organisationId", accountABody.organisation.id);
  fakeAudio.set("name", "Renamed executable");
  fakeAudio.set("mediaType", "JINGLE");
  fakeAudio.set("file", new Blob(["not audio content"], { type: "audio/mpeg" }), "fake.mp3");
  const invalidUpload = await fetch(`${baseUrl}/api/media/upload`, {
    method: "POST",
    headers: { origin: baseUrl, cookie: cookieA },
    body: fakeAudio
  });
  assert.equal(invalidUpload.status, 400);

  const limitedEmail = `rate-limit-${suffix}@example.invalid`;
  let lastResponse;
  for (let attempt = 0; attempt < 11; attempt += 1) {
    lastResponse = await api("/api/auth/login", {
      method: "POST",
      body: { email: limitedEmail, password: "incorrect-password" }
    });
  }
  assert.equal(lastResponse.status, 429);
  assert.ok(Number(lastResponse.headers.get("retry-after")) > 0);
});

