import { resolveBillingServiceState } from "./billing-reconciliation.mjs";

export function resolveEntitlements(subscription, now = new Date()) {
  const plan = subscription?.plan;
  const billingState = resolveBillingServiceState(subscription, now);
  const serviceEnabled = billingState.serviceEnabled;

  return Object.freeze({
    serviceEnabled,
    accessReason: billingState.reason,
    graceEndsAt: billingState.graceEndsAt,
    subscriptionStatus: subscription?.status || null,
    planCode: plan?.code || null,
    stationLimit: serviceEnabled ? plan.stationLimit : 0,
    storageLimitGb: serviceEnabled ? plan.storageLimitGb : 0,
    listenerLimit: serviceEnabled ? plan.listenerLimit : 0,
    maxBitrateKbps: serviceEnabled ? plan.maxBitrateKbps : 0,
    includesRuvanasCatalogue: Boolean(
      serviceEnabled && plan.includesRuvanasCatalogue
    ),
    promoUploadEnabled: Boolean(serviceEnabled && plan.promoUploadEnabled),
    schoolRadioEnabled: Boolean(
      serviceEnabled &&
      (subscription.schoolRadioEnabled ?? plan.schoolRadioEnabled)
    ),
    retailMediaEnabled: Boolean(
      serviceEnabled &&
      (subscription.retailMediaEnabled ?? plan.retailMediaEnabled)
    )
  });
}

export function isWithinLimit(currentUsage, limit) {
  return Number.isFinite(currentUsage) &&
    Number.isFinite(limit) &&
    currentUsage < limit;
}


