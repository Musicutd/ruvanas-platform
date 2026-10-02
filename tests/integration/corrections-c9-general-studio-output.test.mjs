import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { countUnconfirmedStudioExternalShutdowns } from "../../lib/studio-broadcast-service.js";
import { generalStudioChannelIds, generalStudioStationIds } from "../../lib/studio-general-output-boundary.mjs";

const baseUrl = process.env.INTEGRATION_BASE_URL || "http://127.0.0.1:3100";
const ciDatabase = process.env.GITHUB_ACTIONS === "true" &&
  process.env.DATABASE_URL === "postgresql://postgres:postgres@localhost:5432/ruvanas";

async function api(path, { method = "GET", cookie, body, idempotencyKey } = {}) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      origin: baseUrl,
      ...(cookie ? { cookie } : {}),
      ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" })
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual"
  });
}

test("generic Studio live output excludes private Inside channels, stations and legacy sessions", async () => {
  if (!ciDatabase || !process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
    throw new Error("C9 generic Studio integration runs only against the exact disposable CI database.");
  }

  const db = new PrismaClient();
  const suffix = randomUUID();
  let organisationId;
  let userId;
  let planId;
  try {
    const plan = await db.plan.create({ data: {
      name: `Fictional C9 Studio ${suffix}`, code: `C9_STUDIO_${suffix}`,
      productFamily: "ONLINE", tierNumber: 3, monthlyPriceCents: 0,
      storageLimitGb: 1, listenerLimit: 10, maxBitrateKbps: 128,
      onlineRadioEnabled: true, stationLimit: 5
    } });
    planId = plan.id;
    const organisation = await db.organisation.create({ data: {
      name: `Fictional C9 Studio ${suffix}`, slug: `c9-studio-${suffix}`
    } });
    organisationId = organisation.id;
    const password = `CI-only-${randomUUID()}!`;
    const user = await db.user.create({ data: {
      email: `c9-studio-${suffix}@example.invalid`, passwordHash: await bcrypt.hash(password, 4), role: "OWNER"
    } });
    userId = user.id;
    await db.organisationMember.create({ data: { organisationId, userId, role: "OWNER" } });
    await db.subscription.create({ data: { organisationId, planId, status: "ACTIVE" } });

    const publicLocation = await db.location.create({ data: {
      organisationId, name: "Fictional public studio", slug: `c9-studio-public-${suffix}`,
      zones: { create: { name: "Public room", slug: "public-room" } }
    }, include: { zones: true } });
    const privateFacility = await db.location.create({ data: {
      organisationId, name: "Fictional private facility", slug: `c9-studio-private-${suffix}`,
      correctionsFacility: { create: {} }, zones: { create: { name: "Private wing", slug: "private-wing" } }
    }, include: { zones: true } });
    async function station(name, productFamily) {
      return db.station.create({ data: {
        organisationId, productFamily, name, slug: `c9-${name.toLowerCase().replaceAll(" ", "-")}-${suffix}`,
        status: "ACTIVE", listenerLimit: 10, storageLimitGb: 1, maxBitrateKbps: 128,
        streamConfig: { create: { sourceConnectionStatus: "CONNECTED" } }
      } });
    }
    const ordinaryStation = await station("Ordinary Studio", "ONLINE");
    const insideStation = await station("Private Studio", "CORRECTIONS");
    const legacyStation = await station("Legacy Studio", null);
    async function channel(name, stationId, musicRightsUse = "ONLINE_RADIO") {
      return db.channel.create({ data: {
        organisationId, stationId, name, slug: `c9-${name.toLowerCase().replaceAll(" ", "-")}-${suffix}`,
        status: "ACTIVE", musicRightsUse
      } });
    }
    const ordinaryChannel = await channel("Ordinary Channel", ordinaryStation.id);
    const insideChannel = await channel("Inside Channel", insideStation.id, "CORRECTIONS_RADIO");
    const legacyOrdinaryChannel = await channel("Legacy Ordinary Channel", legacyStation.id);
    await channel("Legacy Private Sibling", legacyStation.id, "CORRECTIONS_RADIO");
    const facilityChannel = await channel("Facility Channel", null);
    await db.channelAssignment.createMany({ data: [
      { channelId: ordinaryChannel.id, zoneId: publicLocation.zones[0].id },
      { channelId: facilityChannel.id, zoneId: privateFacility.zones[0].id }
    ] });
    const autoDj = await db.autoDjPolicy.create({ data: {
      organisationId, channelId: ordinaryChannel.id, enabled: true, state: "ACTIVE", rightsUse: "ONLINE_RADIO"
    } });
    async function media(name) {
      return db.mediaAsset.create({ data: {
        organisationId, libraryType: "ORGANISATION_PROMO", name, originalName: `${name}.mp3`,
        storageKey: `c9-studio/${suffix}/${name}.mp3`, mimeType: "audio/mpeg",
        sizeBytes: 1024n, durationSeconds: 20, mediaType: "JINGLE", status: "READY"
      } });
    }
    const ordinaryMedia = await media("ordinary-media");
    const supervisedTakeMedia = await media("supervised-take");
    const supervisedRenderMedia = await media("supervised-render");
    const programme = await db.correctionsProgramme.create({ data: {
      organisationId, facilityId: privateFacility.id, title: "Fictional supervised programme", createdByUserId: userId
    } });
    const contributor = await db.correctionsContributor.create({ data: {
      organisationId, facilityId: privateFacility.id, displayName: "Fictional contributor", createdByUserId: userId
    } });
    const project = await db.audioProject.create({ data: {
      organisationId, title: "Fictional supervised output", editDecision: {}, createdByUserId: userId
    } });
    const projectVersion = await db.audioProjectVersion.create({ data: {
      projectId: project.id, version: 1, state: {}, createdByUserId: userId
    } });
    await db.correctionsStudioSession.create({ data: {
      organisationId, facilityId: privateFacility.id, contributorId: contributor.id,
      programmeId: programme.id, projectId: project.id, supervisorUserId: userId,
      createdByUserId: userId, capabilityScope: { purpose: "CI-only supervision" }
    } });
    await db.audioTake.create({ data: {
      organisationId, projectId: project.id, mediaAssetId: supervisedTakeMedia.id,
      recordedByUserId: userId, sourceEditDecision: {}, status: "READY"
    } });
    await db.audioRender.create({ data: {
      organisationId, projectId: project.id, versionId: projectVersion.id,
      outputMediaAssetId: supervisedRenderMedia.id, requestedByUserId: userId,
      preset: "SPEECH_MP3", status: "SUCCEEDED"
    } });
    const ordinaryPlayout = await db.studioPlayoutSession.create({ data: {
      organisationId, channelId: ordinaryChannel.id, productFamily: "ONLINE", title: "Fictional ordinary playout",
      fallbackAutoDjId: autoDj.id, createdByUserId: userId
    } });
    const insidePlayout = await db.studioPlayoutSession.create({ data: {
      organisationId, channelId: insideChannel.id, productFamily: "ONLINE", title: "Fictional legacy private playout",
      createdByUserId: userId
    } });
    const productMarkedPlayout = await db.studioPlayoutSession.create({ data: {
      organisationId, channelId: ordinaryChannel.id, productFamily: "CORRECTIONS", title: "Fictional product-marked private playout",
      createdByUserId: userId
    } });
    async function destination(name, stationId, type = "RUVANAS_MANAGED") {
      return db.studioBroadcastDestination.create({ data: {
        organisationId, stationId, name, type, enabled: true, createdByUserId: userId
      } });
    }
    const ordinaryDestination = await destination(`Ordinary destination ${suffix}`, ordinaryStation.id);
    const insideDestination = await destination(`Inside destination ${suffix}`, insideStation.id);
    const legacyDestination = await destination(`Legacy destination ${suffix}`, legacyStation.id);
    const externalDestination = await destination(`External destination ${suffix}`, null, "ICECAST");
    async function broadcast(playoutSessionId, destinationId) {
      return db.studioBroadcastSession.create({ data: {
        organisationId, playoutSessionId, createdByUserId: userId,
        destinations: { create: { destinationId } }
      } });
    }
    const ordinaryBroadcast = await broadcast(ordinaryPlayout.id, ordinaryDestination.id);
    const insideBroadcast = await broadcast(insidePlayout.id, externalDestination.id);
    const privateDestinationBroadcast = await broadcast(ordinaryPlayout.id, insideDestination.id);
    const productMarkedBroadcast = await broadcast(productMarkedPlayout.id, ordinaryDestination.id);

    assert.deepEqual([...await generalStudioChannelIds(db, organisationId, [
      ordinaryChannel.id, insideChannel.id, legacyOrdinaryChannel.id, facilityChannel.id
    ])], [ordinaryChannel.id]);
    assert.deepEqual([...await generalStudioStationIds(db, organisationId, [
      ordinaryStation.id, insideStation.id, legacyStation.id
    ])], [ordinaryStation.id]);

    const login = await api("/api/auth/login", { method: "POST", body: { email: user.email, password } });
    assert.equal(login.status, 200, await login.clone().text());
    const cookie = login.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie);

    const playoutResponse = await api("/api/studio/playout", { cookie });
    assert.equal(playoutResponse.status, 200, await playoutResponse.clone().text());
    const playoutView = await playoutResponse.json();
    assert.deepEqual(playoutView.channels.map(({ id }) => id), [ordinaryChannel.id]);
    assert.deepEqual(playoutView.sessions.map(({ id }) => id), [ordinaryPlayout.id]);
    assert.ok(playoutView.assets.some(({ id }) => id === ordinaryMedia.id));
    assert.ok(!playoutView.assets.some(({ id }) => id === supervisedTakeMedia.id || id === supervisedRenderMedia.id));

    const libraryResponse = await api("/api/studio/library", { cookie });
    assert.equal(libraryResponse.status, 200, await libraryResponse.clone().text());
    assert.deepEqual((await libraryResponse.json()).channels.map(({ id }) => id), [ordinaryChannel.id]);
    const privateLibrary = await api(`/api/studio/library?channelId=${insideChannel.id}`, { cookie });
    assert.equal(privateLibrary.status, 404, await privateLibrary.clone().text());

    const broadcastResponse = await api("/api/studio/broadcast", { cookie });
    assert.equal(broadcastResponse.status, 200, await broadcastResponse.clone().text());
    const broadcastView = await broadcastResponse.json();
    assert.deepEqual(broadcastView.stations.map(({ id }) => id), [ordinaryStation.id]);
    assert.ok(broadcastView.destinations.some(({ id }) => id === ordinaryDestination.id));
    assert.ok(broadcastView.destinations.some(({ id }) => id === externalDestination.id));
    assert.ok(!broadcastView.destinations.some(({ id }) => id === insideDestination.id || id === legacyDestination.id));
    assert.deepEqual(broadcastView.playoutSessions.map(({ id }) => id), [ordinaryPlayout.id]);
    assert.deepEqual(broadcastView.sessions.map(({ id }) => id), [ordinaryBroadcast.id]);

    // Newer private history must not consume the 20 rows reserved for ordinary
    // Studio. The 51 private rows cross the server's bounded query page.
    const newestPrivate = new Date(Date.now() + 60_000);
    const laterOrdinary = new Date(Date.now() + 30_000);
    await db.studioPlayoutSession.createMany({ data: Array.from({ length: 51 }, (_, index) => ({
      organisationId, channelId: insideChannel.id, productFamily: "CORRECTIONS",
      title: `Fictional private playout history ${index}`, createdByUserId: userId,
      updatedAt: newestPrivate
    })) });
    await db.studioPlayoutSession.createMany({ data: Array.from({ length: 19 }, (_, index) => ({
      organisationId, channelId: ordinaryChannel.id, productFamily: "ONLINE",
      title: `Fictional ordinary playout history ${index}`, createdByUserId: userId,
      updatedAt: laterOrdinary
    })) });
    const privateBroadcastIds = Array.from({ length: 51 }, () => randomUUID());
    const ordinaryBroadcastIds = Array.from({ length: 19 }, () => randomUUID());
    await db.studioBroadcastSession.createMany({ data: [
      ...privateBroadcastIds.map((id) => ({
        id, organisationId, playoutSessionId: insidePlayout.id, createdByUserId: userId,
        updatedAt: newestPrivate
      })),
      ...ordinaryBroadcastIds.map((id) => ({
        id, organisationId, playoutSessionId: ordinaryPlayout.id, createdByUserId: userId,
        updatedAt: laterOrdinary
      }))
    ] });
    await db.studioBroadcastSessionDestination.createMany({ data: [
      ...privateBroadcastIds.map((sessionId) => ({ sessionId, destinationId: insideDestination.id })),
      ...ordinaryBroadcastIds.map((sessionId) => ({ sessionId, destinationId: ordinaryDestination.id }))
    ] });
    const pagedPlayoutResponse = await api("/api/studio/playout", { cookie });
    assert.equal(pagedPlayoutResponse.status, 200, await pagedPlayoutResponse.clone().text());
    const pagedPlayout = (await pagedPlayoutResponse.json()).sessions;
    assert.equal(pagedPlayout.length, 20);
    assert.ok(pagedPlayout.some(({ id }) => id === ordinaryPlayout.id));
    assert.ok(pagedPlayout.every(({ productFamily }) => productFamily === "ONLINE"));
    const pagedBroadcastResponse = await api("/api/studio/broadcast", { cookie });
    assert.equal(pagedBroadcastResponse.status, 200, await pagedBroadcastResponse.clone().text());
    const pagedBroadcast = (await pagedBroadcastResponse.json()).sessions;
    assert.equal(pagedBroadcast.length, 20);
    assert.ok(pagedBroadcast.some(({ id }) => id === ordinaryBroadcast.id));
    assert.ok(pagedBroadcast.every(({ playoutSessionId }) => playoutSessionId === ordinaryPlayout.id));

    const post = (path, body) => api(path, { method: "POST", cookie, body, idempotencyKey: randomUUID() });
    for (const channelId of [insideChannel.id, legacyOrdinaryChannel.id, facilityChannel.id]) {
      const blocked = await post("/api/studio/playout", { action: "CREATE_SESSION", channelId, title: "Fictional unsafe playout" });
      assert.equal(blocked.status, 403, await blocked.clone().text());
    }
    const privatePlayoutCommand = await post("/api/studio/playout", {
      action: "SET_MODE", sessionId: insidePlayout.id, expectedRevision: 0, mode: "MANUAL"
    });
    assert.equal(privatePlayoutCommand.status, 403, await privatePlayoutCommand.clone().text());
    const normalPlayoutCommand = await post("/api/studio/playout", {
      action: "SET_MODE", sessionId: ordinaryPlayout.id, expectedRevision: 0, mode: "MANUAL"
    });
    assert.equal(normalPlayoutCommand.status, 200, await normalPlayoutCommand.clone().text());
    const markedChannel = await channel("Product Marked Channel", ordinaryStation.id);
    await db.autoDjPolicy.create({ data: {
      organisationId, channelId: markedChannel.id, enabled: true, state: "ACTIVE", rightsUse: "ONLINE_RADIO"
    } });
    await db.studioPlayoutSession.update({ where: { id: productMarkedPlayout.id }, data: { channelId: markedChannel.id } });
    const existingProtectedSession = await post("/api/studio/playout", {
      action: "CREATE_SESSION", channelId: markedChannel.id, title: "Cannot reuse private session"
    });
    assert.equal(existingProtectedSession.status, 403, await existingProtectedSession.clone().text());
    for (const mediaAssetId of [supervisedTakeMedia.id, supervisedRenderMedia.id]) {
      const blocked = await post("/api/studio/playout", {
        action: "ADD_LIVE", sessionId: ordinaryPlayout.id, expectedRevision: 1, mediaAssetId
      });
      assert.equal(blocked.status, 403, await blocked.clone().text());
    }
    const ordinaryPack = await db.studioProgrammePack.create({ data: {
      organisationId, name: `Fictional ordinary pack ${suffix}`, productFamily: "ONLINE", createdByUserId: userId
    } });
    const blockedPack = await post("/api/studio/playout", {
      action: "ADD_PACK_ITEM", packId: ordinaryPack.id, mediaAssetId: supervisedRenderMedia.id, role: "JINGLE"
    });
    assert.equal(blockedPack.status, 403, await blockedPack.clone().text());

    for (const stationId of [insideStation.id, legacyStation.id]) {
      const blocked = await post("/api/studio/broadcast", { action: "QUICK_CONNECT", stationId });
      assert.equal(blocked.status, 403, await blocked.clone().text());
    }
    for (const [playoutSessionId, destinationId] of [
      [insidePlayout.id, externalDestination.id],
      [productMarkedPlayout.id, externalDestination.id],
      [ordinaryPlayout.id, insideDestination.id],
      [ordinaryPlayout.id, legacyDestination.id]
    ]) {
      const blocked = await post("/api/studio/broadcast", {
        action: "START_BROADCAST", playoutSessionId, destinationIds: [destinationId]
      });
      assert.equal(blocked.status, 403, await blocked.clone().text());
    }
    const normalBroadcastStart = await post("/api/studio/broadcast", {
      action: "START_BROADCAST", playoutSessionId: ordinaryPlayout.id, destinationIds: [ordinaryDestination.id]
    });
    assert.equal(normalBroadcastStart.status, 201, await normalBroadcastStart.clone().text());

    const privateMetadata = await post("/api/studio/broadcast", {
      action: "SET_METADATA", sessionId: privateDestinationBroadcast.id, expectedRevision: 0, metadata: "Unsafe"
    });
    assert.equal(privateMetadata.status, 403, await privateMetadata.clone().text());
    await db.studioBroadcastSessionDestination.update({
      where: { sessionId_destinationId: { sessionId: insideBroadcast.id, destinationId: externalDestination.id } },
      // A provider connect may have succeeded before its DB success write.
      data: { state: "RECONNECTING", lastConnectedAt: null }
    });
    const stop = await post("/api/studio/broadcast", {
      action: "STOP_BROADCAST", sessionId: insideBroadcast.id, expectedRevision: 0
    });
    assert.equal(stop.status, 200, await stop.clone().text());
    const stopBody = await stop.json();
    assert.equal(stopBody.stopped, true);
    assert.equal(stopBody.externalShutdownConfirmed, false);
    assert.match(stopBody.notice, /external source shutdown is unconfirmed/i);
    assert.equal((await db.studioBroadcastSession.findUnique({ where: { id: insideBroadcast.id } })).status, "ENDED");
    assert.equal((await db.studioBroadcastSessionDestination.findUnique({
      where: { sessionId_destinationId: { sessionId: insideBroadcast.id, destinationId: externalDestination.id } }
    })).state, "RECONNECTING", "a database stop cannot falsely report provider disconnection");
    assert.ok(await countUnconfirmedStudioExternalShutdowns(db) >= 1, "the worker must flag uncertain external shutdown even without a recorded successful connect");

    await db.studioPlayoutCommand.create({ data: {
      sessionId: insidePlayout.id, organisationId, idempotencyKey: `unsafe-playout-${suffix}`,
      action: "SET_MODE", expectedRevision: 0, result: { sessionId: insidePlayout.id }, actorUserId: userId
    } });
    const replayPlayout = await api("/api/studio/playout", {
      method: "POST", cookie, idempotencyKey: `unsafe-playout-${suffix}`,
      body: { action: "SET_MODE", sessionId: ordinaryPlayout.id, expectedRevision: 1, mode: "MANUAL" }
    });
    assert.equal(replayPlayout.status, 403, await replayPlayout.clone().text());
    await db.studioBroadcastCommand.create({ data: {
      sessionId: productMarkedBroadcast.id, organisationId, idempotencyKey: `unsafe-broadcast-${suffix}`,
      action: "SET_METADATA", expectedRevision: 0, result: { sessionId: productMarkedBroadcast.id }, actorUserId: userId
    } });
    const replayBroadcast = await api("/api/studio/broadcast", {
      method: "POST", cookie, idempotencyKey: `unsafe-broadcast-${suffix}`,
      body: { action: "SET_METADATA", sessionId: ordinaryBroadcast.id, expectedRevision: 0, metadata: "Safe" }
    });
    assert.equal(replayBroadcast.status, 403, await replayBroadcast.clone().text());

    const historicItem = await db.studioPlayoutItem.create({ data: {
      sessionId: ordinaryPlayout.id, organisationId, mediaAssetId: supervisedTakeMedia.id,
      area: "PREPARE", status: "READY", title: "Previously queued private take",
      rightsReady: true, createdByUserId: userId
    } });
    for (const action of ["SEND_NEXT", "INSERT_QUEUE", "START_NEXT"]) {
      const blocked = await post("/api/studio/playout", {
        action, sessionId: ordinaryPlayout.id, expectedRevision: 1, itemId: historicItem.id
      });
      assert.equal(blocked.status, 403, `${action}: ${await blocked.clone().text()}`);
    }
    const hiddenPlayout = await api("/api/studio/playout", { cookie });
    assert.equal(hiddenPlayout.status, 200, await hiddenPlayout.clone().text());
    assert.ok(!(await hiddenPlayout.json()).sessions.some(({ id }) => id === ordinaryPlayout.id));
    const hiddenBroadcast = await api("/api/studio/broadcast", { cookie });
    assert.equal(hiddenBroadcast.status, 200, await hiddenBroadcast.clone().text());
    assert.ok(!(await hiddenBroadcast.json()).sessions.some(({ id }) => id === ordinaryBroadcast.id));
  } finally {
    try {
      if (organisationId) {
        await db.studioBroadcastSession.deleteMany({ where: { organisationId } });
        await db.studioBroadcastDestination.deleteMany({ where: { organisationId } });
        await db.studioProgrammePack.deleteMany({ where: { organisationId } });
        await db.studioPlayoutSession.deleteMany({ where: { organisationId } });
        await db.correctionsStudioSession.deleteMany({ where: { organisationId } });
        await db.audioRender.deleteMany({ where: { organisationId } });
        await db.audioTake.deleteMany({ where: { organisationId } });
        await db.audioProject.deleteMany({ where: { organisationId } });
        await db.correctionsContributor.deleteMany({ where: { organisationId } });
        await db.correctionsProgramme.deleteMany({ where: { organisationId } });
      }
      if (organisationId) await db.organisation.delete({ where: { id: organisationId } });
      if (userId) await db.user.delete({ where: { id: userId } });
      if (planId) await db.plan.delete({ where: { id: planId } });
    } finally {
      await db.$disconnect();
    }
  }
});
