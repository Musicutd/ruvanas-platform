// Pure eligibility only. A caller must separately retain station, source-scope,
// output, lease and per-play rechecks. This module cannot authorize an encoder.
import { musicTrackEligibility } from "./media-library-pro.mjs";
import { catalogueLevelAllows, genreCodesForTrack, licensedGenresForLevel } from "./autodj-genre-entitlements.mjs";
import { parseCatalogueTerritories } from "./catalogue-territories.mjs";
import { MAX_CATALOGUE_FILE_SIZE_BYTES } from "./catalogue-upload.mjs";

const ID = /^[a-zA-Z0-9_-]{8,80}$/;
const STORAGE_KEY = /^catalogue\/music\/[a-f0-9]{64}\.(mp3|wav|m4a|ogg)$/;
const LEVELS = new Set(["FOCUSED", "PROFESSIONAL", "PREMIUM"]);
const MAX_CANDIDATES = 5000;
const decision = (allowed, reason) => Object.freeze({ allowed, reason });

function millis(value) {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value ? date.getTime() : null;
}

function boundedBytes(value) {
  if (typeof value === "bigint") return value > 0n && value <= BigInt(MAX_CATALOGUE_FILE_SIZE_BYTES);
  if (typeof value === "string" && /^[1-9]\d{0,8}$/.test(value)) value = Number(value);
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= MAX_CATALOGUE_FILE_SIZE_BYTES;
}

/**
 * Opt-in extension for manually licensed masters, not a preview/test grant.
 * Entitlements and records must be fresh, complete server-loaded values. Null
 * provider/licence fields and a loaded empty distributor relation are explicit
 * evidence, not optional projections. instant/stopAt form a half-open window.
 * Core and subscriber media are deliberately not relabelled or handled here.
 */
