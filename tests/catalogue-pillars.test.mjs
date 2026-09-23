import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { MUSIC_RIGHTS_USES } from "../lib/media-library-pro.mjs";
import { loadEligibleSubscriberMusic } from "../lib/subscriber-playlist-service.mjs";

const licensedTrack = {
  id: "central-track", status: "READY", rightsReviewStatus: "APPROVED",
  minimumCatalogueLevel: "FOCUSED", permittedTerritories: "EUROPE",
  permittedUses: [...MUSIC_RIGHTS_USES],
  mediaAsset: {
    status: "READY", mediaType: "MUSIC", libraryType: "RUVANAS_CATALOGUE",
    organisationId: null, licensedCatalogue: true, durationSeconds: 180,
    genres: [{ mediaGenre: { slug: "pop", name: "Pop" } }]
  },
  distributorItems: []
};

const configuredGenres = [{ slug: "pop", name: "Pop", active: true, minimumCatalogueLevel: "FOCUSED" }];
const db = { track: { findMany: async () => [licensedTrack] } };

test("one approved central track is available to every cleared pillar without tenant copies", async () => {
  for (const requiredUse of MUSIC_RIGHTS_USES) {
    const entries = await loadEligibleSubscriberMusic(db, {
      organisationId: "subscriber-1", requiredUse, territory: "MT",
      catalogueLevel: "FOCUSED", configuredGenres, sourceScopes: ["LICENSED_CATALOGUE"]
    });
    assert.deepEqual(entries.map((entry) => entry.track.id), ["central-track"], requiredUse);
  }
});

test("catalogue availability still fails closed for wrong tier, territory and pillar", async () => {
  const base = { organisationId: "subscriber-1", requiredUse: "RETAIL_RADIO", territory: "MT", catalogueLevel: "FOCUSED", configuredGenres };
  assert.equal((await loadEligibleSubscriberMusic(db, { ...base, catalogueLevel: "NONE" })).length, 0);
  assert.equal((await loadEligibleSubscriberMusic(db, { ...base, territory: "US" })).length, 0);
  assert.equal((await loadEligibleSubscriberMusic({ track: { findMany: async () => [{ ...licensedTrack, permittedUses: ["ONLINE_RADIO"] }] } }, base)).length, 0);
});

test("pillar catalogue surfaces are subscriber-owned and do not expose source files", async () => {
  const route = await readFile(new URL("../app/api/catalogue/music/route.js", import.meta.url), "utf8");
  const quick = await readFile(new URL("../app/dashboard/retail/music/RetailMusicSetup.js", import.meta.url), "utf8");
  const shared = await readFile(new URL("../app/dashboard/programming/SimplePlaylistWorkspace.js", import.meta.url), "utf8");
  for (const product of ["RETAIL", "SCHOOL", "ONLINE", "HEALTH", "FAITH", "ORGANISATIONS"]) assert.match(route, new RegExp(`${product}: "${product === "ORGANISATIONS" ? "ORGANISATIONS" : product}_RADIO"`));
  assert.match(route, /subscriberProductAccess/);
  assert.match(route, /organisationId/);
  assert.doesNotMatch(route, /storageKey|downloadHost|sourceUrl/);
  assert.match(quick, /Approved Ruvanas catalogue/);
  assert.match(shared, /approved catalogue track/);
});
