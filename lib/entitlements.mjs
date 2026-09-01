import { resolveBillingServiceState } from "./billing-reconciliation.mjs";

export function resolveEntitlements(subscription, now = new Date()) {
  const plan = subscription?.plan;
  const billingState = resolveBillingServiceState(subscription, now);
  const serviceEnabled = billingState.serviceEnabled;
  const schoolRadioEnabled = Boolean(
    serviceEnabled &&
    (subscription?.schoolRadioEnabled ?? plan?.schoolRadioEnabled)
  );

  return Object.freeze({
    serviceEnabled,
    accessReason: billingState.reason,
    graceEndsAt: billingState.graceEndsAt,
    subscriptionStatus: subscription?.status || null,
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
    promoUploadEnabled: Boolean(serviceEnabled && plan.promoUploadEnabled),
    schoolRadioEnabled,
    schoolPublicPublishingEnabled: Boolean(
      schoolRadioEnabled &&
      (subscription.schoolPublicPublishingEnabled ?? plan.schoolPublicPublishingEnabled)
    ),
    retailMediaEnabled: Boolean(
      serviceEnabled &&
      (subscription.retailMediaEnabled ?? plan.retailMediaEnabled)
    ),
    digitalSignageEnabled: Boolean(
      serviceEnabled &&
      (subscription.digitalSignageEnabled ?? plan.digitalSignageEnabled)
    )
  });
}

export function isWithinLimit(currentUsage, limit) {
  return Number.isFinite(currentUsage) &&
    Number.isFinite(limit) &&
    currentUsage < limit;
}


