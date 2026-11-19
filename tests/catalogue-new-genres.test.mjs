import assert from "node:assert/strict";
import test from "node:test";
import { CANONICAL_AUTODJ_GENRES } from "../lib/autodj-genre-entitlements.mjs";
import { newCatalogueGenreLevel, resolveNewCatalogueGenres } from "../lib/catalogue-new-genres.mjs";

function fixture(initial = [], beforeCreate = null) {
  const saved = structuredClone(initial);
  const writes = [];
  let reads = 0;
  const tx = { mediaGenre: {
    findMany: async () => { reads += 1; return structuredClone(saved); },
    createMany: async ({ data, skipDuplicates }) => {
      assert.equal(skipDuplicates, true);
      writes.push(structuredClone(data));
      if (beforeCreate) await beforeCreate(saved, data);
      let count = 0;
      for (const row of data) {
        if (saved.some((genre) => genre.name === row.name || genre.slug === row.slug || genre.normalizedKey === row.normalizedKey)) continue;
        saved.push({ id: `genre-${saved.length + 1}`, ...row });
        count += 1;
      }
      return { count };
    }
  } };
  return { tx, saved, writes, reads: () => reads };
}

const existing = (overrides = {}) => ({
  id: "existing", name: "Dance", slug: "dance", normalizedKey: "dance",
  active: true, providerReviewStatus: "APPROVED", minimumCatalogueLevel: "PREMIUM",
  sourceProvider: "SUPPLIER", autoCreated: false, ...overrides
});

test("all canonical new genres derive their catalogue tiers from the existing entitlement matrix", async () => {
  for (const canonical of CANONICAL_AUTODJ_GENRES) {
    const db = fixture();
    const result = await resolveNewCatalogueGenres(db.tx, [canonical.code]);
    assert.deepEqual(result.createdNames, [canonical.label]);
    assert.equal(db.saved[0].name, canonical.label);
    assert.equal(db.saved[0].minimumCatalogueLevel, canonical.minimumLevel);
    assert.equal(newCatalogueGenreLevel(canonical.label), canonical.minimumLevel);
    assert.equal(db.saved[0].active, true);
    assert.equal(db.saved[0].providerReviewStatus, "APPROVED");
    assert.equal(db.saved[0].autoCreated, true);
  }
});

test("custom genres remain Premium and decoded names are stored readably", async () => {
  const db = fixture();
  const result = await resolveNewCatalogueGenres(db.tx, ["  Soul   &amp; Jazz  "]);
  assert.deepEqual(result.createdNames, ["Soul & Jazz"]);
  assert.equal(db.saved[0].minimumCatalogueLevel, "PREMIUM");
  assert.equal(newCatalogueGenreLevel("Soul & Jazz"), "PREMIUM");
});

test("canonical aliases and spelling variants create only one genre and one audit name", async () => {
  const db = fixture();
  const result = await resolveNewCatalogueGenres(db.tx, ["hip hop", "HIP_HOP", "Hip-Hop", "hiphop"]);
  assert.deepEqual(result.createdNames, ["Hip-Hop"]);
  assert.equal(result.ids.length, 1);
  assert.equal(db.saved.length, 1);
  assert.equal(db.writes.length, 1);
});

test("spacing, punctuation and R&B aliases are deduplicated without losing distinct genres", async () => {
  const db = fixture();
  const result = await resolveNewCatalogueGenres(db.tx, ["R&amp;B", "R and B", "rnb", "Rhythm and Blues", "Jazz Soul", "JazzSoul"]);
  assert.equal(result.ids.length, 2);
  assert.deepEqual(result.createdNames, ["R&B", "Jazz Soul"]);
});

test("existing approved genres are reused without changing tier, ownership or any other field", async () => {
  const original = existing();
  const db = fixture([original]);
  const result = await resolveNewCatalogueGenres(db.tx, ["DANCE"]);
  assert.deepEqual(result, { ids: [original.id], createdNames: [] });
  assert.deepEqual(db.saved, [original]);
  assert.deepEqual(db.writes, []);
});

test("existing normalizedKey and case-insensitive names remain matching identities", async () => {
  for (const original of [
    existing({ name: "Electronic", slug: "electronic", normalizedKey: "dance" }),
    existing({ name: "dAnCe", slug: "other", normalizedKey: null })
  ]) {
    const db = fixture([original]);
    assert.deepEqual(await resolveNewCatalogueGenres(db.tx, ["Dance"]), { ids: [original.id], createdNames: [] });
    assert.deepEqual(db.writes, []);
  }
});

test("existing canonical records are found through canonical aliases without replacement", async () => {
  const original = existing({ name: "Extended Club/House", slug: "extended-club-house", normalizedKey: "extended club house" });
  const db = fixture([original]);
  assert.deepEqual(await resolveNewCatalogueGenres(db.tx, ["House/Club"]), { ids: [original.id], createdNames: [] });
  assert.deepEqual(db.writes, []);
});

