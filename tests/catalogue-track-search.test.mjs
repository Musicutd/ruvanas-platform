import test from "node:test";
import assert from "node:assert/strict";
import { catalogueTableRows, catalogueGenreOptions, catalogueRowCanUpdateTier, filterCatalogueRows } from "../lib/catalogue-track-search.mjs";

const genre = (id, name) => ({ mediaGenre: { id, name } });
const rows = catalogueTableRows([
  { id: "asset1", name: "file", originalName: "Beyonce - Halo.mp3", storageKey: "private", sourceUrl: "private",
    createdAt: new Date("2026-11-11T10:00:00Z"), genres: [genre("pop", "Pop")],
    track: { id: "track1", artist: "Beyoncé", title: "Halo", minimumCatalogueLevel: "FOCUSED", permittedUses: ["RETAIL_RADIO"], permittedTerritories: "MT", audioUrl: "private" } },
  { id: "asset2", name: "file", genres: [genre("rock", "Rock"), genre("pop", "Pop")],
    track: { id: "track2", artist: "The Band", title: "Christmas Lights", minimumCatalogueLevel: "PREMIUM" } },
  { id: "legacy", name: "Legacy recording", genres: [] }
]);

test("catalogue search ignores case, accents and surrounding whitespace", () => {
  assert.deepEqual(filterCatalogueRows(rows, { query: "  BEYONCE  " }).map(row => row.id), ["asset1"]);
  assert.deepEqual(filterCatalogueRows(rows, { query: "halo beyonce" }).map(row => row.id), ["asset1"]);
});

test("title and artist scopes do not accidentally search other fields", () => {
  assert.equal(filterCatalogueRows(rows, { query: "band", scope: "title" }).length, 0);
  assert.equal(filterCatalogueRows(rows, { query: "Christmas", scope: "artist" }).length, 0);
  assert.deepEqual(filterCatalogueRows(rows, { query: "band", scope: "artist" }).map(row => row.id), ["asset2"]);
  assert.deepEqual(filterCatalogueRows(rows, { query: "Christmas", scope: "title" }).map(row => row.id), ["asset2"]);
});

test("genre filter combines with the query and matches exact genre identity", () => {
  assert.deepEqual(filterCatalogueRows(rows, { genreId: "pop" }).map(row => row.id), ["asset1", "asset2"]);
  assert.deepEqual(filterCatalogueRows(rows, { genreId: "rock", query: "band" }).map(row => row.id), ["asset2"]);
  assert.equal(filterCatalogueRows(rows, { genreId: "pop", query: "missing" }).length, 0);
  assert.equal(filterCatalogueRows(rows, { genreId: "ro" }).length, 0);
  assert.deepEqual(filterCatalogueRows(rows, { query: "rock" }).map(row => row.id), ["asset2"]);
});

test("cleared search includes legacy records and genre options are distinct and sorted", () => {
  assert.equal(filterCatalogueRows(rows).length, 3);
  assert.equal(rows[2].track, null);
  assert.equal(rows[2].title, "Legacy recording");
  assert.deepEqual(catalogueGenreOptions(rows), [{ id: "pop", name: "Pop" }, { id: "rock", name: "Rock" }]);
});

test("client table data excludes private storage and playback properties", () => {
  assert.equal(JSON.stringify(rows).includes("private"), false);
  assert.deepEqual(rows[0].track, {
    id: "track1", minimumCatalogueLevel: "FOCUSED", catalogueAllTiers: false, permittedUses: ["RETAIL_RADIO"], permittedTerritories: "MT"
  });
  assert.equal(rows[0].createdAt, "2026-11-11T10:00:00.000Z");
});

test("bulk selection permits only unarchived music with track metadata", () => {
  const ready = { track: { id: "track1" }, mediaType: "MUSIC", status: "READY" };
  assert.equal(catalogueRowCanUpdateTier(ready), true);
  assert.equal(catalogueRowCanUpdateTier({ ...ready, status: "DRAFT" }), true);
  for (const change of [{ track: null }, { mediaType: "PROMO" }, { status: "ARCHIVED" }, { status: "DELETED" }]) {
    assert.equal(catalogueRowCanUpdateTier({ ...ready, ...change }), false);
  }
});
