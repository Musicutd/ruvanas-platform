import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";

const baseUrl = process.env.INTEGRATION_BASE_URL || "http://127.0.0.1:3100";
const db = new PrismaClient();
// Keep this journey's registration bucket independent from other integration
// suites that deliberately exercise the shared-IP production rate limit.
const api = (path, { method = "GET", body, cookie } = {}) => fetch(`${baseUrl}${path}`, { method, headers: { origin: baseUrl, "cf-connecting-ip": "203.0.113.201", ...(process.env.INTERNAL_REGISTRATION_TEST_KEY ? { "x-ruvanas-registration-test-key": process.env.INTERNAL_REGISTRATION_TEST_KEY } : {}), ...(cookie ? { cookie } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
const sessionCookie = (response) => response.headers.get("set-cookie")?.split(";")[0] || "";

async function register(label) {
  const suffix = randomUUID();
  const response = await api("/api/auth/register", { method: "POST", body: { name: label, organisationName: `${label} ${suffix}`, email: `simple-playlist-${suffix}@example.invalid`, password: "correct-horse-battery-staple", product: "ONLINE", tier: "online-starter", source: "ADMIN_TEST" } });
  assert.equal(response.status, 201, await response.clone().text());
  return { cookie: sessionCookie(response), organisationId: (await response.json()).organisation.id };
}

test("subscriber prepares Non-Stop, owns templates and schedules, while Admin registry gets the station", async () => {
  const owner = await register("Playlist Owner");
  const other = await register("Playlist Other");
  const stationResponse = await api("/api/stations", { method: "POST", cookie: owner.cookie, body: { name: `Playlist Station ${randomUUID()}` } });
  assert.equal(stationResponse.status, 200, await stationResponse.clone().text());
  const station = (await stationResponse.json()).station;
  assert.equal(station.status, "PENDING_SETUP");
  const registry = await db.station.findFirst({ where: { id: station.id, organisationId: owner.organisationId }, include: { channels: true, streamConfig: true } });
  assert.equal(registry.channels.length, 1);
  assert.equal(registry.channels[0].status, "DRAFT");
  assert.equal(registry.streamConfig, null);
  const channelId = registry.channels[0].id;

  const suffix = randomUUID().slice(0, 8);
  const genre = await db.mediaGenre.create({ data: { name: `Test Pop ${suffix}`, slug: `test-pop-${suffix}` } });
  const asset = await db.mediaAsset.create({ data: { organisationId: owner.organisationId, libraryType: "ORGANISATION_MUSIC", name: "Playlist test song", originalName: "song.mp3", storageKey: `integration/${suffix}.mp3`, mimeType: "audio/mpeg", sizeBytes: 1024n, durationSeconds: 180, mediaType: "MUSIC", status: "READY", genres: { create: { mediaGenreId: genre.id, isPrimary: true } } } });
  await db.track.create({ data: { mediaAssetId: asset.id, title: "Test Pop", artist: "Test Artist", status: "READY", rightsHolder: "Test Rights", rightsReference: `LIC-${suffix}`, rightsBasis: "DIRECT_LICENCE", permittedTerritories: "WORLDWIDE", permittedUses: ["ONLINE_RADIO"], rightsConfirmedAt: new Date(), rightsReviewStatus: "APPROVED" } });

  const dashboard = await api("/api/programming/simple", { cookie: owner.cookie });
  assert.equal(dashboard.status, 200, await dashboard.clone().text());
  assert.equal((await dashboard.json()).channels.some((item) => item.id === channelId && item.streamingStatus === "PENDING_MANUAL_CONFIGURATION"), true);
  const genreCode = `TEST_POP_${suffix.toUpperCase()}`;
  const nonStop = await api("/api/programming/simple/nonstop", { method: "PUT", cookie: owner.cookie, body: { channelId, enabled: true, genreCodes: [genreCode] } });
  assert.equal(nonStop.status, 200, await nonStop.clone().text());

  const payload = { channelId, name: "Morning", durationValue: 3, durationUnit: "HOURS", buildMode: "GENRE_SEQUENCE", genreCodes: [genreCode, genreCode] };
  const created = await api("/api/programming/simple", { method: "POST", cookie: owner.cookie, body: payload });
  assert.equal(created.status, 201, await created.clone().text());
  const playlistId = (await created.json()).playlist.id;
  const copied = await api(`/api/programming/simple/${playlistId}`, { method: "POST", cookie: owner.cookie, body: { action: "duplicate" } });
  assert.equal(copied.status, 201, await copied.clone().text());
  const edited = await api(`/api/programming/simple/${playlistId}`, { method: "PATCH", cookie: owner.cookie, body: { ...payload, name: "Updated Morning" } });
  assert.equal(edited.status, 200, await edited.clone().text());

  const startsAt = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 16);
  const endsAt = new Date(Date.now() + 3 * 86400000 + 2 * 3600000).toISOString().slice(0, 16);
  const eventBody = { channelId, playlistId, startsAt, endsAt, timezone: "UTC" };
  const scheduled = await api("/api/programming/simple/events", { method: "POST", cookie: owner.cookie, body: eventBody });
  assert.equal(scheduled.status, 201, await scheduled.clone().text());
  const overlap = await api("/api/programming/simple/events", { method: "POST", cookie: owner.cookie, body: eventBody });
  assert.equal(overlap.status, 409, await overlap.clone().text());

  const foreignWrite = await api(`/api/programming/simple/${playlistId}`, { method: "PATCH", cookie: other.cookie, body: { ...payload, name: "Foreign" } });
  assert.equal(foreignWrite.status, 404, await foreignWrite.clone().text());
  const foreignSchedule = await api("/api/programming/simple/events", { method: "POST", cookie: other.cookie, body: eventBody });
  assert.equal(foreignSchedule.status, 404, await foreignSchedule.clone().text());
  const archiveWarning = await api(`/api/programming/simple/${playlistId}`, { method: "DELETE", cookie: owner.cookie });
  assert.equal(archiveWarning.status, 409, await archiveWarning.clone().text());
  const archived = await api(`/api/programming/simple/${playlistId}?confirm=true`, { method: "DELETE", cookie: owner.cookie });
  assert.equal(archived.status, 200, await archived.clone().text());
  assert.equal(await db.subscriberPlaylistEvent.count({ where: { organisationId: owner.organisationId, smartPlaylistId: playlistId, cancelledAt: null } }), 0);
});

test.after(async () => { await db.$disconnect(); });
