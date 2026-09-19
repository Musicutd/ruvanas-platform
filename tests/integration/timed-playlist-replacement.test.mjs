import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { assertSafeFinalAcceptanceEnvironment } from "../../lib/final-platform-acceptance.mjs";
import { loadPublishedTimedChannelAuthority, loadPublishedTimedChannelItemAdmission, loadPublishedTimedChannelSequence } from "../../lib/studio-timed-sequence-loader.mjs";

function isolatedEnvironmentReady() {
  try {
    assertSafeFinalAcceptanceEnvironment({
      baseUrl: process.env.INTEGRATION_BASE_URL,
      databaseUrl: process.env.DATABASE_URL,
      runDatabaseTests: process.env.RUN_DATABASE_TESTS
    });
    const databaseName = new URL(process.env.DATABASE_URL).pathname.slice(1);
    return /(?:acceptance|disposable|test)/i.test(databaseName) &&
      Boolean(process.env.INTERNAL_REGISTRATION_TEST_KEY) &&
      process.env.RUVANAS_TIMED_PLAYLIST_REPLACEMENT_ENABLED === "1";
  } catch {
    return false;
  }
}

const baseUrl = process.env.INTEGRATION_BASE_URL || "http://127.0.0.1:3100";

async function api(path, { method = "GET", body, cookie, clientAddress } = {}) {
  const headers = { origin: baseUrl, "x-ruvanas-registration-test-key": process.env.INTERNAL_REGISTRATION_TEST_KEY };
  if (cookie) headers.cookie = cookie;
  if (clientAddress) headers["x-forwarded-for"] = clientAddress;
  if (body !== undefined) headers["content-type"] = "application/json";
  return fetch(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
}

async function registerOwner(label, { product = "ONLINE", tier = "online-starter" } = {}) {
  const suffix = randomUUID();
  const response = await api("/api/auth/register", { method: "POST", clientAddress: `2001:db8::${suffix.slice(0, 4)}`, body: {
    name: `${label} Owner`, organisationName: `${label} ${suffix}`,
    email: `timed-playlist-${suffix}@example.invalid`, password: "correct-horse-battery-staple",
    product, tier, source: "ADMIN_TEST"
  } });
  assert.equal(response.status, 201, await response.clone().text());
  return { ...(await response.json()), cookie: response.headers.get("set-cookie")?.split(";")[0] || "" };
}

test("timed playlist publication replaces exactly one future programme and rolls back a changed original", {
  skip: isolatedEnvironmentReady() ? false : "Requires a local disposable PostgreSQL database, local app, isolated registration key and replacement test flag"
}, async () => {
  const db = new PrismaClient();
  try {
    const owner = await registerOwner("Timed Playlist", { tier: "online-professional" });
    const outsider = await registerOwner("Outside Timed Playlist", { tier: "online-professional" });
    const organisationId = owner.organisation.id;
    const station = await db.station.create({ data: {
      organisationId, productFamily: "ONLINE", name: "Isolated timed station", slug: `timed-station-${randomUUID()}`,
      status: "DRAFT", listenerLimit: 100, storageLimitGb: 5, maxBitrateKbps: 128
    } });
    const channel = await db.channel.create({ data: {
      organisationId, stationId: station.id, name: "Isolated timed radio", slug: `timed-${randomUUID()}`, status: "ACTIVE"
    } });
    const genre = await db.mediaGenre.upsert({ where: { slug: "pop" }, update: {}, create: { name: "Pop", slug: "pop" } });
    const expiresAt = new Date(Date.now() + 4 * 365 * 86400000);
    for (const index of [1, 2]) {
      const asset = await db.mediaAsset.create({ data: {
        organisationId, libraryType: "ORGANISATION_MUSIC", name: `Isolated tone ${index}`,
        originalName: `tone-${index}.mp3`, storageKey: `isolated-timed/${randomUUID()}.mp3`,
        mimeType: "audio/mpeg", sizeBytes: 1024n, durationSeconds: 180, mediaType: "MUSIC", status: "READY",
        genres: { create: { mediaGenreId: genre.id, isPrimary: true } }
      } });
      await db.track.create({ data: {
        mediaAssetId: asset.id, title: `Isolated tone ${index}`, artist: `Test Artist ${index}`,
        status: "READY", rightsHolder: "Self-owned test audio", rightsReference: `TIMED-${randomUUID()}`,
        rightsBasis: "DIRECT_LICENCE", permittedTerritories: "WORLDWIDE", permittedUses: ["ONLINE_RADIO"],
        licenceExpiresAt: expiresAt, rightsConfirmedAt: new Date(), rightsReviewStatus: "APPROVED"
      } });
    }

    const scheduledDate = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    const draftResponse = await api("/api/programming/autodj-expansion", { method: "POST", cookie: owner.cookie, body: {
      name: "Isolated future block", targetType: "CHANNEL", targetId: channel.id,
      scheduledDate, startTime: "10:00", endTime: "11:00",
      selectedGenreCodes: ["POP"], sourceScopes: ["SUBSCRIBER_LIBRARY"]
    } });
    assert.equal(draftResponse.status, 201, await draftResponse.clone().text());
    const draft = (await draftResponse.json()).playlist;
    assert.ok(draft.versions[0].items.length > 2, "the frozen hour must exercise repeated tracks");
    const publishPath = `/api/programming/autodj-expansion/${draft.id}/publish`;
    assert.equal((await api(publishPath, { method: "POST", cookie: outsider.cookie })).status, 404);

    const firstResponse = await api(publishPath, { method: "POST", cookie: owner.cookie });
    assert.equal(firstResponse.status, 200, await firstResponse.clone().text());
    const first = (await firstResponse.json()).playlist;
    assert.equal(first.publishedVersion, 1);
    assert.equal(await db.musicModeTrack.count({ where: { musicModeId: first.musicMode.id } }), 2);
    const firstPlan = await loadPublishedTimedChannelSequence(db, { organisationId, channelId: channel.id, playlistId: draft.id });
    assert.equal(firstPlan.ready, true, firstPlan.reason);
    assert.equal(firstPlan.version, 1);
    assert.deepEqual(firstPlan.items.map((item) => item.trackId), first.versions.find((version) => version.version === 1).items.map((item) => item.trackId));
    assert.equal(firstPlan.listenerVerified, false);
    const consolePath = `/api/studio/console?channelId=${channel.id}&date=${scheduledDate}`;
    assert.equal((await api(consolePath, { cookie: outsider.cookie })).status, 404);
    const firstLogResponse = await api(consolePath, { cookie: owner.cookie });
    assert.equal(firstLogResponse.status, 200, await firstLogResponse.clone().text());
    const firstLog = (await firstLogResponse.json()).dailyLog;
    assert.deepEqual(firstLog.timedPlaylists.map((playlist) => [playlist.id, playlist.publishedVersion, playlist.currentVersion]), [[draft.id, 1, 1]]);
    assert.equal(firstLog.planned.filter((item) => item.sourceType === "TIMED_PLAYLIST").length, first.versions.find((version) => version.version === 1).items.length);
    assert.equal(firstLog.actual.length, 0, "a published plan is not listener proof");
    assert.equal((await api(publishPath, { method: "POST", cookie: owner.cookie })).status, 409);
    const schedule = await db.programmeSchedule.findUniqueOrThrow({ where: { channelId_organisationId: { channelId: channel.id, organisationId } } });
    const versionOne = await db.programmeScheduleVersion.findFirstOrThrow({ where: { scheduleId: schedule.id, isActive: true }, include: { items: true } });
    assert.equal(versionOne.items.filter((item) => item.musicModeId === first.musicMode.id).length, 1);
    const authorityAtStart = await loadPublishedTimedChannelAuthority(db, {
      organisationId, channelId: channel.id, playlistId: draft.id, clock: () => firstPlan.startsAt
    });
    assert.equal(authorityAtStart.sourceCommandAllowed, false);
    assert.equal(authorityAtStart.listenerVerified, false);
    const publishedBlock = versionOne.items.find((item) => item.musicModeId === first.musicMode.id);
    const blockEndsAt = new Date(publishedBlock.startsAt.getTime() + publishedBlock.durationMinutes * 60_000);
    if (firstPlan.endsAt <= blockEndsAt) {
      assert.equal(authorityAtStart.consistent, true, authorityAtStart.reason);
    } else {
      assert.equal(authorityAtStart.reason, "SEQUENCE_PROGRAMME_AUTHORITY_MISMATCH");
    }

    const secondItem = firstPlan.items[1];
    const secondBoundary = new Date(firstPlan.startsAt.getTime() + secondItem.startOffsetSeconds * 1000);
    await db.stationStreamConfig.create({ data: { stationId: station.id, outboundAutoDjEnabled: true,
      encoderLeaseOwner: "isolated-worker", encoderLeaseUntil: new Date(secondBoundary.getTime() + 30_000) } });
    const secondScope = { organisationId, channelId: channel.id, playlistId: draft.id,
      expectedVersion: 1, expectedTrackId: secondItem.trackId, position: 1,
      workerOwner: "isolated-worker", clock: () => secondBoundary };
    const secondAdmission = await loadPublishedTimedChannelItemAdmission(db, secondScope);
    assert.equal(secondAdmission.sourceCommandAllowed, false);
    assert.equal(secondAdmission.listenerVerified, false);
    if (firstPlan.endsAt <= blockEndsAt) {
      assert.equal(secondAdmission.admissible, true, secondAdmission.reason);
    } else {
      assert.equal(secondAdmission.reason, "SEQUENCE_ITEM_PROGRAMME_MISMATCH");
    }
    const trackBeforeTakedown = await db.track.findUniqueOrThrow({ where: { id: secondItem.trackId } });
    await db.track.update({ where: { id: secondItem.trackId }, data: { rightsReviewStatus: "REJECTED" } });
    assert.match((await loadPublishedTimedChannelItemAdmission(db, secondScope)).reason, /^SEQUENCE_RIGHTS_/);
    await db.track.update({ where: { id: secondItem.trackId }, data: { rightsReviewStatus: trackBeforeTakedown.rightsReviewStatus } });
    await db.stationStreamConfig.update({ where: { stationId: station.id }, data: { encoderLeaseOwner: "other-worker" } });
    if (firstPlan.endsAt <= blockEndsAt) {
      assert.equal((await loadPublishedTimedChannelItemAdmission(db, secondScope)).reason,
        "SEQUENCE_ITEM_ENCODER_LEASE_UNAVAILABLE");
    }

    const regeneratePath = `/api/programming/autodj-expansion/${draft.id}`;
    const regenerated = await api(regeneratePath, { method: "POST", cookie: owner.cookie, body: { action: "REGENERATE" } });
    assert.equal(regenerated.status, 200, await regenerated.clone().text());
    assert.equal((await regenerated.json()).playlist.currentVersion, 2);
    const draftLogResponse = await api(consolePath, { cookie: owner.cookie });
    assert.equal(draftLogResponse.status, 200, await draftLogResponse.clone().text());
    assert.deepEqual((await draftLogResponse.json()).dailyLog.timedPlaylists.map((playlist) => [playlist.publishedVersion, playlist.currentVersion]), [[1, 2]]);
    const replacementResponses = await Promise.all([
      api(publishPath, { method: "POST", cookie: owner.cookie }),
      api(publishPath, { method: "POST", cookie: owner.cookie })
    ]);
    assert.deepEqual(replacementResponses.map((response) => response.status).sort(), [200, 409]);
    const published = (await replacementResponses.find((response) => response.status === 200).json()).playlist;
    assert.equal(published.publishedVersion, 2);
    assert.notEqual(published.musicMode.id, first.musicMode.id);
    const replacedLogResponse = await api(consolePath, { cookie: owner.cookie });
    assert.equal(replacedLogResponse.status, 200, await replacedLogResponse.clone().text());
    assert.deepEqual((await replacedLogResponse.json()).dailyLog.timedPlaylists.map((playlist) => [playlist.publishedVersion, playlist.currentVersion]), [[2, 2]]);
    const versions = await db.programmeScheduleVersion.findMany({ where: { scheduleId: schedule.id }, include: { items: true }, orderBy: { version: "asc" } });
    assert.deepEqual(versions.map((version) => [version.status, version.isActive]), [["ARCHIVED", false], ["PUBLISHED", true]]);
    assert.equal(versions[0].items.filter((item) => item.musicModeId === first.musicMode.id).length, 1);
    assert.equal(versions[1].items.filter((item) => item.musicModeId === published.musicMode.id).length, 1);
    assert.equal(versions[1].items.filter((item) => item.musicModeId === first.musicMode.id).length, 0);
    assert.equal(await db.musicModeTrack.count({ where: { musicModeId: first.musicMode.id } }), 2);
    const replacementPlan = await loadPublishedTimedChannelSequence(db, { organisationId, channelId: channel.id, playlistId: draft.id });
    assert.equal(replacementPlan.ready, true, replacementPlan.reason);
    assert.equal(replacementPlan.version, 2);
    assert.deepEqual(replacementPlan.items.map((item) => item.trackId), published.versions.find((version) => version.version === 2).items.map((item) => item.trackId));

    const nextDraft = await api(regeneratePath, { method: "POST", cookie: owner.cookie, body: { action: "REGENERATE" } });
    assert.equal(nextDraft.status, 200, await nextDraft.clone().text());
    assert.equal((await loadPublishedTimedChannelSequence(db, { organisationId, channelId: channel.id, playlistId: draft.id })).version, 2);
    const currentItem = versions[1].items.find((item) => item.musicModeId === published.musicMode.id);
    await db.programmeScheduleItem.update({ where: { id: currentItem.id }, data: { label: "Changed by another scheduler" } });
    assert.equal((await loadPublishedTimedChannelSequence(db, { organisationId, channelId: channel.id, playlistId: draft.id })).reason, "SEQUENCE_PROGRAMME_MISMATCH");
    const modeCount = await db.musicMode.count({ where: { organisationId, source: "GENERATED_PLAYLIST" } });
    const rejected = await api(publishPath, { method: "POST", cookie: owner.cookie });
    assert.equal(rejected.status, 409, await rejected.clone().text());
    const retained = await db.generatedPlaylist.findUniqueOrThrow({ where: { id: draft.id } });
    assert.equal(retained.publishedVersion, 2);
    assert.equal(retained.status, "DRAFT");
    assert.equal(await db.musicMode.count({ where: { organisationId, source: "GENERATED_PLAYLIST" } }), modeCount);
    assert.equal(await db.programmeScheduleVersion.count({ where: { scheduleId: schedule.id, isActive: true } }), 1);
  } finally {
    await db.$disconnect();
  }
});

test("future Retail location and zone playlists replace only their own published area schedules", {
  skip: isolatedEnvironmentReady() ? false : "Requires a local disposable PostgreSQL database, local app, isolated registration key and replacement test flag"
}, async () => {
  const db = new PrismaClient();
  try {
    const owner = await registerOwner("Retail Timed Playlist", { product: "RETAIL", tier: "retail-start" });
    const organisationId = owner.organisation.id;
    const location = await db.location.create({ data: {
      organisationId, name: "Isolated retail site", slug: `retail-${randomUUID()}`,
      status: "ACTIVE", timezone: "Europe/Malta", countryCode: "MT"
    } });
    const zone = await db.zone.create({ data: {
      locationId: location.id, name: "Isolated playback area", slug: `zone-${randomUUID()}`, status: "ACTIVE"
    } });
    const genre = await db.mediaGenre.upsert({ where: { slug: "pop" }, update: {}, create: { name: "Pop", slug: "pop" } });
    for (const index of [1, 2]) {
      const asset = await db.mediaAsset.create({ data: {
        organisationId, libraryType: "ORGANISATION_MUSIC", name: `Retail test tone ${index}`,
        originalName: `retail-tone-${index}.mp3`, storageKey: `isolated-retail/${randomUUID()}.mp3`,
        mimeType: "audio/mpeg", sizeBytes: 1024n, durationSeconds: 180, mediaType: "MUSIC", status: "READY",
        genres: { create: { mediaGenreId: genre.id, isPrimary: true } }
      } });
      await db.track.create({ data: {
        mediaAssetId: asset.id, title: `Retail test tone ${index}`, artist: `Test Artist ${index}`,
        status: "READY", rightsHolder: "Self-owned test audio", rightsReference: `RETAIL-TIMED-${randomUUID()}`,
        rightsBasis: "DIRECT_LICENCE", permittedTerritories: "MT", permittedUses: ["RETAIL_RADIO"],
        licenceExpiresAt: new Date(Date.now() + 4 * 365 * 86400000), rightsConfirmedAt: new Date(), rightsReviewStatus: "APPROVED"
      } });
    }

    const scheduledDate = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    for (const target of [{ type: "LOCATION", id: location.id }, { type: "ZONE", id: zone.id }]) {
      const targetWhere = target.type === "LOCATION" ? { locationId: target.id } : { zoneId: target.id };
      const draftResponse = await api("/api/programming/autodj-expansion", { method: "POST", cookie: owner.cookie, body: {
        name: `Isolated ${target.type.toLowerCase()} block`, targetType: target.type, targetId: target.id,
        scheduledDate, startTime: "10:00", endTime: "11:00",
        selectedGenreCodes: ["POP"], sourceScopes: ["SUBSCRIBER_LIBRARY"]
      } });
      assert.equal(draftResponse.status, 201, await draftResponse.clone().text());
      const draft = (await draftResponse.json()).playlist;
      const publishPath = `/api/programming/autodj-expansion/${draft.id}/publish`;
      const firstResponse = await api(publishPath, { method: "POST", cookie: owner.cookie });
      assert.equal(firstResponse.status, 200, await firstResponse.clone().text());
      const first = (await firstResponse.json()).playlist;
      let schedules = await db.musicSchedule.findMany({ where: { organisationId, ...targetWhere }, include: { slots: true }, orderBy: { version: "asc" } });
      assert.deepEqual(schedules.map((schedule) => [schedule.version, schedule.status]), [[1, "PUBLISHED"]]);
      assert.equal(schedules[0].slots.length, 1);
      assert.equal(schedules[0].slots[0].musicModeId, first.musicMode.id);

      const regeneratePath = `/api/programming/autodj-expansion/${draft.id}`;
      const regenerated = await api(regeneratePath, { method: "POST", cookie: owner.cookie, body: { action: "REGENERATE" } });
      assert.equal(regenerated.status, 200, await regenerated.clone().text());
      const secondResponse = await api(publishPath, { method: "POST", cookie: owner.cookie });
      assert.equal(secondResponse.status, 200, await secondResponse.clone().text());
      const second = (await secondResponse.json()).playlist;
      assert.notEqual(second.musicMode.id, first.musicMode.id);
      schedules = await db.musicSchedule.findMany({ where: { organisationId, ...targetWhere }, include: { slots: true }, orderBy: { version: "asc" } });
      assert.deepEqual(schedules.map((schedule) => [schedule.version, schedule.status]), [[1, "ARCHIVED"], [2, "PUBLISHED"]]);
      assert.equal(schedules[0].slots[0].musicModeId, first.musicMode.id);
      assert.equal(schedules[1].slots[0].musicModeId, second.musicMode.id);
      assert.equal(await db.musicModeTrack.count({ where: { musicModeId: first.musicMode.id } }), 2);

      const thirdDraft = await api(regeneratePath, { method: "POST", cookie: owner.cookie, body: { action: "REGENERATE" } });
      assert.equal(thirdDraft.status, 200, await thirdDraft.clone().text());
      await db.scheduleSlot.update({ where: { id: schedules[1].slots[0].id }, data: { startMinute: 630 } });
      const modeCount = await db.musicMode.count({ where: { organisationId, source: "GENERATED_PLAYLIST" } });
      const rejected = await api(publishPath, { method: "POST", cookie: owner.cookie });
      assert.equal(rejected.status, 409, await rejected.clone().text());
      const retained = await db.generatedPlaylist.findUniqueOrThrow({ where: { id: draft.id } });
      assert.equal(retained.publishedVersion, 2);
      assert.equal(retained.status, "DRAFT");
      assert.equal(await db.musicMode.count({ where: { organisationId, source: "GENERATED_PLAYLIST" } }), modeCount);
      assert.equal(await db.musicSchedule.count({ where: { organisationId, ...targetWhere, status: "PUBLISHED" } }), 1);
    }
  } finally {
    await db.$disconnect();
  }
});
