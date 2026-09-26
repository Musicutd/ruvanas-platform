import { genreCodesForTrack, normaliseGenreCode } from "./autodj-genre-entitlements.mjs";
import { musicTrackEligibility } from "./media-library-pro.mjs";

// Conservative C2 provisioning caps; enterprise expansion requires an explicit
// future Super Admin agreement, never an implicit unlimited allowance.
export const CORRECTIONS_CAPS = Object.freeze({
  1: { facilities: 1, zones: 2 },
  2: { facilities: 1, zones: 5 },
  3: { facilities: 1, zones: 15 },
  4: { facilities: 5, zones: 50 },
  5: { facilities: 5, zones: 50 }
});

export function correctionsCaps(entitlements = {}) {
  if (!entitlements.correctionsRadioEnabled) return { facilities: 0, zones: 0 };
  return CORRECTIONS_CAPS[entitlements.planTierNumber] || { facilities: 0, zones: 0 };
}

export function correctionsFacilityPermission({ role, organisationId, memberId, locationId, assignment, edit = false } = {}) {
  if (!organisationId || !locationId) return false;
  if (role === "OWNER") return true;
  if (!assignment || assignment.organisationId !== organisationId || assignment.organisationMemberId !== memberId || assignment.facilityId !== locationId) return false;
  return !edit || (role === "MANAGER" && assignment.permission === "MANAGER");
}

function list(value, { genre = false } = {}) {
  if (value === undefined) value = [];
  if (!Array.isArray(value) || value.length > 100) throw new Error("Policy lists must have no more than 100 entries.");
  const entries = value.map((item) => {
    if (typeof item !== "string" || item.length > 160) throw new Error("Policy entries must be short text.");
    return genre ? normaliseGenreCode(item) : item.trim().toLowerCase();
  }).filter(Boolean);
  return [...new Set(entries)];
}

export function normalizeCorrectionsPolicy(input = {}) {
  if (input.cleanOnly === false || input.explicitAllowed === true) {
    throw new Error("Explicit music cannot be permitted for Corrections.");
  }
  return {
    allowedGenres: list(input.allowedGenres, { genre: true }),
    restrictedGenres: list(input.restrictedGenres, { genre: true }),
    blockedTrackIds: list(input.blockedTrackIds),
    blockedArtists: list(input.blockedArtists)
  };
}

export function correctionsPolicyEligibility(track, { baseEligibility, organisationPolicy, facilityPolicy, youthFacility = false } = {}) {
  if (baseEligibility?.playable !== true) return { playable: false, reason: baseEligibility?.reason || "BASE_RIGHTS_NOT_APPROVED" };
  if (!organisationPolicy?.policyConfiguredAt || !facilityPolicy?.policyConfiguredAt) return { playable: false, reason: "CORRECTIONS_POLICY_NOT_CONFIGURED" };
  if (track?.isExplicit !== false || (youthFacility && track?.contentWarning)) return { playable: false, reason: "CORRECTIONS_CONTENT_RESTRICTED" };
  if (!track?.permittedUses?.includes("CORRECTIONS_RADIO")) return { playable: false, reason: "CORRECTIONS_USE_NOT_PERMITTED" };
  const genres = genreCodesForTrack(track);
  for (const policy of [organisationPolicy, facilityPolicy]) {
    if (policy.cleanOnly === false) return { playable: false, reason: "CORRECTIONS_POLICY_INVALID" };
    if ((policy.blockedTrackIds || []).includes(track.id?.toLowerCase())) return { playable: false, reason: "CORRECTIONS_TRACK_BLOCKED" };
    if ((policy.blockedArtists || []).includes(track.artist?.trim().toLowerCase())) return { playable: false, reason: "CORRECTIONS_ARTIST_BLOCKED" };
    if (genres.some((genre) => (policy.restrictedGenres || []).includes(genre))) return { playable: false, reason: "CORRECTIONS_GENRE_RESTRICTED" };
    if (policy.allowedGenres?.length && !genres.some((genre) => policy.allowedGenres.includes(genre))) return { playable: false, reason: "CORRECTIONS_GENRE_NOT_ALLOWED" };
  }
  return { playable: true, reason: "CORRECTIONS_POLICY_APPROVED" };
}

export function correctionsMusicEligibility(track, { organisationId, facility, organisationPolicy, facilityPolicy, licensedCatalogueLevel, ...rightsContext } = {}) {
  const territory = facility?.location?.countryCode;
  if (!organisationId || facility?.location?.organisationId !== organisationId || facilityPolicy?.locationId !== facility?.locationId || !/^[A-Z]{2}$/.test(territory || "")) {
    return { playable: false, reason: "CORRECTIONS_FACILITY_OR_TERRITORY_REQUIRED" };
  }
  const baseEligibility = musicTrackEligibility(track, { ...rightsContext, organisationId, territory, licensedCatalogueLevel, requiredUse: "CORRECTIONS_RADIO" });
  return correctionsPolicyEligibility(track, { baseEligibility, organisationPolicy, facilityPolicy, youthFacility: facility.youthFacility });
}
