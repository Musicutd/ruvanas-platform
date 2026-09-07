import { resolveBillingServiceState } from "./billing-reconciliation.mjs";
import { resolveComplimentaryPlan } from "./complimentary-access.mjs";

const LICENSED_CATALOGUE_LEVEL_ORDER = Object.freeze({
  NONE: 0,
  FOCUSED: 1,
  PROFESSIONAL: 2,
  PREMIUM: 3
});

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
  const resolvedLicensedCatalogueLevel = serviceEnabled
    ? licensedCatalogueLevel(plan?.licensedMusicCatalogueLevel)
    : "NONE";

  return Object.freeze({
    serviceEnabled,
    accessReason: billingState.reason,
    graceEndsAt: billingState.graceEndsAt,
    subscriptionStatus: subscription?.status || null,
    complimentaryAccess,
    planName: plan?.name || null,
    planCode: plan?.code || null,
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
    productAccessSource: Object.freeze({
      retail: capabilitySource(subscription, "retailRadioEnabled", complimentaryAccess),
      school: capabilitySource(subscription, "schoolRadioEnabled", complimentaryAccess),
      online: capabilitySource(subscription, "onlineRadioEnabled", complimentaryAccess),
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


