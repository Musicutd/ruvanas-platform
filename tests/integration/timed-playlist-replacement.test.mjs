import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { assertSafeFinalAcceptanceEnvironment } from "../../lib/final-platform-acceptance.mjs";

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

async function api(path, { method = "GET", body, cookie } = {}) {
  const headers = { origin: baseUrl, "x-ruvanas-registration-test-key": process.env.INTERNAL_REGISTRATION_TEST_KEY };
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers["content-type"] = "application/json";
  return fetch(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
}

async function registerOwner(label) {
  const suffix = randomUUID();
  const response = await api("/api/auth/register", { method: "POST", body: {
    name: `${label} Owner`, organisationName: `${label} ${suffix}`,
    email: `timed-playlist-${suffix}@example.invalid`, password: "correct-horse-battery-staple",
    product: "ONLINE", tier: "online-starter", source: "ADMIN_TEST"
  } });
  assert.equal(response.status, 201, await response.clone().text());
  return { ...(await response.json()), cookie: response.headers.get("set-cookie")?.split(";")[0] || "" };
}

test("timed playlist publication replaces exactly one future programme and rolls back a changed original", {
  skip: isolatedEnvironmentReady() ? false : "Requires a local disposable PostgreSQL database, local app, isolated registration key and replacement test flag"
}, async () => {
  const db = new PrismaClient();
  try {
    const owner = await registerOwner("Timed Playlist");
    const outsider = await registerOwner("Outside Timed Playlist");
    const organisationId = owner.organisation.id;
    const channel = await db.channel.create({ data: { organisationId, name: "Isolated timed radio", slug: `timed-${randomUUID()}`, status: "ACTIVE" } });
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

    const scheduledDate = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
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
    assert.equal((await api(publishPath, { method: "POST", cookie: owner.cookie })).status, 409);
    const schedule = await db.programmeSchedule.findUniqueOrThrow({ where: { channelId_organisationId: { channelId: channel.id, organisationId } } });
    const versionOne = await db.programmeScheduleVersion.findFirstOrThrow({ where: { scheduleId: schedule.id, isActive: true }, include: { items: true } });
    assert.equal(versionOne.items.filter((item) => item.musicModeId === first.musicMode.id).length, 1);

    const regeneratePath = `/api/programming/autodj-expansion/${draft.id}`;
    const regenerated = await api(regeneratePath, { method: "POST", cookie: owner.cookie, body: { action: "REGENERATE" } });
    assert.equal(regenerated.status, 200, await regenerated.clone().text());
    assert.equal((await regenerated.json()).playlist.currentVersion, 2);
    const replacementResponses = await Promise.all([
      api(publishPath, { method: "POST", cookie: owner.cookie }),
      api(publishPath, { method: "POST", cookie: owner.cookie })
    ]);
    assert.deepEqual(replacementResponses.map((response) => response.status).sort(), [200, 409]);
    const published = (await replacementResponses.find((response) => response.status === 200).json()).playlist;
    assert.equal(published.publishedVersion, 2);
    assert.notEqual(published.musicMode.id, first.musicMode.id);
    const versions = await db.programmeScheduleVersion.findMany({ where: { scheduleId: schedule.id }, include: { items: true }, orderBy: { version: "asc" } });
    assert.deepEqual(versions.map((version) => [version.status, version.isActive]), [["ARCHIVED", false], ["PUBLISHED", true]]);
    assert.equal(versions[0].items.filter((item) => item.musicModeId === first.musicMode.id).length, 1);
    assert.equal(versions[1].items.filter((item) => item.musicModeId === published.musicMode.id).length, 1);
    assert.equal(versions[1].items.filter((item) => item.musicModeId === first.musicMode.id).length, 0);
    assert.equal(await db.musicModeTrack.count({ where: { musicModeId: first.musicMode.id } }), 2);

    const nextDraft = await api(regeneratePath, { method: "POST", cookie: owner.cookie, body: { action: "REGENERATE" } });
    assert.equal(nextDraft.status, 200, await nextDraft.clone().text());
    const currentItem = versions[1].items.find((item) => item.musicModeId === published.musicMode.id);
    await db.programmeScheduleItem.update({ where: { id: currentItem.id }, data: { label: "Changed by another scheduler" } });
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
