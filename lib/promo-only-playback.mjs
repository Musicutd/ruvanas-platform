import { readPromoOnlyConfig } from "./promo-only.mjs";
import { catalogueTerritoriesWithinApprovedScope, normalizeCatalogueTerritory, parseCatalogueTerritories } from "./catalogue-territories.mjs";

// Supplier test access is not a licence for general catalogue playback.
// Checking this at use time also covers tracks imported before the switch is turned off.
export function promoOnlyPlaybackDecision(track, { config } = {}) {
  if (track?.catalogueProvider !== "PROMO_ONLY") return { allowed: true, reason: "OTHER_CATALOGUE" };
  let current = config;
  if (!current) {
    try { current = readPromoOnlyConfig(); }
    catch { return { allowed: false, reason: "PROMOONLY_DISABLED" }; }
  }
  if (current.enabled !== true || current.mode !== "AUDIO_TEST") {
    return { allowed: false, reason: "PROMOONLY_DISABLED" };
  }
  if (!Array.isArray(track.distributorItems) || !track.distributorItems.length || track.distributorItems.some((item) =>
    item.connection?.providerKey !== "PROMO_ONLY" || item.connection.status !== "ACTIVE" ||
    item.status !== "ACTIVE" || item.autoDjReady !== true
  )) {
    return { allowed: false, reason: "PROMOONLY_CONNECTION_INACTIVE" };
  }
  return { allowed: true, reason: "PROMOONLY_AUDIO_TEST" };
}

export function promoOnlyStreamDecision(track, { currentPlanEligible = false, config } = {}) {
  if (track?.catalogueProvider !== "PROMO_ONLY") return { allowed: true, reason: "OTHER_CATALOGUE" };
  if (!currentPlanEligible) return { allowed: false, reason: "PROMOONLY_NOT_IN_CURRENT_PLAN" };
  return promoOnlyPlaybackDecision(track, { config });
}

export function promoOnlyApprovalScopeDecision({ territories, uses, approvedTerritories, approvedUses } = {}) {
  const parsed = parseCatalogueTerritories(territories, { allowWorldwide: false });
  if (!parsed.ok) return { allowed: false, reason: "PROMOONLY_TERRITORY_INVALID" };
  if (parsed.codes.some((code) => ["EUROPE", "DE"].includes(code)) ||
      !Array.isArray(approvedTerritories) || !approvedTerritories.length ||
      approvedTerritories.some((code) => ["EUROPE", "WORLDWIDE", "DE"].includes(normalizeCatalogueTerritory(code))) ||
      !catalogueTerritoriesWithinApprovedScope(parsed.codes, approvedTerritories)) {
    return { allowed: false, reason: "PROMOONLY_TERRITORY_UNAPPROVED" };
  }
  if (!Array.isArray(uses) || !uses.length || !Array.isArray(approvedUses) || !approvedUses.length ||
      uses.some((use) => !approvedUses.includes(use))) {
    return { allowed: false, reason: "PROMOONLY_USE_UNAPPROVED" };
  }
  return { allowed: true, reason: "PROMOONLY_APPROVED_SCOPE", territoryCodes: parsed.codes };
}

// Never follow a provider row's mutable trackId into organisation-owned media.
export async function updatePromoOnlyOwnedTrack(tx, trackId, data) {
  if (!trackId) throw Object.assign(new Error("Promo Only catalogue ownership could not be verified."), { code: "PROMOONLY_CATALOGUE_OWNERSHIP_MISMATCH" });
  const result = await tx.track.updateMany({
    where: {
      id: trackId,
      catalogueProvider: "PROMO_ONLY",
      mediaAsset: { is: { libraryType: "RUVANAS_CATALOGUE", organisationId: null } }
    },
    data
  });
  if (result.count !== 1) {
    throw Object.assign(new Error("Promo Only catalogue ownership could not be verified."), { code: "PROMOONLY_CATALOGUE_OWNERSHIP_MISMATCH" });
  }
  return result;
}
