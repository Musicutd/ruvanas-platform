import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { createPlaybackProofToken } from "../../lib/playback-proof.mjs";
import { hashPlayerToken } from "../../lib/player-tokens.mjs";

const baseUrl = process.env.INTEGRATION_BASE_URL || "http://127.0.0.1:3100";
const sessionSecret = process.env.SESSION_SECRET;

async function api(path, { method = "GET", body, cookie, origin = baseUrl, headers: extraHeaders = {} } = {}) {
  const headers = { ...extraHeaders };
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

function responseCookie(response) {
  return response.headers.get("set-cookie")?.split(";")[0] || "";
}

test("player enrolment, offline recovery, command delivery, proof replay, and disablement form one controlled lifecycle", async () => {
  assert.ok(sessionSecret && sessionSecret.length >= 32, "SESSION_SECRET must be configured for the integration suite.");

  const database = new PrismaClient();
  const suffix = randomUUID();
  const enrolmentCode = `enrol-${suffix}`;
  const streamUrl = `https://stream.example.invalid/${suffix}.mp3`;
  let organisationId;
  let userId;

  try {
    const operator = await database.user.create({
      data: {
        email: `player-lifecycle-${suffix}@example.invalid`,
        passwordHash: "not-used-by-player-lifecycle-test",
        role: "SUPER_ADMIN"
      }
    });
    userId = operator.id;

    const organisation = await database.organisation.create({
      data: {
        name: `Player lifecycle ${suffix}`,
        slug: `player-lifecycle-${suffix}`
      }
    });
    organisationId = organisation.id;

    const location = await database.location.create({
      data: {
        organisationId,
        name: "Lifecycle location",
        slug: "lifecycle-location",
        status: "ACTIVE"
      }
    });
    const zone = await database.zone.create({
      data: {
        locationId: location.id,
        name: "Lifecycle zone",
        slug: "lifecycle-zone"
      }
    });
    const station = await database.station.create({
      data: {
        organisationId,
        name: "Lifecycle station",
        slug: `lifecycle-station-${suffix}`,
        status: "ACTIVE",
        listenerLimit: 25,
        storageLimitGb: 5,
        maxBitrateKbps: 320,
        streamConfig: {
          create: {
            streamUrl,
            sourceConnectionStatus: "CONNECTED",
            lastConnectedAt: new Date(),
            lastHeartbeatAt: new Date()
          }
        }
      }
    });
    const channel = await database.channel.create({
      data: {
        organisationId,
        stationId: station.id,
        name: "Lifecycle channel",
        slug: "lifecycle-channel",
        status: "ACTIVE"
      }
    });
    await database.channelAssignment.create({
      data: { channelId: channel.id, zoneId: zone.id }
    });

    const player = await database.player.create({
      data: {
        organisationId,
        zoneId: zone.id,
        name: "Lifecycle player",
        status: "PENDING_ENROLMENT",
        enrolmentTokenHash: hashPlayerToken(enrolmentCode, sessionSecret),
        enrolmentExpiresAt: new Date(Date.now() + 10 * 60_000)
      }
    });

    const enrolment = await api("/api/player/enrol", {
      method: "POST",
      body: { code: enrolmentCode }
    });
    assert.equal(enrolment.status, 200, await enrolment.clone().text());
    assert.ok(enrolment.headers.get("x-request-id"));
    assert.equal((await enrolment.json()).playerId, player.id);
    const playerCookie = responseCookie(enrolment);
    assert.match(playerCookie, /^ruvanas_player=/);

    const enrolled = await database.player.findUniqueOrThrow({ where: { id: player.id } });
    assert.equal(enrolled.status, "ONLINE");
    assert.equal(enrolled.enrolmentTokenHash, null);
    assert.equal(enrolled.enrolmentExpiresAt, null);
    assert.ok(enrolled.sessionTokenHash);
    assert.ok(enrolled.enrolledAt);
    assert.equal(await database.auditLog.count({
      where: { organisationId, action: "PLAYER_ENROLLED", entityId: player.id }
    }), 1);

    const replayedEnrolment = await api("/api/player/enrol", {
      method: "POST",
      body: { code: enrolmentCode }
    });
    assert.equal(replayedEnrolment.status, 400);

    const state = await api("/api/player/state", { cookie: playerCookie });
    assert.equal(state.status, 200, await state.clone().text());
    const stateBody = await state.json();
    assert.deepEqual(stateBody.player, {
      id: player.id,
      name: "Lifecycle player",
      zone: "Lifecycle zone",
      location: "Lifecycle location"
    });
    assert.deepEqual(stateBody.channel, {
      id: channel.id,
      name: "Lifecycle channel",
      streamUrl
    });
    assert.equal(stateBody.heartbeatIntervalSeconds, 30);
    assert.equal(stateBody.manifestUrl, "/api/player/manifest");

    const offlineAt = new Date(Date.now() - 2 * 60_000);
    await database.player.update({
      where: { id: player.id },
      data: { status: "OFFLINE", lastHeartbeatAt: offlineAt }
    });
    const command = await database.playerCommand.create({
      data: {
        organisationId,
        playerId: player.id,
        requestedById: operator.id,
        kind: "COLLECT_DIAGNOSTICS",
        expiresAt: new Date(Date.now() + 10 * 60_000)
      }
    });
    assert.equal((await database.playerCommand.findUniqueOrThrow({ where: { id: command.id } })).status, "PENDING");

    const heartbeat = await api("/api/player/heartbeat", {
      method: "POST",
      cookie: playerCookie,
      headers: { "user-agent": "Ruvanas lifecycle assurance", "x-forwarded-for": "192.0.2.10" },
      body: {
        appVersion: "stage-13c",
        manifestVersion: "manifest-13c",
        sourceStatus: "connected",
        studentName: "must-not-be-retained"
      }
    });
    assert.equal(heartbeat.status, 200, await heartbeat.clone().text());
    assert.equal((await heartbeat.json()).recovered, true);

    const reconnected = await database.player.findUniqueOrThrow({ where: { id: player.id } });
    assert.equal(reconnected.status, "ONLINE");
    assert.equal(reconnected.lastIpAddress, "192.0.2.10");
    assert.equal(reconnected.lastUserAgent, "Ruvanas lifecycle assurance");
    const recoverySample = await database.playerHeartbeatSample.findFirstOrThrow({
      where: { playerId: player.id },
      orderBy: { observedAt: "desc" }
    });
    assert.equal(recoverySample.kind, "RECOVERY");
    assert.equal(recoverySample.appVersion, "stage-13c");
    assert.equal(recoverySample.manifestVersion, "manifest-13c");
    assert.equal(recoverySample.sourceStatus, "CONNECTED");

    const queuedCommand = await api("/api/player/commands", { cookie: playerCookie });
    assert.equal(queuedCommand.status, 200, await queuedCommand.clone().text());
    const queuedCommandBody = await queuedCommand.json();
    assert.equal(queuedCommandBody.command.id, command.id);
    assert.equal(queuedCommandBody.command.kind, "COLLECT_DIAGNOSTICS");
    assert.equal((await database.playerCommand.findUniqueOrThrow({ where: { id: command.id } })).status, "DELIVERED");

    const noDuplicateDelivery = await api("/api/player/commands", { cookie: playerCookie });
    assert.equal(noDuplicateDelivery.status, 200);
    assert.equal((await noDuplicateDelivery.json()).command, null);

    const acknowledgement = await api(`/api/player/commands/${command.id}/acknowledge`, {
      method: "POST",
      cookie: playerCookie,
      body: {
        outcome: "SUCCEEDED",
        message: "Diagnostics collected after reconnect.",
        details: {
          appVersion: "stage-13c",
          manifestVersion: "manifest-13c",
          sourceStatus: "connected",
          privateDetail: "must-not-be-retained"
        }
      }
    });
    assert.equal(acknowledgement.status, 200, await acknowledgement.clone().text());
    const acknowledged = await database.playerCommand.findUniqueOrThrow({ where: { id: command.id } });
    assert.equal(acknowledged.status, "ACKNOWLEDGED");
    assert.deepEqual(acknowledged.resultDetails, {
      appVersion: "stage-13c",
      manifestVersion: "manifest-13c",
      sourceStatus: "CONNECTED"
    });
    assert.equal(await database.auditLog.count({
      where: { organisationId, action: "PLAYER_COMMAND_ACKNOWLEDGED", entityId: command.id }
    }), 1);

    const replayedAcknowledgement = await api(`/api/player/commands/${command.id}/acknowledge`, {
      method: "POST",
      cookie: playerCookie,
      body: { outcome: "SUCCEEDED" }
    });
    assert.equal(replayedAcknowledgement.status, 409);

    const mediaAsset = await database.mediaAsset.create({
      data: {
        organisationId,
        libraryType: "RUVANAS_CATALOGUE",
        name: "Lifecycle track",
        originalName: "lifecycle-track.mp3",
        storageKey: `player-lifecycle/${suffix}.mp3`,
        mimeType: "audio/mpeg",
        sizeBytes: 1024n,
        durationSeconds: 30,
        mediaType: "MUSIC",
        status: "READY"
      }
    });
    const track = await database.track.create({
      data: {
        mediaAssetId: mediaAsset.id,
        title: "Lifecycle track",
        artist: "Ruvanas assurance",
        status: "READY"
      }
    });
    const proofEvent = {
      eventId: randomUUID(),
      manifestVersion: "13c13c13c13c13c13c13c13c",
      scheduleItemId: "c".repeat(64),
      itemType: "MUSIC",
      trackId: track.id,
      eventType: "COMPLETED",
      occurredAt: new Date().toISOString(),
      positionSeconds: 30
    };
    proofEvent.proofToken = createPlaybackProofToken({
      playerId: player.id,
      manifestVersion: proofEvent.manifestVersion,
      scheduleItemId: proofEvent.scheduleItemId,
      contentId: track.id
    }, sessionSecret);

    await database.player.update({
      where: { id: player.id },
      data: { status: "OFFLINE", lastHeartbeatAt: new Date(Date.now() - 2 * 60_000) }
    });
    const uploadedProof = await api("/api/player/proof-of-play", {
      method: "POST",
      cookie: playerCookie,
      body: { events: [proofEvent] }
    });
    assert.equal(uploadedProof.status, 200, await uploadedProof.clone().text());
    assert.deepEqual(
      (({ ok, accepted, duplicates }) => ({ ok, accepted, duplicates }))(await uploadedProof.json()),
      { ok: true, accepted: 1, duplicates: 0 }
    );
    assert.equal((await database.player.findUniqueOrThrow({ where: { id: player.id } })).status, "ONLINE");

    const replayedProof = await api("/api/player/proof-of-play", {
      method: "POST",
      cookie: playerCookie,
      body: { events: [proofEvent] }
    });
    assert.equal(replayedProof.status, 200, await replayedProof.clone().text());
    assert.deepEqual(
      (({ ok, accepted, duplicates }) => ({ ok, accepted, duplicates }))(await replayedProof.json()),
      { ok: true, accepted: 0, duplicates: 1 }
    );
    assert.equal(await database.proofOfPlayEvent.count({ where: { clientEventId: proofEvent.eventId } }), 1);

    await database.player.update({
      where: { id: player.id },
      data: { status: "DISABLED" }
    });
    const disabledState = await api("/api/player/state", { cookie: playerCookie });
    assert.equal(disabledState.status, 401);
    const disabledHeartbeat = await api("/api/player/heartbeat", {
      method: "POST",
      cookie: playerCookie,
      body: {}
    });
    assert.equal(disabledHeartbeat.status, 401);
    const disabledCommands = await api("/api/player/commands", { cookie: playerCookie });
    assert.equal(disabledCommands.status, 401);
    const disabledProof = await api("/api/player/proof-of-play", {
      method: "POST",
      cookie: playerCookie,
      body: { events: [proofEvent] }
    });
    assert.equal(disabledProof.status, 401);
  } finally {
    if (organisationId) {
      await database.proofOfPlayEvent.deleteMany({ where: { organisationId } });
      await database.auditLog.deleteMany({ where: { organisationId } });
      await database.organisation.deleteMany({ where: { id: organisationId } });
    }
    if (userId) await database.user.deleteMany({ where: { id: userId } });
    await database.$disconnect();
  }
});
