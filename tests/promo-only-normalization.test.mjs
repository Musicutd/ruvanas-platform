import assert from "node:assert/strict";
import { test } from "node:test";
import { mapPromoOnlyTrack, promoOnlyPayloadHash } from "../lib/promo-only.mjs";
import { resolvePromoOnlyFeedItem, upsertPromoOnlyMetadata } from "../lib/promo-only-service.js";

// Synthetic values using the published /doc/track_info field names. These
// are contract mocks, not observations of an account or catalogue grant.
const fixture = { id: 91, title: "Fixture recording", artist: "Fixture artist", releaseid: 55, titleid: 22,
  release: "Fixture release", duration: 177, media: "mp3,m4a,wav", media_type: 2,
  release_image: "https://media.example.test/cover.jpg", modified: 1780000000 };
const connection = { id: "connection", defaultMinimumCatalogueLevel: "FOCUSED",
  defaultPermittedTerritories: ["WORLDWIDE"], defaultPermittedUses: ["ONLINE_RADIO"], createdByUserId: "admin" };

function database(existing = null, ownershipMatches = true) {
  const calls = { updates: [], quarantines: [], releases: [] };
  const db = {
    musicDistributorTrack: {
      findUnique: async () => existing,
      upsert: async ({ create, update }) => { calls.updates.push({ create, update }); return { id: "provider-item", ...(existing ? { ...existing, ...update } : create) }; }
    },
    musicDistributorRelease: { upsert: async (args) => { calls.releases.push(args); return { id: "release-row" }; } },
    track: { updateMany: async (args) => { calls.quarantines.push(args); return { count: ownershipMatches ? 1 : 0 }; } },
    auditLog: { create: async () => ({}) }
  };
  return { db, calls };
}

test("documented metadata fields map without inventing rights or supplier products", () => {
  const mapped = mapPromoOnlyTrack(fixture);
  assert.equal(mapped.externalTrackId, "91");
  assert.equal(mapped.durationSeconds, 177);
  assert.equal(mapped.album, "Fixture release");
  assert.equal(mapped.mediaType, "2");
  assert.deepEqual(mapped.audioFormats, ["mp3", "m4a", "wav"]);
  assert.equal(mapped.artworkUrl, fixture.release_image);
  assert.ok(mapped.unsupportedFields.includes("rights"));
  assert.equal(mapped.permittedTerritories, undefined);
  for (const id of ["91bad", "91/92", "-1", "0", "9007199254740992"]) {
    assert.throws(() => mapPromoOnlyTrack({ ...fixture, id }), { code: "PROMOONLY_METADATA_INCOMPLETE" });
  }
});

test("same title never resolves a feed item without a stable supplier ID", async () => {
  let calls = 0;
  await assert.rejects(() => resolvePromoOnlyFeedItem({ recent: async () => { calls++; return [fixture, { ...fixture, id: 92 }]; } },
    { normalizedPayload: { title: fixture.title } }), { code: "PROMOONLY_IDENTITY_REQUIRED" });
  assert.equal(calls, 0);
});

test("requested track and release identity must match the provider response", async () => {
  assert.equal((await resolvePromoOnlyFeedItem({ track: async () => fixture }, { externalTrackId: "91" })).tracks.length, 1);
  await assert.rejects(() => resolvePromoOnlyFeedItem({ track: async () => ({ ...fixture, id: 92 }) }, { externalTrackId: "91" }), { code: "PROMOONLY_IDENTITY_MISMATCH" });
  await assert.rejects(() => resolvePromoOnlyFeedItem({ release: async () => [fixture] }, { externalReleaseId: "56" }), { code: "PROMOONLY_IDENTITY_MISMATCH" });
});

test("new metadata grants no territory or use, even when connection defaults are broad", async () => {
  const { db, calls } = database();
  await upsertPromoOnlyMetadata(db, connection, mapPromoOnlyTrack(fixture), {});
  assert.deepEqual(calls.updates[0].create.permittedTerritories, []);
  assert.deepEqual(calls.updates[0].create.permittedUses, []);
  assert.equal(calls.quarantines.length, 0);
});

