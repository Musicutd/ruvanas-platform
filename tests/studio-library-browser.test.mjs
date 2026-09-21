import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { filterStudioLibraryCards, studioLibraryCard, studioLibraryGenreLabel } from "../lib/studio-library-browser.mjs";

test("subscriber library exposes track details but never media locations", () => {
  const card = studioLibraryCard({
    track: {
      id: "track-1", title: "Blue Sky", artist: "The Band", album: "Summer",
      mixName: "Radio Edit", bpm: 124, isExplicit: false,
      sourceUrl: "https://private.example/audio.mp3", storageKey: "private/key",
      mediaAsset: {
        id: "asset-1", durationSeconds: 190, libraryType: "RUVANAS_CATALOGUE",
        storageKey: "private/key", publicUrl: "https://private.example/audio.mp3"
      }
    },
    genreCodes: ["POP", "DANCE"]
  });
  assert.equal(card.title, "Blue Sky");
  assert.equal(card.source, "Ruvanas catalogue");
  assert.equal(card.durationSeconds, 190);
  assert.equal(card.genres.length, 2);
  for (const forbidden of ["sourceUrl", "storageKey", "publicUrl", "mediaAsset", "asset-1", "private/key", "private.example"]) {
    assert.equal(JSON.stringify(card).includes(forbidden), false);
  }
});

test("subscriber library search and genre filtering work together", () => {
  const cards = [
    { id: "a", artist: "The Band", title: "Blue Sky", album: "Summer", mix: "Radio Edit", genres: ["POP"] },
    { id: "b", artist: "Another Band", title: "Night Sky", album: "Winter", mix: null, genres: ["DANCE"] }
  ];
  assert.deepEqual(filterStudioLibraryCards(cards, { query: "blue band", genre: "pop" }).map((card) => card.id), ["a"]);
  assert.deepEqual(filterStudioLibraryCards(cards, { query: "sky", genre: "dance" }).map((card) => card.id), ["b"]);
  assert.deepEqual(filterStudioLibraryCards(cards, { query: "missing" }), []);
  assert.equal(studioLibraryGenreLabel("r-and-b"), "R&B");
});

test("subscriber Studio library route is tenant- and rights-scoped and shows no download link", async () => {
  const [route, view] = await Promise.all([
    readFile(new URL("../app/api/studio/library/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/studio/StudioLibraryClient.js", import.meta.url), "utf8")
  ]);
  assert.match(route, /requireActiveStudio\(ORGANISATION_MEMBER_ROLES\)/);
  assert.match(route, /organisationId: access\.organisation\.id/);
  assert.match(route, /loadEligibleSubscriberMusic/);
  assert.match(route, /studioLibraryCard/);
  assert.doesNotMatch(view, /\bdownload\s*=/i);
  assert.doesNotMatch(view, /\/api\/media\//);
});
