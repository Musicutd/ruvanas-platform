// Shared by CSV preview and transactional genre creation. Unavailable aliases
// must remain visible to matching so that they cannot be recreated as new.
import { CANONICAL_AUTODJ_GENRES, normaliseGenreCode } from "./autodj-genre-entitlements.mjs";

export const canonicalCatalogueGenre = name => CANONICAL_AUTODJ_GENRES.find(genre => genre.code === normaliseGenreCode(name)) || null;
export function decodeSpreadsheetText(value) {
  return String(value ?? "")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .trim();
}

export const catalogueGenreLookupKey = (value) => decodeSpreadsheetText(value).toLowerCase().replace(/\band\b/g, "&").replace(/[^a-z0-9]+/g, " ").trim();
const compact = (value) => catalogueGenreLookupKey(value).replace(/\s+/g, "");
const rbAliases = ["r&b", "r and b", "rnb", "rhythm and blues"];
const rbKeys = new Set(rbAliases.flatMap(value => [catalogueGenreLookupKey(value), compact(value)]));

export function catalogueGenreKeys(genre) {
  const keys = new Set([genre.name, genre.slug, genre.normalizedKey].filter(Boolean).flatMap(value => [catalogueGenreLookupKey(value), compact(value)]).filter(Boolean));
  for (const value of [genre.name, genre.slug, genre.normalizedKey].filter(Boolean)) {
    const canonical = canonicalCatalogueGenre(value);
    if (canonical) for (const alias of [canonical.code, canonical.label, ...canonical.aliases]) {
      keys.add(catalogueGenreLookupKey(alias)); keys.add(compact(alias));
    }
  }
  if ([...keys].some(key => rbKeys.has(key))) for (const key of rbKeys) keys.add(key);
  return [...keys];
}

export function matchCatalogueGenres(name, genres) {
  const requested = catalogueGenreKeys({ name });
  const matched = new Map();
  for (const genre of genres) {
    if (catalogueGenreKeys(genre).some(key => requested.includes(key))) matched.set(genre.id, genre);
  }
  return [...matched.values()];
}

export function isCatalogueGenreAvailable(genre) {
  return genre.active !== false && (genre.providerReviewStatus == null || genre.providerReviewStatus === "APPROVED");
}
