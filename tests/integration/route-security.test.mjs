import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";

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

  const ownOrganisationSwitch = await api("/api/me/organisation", {
    method: "POST",
    cookie: cookieA,
    body: { organisationId: accountABody.organisation.id }
  });
  assert.equal(ownOrganisationSwitch.status, 200);

  const activeOrganisation = await api("/api/me", { cookie: cookieA });
  assert.equal(activeOrganisation.status, 200);
  assert.equal(
    (await activeOrganisation.json()).organisation.id,
    accountABody.organisation.id
  );

  const unauthenticatedPlayerState = await api("/api/player/state");
  assert.equal(unauthenticatedPlayerState.status, 401);

  const unauthenticatedHeartbeat = await api("/api/player/heartbeat", {
    method: "POST"
  });
  assert.equal(unauthenticatedHeartbeat.status, 401);

  const invalidPlayerEnrolment = await api("/api/player/enrol", {
    method: "POST",
    body: { code: "invalid-enrolment-code" }
  });
  assert.equal(invalidPlayerEnrolment.status, 400);

  const unauthenticatedStation = await api("/api/stations", {
    method: "POST",
    body: { name: "Unauthenticated station" }
  });
  assert.equal(unauthenticatedStation.status, 401);

  const unauthenticatedGroupAssignment = await api(
    "/api/admin/location-groups/not-a-group/channel",
    {
      method: "POST",
      body: { channelId: "not-a-channel" }
    }
  );
  assert.equal(unauthenticatedGroupAssignment.status, 401);

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

  const crossTenantOrganisationSwitch = await api("/api/me/organisation", {
    method: "POST",
    cookie: cookieB,
    body: { organisationId: accountABody.organisation.id }
  });
  assert.equal(crossTenantOrganisationSwitch.status, 403);

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

  const ownerBulkAssignmentAttempt = await api(
    "/api/admin/location-groups/not-a-group/channel",
    {
      method: "POST",
      cookie: cookieA,
      body: { channelId: "not-a-channel" }
    }
  );
  assert.equal(ownerBulkAssignmentAttempt.status, 403);

  const db = new PrismaClient();
  try {
    await db.user.update({
      where: { id: accountABody.user.id },
      data: { role: "SUPER_ADMIN" }
    });

    const location = await db.location.create({
      data: {
        organisationId: accountABody.organisation.id,
        name: `Bulk Assignment Location ${suffix}`,
        slug: `bulk-location-${suffix}`
      }
    });
    const zones = await Promise.all([
      db.zone.create({
        data: { locationId: location.id, name: "Main floor", slug: "main-floor" }
      }),
      db.zone.create({
        data: { locationId: location.id, name: "Cafe", slug: "cafe" }
      })
    ]);
    const channels = await Promise.all([
      db.channel.create({
        data: {
          organisationId: accountABody.organisation.id,
          name: `Original Channel ${suffix}`,
          slug: `original-channel-${suffix}`
        }
      }),
      db.channel.create({
        data: {
          organisationId: accountABody.organisation.id,
          name: `Group Channel ${suffix}`,
          slug: `group-channel-${suffix}`
        }
      })
    ]);
    await db.channelAssignment.create({
      data: { channelId: channels[0].id, zoneId: zones[0].id }
    });
    const locationGroup = await db.locationGroup.create({
      data: {
        organisationId: accountABody.organisation.id,
        name: `Integration Group ${suffix}`,
        slug: `integration-group-${suffix}`,
        locations: { create: { locationId: location.id } }
      }
    });

    const bulkAssignment = await api(
      `/api/admin/location-groups/${locationGroup.id}/channel`,
      {
        method: "POST",
        cookie: cookieA,
        body: { channelId: channels[1].id, dryRun: true }
      }
    );
    assert.equal(bulkAssignment.status, 200, await bulkAssignment.clone().text());
    const bulkResult = await bulkAssignment.json();
    assert.equal(bulkResult.changedZoneCount, 2);
    assert.equal(bulkResult.unchangedZoneCount, 0);
    assert.equal(bulkResult.dryRun, true);

    const assignmentsBeforeApply = await db.channelAssignment.findMany({
      where: { zoneId: { in: zones.map((zone) => zone.id) }, activeTo: null }
    });
    assert.equal(assignmentsBeforeApply.length, 1);
    assert.equal(assignmentsBeforeApply[0].channelId, channels[0].id);

    const appliedAssignment = await api(
      `/api/admin/location-groups/${locationGroup.id}/channel`,
      {
        method: "POST",
        cookie: cookieA,
        body: { channelId: channels[1].id }
      }
    );
    assert.equal(appliedAssignment.status, 200, await appliedAssignment.clone().text());
    const appliedResult = await appliedAssignment.json();
    assert.equal(appliedResult.changedZoneCount, 2);
    assert.equal(appliedResult.unchangedZoneCount, 0);

    const activeAssignments = await db.channelAssignment.findMany({
      where: { zoneId: { in: zones.map((zone) => zone.id) }, activeTo: null },
      orderBy: { zoneId: "asc" }
    });
    assert.equal(activeAssignments.length, 2);
    assert.ok(activeAssignments.every((assignment) => assignment.channelId === channels[1].id));

    const repeatedAssignment = await api(
      `/api/admin/location-groups/${locationGroup.id}/channel`,
      {
        method: "POST",
        cookie: cookieA,
        body: { channelId: channels[1].id }
      }
    );
    assert.equal(repeatedAssignment.status, 200);
    const repeatedResult = await repeatedAssignment.json();
    assert.equal(repeatedResult.changedZoneCount, 0);
    assert.equal(repeatedResult.unchangedZoneCount, 2);

    const batchAudits = await db.auditLog.count({
      where: {
        organisationId: accountABody.organisation.id,
        action: "LOCATION_GROUP_CHANNEL_ASSIGNED",
        entityId: locationGroup.id
      }
    });
    assert.equal(batchAudits, 1);
  } finally {
    await db.$disconnect();
  }

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

