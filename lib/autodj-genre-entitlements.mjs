const LEVEL_ORDER = Object.freeze({ NONE: 0, FOCUSED: 1, PROFESSIONAL: 2, PREMIUM: 3 });

export const AUTODJ_SOURCE_SCOPES = Object.freeze([
  "SUBSCRIBER_LIBRARY",
  "RUVANAS_CORE",
  "LICENSED_CATALOGUE"
]);

export const CANONICAL_AUTODJ_GENRES = Object.freeze([
  { code: "POP", label: "Pop", minimumLevel: "FOCUSED", aliases: ["pop"] },
  { code: "HIP_HOP", label: "Hip-Hop", minimumLevel: "FOCUSED", aliases: ["hip hop", "hip-hop", "hiphop"] },
  { code: "DANCE", label: "Dance", minimumLevel: "FOCUSED", aliases: ["dance"] },
  { code: "ROCK", label: "Rock", minimumLevel: "FOCUSED", aliases: ["rock"] },
  { code: "COUNTRY", label: "Country", minimumLevel: "PROFESSIONAL", aliases: ["country"] },
  { code: "LATIN", label: "Latin", minimumLevel: "PROFESSIONAL", aliases: ["latin"] },
  { code: "CARIBBEAN", label: "Caribbean", minimumLevel: "PROFESSIONAL", aliases: ["caribbean"] },
  { code: "CHRISTIAN", label: "Christian", minimumLevel: "PROFESSIONAL", aliases: ["christian"] },
  { code: "CLUB_HOUSE_EXTENDED", label: "Extended Club/House", minimumLevel: "PREMIUM", aliases: ["club", "house", "club house", "house club", "club/house", "house/club", "extended club house"] }
]);

const BY_CODE = new Map(CANONICAL_AUTODJ_GENRES.map((genre) => [genre.code, genre]));
const normaliseKey = (value) => String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const BY_ALIAS = new Map(CANONICAL_AUTODJ_GENRES.flatMap((genre) => [genre.code, genre.label, ...genre.aliases].map((value) => [normaliseKey(value), genre.code])));

export function normaliseGenreCode(value) {
  const explicit = String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return BY_CODE.has(explicit) ? explicit : BY_ALIAS.get(normaliseKey(value)) || explicit;
}

export function catalogueLevelAllows(actual, required) {
  return (LEVEL_ORDER[actual] ?? 0) >= (LEVEL_ORDER[required] ?? Number.POSITIVE_INFINITY);
}

export function licensedGenresForLevel(level, configuredGenres = []) {
  if ((LEVEL_ORDER[level] ?? 0) === 0) return [];
  const base = CANONICAL_AUTODJ_GENRES
    .filter((genre) => catalogueLevelAllows(level, genre.minimumLevel))
    .map(({ code, label, minimumLevel }) => ({ code, label, minimumLevel, premiumMore: false }));
  if (level !== "PREMIUM") return base;
  const present = new Set(base.map((genre) => genre.code));
  for (const configured of configuredGenres) {
    if (configured?.active === false || configured?.minimumCatalogueLevel !== "PREMIUM") continue;
    const code = normaliseGenreCode(configured.code || configured.slug || configured.name);
    if (!code || present.has(code)) continue;
    present.add(code);
    base.push({ code, label: configured.name || code.replaceAll("_", " "), minimumLevel: "PREMIUM", premiumMore: true });
  }
  return base;
}

export function parseSourceScopes(values) {
  const result = [...new Set((Array.isArray(values) ? values : []).map((value) => String(value).toUpperCase()))]
    .filter((value) => AUTODJ_SOURCE_SCOPES.includes(value));
  if (!result.length) throw new Error("Choose at least one permitted music source.");
  return result;
}

export function assertGenreSelection({ selectedGenreCodes, sourceScopes, catalogueLevel, configuredGenres = [] }) {
  const scopes = parseSourceScopes(sourceScopes);
  const selected = [...new Set((Array.isArray(selectedGenreCodes) ? selectedGenreCodes : []).map(normaliseGenreCode).filter(Boolean))];
  if (!selected.length) throw new Error("Choose at least one music genre.");
  if (selected.length > 24) throw new Error("Choose no more than 24 music genres.");
  if (scopes.includes("LICENSED_CATALOGUE")) {
    const allowed = new Set(licensedGenresForLevel(catalogueLevel, configuredGenres).map((genre) => genre.code));
    const denied = selected.filter((code) => !allowed.has(code));
    if (denied.length) {
      const error = new Error(`Your current plan does not allow these Licensed Music Catalogue genres: ${denied.join(", ")}.`);
      error.code = "LOCKED_CATALOGUE_GENRE";
      throw error;
    }
  }
  return { selectedGenreCodes: selected, sourceScopes: scopes };
}

export function sourceScopeForTrack(track) {
  if (track?.mediaAsset?.libraryType === "ORGANISATION_MUSIC") return "SUBSCRIBER_LIBRARY";
  if (track?.mediaAsset?.libraryType === "RUVANAS_CATALOGUE" && track.mediaAsset.licensedCatalogue === true) return "LICENSED_CATALOGUE";
  return "RUVANAS_CORE";
}

export function genreCodesForTrack(track) {
  return [...new Set((track?.mediaAsset?.genres || []).map((entry) => normaliseGenreCode(entry?.mediaGenre?.slug || entry?.mediaGenre?.name)).filter(Boolean))];
}
