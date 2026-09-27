import { normaliseGenreCode } from "./autodj-genre-entitlements.mjs";

// Network Studio audio is organisation-owned promo media, not a licensed
// catalogue track. Apply both policy layers to the exact source assets and
// output version; never infer an artist or an explicit-content clearance from
// a filename. Music without independently reviewable track rights fails shut.
export function correctionsNetworkSourcePolicy({ sourceMedia = [], outputMediaAssetId, organisationPolicy, facilityPolicy } = {}) {
  if (!organisationPolicy?.policyConfiguredAt || !facilityPolicy?.policyConfiguredAt) return { allowed: false, reason: "CORRECTIONS_POLICY_NOT_CONFIGURED" };
  if (!sourceMedia.length || sourceMedia.some((media) => !media?.id || media.status !== "READY" || media.libraryType !== "ORGANISATION_PROMO")) {
    return { allowed: false, reason: "NETWORK_SOURCE_UNAVAILABLE" };
  }
  const ids = new Set([...sourceMedia.map((media) => media.id), outputMediaAssetId].filter(Boolean).map((id) => id.toLowerCase()));
  for (const policy of [organisationPolicy, facilityPolicy]) {
    if (policy.cleanOnly === false) return { allowed: false, reason: "CORRECTIONS_POLICY_INVALID" };
    if ((policy.blockedTrackIds || []).some((id) => ids.has(id.toLowerCase()))) return { allowed: false, reason: "CORRECTIONS_SOURCE_BLOCKED" };
    for (const media of sourceMedia) {
      const genres = (media.genres || []).map((entry) => normaliseGenreCode(entry.mediaGenre?.slug || entry.mediaGenre?.name || "")).filter(Boolean);
      if (genres.some((genre) => (policy.restrictedGenres || []).includes(genre))) return { allowed: false, reason: "CORRECTIONS_GENRE_RESTRICTED" };
      // A spoken announcement has no music genre. The allowed-music list
      // governs tagged music, not speech; a tagged source must intersect it.
      if (genres.length && policy.allowedGenres?.length && !genres.some((genre) => policy.allowedGenres.includes(genre))) return { allowed: false, reason: "CORRECTIONS_GENRE_NOT_ALLOWED" };
      if (media.mediaType === "MUSIC") {
        // Studio promo uploads have no licensed-music approval path. Do not
        // turn an organisation-owned file into network music by renaming it.
        return { allowed: false, reason: "NETWORK_MUSIC_RIGHTS_UNVERIFIED" };
      }
    }
  }
  return { allowed: true, reason: "NETWORK_SOURCE_POLICY_APPROVED" };
}
