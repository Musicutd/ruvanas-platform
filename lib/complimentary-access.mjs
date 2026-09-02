import { createHash, randomBytes } from "node:crypto";

const CODE_GROUPS = 3;
const BYTES_PER_GROUP = 4;

export function normaliseComplimentaryCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export function hashComplimentaryCode(value) {
  const normalised = normaliseComplimentaryCode(value);
  if (!normalised) return null;
  return createHash("sha256").update(normalised, "utf8").digest("hex");
}

export function generateComplimentaryCode() {
  const groups = Array.from({ length: CODE_GROUPS }, () =>
    randomBytes(BYTES_PER_GROUP).toString("hex").toUpperCase()
  );
  return `RUV-${groups.join("-")}`;
}

export function complimentaryCodeSuffix(value) {
  return normaliseComplimentaryCode(value).slice(-4);
}

export function canRedeemComplimentaryAccess(role) {
  return ["OWNER", "MANAGER"].includes(role);
}

export function complimentaryPlanSnapshot(plan) {
  if (!plan?.active) throw new Error("Choose an active tier.");
  return {
    complimentaryPlanName: plan.name,
    complimentaryPlanCode: plan.code,
    complimentaryStationLimit: plan.stationLimit,
    complimentaryStorageLimitGb: plan.storageLimitGb,
    complimentaryListenerLimit: plan.listenerLimit,
    complimentaryMaxBitrateKbps: plan.maxBitrateKbps,
    complimentaryIncludesCatalogue: plan.includesRuvanasCatalogue,
    complimentaryPromoUploadEnabled: plan.promoUploadEnabled,
    complimentarySchoolRadioEnabled: plan.schoolRadioEnabled,
    complimentarySchoolPublicPublishingEnabled: plan.schoolPublicPublishingEnabled,
    complimentaryRetailMediaEnabled: plan.retailMediaEnabled,
    complimentaryDigitalSignageEnabled: plan.digitalSignageEnabled
  };
}

export function clearComplimentaryAccess() {
  return {
    complimentaryAccessCodeId: null,
    complimentaryAccessActive: false,
    complimentaryAccessActivatedAt: null,
    complimentaryPlanName: null,
    complimentaryPlanCode: null,
    complimentaryStationLimit: null,
    complimentaryStorageLimitGb: null,
    complimentaryListenerLimit: null,
    complimentaryMaxBitrateKbps: null,
    complimentaryIncludesCatalogue: null,
    complimentaryPromoUploadEnabled: null,
    complimentarySchoolRadioEnabled: null,
    complimentarySchoolPublicPublishingEnabled: null,
    complimentaryRetailMediaEnabled: null,
    complimentaryDigitalSignageEnabled: null
  };
}

export function resolveComplimentaryPlan(subscription) {
  if (
    !subscription?.complimentaryAccessActive ||
    !subscription.complimentaryPlanName ||
    !subscription.complimentaryPlanCode ||
    !Number.isInteger(subscription.complimentaryStationLimit) ||
    !Number.isInteger(subscription.complimentaryStorageLimitGb) ||
    !Number.isInteger(subscription.complimentaryListenerLimit) ||
    !Number.isInteger(subscription.complimentaryMaxBitrateKbps)
  ) return null;

  return {
    active: true,
    name: subscription.complimentaryPlanName,
    code: subscription.complimentaryPlanCode,
    stationLimit: subscription.complimentaryStationLimit,
    storageLimitGb: subscription.complimentaryStorageLimitGb,
    listenerLimit: subscription.complimentaryListenerLimit,
    maxBitrateKbps: subscription.complimentaryMaxBitrateKbps,
    includesRuvanasCatalogue: Boolean(subscription.complimentaryIncludesCatalogue),
    promoUploadEnabled: Boolean(subscription.complimentaryPromoUploadEnabled),
    schoolRadioEnabled: Boolean(subscription.complimentarySchoolRadioEnabled),
    schoolPublicPublishingEnabled: Boolean(subscription.complimentarySchoolPublicPublishingEnabled),
    retailMediaEnabled: Boolean(subscription.complimentaryRetailMediaEnabled),
    digitalSignageEnabled: Boolean(subscription.complimentaryDigitalSignageEnabled)
  };
}

export function describePlanFeatures(plan) {
  return [
    `${plan.stationLimit} live shop stream${plan.stationLimit === 1 ? "" : "s"}`,
    `${plan.listenerLimit} listener capacity`,
    `${plan.storageLimitGb} GB audio storage`,
    `up to ${plan.maxBitrateKbps} kbps audio`,
    plan.includesRuvanasCatalogue ? "Ruvanas music catalogue" : null,
    plan.promoUploadEnabled ? "promotional audio uploads" : null,
    plan.schoolRadioEnabled ? "School Radio" : null,
    plan.schoolPublicPublishingEnabled ? "public School Radio publishing" : null,
    plan.retailMediaEnabled ? "Retail Media" : null,
    plan.digitalSignageEnabled ? "Digital Signage" : null
  ].filter(Boolean);
}
