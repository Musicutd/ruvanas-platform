import { resolveBillingServiceState } from "./billing-reconciliation.mjs";
import { resolveComplimentaryPlan } from "./complimentary-access.mjs";

const LICENSED_CATALOGUE_LEVEL_ORDER = Object.freeze({
  NONE: 0,
  FOCUSED: 1,
  PROFESSIONAL: 2,
  PREMIUM: 3
});

export const STUDIO_LEVELS = Object.freeze({ BASIC: "BASIC", PRO: "PRO" });
export const STUDIO_EXTERNAL_DESTINATION_LIMITS = Object.freeze({ 1: 0, 2: 0, 3: 2, 4: 5, 5: 10 });

export function studioLevelForTier(tierNumber) {
  const tier = Number(tierNumber);
  return Number.isInteger(tier) && tier >= 3 ? STUDIO_LEVELS.PRO : STUDIO_LEVELS.BASIC;
}

export function studioExternalDestinationLimit(tierNumber, customLimit = null) {
  const tier = Number(tierNumber);
  if (tier === 5 && customLimit != null && Number.isInteger(Number(customLimit)) && Number(customLimit) >= 0) return Number(customLimit);
  return STUDIO_EXTERNAL_DESTINATION_LIMITS[tier] || 0;
}

function licensedCatalogueLevel(value) {
  return Object.hasOwn(LICENSED_CATALOGUE_LEVEL_ORDER, value) ? value : "NONE";
}

function capabilitySource(subscription, field, complimentaryAccess) {
  if (complimentaryAccess) return "COMPLIMENTARY";
  if (subscription?.[field] !== null && subscription?.[field] !== undefined) return "SUBSCRIPTION_OVERRIDE";
  return "PLAN";
}

export function resolveEffectivePlan(subscription) {
  return resolveComplimentaryPlan(subscription) || subscription?.plan || null;
}

