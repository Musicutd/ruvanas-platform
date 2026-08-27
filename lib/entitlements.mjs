const SERVICE_ENABLED_STATUSES = Object.freeze([
  "TRIAL",
  "ACTIVE",
  "PAST_DUE"
]);

export function resolveEntitlements(subscription) {
  const plan = subscription?.plan;
  const serviceEnabled = Boolean(
    plan?.active && SERVICE_ENABLED_STATUSES.includes(subscription?.status)
  );

  return Object.freeze({
    serviceEnabled,
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
    schoolRadioEnabled: Boolean(serviceEnabled && plan.schoolRadioEnabled)
  });
}

export function isWithinLimit(currentUsage, limit) {
  return Number.isFinite(currentUsage) &&
    Number.isFinite(limit) &&
    currentUsage < limit;
}
