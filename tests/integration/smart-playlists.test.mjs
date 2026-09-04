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

function sessionCookie(response) {
  return response.headers.get("set-cookie")?.split(";")[0] || "";
}

test("Smart Playlist draft, preview and publication remain tenant-scoped", async () => {
  const suffix = randomUUID();
  const registration = await api("/api/auth/register", {
    method: "POST",
    body: {
      name: "Smart Playlist Owner",
      organisationName: `Smart Playlist ${suffix}`,
      email: `smart-playlist-${suffix}@example.invalid`,
      password: "correct-horse-battery-staple"
    }
  });
  assert.equal(registration.status, 201, await registration.clone().text());
  const registrationBody = await registration.json();
  const cookie = sessionCookie(registration);
  const organisationId = registrationBody.organisation.id;

  const unauthenticated = await api("/api/programming/smart-playlists");
  assert.equal(unauthenticated.status, 401);

  const draftResponse = await api("/api/programming/smart-playlists", {
    method: "POST",
    cookie,
    body: {
      name: "Clean integration pop",
      description: "Integration rotation",
      maxTracks: 25,
      defaultWeight: 120,
      sort: "ARTIST_TITLE",
      rightsUse: "ONLINE_RADIO",
      territory: "MT",
      rules: [
        { field: "GENRE", operator: "IS", value: `Pop ${suffix}` },
        { field: "EXPLICIT", operator: "IS", value: "false" }
      ]
    }
  });
  assert.equal(draftResponse.status, 201, await draftResponse.clone().text());
  const draft = (await draftResponse.json()).playlist;
  assert.equal(draft.status, "DRAFT");
  assert.equal(draft.needsPublish, true);

  const genre = await db.mediaGenre.upsert({
    where: { slug: `pop-${suffix}` },
    update: {},
    create: { name: `Pop ${suffix}`, slug: `pop-${suffix}` }
  });
  const asset = await db.mediaAsset.create({
    data: {
      organisationId,
      libraryType: "ORGANISATION_MUSIC",
      name: "Integration music",
      originalName: "integration.mp3",
      storageKey: `integration/${suffix}.mp3`,
      mimeType: "audio/mpeg",
      sizeBytes: 1024n,
      durationSeconds: 180,
      mediaType: "MUSIC",
      status: "READY",
      genres: { create: { mediaGenreId: genre.id, isPrimary: true } }
    }
  });
  await db.track.create({
    data: {
      mediaAssetId: asset.id,
      title: "Integration Song",
      artist: "Integration Artist",
      releaseYear: 2026,
      status: "READY",
      rightsHolder: "Integration Rights",
      rightsReference: `LIC-${suffix}`,
      rightsBasis: "DIRECT_LICENCE",
      permittedTerritories: "MT",
      permittedUses: ["ONLINE_RADIO"],
      licenceStartsAt: new Date("2026-01-01T00:00:00.000Z"),
      licenceExpiresAt: new Date("2027-12-31T00:00:00.000Z"),
      rightsConfirmedAt: new Date(),
      rightsReviewStatus: "APPROVED"
    }
  });

  const previewResponse = await api(`/api/programming/smart-playlists/${draft.id}/preview`, { cookie });
  assert.equal(previewResponse.status, 200, await previewResponse.clone().text());
  const preview = await previewResponse.json();
  assert.equal(preview.count, 1);
  assert.equal(preview.tracks[0].title, "Integration Song");
  assert.ok(preview.tracks[0].explanations.length === 2);

  const publishResponse = await api(`/api/programming/smart-playlists/${draft.id}/publish`, { method: "POST", cookie });
  assert.equal(publishResponse.status, 200, await publishResponse.clone().text());
  const published = (await publishResponse.json()).playlist;
  assert.equal(published.status, "ACTIVE");
  assert.equal(published.needsPublish, false);
  assert.equal(published.trackCount, 1);
  assert.equal(await db.musicModeTrack.count({ where: { musicModeId: published.musicMode.id } }), 1);

  const updateResponse = await api(`/api/programming/smart-playlists/${draft.id}`, {
    method: "PUT",
    cookie,
    body: {
      name: "Clean integration pop",
      description: "Updated integration rotation",
      maxTracks: 10,
      defaultWeight: 140,
      sort: "RECENTLY_ADDED",
      rightsUse: "ONLINE_RADIO",
      territory: "MT",
      rules: [
        { field: "GENRE", operator: "IS", value: `Pop ${suffix}` },
        { field: "EXPLICIT", operator: "IS", value: "false" },
        { field: "RELEASE_YEAR", operator: "AT_LEAST", value: "2025" }
      ]
    }
  });
  assert.equal(updateResponse.status, 200, await updateResponse.clone().text());
  const updated = (await updateResponse.json()).playlist;
  assert.equal(updated.version, 2);
  assert.equal(updated.materializedVersion, 1);
  assert.equal(updated.needsPublish, true);
  assert.equal(await db.musicModeTrack.count({ where: { musicModeId: published.musicMode.id } }), 1);

  const republishResponse = await api(`/api/programming/smart-playlists/${draft.id}/publish`, { method: "POST", cookie });
  assert.equal(republishResponse.status, 200, await republishResponse.clone().text());
  assert.equal((await republishResponse.json()).playlist.materializedVersion, 2);

  const archiveResponse = await api(`/api/programming/smart-playlists/${draft.id}/archive`, { method: "POST", cookie });
  assert.equal(archiveResponse.status, 200, await archiveResponse.clone().text());
  assert.equal((await archiveResponse.json()).playlist.status, "ARCHIVED");
  assert.equal((await db.musicMode.findUnique({ where: { id: published.musicMode.id } })).status, "ARCHIVED");
});

test.after(async () => {
  await db.$disconnect();
});