test("documented release shape validates its outer ID and retains release title and date", async () => {
  const { releaseid, release: trackRelease, release_image, ...track } = fixture;
  const release = { id: 55, release: "Fixture compilation", date: "2026-10-10", release_img: "https://media.example.test/compilation.jpg", tracks: [track] };
  const resolved = await resolvePromoOnlyFeedItem({ release: async () => release }, { externalReleaseId: "55" });
  const mapped = mapPromoOnlyTrack(resolved.tracks[0], resolved.release);
  assert.equal(mapped.externalReleaseId, "55");
  assert.equal(mapped.album, "Fixture compilation");
  assert.equal(mapped.releaseDate.toISOString().slice(0, 10), "2026-10-10");
  assert.equal(mapped.artworkUrl, release.release_img);
  await assert.rejects(() => resolvePromoOnlyFeedItem({ release: async () => ({ ...release, id: 56 }) }, { externalReleaseId: "55" }), { code: "PROMOONLY_IDENTITY_MISMATCH" });
});

test("metadata refresh preserves takedown, rights, tiers and playlist-linked Track identity", async () => {
  const existing = { id: "item", trackId: "catalogue-track", status: "TAKEN_DOWN", minimumCatalogueLevel: "PREMIUM",
    permittedTerritories: ["US"], permittedUses: ["RETAIL"], rightsReference: "reviewed-contract",
    metadataChecksum: "old", importState: "AUTODJ_READY", audioStatus: "STORED_PENDING_RIGHTS" };
  const { db, calls } = database(existing);
  const result = await upsertPromoOnlyMetadata(db, connection, mapPromoOnlyTrack(fixture), {});
  for (const field of ["status", "permittedTerritories", "permittedUses", "minimumCatalogueLevel", "rightsReference", "trackId"]) {
    assert.equal(Object.hasOwn(calls.updates[0].update, field), false);
    assert.deepEqual(result.track[field], existing[field]);
  }
  assert.equal(result.track.autoDjReady, false);
  assert.equal(calls.updates[0].create.revision, undefined);
  assert.deepEqual(calls.updates[0].update.revision, { increment: 1 });
  assert.equal(result.track.importState, "RECONCILIATION_REQUIRED");
  assert.equal(calls.quarantines[0].where.id, existing.trackId);
  assert.equal(calls.quarantines[0].where.catalogueProvider, "PROMO_ONLY");
  assert.equal(calls.releases[0].update.status, undefined);
  assert.equal(calls.releases[0].update.takenDownAt, undefined);
});

test("corrupt provider link cannot overwrite customer-owned content", async () => {
  const { db, calls } = database({ trackId: "customer-upload", metadataChecksum: "old" }, false);
  await assert.rejects(() => upsertPromoOnlyMetadata(db, connection, mapPromoOnlyTrack(fixture), {}), { code: "PROMOONLY_CATALOGUE_OWNERSHIP_MISMATCH" });
  assert.equal(calls.updates.length, 0);
  assert.equal(calls.quarantines[0].where.mediaAsset.is.organisationId, null);
});

test("unchanged metadata is idempotent and older supplier revision cannot overwrite newer metadata", async () => {
  const metadata = mapPromoOnlyTrack(fixture);
  const existing = { trackId: "catalogue-track", metadataChecksum: promoOnlyPayloadHash(fixture), sourceModifiedAt: metadata.sourceModifiedAt };
  const current = database(existing);
  assert.equal((await upsertPromoOnlyMetadata(current.db, connection, metadata, {})).changed, false);
  assert.equal(current.calls.quarantines.length, 0);
  const stale = database({ ...existing, sourceModifiedAt: new Date(metadata.sourceModifiedAt.getTime() + 1000) });
  assert.equal((await upsertPromoOnlyMetadata(stale.db, connection, metadata, {})).changed, false);
  assert.equal(stale.calls.updates.length, 0);
  assert.equal(stale.calls.releases.length, 0);
});
