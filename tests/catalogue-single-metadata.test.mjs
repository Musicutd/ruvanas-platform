import assert from "node:assert/strict";
import test from "node:test";
import { parseCatalogueManifest } from "../lib/catalogue-bulk-import.mjs";
import { parseNewCatalogueGenreNames, selectSingleCatalogueRow } from "../lib/catalogue-single-metadata.mjs";
import { resolveNewCatalogueGenres } from "../lib/catalogue-new-genres.mjs";

const genres = [{ id: "cm0000000000000000000001", name: "R&B", slug: "r-and-b" }];

test("single upload matches one song in a multi-row CSV and proposes unknown genres", async () => {
  const csv = Buffer.from("#,Artist,Title,Mix,Time,BPM,Genre,Content Warning\n1,Adele,First,Clean,3:17,121,R&amp;B,\n2,Adele,Second,Radio Edit,3:30,104,Soul,X\n3,Other,Third,,2:40,110,Dance,\n");
  const rows = await parseCatalogueManifest({ buffer: csv, fileName: "music.csv", genres, allowNewGenres: true });
  const selected = selectSingleCatalogueRow(rows, "02 Adele - Second.mp3");
  assert.equal(selected.ok, true);
  assert.equal(selected.row.sheetRow, 3);
  assert.equal(selected.row.mixName, "Radio Edit");
  assert.equal(selected.row.durationSeconds, 210);
  assert.equal(selected.row.isExplicit, true);
  assert.deepEqual(selected.row.newGenreNames, ["Soul"]);
  assert.deepEqual(rows[0].genreNames, ["R&B"]);
});

test("single upload does not silently map a new genre to a partial existing genre", async () => {
  const csv = Buffer.from("Artist,Title,Genre\nArtist,Title,Contemporary R&amp;B\n");
  const [row] = await parseCatalogueManifest({ buffer: csv, fileName: "music.csv", genres, allowNewGenres: true });
  assert.deepEqual(row.newGenreNames, ["Contemporary R&B"]);
  assert.deepEqual(row.genreIds, []);
});

test("explicit File column wins, and ambiguous matches are rejected", async () => {
  const csv = Buffer.from("File,Artist,Title\nfirst.mp3,Adele,Song\nsecond.mp3,Adele,Song\n");
  const rows = await parseCatalogueManifest({ buffer: csv, fileName: "music.csv", genres, allowNewGenres: true });
  assert.equal(selectSingleCatalogueRow(rows, "second.mp3").row.sheetRow, 3);
  assert.equal(selectSingleCatalogueRow(rows, "unknown.mp3").ok, false);
  const ambiguous = await parseCatalogueManifest({ buffer: Buffer.from("Artist,Title\nAdele,Song\nAdele,Song\n"), fileName: "music.csv", genres, allowNewGenres: true });
  assert.match(selectSingleCatalogueRow(ambiguous, "Adele - Song.mp3").error, /More than one/i);
});

test("new genre values are validated and capped together with selected genres", () => {
  assert.deepEqual(parseNewCatalogueGenreNames('["R&amp;B","Soul"]').names, ["R&B", "Soul"]);
  assert.equal(parseNewCatalogueGenreNames('["Soul","soul"]').ok, false);
  assert.equal(parseNewCatalogueGenreNames('["Soul"]', 10).ok, false);
  assert.equal(parseNewCatalogueGenreNames('not json').ok, false);
});

test("a new spreadsheet genre is created once at Premium level and can be reused", async () => {
  const saved = [];
  const tx = { mediaGenre: {
    findFirst: async ({ where }) => saved.find((genre) => genre.normalizedKey === where.OR[0].normalizedKey) || null,
    findUnique: async ({ where }) => saved.find((genre) => genre.slug === where.slug) || null,
    create: async ({ data }) => {
      const genre = { id: `genre-${saved.length + 1}`, ...data };
      saved.push(genre);
      return genre;
    }
  } };
  const created = await resolveNewCatalogueGenres(tx, ["Soul"]);
  assert.deepEqual(created.createdNames, ["Soul"]);
  assert.equal(saved[0].minimumCatalogueLevel, "PREMIUM");
  assert.equal(saved[0].active, true);
  const reused = await resolveNewCatalogueGenres(tx, ["Soul"]);
  assert.deepEqual(reused.createdNames, []);
  assert.deepEqual(reused.ids, created.ids);
});