export function resolveEntitlements(subscription, now = new Date()) {
  const plan = resolveEffectivePlan(subscription);
  const billingState = resolveBillingServiceState(subscription, now);
  const serviceEnabled = billingState.serviceEnabled;
  const complimentaryAccess = billingState.reason === "COMPLIMENTARY_ACCESS";
  const retailRadioEnabled = Boolean(
    serviceEnabled &&
    (complimentaryAccess
      ? plan?.retailRadioEnabled
      : subscription?.retailRadioEnabled ?? plan?.retailRadioEnabled)
  );
  const schoolRadioEnabled = Boolean(
    serviceEnabled &&
    (complimentaryAccess
      ? plan?.schoolRadioEnabled
      : subscription?.schoolRadioEnabled ?? plan?.schoolRadioEnabled)
  );
  const onlineRadioEnabled = Boolean(
    serviceEnabled &&
    (complimentaryAccess
      ? plan?.onlineRadioEnabled
      : subscription?.onlineRadioEnabled ?? plan?.onlineRadioEnabled)
  );
  const healthRadioEnabled = Boolean(
    serviceEnabled &&
    (complimentaryAccess
      ? plan?.healthRadioEnabled
      : subscription?.healthRadioEnabled ?? plan?.healthRadioEnabled)
  );
  const faithRadioEnabled = Boolean(
    serviceEnabled &&
    (complimentaryAccess
      ? plan?.faithRadioEnabled
      : subscription?.faithRadioEnabled ?? plan?.faithRadioEnabled)
  );
  const organisationsEnabled = Boolean(
    serviceEnabled &&
    (complimentaryAccess
      ? plan?.organisationsEnabled
      : subscription?.organisationsEnabled ?? plan?.organisationsEnabled)
  );
  const resolvedLicensedCatalogueLevel = serviceEnabled
    ? licensedCatalogueLevel(plan?.licensedMusicCatalogueLevel)
    : "NONE";
  const planTierNumber = Number(plan?.tierNumber) || null;
  const studioLevel = studioLevelForTier(planTierNumber);

  return Object.freeze({
    serviceEnabled,
    accessReason: billingState.reason,
    graceEndsAt: billingState.graceEndsAt,
    subscriptionStatus: subscription?.status || null,
    complimentaryAccess,
    planName: plan?.name || null,
    planCode: plan?.code || null,
    planProductFamily: plan?.productFamily || null,
    planTierNumber,
    studioLevel,
    studioBasicEnabled: Boolean(serviceEnabled),
    studioProEnabled: Boolean(serviceEnabled && studioLevel === STUDIO_LEVELS.PRO),
    studioMultitrackTrackLimit: studioLevel === STUDIO_LEVELS.PRO ? 16 : 8,
    studioExternalDestinationLimit: serviceEnabled ? studioExternalDestinationLimit(planTierNumber, plan?.studioExternalDestinationLimit) : 0,
    stationLimit: serviceEnabled ? plan.stationLimit : 0,
    streamLimit: serviceEnabled ? plan.stationLimit : 0,
    simultaneousStreamsEnabled: Boolean(serviceEnabled && plan.stationLimit > 1),
    storageLimitGb: serviceEnabled ? plan.storageLimitGb : 0,
    listenerLimit: serviceEnabled ? plan.listenerLimit : 0,
    maxBitrateKbps: serviceEnabled ? plan.maxBitrateKbps : 0,
    includesRuvanasCatalogue: Boolean(
      serviceEnabled && plan.includesRuvanasCatalogue
    ),
    licensedMusicCatalogueLevel: resolvedLicensedCatalogueLevel,
    licensedMusicCatalogueEnabled: resolvedLicensedCatalogueLevel !== "NONE",
    promoUploadEnabled: Boolean(serviceEnabled && plan.promoUploadEnabled),
    retailRadioEnabled,
    schoolRadioEnabled,
    onlineRadioEnabled,
    healthRadioEnabled,
    faithRadioEnabled,
    organisationsEnabled,
    productAccessSource: Object.freeze({
      retail: capabilitySource(subscription, "retailRadioEnabled", complimentaryAccess),
      school: capabilitySource(subscription, "schoolRadioEnabled", complimentaryAccess),
      online: capabilitySource(subscription, "onlineRadioEnabled", complimentaryAccess),
      health: capabilitySource(subscription, "healthRadioEnabled", complimentaryAccess),
      faith: capabilitySource(subscription, "faithRadioEnabled", complimentaryAccess),
      organisations: capabilitySource(subscription, "organisationsEnabled", complimentaryAccess),
      licensedMusicCatalogue: complimentaryAccess ? "COMPLIMENTARY" : "PLAN"
    }),
    schoolPublicPublishingEnabled: Boolean(
      schoolRadioEnabled &&
      (complimentaryAccess
        ? plan.schoolPublicPublishingEnabled
        : subscription.schoolPublicPublishingEnabled ?? plan.schoolPublicPublishingEnabled)
    ),
    retailMediaEnabled: Boolean(
      serviceEnabled &&
      (complimentaryAccess
        ? plan.retailMediaEnabled
        : subscription.retailMediaEnabled ?? plan.retailMediaEnabled)
    ),
    digitalSignageEnabled: Boolean(
      serviceEnabled &&
      (complimentaryAccess
        ? plan.digitalSignageEnabled
        : subscription.digitalSignageEnabled ?? plan.digitalSignageEnabled)
    )
  });
}

export function hasLicensedMusicCatalogueLevel(actual, required) {
  if (!Object.hasOwn(LICENSED_CATALOGUE_LEVEL_ORDER, required)) return false;
  return LICENSED_CATALOGUE_LEVEL_ORDER[licensedCatalogueLevel(actual)] >=
    LICENSED_CATALOGUE_LEVEL_ORDER[required];
}

export function isWithinLimit(currentUsage, limit) {
  return Number.isFinite(currentUsage) &&
    Number.isFinite(limit) &&
    currentUsage < limit;
}