export function licensedManualCatalogueDecision(track, context = {}) {
  const { enabled = false, organisationId, entitlements, territory, instant, stopAt,
    configuredGenres = [], selectedGenreCodes = null } =
    context && typeof context === "object" && !Array.isArray(context) ? context : {};
  if (enabled !== true) return decision(false, "MANUAL_CATALOGUE_DISABLED");
  const asset = track?.mediaAsset;
  if (asset?.libraryType !== "RUVANAS_CATALOGUE" || asset.licensedCatalogue !== true) {
    return decision(false, "NOT_LICENSED_MANUAL_CATALOGUE");
  }
  if (entitlements?.outputEnabled !== true || entitlements?.sandboxDraftOnly === true ||
      (typeof entitlements?.planCode === "string" && entitlements.planCode.trim().toUpperCase().startsWith("PRIVATE_PREVIEW_"))) {
    return decision(false, "OUTPUT_NOT_PERMITTED");
  }
  if (entitlements.serviceEnabled !== true || entitlements.onlineRadioEnabled !== true) return decision(false, "SERVICE_INACTIVE");
  const level = entitlements.licensedMusicCatalogueLevel;
  if (entitlements.licensedMusicCatalogueEnabled !== true || !LEVELS.has(level)) return decision(false, "CATALOGUE_PLAN_REQUIRED");
  if (!ID.test(organisationId || "")) return decision(false, "ORGANISATION_SCOPE_INVALID");
  const start = millis(instant), stop = millis(stopAt);
  if (start === null || stop === null || stop <= start) return decision(false, "RIGHTS_WINDOW_INACTIVE");
  // A recorded, concrete country is required even for WORLDWIDE recordings.
  if (typeof territory !== "string" || !/^[A-Z]{2}$/.test(territory)) return decision(false, "TERRITORY_REQUIRED");
  if (!Array.isArray(configuredGenres) || configuredGenres.length > 250 ||
      configuredGenres.some(genre => !genre || typeof genre !== "object" || Array.isArray(genre))) return decision(false, "INVALID_GENRES");
  if (selectedGenreCodes !== null && (!Array.isArray(selectedGenreCodes) || selectedGenreCodes.length > 24 ||
      selectedGenreCodes.some(code => typeof code !== "string" || !code.trim()))) return decision(false, "GENRE_SELECTION_INVALID");
  if (!ID.test(track?.id || "") || !ID.test(asset.id || "") || track.mediaAssetId !== asset.id ||
      !STORAGE_KEY.test(asset.storageKey || "") || !boundedBytes(asset.sizeBytes) ||
      !Number.isInteger(asset.durationSeconds) || asset.durationSeconds < 3 || asset.durationSeconds > 86_400 ||
      typeof track.title !== "string" || !track.title.trim() || track.title.length > 200 ||
      typeof track.artist !== "string" || !track.artist.trim() || track.artist.length > 200) return decision(false, "TRACK_IDENTITY_INVALID");
  // An omitted relation/provider projection is not evidence of manual origin.
  if (track.catalogueProvider !== null || track.rightsBasis === "DISTRIBUTOR_LICENCE" ||
      !Array.isArray(track.distributorItems) || track.distributorItems.length !== 0) return decision(false, "PROVIDER_OUTPUT_UNAVAILABLE");
  if (asset.organisationId !== null) return decision(false, "CATALOGUE_OWNERSHIP_INVALID");
  if (track.status !== "READY") return decision(false, "TRACK_NOT_READY");
  if (asset.status !== "READY" || asset.mediaType !== "MUSIC") return decision(false, "MEDIA_NOT_READY");
  const confirmed = millis(track.rightsConfirmedAt), reviewed = millis(track.rightsReviewedAt);
  if (track.rightsReviewStatus !== "APPROVED" || confirmed === null || reviewed === null || confirmed > start || reviewed > start ||
      !ID.test(track.rightsConfirmedById || "") || !ID.test(track.rightsReviewedById || "") ||
      typeof track.rightsHolder !== "string" || !track.rightsHolder.trim() ||
      typeof track.rightsReference !== "string" || !track.rightsReference.trim() ||
      !["OWNED_MASTER", "DIRECT_LICENCE", "OTHER"].includes(track.rightsBasis)) return decision(false, "RIGHTS_DECLARATION_REQUIRED");
  if (!Array.isArray(track.permittedUses) || !track.permittedUses.includes("ONLINE_RADIO") ||
      track.permittedUses.some(use => typeof use !== "string")) return decision(false, "USE_NOT_PERMITTED");
  if (!parseCatalogueTerritories(track.permittedTerritories).ok) return decision(false, "TERRITORY_REQUIRED");
  if (!LEVELS.has(track.minimumCatalogueLevel) || !catalogueLevelAllows(level, track.minimumCatalogueLevel)) return decision(false, "CATALOGUE_TIER_REQUIRED");
  if ((track.licenceStartsAt !== null && millis(track.licenceStartsAt) === null) ||
      (track.licenceExpiresAt !== null && millis(track.licenceExpiresAt) === null)) return decision(false, "RIGHTS_WINDOW_INACTIVE");
  const genres = (Array.isArray(asset.genres) ? asset.genres : []).filter(item => {
    const genre = item?.mediaGenre;
    return genre?.active === true && genre.providerReviewStatus === "APPROVED" &&
      LEVELS.has(genre.minimumCatalogueLevel) && catalogueLevelAllows(level, genre.minimumCatalogueLevel);
  });
  const projected = { ...track, mediaAsset: { ...asset, genres } };
  const allowedGenres = new Set(licensedGenresForLevel(level, configuredGenres).map(genre => genre.code));
  if (!genreCodesForTrack(projected).some(code => allowedGenres.has(code))) return decision(false, "CATALOGUE_GENRE_LOCKED");
  const options = { organisationId, requiredUse: "ONLINE_RADIO", territory, licensedCatalogueLevel: level,
    selectedGenreCodes, configuredGenres, promoOnlyConfig: { enabled: false, mode: "OFF" } };
  // Canonical licences are inclusive UTC dates. The last playable instant is
  // stopAt - 1ms, not the exclusive stop; an exact next-midnight stop is valid.
  for (const time of [start, stop - 1]) {
    const eligibility = musicTrackEligibility(projected, { ...options, instant: new Date(time) });
    if (!eligibility.playable) return decision(false, eligibility.reason);
  }
  return decision(true, "LICENSED_MANUAL_CATALOGUE");
}

/** Filter only this new source category; preserve entry references and weights. */
export function filterLicensedManualCatalogueEntries(entries, options) {
  if (!Array.isArray(entries) || entries.length > MAX_CANDIDATES) {
    return { entries: [], excludedReasons: { INVALID_ENTRIES: 1 } };
  }
  const accepted = [], excludedReasons = {};
  for (const entry of entries) {
    const result = licensedManualCatalogueDecision(entry?.track, options);
    if (result.allowed) accepted.push(entry);
    else excludedReasons[result.reason] = (excludedReasons[result.reason] || 0) + 1;
  }
  return { entries: accepted, excludedReasons };
}
