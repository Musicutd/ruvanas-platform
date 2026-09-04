import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";

const baseUrl = process.env.INTEGRATION_BASE_URL || "http://127.0.0.1:3100";
const db = new PrismaClient();

async function api(path, { method = "GET", body, cookie } = {}) {
  const headers = { origin: baseUrl };
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers["content-type"] = "application/json";
  return fetch(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
}

function sessionCookie(response) { return response.headers.get("set-cookie")?.split(";")[0] || ""; }

test("Radio Clock draft, exact-hour publication and revisions remain tenant scoped", async () => {
  const suffix = randomUUID();
  const registration = await api("/api/auth/register", { method: "POST", body: { name: "Radio Clock Owner", organisationName: `Radio Clock ${suffix}`, email: `radio-clock-${suffix}@example.invalid`, password: "correct-horse-battery-staple" } });
  assert.equal(registration.status, 201, await registration.clone().text());
  const registrationBody = await registration.json();
  const cookie = sessionCookie(registration);
  const organisationId = registrationBody.organisation.id;

  assert.equal((await api("/api/programming/radio-clocks")).status, 401);

  const asset = await db.mediaAsset.create({ data: { organisationId, libraryType: "ORGANISATION_MUSIC", name: "Clock music", originalName: "clock.mp3", storageKey: `clock/${suffix}.mp3`, mimeType: "audio/mpeg", sizeBytes: 1024n, durationSeconds: 180, mediaType: "MUSIC", status: "READY" } });
  const track = await db.track.create({ data: { mediaAssetId: asset.id, title: "Clock Song", artist: "Clock Artist", status: "READY", rightsHolder: "Clock Rights", rightsReference: `CLOCK-${suffix}`, rightsBasis: "DIRECT_LICENCE", permittedUses: ["ONLINE_RADIO"], rightsConfirmedAt: new Date(), rightsReviewStatus: "APPROVED" } });
  const mode = await db.musicMode.create({ data: { organisationId, name: "Clock Mode", slug: `clock-mode-${suffix}`, status: "ACTIVE", tracks: { create: { trackId: track.id, weight: 100 } } } });

  const clockPayload = { name: "Integration hour", description: "Exact reusable hour", items: [{ type: "MUSIC_MODE", label: "Full-hour rotation", durationSeconds: 3600, transition: "CLEAN", transitionSeconds: 0, sourceId: mode.id }] };
  const createdResponse = await api("/api/programming/radio-clocks", { method: "POST", cookie, body: clockPayload });
  assert.equal(createdResponse.status, 201, await createdResponse.clone().text());
  const created = (await createdResponse.json()).clock;
  assert.equal(created.readyToPublish, true);
  assert.equal(created.needsPublish, true);

  const previewResponse = await api(`/api/programming/radio-clocks/${created.id}/preview`, { cookie });
  assert.equal(previewResponse.status, 200, await previewResponse.clone().text());
  assert.equal((await previewResponse.json()).clock.plannedSeconds, 3600);

  const publishResponse = await api(`/api/programming/radio-clocks/${created.id}/publish`, { method: "POST", cookie });
  assert.equal(publishResponse.status, 200, await publishResponse.clone().text());
  const published = (await publishResponse.json()).clock;
  assert.equal(published.status, "PUBLISHED");
  assert.equal(published.publishedVersion, 1);
  assert.equal(published.needsPublish, false);

  const shortResponse = await api(`/api/programming/radio-clocks/${created.id}`, { method: "PUT", cookie, body: { ...clockPayload, items: [{ ...clockPayload.items[0], durationSeconds: 3599 }] } });
  assert.equal(shortResponse.status, 200, await shortResponse.clone().text());
  const short = (await shortResponse.json()).clock;
  assert.equal(short.version, 2);
  assert.equal(short.publishedVersion, 1);
  assert.equal(short.needsPublish, true);
  assert.equal((await api(`/api/programming/radio-clocks/${created.id}/publish`, { method: "POST", cookie })).status, 409);

  const fixedResponse = await api(`/api/programming/radio-clocks/${created.id}`, { method: "PUT", cookie, body: clockPayload });
  assert.equal(fixedResponse.status, 200, await fixedResponse.clone().text());
  const republishResponse = await api(`/api/programming/radio-clocks/${created.id}/publish`, { method: "POST", cookie });
  assert.equal(republishResponse.status, 200, await republishResponse.clone().text());
  assert.equal((await republishResponse.json()).clock.publishedVersion, 3);

  const archiveResponse = await api(`/api/programming/radio-clocks/${created.id}/archive`, { method: "POST", cookie });
  assert.equal(archiveResponse.status, 200, await archiveResponse.clone().text());
  assert.equal((await archiveResponse.json()).clock.status, "ARCHIVED");
});

test.after(async () => { await db.$disconnect(); });
