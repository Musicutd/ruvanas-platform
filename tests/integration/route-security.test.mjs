import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { hashPlayerToken } from "../../lib/player-tokens.mjs";

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

  const unauthenticatedManifest = await api("/api/player/manifest");
  assert.equal(unauthenticatedManifest.status, 401);

  const unauthenticatedPlayerMedia = await api("/api/player/media/not-an-asset");
  assert.equal(unauthenticatedPlayerMedia.status, 401);

  const unauthenticatedHeartbeat = await api("/api/player/heartbeat", {
    method: "POST"
  });
  assert.equal(unauthenticatedHeartbeat.status, 401);

  const unauthenticatedProofOfPlay = await api("/api/player/proof-of-play", {
    method: "POST",
    body: { events: [] }
  });
  assert.equal(unauthenticatedProofOfPlay.status, 401);

  const unauthenticatedPromoArchive = await api(
    "/api/admin/promos/example/status",
    { method: "PATCH", body: { status: "ARCHIVED" } }
  );
  assert.equal(unauthenticatedPromoArchive.status, 401);

  const unauthenticatedPromoReview = await api(
    "/api/admin/promos/example/versions/example/review",
    { method: "PATCH", body: { decision: "APPROVE" } }
  );
  assert.equal(unauthenticatedPromoReview.status, 401);

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

  const unauthenticatedOpeningHours = await api(
    "/api/admin/locations/not-a-location/opening-hours",
    { method: "PUT", body: { weeklyHours: [], exceptions: [] } }
  );
  assert.equal(unauthenticatedOpeningHours.status, 401);

  const unauthenticatedMusicMode = await api("/api/admin/music-modes", {
    method: "POST",
    body: { organisationId: "not-an-organisation", name: "No session" }
  });
  assert.equal(unauthenticatedMusicMode.status, 401);

  const unauthenticatedMusicSchedule = await api("/api/admin/music-schedules", {
    method: "POST",
    body: { organisationId: "not-an-organisation", targetType: "LOCATION", targetId: "not-a-location", name: "No session", slots: [] }
  });
  assert.equal(unauthenticatedMusicSchedule.status, 401);

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

  const ownerOpeningHoursAttempt = await api(
    "/api/admin/locations/not-a-location/opening-hours",
    { method: "PUT", cookie: cookieA, body: { weeklyHours: [], exceptions: [] } }
  );
  assert.equal(ownerOpeningHoursAttempt.status, 403);

  const ownerMusicModeAttempt = await api("/api/admin/music-modes", {
    method: "POST",
    cookie: cookieA,
    body: {
      organisationId: accountABody.organisation.id,
      name: "Forbidden music mode"
    }
  });
  assert.equal(ownerMusicModeAttempt.status, 403);

  const ownerMusicScheduleAttempt = await api("/api/admin/music-schedules", {
    method: "POST",
    cookie: cookieA,
    body: { organisationId: accountABody.organisation.id, targetType: "LOCATION", targetId: "not-a-location", name: "Forbidden schedule", slots: [] }
  });
  assert.equal(ownerMusicScheduleAttempt.status, 403);

  const db = new PrismaClient();
  try {
    await db.user.update({
      where: { id: accountABody.user.id },
      data: { role: "SUPER_ADMIN" }
    });

    const musicMode = await api("/api/admin/music-modes", {
      method: "POST",
      cookie: cookieA,
      body: {
        organisationId: accountABody.organisation.id,
        name: `Morning Energy ${suffix}`,
        description: "Integration draft mode",
        tracks: []
      }
    });
    assert.equal(musicMode.status, 201, await musicMode.clone().text());
    const musicModeBody = await musicMode.json();
    assert.equal(musicModeBody.mode.status, "DRAFT");
    assert.equal(
      await db.auditLog.count({
        where: {
          organisationId: accountABody.organisation.id,
          action: "MUSIC_MODE_CREATED",
          entityId: musicModeBody.mode.id
        }
      }),
      1
    );

    const catalogueAsset = await db.mediaAsset.create({
      data: {
        name: `Rights-cleared track ${suffix}`,
        originalName: "integration.mp3",
        storageKey: `integration/catalogue/${suffix}.mp3`,
        mimeType: "audio/mpeg",
        sizeBytes: 1024n,
        durationSeconds: 180,
        mediaType: "MUSIC",
        libraryType: "RUVANAS_CATALOGUE",
        status: "READY"
      }
    });
    const track = await db.track.create({
      data: {
        mediaAssetId: catalogueAsset.id,
        title: `Integration Track ${suffix}`,
        artist: "Ruvanas Test Artist",
        status: "READY"
      }
    });
    await assert.rejects(
      db.musicModeTrack.create({
        data: {
          musicModeId: musicModeBody.mode.id,
          trackId: track.id,
          weight: 0
        }
      })
    );
    await db.musicModeTrack.create({ data: { musicModeId: musicModeBody.mode.id, trackId: track.id, weight: 100 } });
    const activateMode = await api(`/api/admin/music-modes/${musicModeBody.mode.id}/status`, {
      method: "PATCH", cookie: cookieA, body: { status: "ACTIVE" }
    });
    assert.equal(activateMode.status, 200, await activateMode.clone().text());

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
    const openingHours = await api(
      `/api/admin/locations/${location.id}/opening-hours`,
      {
        method: "PUT",
        cookie: cookieA,
        body: {
          weeklyHours: Array.from({ length: 7 }, (_, weekday) => ({
            weekday,
            isClosed: false,
            opensAt: "00:00",
            closesAt: "23:59"
          })),
          exceptions: [
            { date: "2026-12-25", label: "Christmas", isClosed: true },
            { date: "2026-12-31", label: "New Year's Eve", isClosed: false, opensAt: "09:00", closesAt: "14:00" }
          ]
        }
      }
    );
    assert.equal(openingHours.status, 200, await openingHours.clone().text());
    assert.equal(await db.locationOpeningHour.count({ where: { locationId: location.id } }), 7);
    assert.equal(await db.locationOpeningException.count({ where: { locationId: location.id } }), 2);
    assert.equal(await db.auditLog.count({ where: { action: "LOCATION_OPENING_HOURS_UPDATED", entityId: location.id } }), 1);
    const publishedSchedule = await api("/api/admin/music-schedules", {
      method: "POST",
      cookie: cookieA,
      body: {
        organisationId: accountABody.organisation.id,
        targetType: "LOCATION",
        targetId: location.id,
        name: `Retail week ${suffix}`,
        publish: true,
        slots: Array.from({ length: 7 }, (_, weekday) => ({ weekday, startsAt: "00:00", endsAt: "23:59", musicModeId: musicModeBody.mode.id, priority: 10 }))
      }
    });
    assert.equal(publishedSchedule.status, 201, await publishedSchedule.clone().text());
    const publishedScheduleBody = await publishedSchedule.json();
    assert.equal(publishedScheduleBody.schedule.status, "PUBLISHED");
    assert.equal(publishedScheduleBody.schedule.version, 1);
    assert.equal(await db.auditLog.count({ where: { action: "MUSIC_SCHEDULE_PUBLISHED", entityId: publishedScheduleBody.schedule.id } }), 1);

    const resolvedSchedule = await api(`/api/admin/music-schedules/resolve?zoneId=${zones[0].id}&at=2026-08-31T10%3A00%3A00.000Z`, { cookie: cookieA });
    assert.equal(resolvedSchedule.status, 200, await resolvedSchedule.clone().text());
    const resolvedScheduleBody = await resolvedSchedule.json();
    assert.equal(resolvedScheduleBody.resolution.musicMode.id, musicModeBody.mode.id);
    assert.equal(resolvedScheduleBody.resolution.reason, "LOCATION_SLOT");

    const rawPlayerToken = `integration-player-${suffix}`;
    await db.player.create({ data: {
      organisationId: accountABody.organisation.id,
      zoneId: zones[0].id,
      name: `Integration Player ${suffix}`,
      status: "ONLINE",
      sessionTokenHash: hashPlayerToken(rawPlayerToken, process.env.SESSION_SECRET),
      enrolledAt: new Date(),
      lastHeartbeatAt: new Date()
    } });
    const playerManifest = await api("/api/player/manifest", { cookie: `ruvanas_player=${rawPlayerToken}` });
    assert.equal(playerManifest.status, 200, await playerManifest.clone().text());
    const playerManifestBody = await playerManifest.json();
    assert.equal(playerManifestBody.state, "READY");
    assert.equal(playerManifestBody.musicMode.id, musicModeBody.mode.id);
    assert.equal(playerManifestBody.playlist[0].trackId, track.id);
    assert.equal("storageKey" in playerManifestBody.playlist[0], false);
    assert.match(playerManifestBody.playlist[0].proofToken, /^[0-9a-f]{64}$/);

    const playbackEventId = randomUUID();
    const playbackEvent = {
      eventId: playbackEventId,
      manifestVersion: playerManifestBody.version,
      proofToken: playerManifestBody.playlist[0].proofToken,
      trackId: track.id,
      eventType: "STARTED",
      occurredAt: new Date().toISOString(),
      positionSeconds: 0
    };
    const proofOfPlay = await api("/api/player/proof-of-play", {
      method: "POST",
      cookie: `ruvanas_player=${rawPlayerToken}`,
      body: { events: [playbackEvent] }
    });
    assert.equal(proofOfPlay.status, 200, await proofOfPlay.clone().text());
    assert.equal((await proofOfPlay.json()).accepted, 1);

    const duplicateProofOfPlay = await api("/api/player/proof-of-play", {
      method: "POST",
      cookie: `ruvanas_player=${rawPlayerToken}`,
      body: { events: [playbackEvent] }
    });
    assert.equal(duplicateProofOfPlay.status, 200, await duplicateProofOfPlay.clone().text());
    assert.equal((await duplicateProofOfPlay.json()).duplicates, 1);
    assert.equal(await db.proofOfPlayEvent.count({ where: { playerId: playerManifestBody.player.id, clientEventId: playbackEventId } }), 1);

    const tamperedProofOfPlay = await api("/api/player/proof-of-play", {
      method: "POST",
      cookie: `ruvanas_player=${rawPlayerToken}`,
      body: { events: [{ ...playbackEvent, eventId: randomUUID(), proofToken: "0".repeat(64) }] }
    });
    assert.equal(tamperedProofOfPlay.status, 400);

    const unavailablePlayerMedia = await api("/api/player/media/not-an-asset", { cookie: `ruvanas_player=${rawPlayerToken}` });
    assert.equal(unavailablePlayerMedia.status, 404);
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

    await assert.rejects(
      db.channelAssignment.create({
        data: {
          channelId: channels[0].id,
          zoneId: zones[1].id
        }
      }),
      (error) => error?.code === "P2002"
    );

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