test("inactive, pending and rejected genres cannot be reactivated or bypassed by aliases", async () => {
  for (const blocked of [
    existing({ active: false }),
    existing({ providerReviewStatus: "PENDING" }),
    existing({ providerReviewStatus: "REJECTED" }),
    existing({ name: "Hip-Hop", slug: "hip-hop", normalizedKey: "hip hop", active: false }),
    existing({ name: "R&B", slug: "r-and-b", normalizedKey: "r&b", providerReviewStatus: "PENDING" })
  ]) {
    const db = fixture([blocked]);
    const name = blocked.name === "Hip-Hop" ? "HipHop" : blocked.name === "R&B" ? "Rhythm and Blues" : "dance";
    await assert.rejects(resolveNewCatalogueGenres(db.tx, [name]), { code: "CATALOGUE_GENRE_UNAVAILABLE" });
    assert.deepEqual(db.saved, [blocked]);
    assert.deepEqual(db.writes, []);
  }
});

test("ambiguous existing aliases fail rather than choosing or creating a replacement", async () => {
  const db = fixture([existing(), existing({ id: "second", name: "DANCE", slug: "dance-two", normalizedKey: null })]);
  await assert.rejects(resolveNewCatalogueGenres(db.tx, ["Dance"]), { code: "CATALOGUE_GENRE_AMBIGUOUS" });
  assert.deepEqual(db.writes, []);
});

test("all input bounds are validated before any database read or write", async () => {
  for (const invalid of [undefined, null, "Dance", {}, Array(11).fill("Dance"), [null], ["Dance", null], [2], [""], ["   "], ["a".repeat(121)], ["!!!"], ["Dance\u0000"], ["&#999999999;"]]) {
    const db = fixture();
    await assert.rejects(resolveNewCatalogueGenres(db.tx, invalid), { code: "CATALOGUE_GENRE_INVALID" });
    assert.equal(db.reads(), 0);
    assert.deepEqual(db.writes, []);
  }
  const db = fixture();
  assert.deepEqual(await resolveNewCatalogueGenres(db.tx, []), { ids: [], createdNames: [] });
  assert.equal(db.reads(), 0);
  assert.equal((await resolveNewCatalogueGenres(db.tx, ["a".repeat(120)])).ids.length, 1);
  assert.equal((await resolveNewCatalogueGenres(db.tx, Array.from({ length: 10 }, (_, index) => `Custom ${index}`))).ids.length, 10);
});

test("a concurrent same-identity insert is reused and not falsely attributed to this transaction", async () => {
  const raced = existing({ minimumCatalogueLevel: "FOCUSED" });
  const db = fixture([], (saved) => saved.push(raced));
  assert.deepEqual(await resolveNewCatalogueGenres(db.tx, ["dance"]), { ids: [raced.id], createdNames: [] });
  assert.equal(db.saved.length, 1);
});

test("a concurrent punctuation variant uses the same unique identity key", async () => {
  const db = fixture([], (saved, data) => saved.push(existing({ name: "JazzSoul", slug: "jazzsoul", normalizedKey: data[0].normalizedKey })));
  assert.deepEqual(await resolveNewCatalogueGenres(db.tx, ["Jazz Soul"]), { ids: ["existing"], createdNames: [] });
  assert.equal(db.saved.length, 1);
});

test("a concurrent blocked insert stays unavailable", async () => {
  const db = fixture([], (saved) => saved.push(existing({ active: false })));
  await assert.rejects(resolveNewCatalogueGenres(db.tx, ["Dance"]), { code: "CATALOGUE_GENRE_UNAVAILABLE" });
  assert.equal(db.saved.length, 1);
});

test("an unrelated truncated-slug collision fails safely without allocating a duplicate suffix", async () => {
  const prefix = "a".repeat(80);
  const db = fixture([existing({ name: `${prefix} first`, slug: prefix, normalizedKey: "unrelated" })]);
  await assert.rejects(resolveNewCatalogueGenres(db.tx, [`${prefix} second`]), { code: "CATALOGUE_GENRE_CONFLICT" });
  assert.equal(db.saved.length, 1);
  assert.equal(db.writes.length, 1);
});

test("database errors propagate without querying an aborted transaction", async () => {
  const db = fixture();
  db.tx.mediaGenre.createMany = async () => { throw Object.assign(new Error("unique failure"), { code: "P2002" }); };
  await assert.rejects(resolveNewCatalogueGenres(db.tx, ["Dance"]), { code: "P2002" });
  assert.equal(db.reads(), 1);
});

test("missing insert result and unexpected counts fail closed", async () => {
  const db = fixture();
  db.tx.mediaGenre.createMany = async () => ({ count: 0 });
  await assert.rejects(resolveNewCatalogueGenres(db.tx, ["Dance"]), { code: "CATALOGUE_GENRE_CONFLICT" });
  const unexpected = fixture();
  const insert = unexpected.tx.mediaGenre.createMany;
  unexpected.tx.mediaGenre.createMany = async (args) => { await insert(args); return { count: 2 }; };
  await assert.rejects(resolveNewCatalogueGenres(unexpected.tx, ["Dance"]), { code: "CATALOGUE_GENRE_CONFLICT" });
});
