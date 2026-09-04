import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";

const baseUrl = process.env.INTEGRATION_BASE_URL || "http://127.0.0.1:3100";
const db = new PrismaClient();

async function api(path, { method = "GET", body, cookie, clientAddress } = {}) {
  const headers = { origin: baseUrl };
  if (cookie) headers.cookie = cookie;
  if (clientAddress) headers["x-forwarded-for"] = clientAddress;
  if (body !== undefined) headers["content-type"] = "application/json";
  return fetch(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
}

function sessionCookie(response) { return response.headers.get("set-cookie")?.split(";")[0] || ""; }

async function register(label, clientAddress) {
  const suffix = randomUUID();
  const email = `advanced-scheduler-${label}-${suffix}@example.invalid`;
  const response = await api("/api/auth/register", { method: "POST", clientAddress, body: { name: `${label} Scheduler Owner`, organisationName: `${label} Scheduler ${suffix}`, email, password: "correct-horse-battery-staple" } });
  assert.equal(response.status, 201, await response.clone().text());
  const body = await response.json();
  return { cookie: sessionCookie(response), organisationId: body.organisation.id, userId: body.user.id };
}

test("Advanced Scheduler versions, publication and tenancy remain controlled", async () => {
  const owner = await register("Primary", "192.0.2.201");
  const outsider = await register("Outside", "192.0.2.202");
  assert.equal((await api("/api/programming/advanced-scheduler")).status, 401);

  const channel = await db.channel.create({ data: { organisationId: owner.organisationId, name: "Main Online Radio", slug: `main-${randomUUID()}`, status: "ACTIVE" } });
  const asset = await db.mediaAsset.create({ data: { organisationId: owner.organisationId, libraryType: "ORGANISATION_MUSIC", name: "Scheduler music", originalName: "scheduler.mp3", storageKey: `scheduler/${randomUUID()}.mp3`, mimeType: "audio/mpeg", sizeBytes: 1024n, durationSeconds: 180, mediaType: "MUSIC", status: "READY" } });
  const track = await db.track.create({ data: { mediaAssetId: asset.id, title: "Scheduler Song", artist: "Scheduler Artist", status: "READY", rightsHolder: "Scheduler Rights", rightsReference: `SCHED-${randomUUID()}`, rightsBasis: "DIRECT_LICENCE", permittedUses: ["ONLINE_RADIO"], rightsConfirmedAt: new Date(), rightsReviewStatus: "APPROVED" } });
  const mode = await db.musicMode.create({ data: { organisationId: owner.organisationId, name: "Scheduler Mode", slug: `scheduler-${randomUUID()}`, status: "ACTIVE", tracks: { create: { trackId: track.id, weight: 100 } } } });
  const clock = await db.radioClock.create({ data: { organisationId: owner.organisationId, name: "Published Hour", slug: `published-${randomUUID()}`, status: "PUBLISHED", version: 1, publishedVersion: 1, durationSeconds: 3600, createdByUserId: owner.userId, publishedByUserId: owner.userId, publishedAt: new Date(), items: { create: { position: 0, type: "MUSIC_MODE", label: "Full hour", offsetSeconds: 0, durationSeconds: 3600, transition: "CLEAN", transitionSeconds: 0, musicModeId: mode.id } } } });

  const payload = { channelId: channel.id, name: "Main weekly schedule", timezone: "Europe/Malta", items: [{ label: "Monday breakfast", recurrence: "WEEKLY", sourceType: "RADIO_CLOCK", weekday: 1, startTime: "09:00", durationMinutes: 60, priority: 50, sourceId: clock.id }] };
  const createdResponse = await api("/api/programming/advanced-scheduler", { method: "POST", cookie: owner.cookie, body: payload });
  assert.equal(createdResponse.status, 201, await createdResponse.clone().text());
  const created = (await createdResponse.json()).schedule;
  assert.equal(created.latestVersion, 1);
  assert.equal(created.activeVersion, null);

  const v1 = created.versions[0];
  assert.equal((await api(`/api/programming/advanced-scheduler/${created.id}/preview?versionId=${v1.id}&days=7`, { cookie: outsider.cookie })).status, 404);
  const previewResponse = await api(`/api/programming/advanced-scheduler/${created.id}/preview?versionId=${v1.id}&days=7`, { cookie: owner.cookie });
  assert.equal(previewResponse.status, 200, await previewResponse.clone().text());
  const preview = (await previewResponse.json()).preview;
  assert.equal(preview.readyToPublish, true);
  assert.equal(preview.occurrences.length, 1);

  const publishV1 = await api(`/api/programming/advanced-scheduler/${created.id}/versions/${v1.id}/publish`, { method: "POST", cookie: owner.cookie, body: { conflictsAcknowledged: false } });
  assert.equal(publishV1.status, 200, await publishV1.clone().text());
  assert.equal((await publishV1.json()).version.isActive, true);

  const versionResponse = await api(`/api/programming/advanced-scheduler/${created.id}`, { method: "PUT", cookie: owner.cookie, body: { ...payload, name: "Main schedule revision", items: [{ ...payload.items[0], startTime: "10:00" }] } });
  assert.equal(versionResponse.status, 200, await versionResponse.clone().text());
  const revised = (await versionResponse.json()).schedule;
  assert.equal(revised.latestVersion, 2);
  assert.equal(revised.activeVersion.version, 1);
  const v2 = revised.versions.find((version) => version.version === 2);

  const publishV2 = await api(`/api/programming/advanced-scheduler/${created.id}/versions/${v2.id}/publish`, { method: "POST", cookie: owner.cookie, body: { conflictsAcknowledged: false } });
  assert.equal(publishV2.status, 200, await publishV2.clone().text());
  const versions = await db.programmeScheduleVersion.findMany({ where: { scheduleId: created.id }, orderBy: { version: "asc" } });
  assert.deepEqual(versions.map((version) => [version.version, version.status, version.isActive]), [[1, "ARCHIVED", false], [2, "PUBLISHED", true]]);
  assert.equal(versions.filter((version) => version.isActive).length, 1);

  const archiveResponse = await api(`/api/programming/advanced-scheduler/${created.id}/archive`, { method: "POST", cookie: owner.cookie });
  assert.equal(archiveResponse.status, 200, await archiveResponse.clone().text());
  assert.equal(await db.programmeScheduleVersion.count({ where: { scheduleId: created.id, isActive: true } }), 0);
});

test.after(async () => { await db.$disconnect(); });
