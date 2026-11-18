import { CANONICAL_AUTODJ_GENRES, normaliseGenreCode } from "./autodj-genre-entitlements.mjs";
import { catalogueGenreKeys, catalogueGenreLookupKey, decodeSpreadsheetText, matchCatalogueGenres } from "./catalogue-genre-identity.mjs";

const canonicalGenre = (name) => CANONICAL_AUTODJ_GENRES.find((genre) => genre.code === normaliseGenreCode(name));
const baseSlug = (value) => value.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "genre";
const identityKey = (name) => catalogueGenreKeys({ name }).filter((key) => !/\s/.test(key)).sort()[0];
const genreError = (message, code) => Object.assign(new Error(message), { code });
const selection = { id: true, name: true, slug: true, normalizedKey: true, active: true, providerReviewStatus: true, minimumCatalogueLevel: true };

export function newCatalogueGenreLevel(name) {
  return canonicalGenre(name)?.minimumLevel || "PREMIUM";
}

function validatedNames(names) {
  if (!Array.isArray(names) || names.length > 10) {
    throw genreError("Select no more than 10 different genres per track.", "CATALOGUE_GENRE_INVALID");
  }
  const unique = new Map();
  for (const value of names) {
    let name;
    try { name = typeof value === "string" ? decodeSpreadsheetText(value).replace(/\s+/g, " ") : ""; }
    catch { name = ""; }
    if (!name || name.length > 120 || /[\u0000-\u001f\u007f]/.test(name) || !catalogueGenreLookupKey(name)) {
      throw genreError("A genre name must be 1–120 readable characters.", "CATALOGUE_GENRE_INVALID");
    }
    const display = canonicalGenre(name)?.label || name;
    if (!unique.has(identityKey(display))) unique.set(identityKey(display), { requestedName: name, display });
  }
  return [...unique.values()];
}

function matchingGenre(name, display, genres) {
  const matches = new Map([...matchCatalogueGenres(name, genres), ...matchCatalogueGenres(display, genres)].map((genre) => [genre.id, genre]));
  if (matches.size > 1) {
    throw genreError(`The genre “${name}” matches more than one catalogue genre. Review the existing genres first.`, "CATALOGUE_GENRE_AMBIGUOUS");
  }
  const genre = [...matches.values()][0];
  if (genre && (genre.active !== true || genre.providerReviewStatus !== "APPROVED")) {
    throw genreError(`The genre “${name}” is not available for catalogue tracks.`, "CATALOGUE_GENRE_UNAVAILABLE");
  }
  return genre;
}

export async function resolveNewCatalogueGenres(tx, names) {
  const ids = [];
  const createdNames = [];
  const requested = validatedNames(names);
  if (!requested.length) return { ids, createdNames };
  let genres = await tx.mediaGenre.findMany({ select: selection });
  for (const { requestedName: name, display } of requested) {
    let genre = matchingGenre(name, display, genres);
    if (!genre) {
      // ON CONFLICT DO NOTHING keeps a concurrent unique-key collision from
      // aborting the PostgreSQL transaction. Never catch P2002 and query it.
      const result = await tx.mediaGenre.createMany({ data: [{
        name: display,
        slug: baseSlug(display),
        normalizedKey: identityKey(display),
        active: true,
        minimumCatalogueLevel: newCatalogueGenreLevel(display),
        autoCreated: true,
        providerReviewStatus: "APPROVED"
      }], skipDuplicates: true });
      genres = await tx.mediaGenre.findMany({ select: selection });
      genre = matchingGenre(name, display, genres);
      if (!genre || (result.count !== 0 && result.count !== 1)) {
        throw genreError(`The genre “${name}” conflicts with an existing catalogue name or slug. Review the existing genres first.`, "CATALOGUE_GENRE_CONFLICT");
      }
      if (result.count === 1) createdNames.push(genre.name);
    }
    if (!ids.includes(genre.id)) ids.push(genre.id);
  }
  return { ids, createdNames };
}
