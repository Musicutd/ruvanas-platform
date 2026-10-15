import { RUVANAS_PRODUCTS } from "./product-plan-catalogue.mjs";

export const PREVIEW_TESTER_PLAN_CODE = "PRIVATE_PREVIEW_TESTER_V1";
export const PREVIEW_TESTER_LIMIT = 20;
const FLAGS = Object.freeze({
  RETAIL: "retailRadioEnabled", SCHOOL: "schoolRadioEnabled", ONLINE: "onlineRadioEnabled",
  HEALTH: "healthRadioEnabled", FAITH: "faithRadioEnabled", ORGANISATIONS: "organisationsEnabled",
  CORRECTIONS: "correctionsRadioEnabled"
});
export const PREVIEW_TESTER_PLAN = Object.freeze({
  code: PREVIEW_TESTER_PLAN_CODE, name: "Private preview tester (not a public plan)",
  publicSlug: null, productFamily: null, tierNumber: null, publiclyAvailable: false,
  monthlyPriceCents: 0, stationLimit: 1, storageLimitGb: 1, listenerLimit: 1, maxBitrateKbps: 128,
  studioExternalDestinationLimit: 0, includesRuvanasCatalogue: false, licensedMusicCatalogueLevel: "NONE",
  promoUploadEnabled: false, schoolPublicPublishingEnabled: false, retailMediaEnabled: false,
  digitalSignageEnabled: false, active: true,
  ...Object.fromEntries(Object.values(FLAGS).map((key) => [key, false]))
});

export class PrivatePreviewAccountError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.name = "PrivatePreviewAccountError";
    this.code = code;
    this.status = status;
  }
}

export function normalizePreviewPillars(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > RUVANAS_PRODUCTS.length ||
      value.some((pillar) => !RUVANAS_PRODUCTS.includes(pillar)) || new Set(value).size !== value.length) {
    throw new PrivatePreviewAccountError("INVALID_PILLARS", 400);
  }
  return RUVANAS_PRODUCTS.filter((pillar) => value.includes(pillar));
}

export function previewTesterOverrides(pillars) {
  return Object.fromEntries(Object.entries(FLAGS).map(([pillar, key]) => [key, pillars.includes(pillar)]));
}

export function isPreviewTesterPlan(plan) {
  return Boolean(plan && Object.entries(PREVIEW_TESTER_PLAN).every(([key, value]) => plan[key] === value));
}

// Pure structural invariants are shared by password login and request/session
// authorization. Code-only testers can be checked with requirePassword:false;
// management can inspect disabled/expired grants with allowInactive:true.
export function assertPreviewTesterState(user, {
  now = new Date(), allowInactive = false, requirePassword = true
} = {}) {
  const grant = user?.privatePreviewAccess;
  const memberships = user?.memberships || [];
  const subscription = memberships[0]?.organisation?.subscription;
  let pillars;
  try { pillars = normalizePreviewPillars(grant?.pillars); } catch {
    throw new PrivatePreviewAccountError("TARGET_UNAVAILABLE", 404);
  }
  if (!user || user.role !== "OWNER" || !grant || grant.userId !== user.id || !grant.organisationId ||
      memberships.length !== 1 || memberships[0].organisationId !== grant.organisationId ||
      memberships[0].role !== "OWNER" || !isPreviewTesterPlan(subscription?.plan) ||
      subscription.organisationId !== grant.organisationId || subscription.billingContract ||
      subscription.status !== "TRIAL" || !(subscription.currentPeriodEnd instanceof Date) ||
      subscription.currentPeriodEnd.getTime() !== grant.expiresAt?.getTime?.() ||
      subscription.complimentaryAccessActive || subscription.schoolPublicPublishingEnabled !== false ||
      subscription.retailMediaEnabled !== false || subscription.digitalSignageEnabled !== false ||
      !Object.entries(previewTesterOverrides(pillars)).every(([key, enabled]) => subscription[key] === enabled) ||
      !(grant.expiresAt instanceof Date) || !Number.isFinite(grant.expiresAt.getTime()) ||
      (!allowInactive && (!grant.enabled || (requirePassword && !grant.passwordEnabled) || grant.expiresAt <= now))) {
    throw new PrivatePreviewAccountError("TARGET_UNAVAILABLE", 404);
  }
  const security = memberships[0].organisation?.enterpriseSecurityPolicy;
  if (security?.ssoRequired && security.passwordFallback === false) {
    throw new PrivatePreviewAccountError("TARGET_UNAVAILABLE", 404);
  }
  return { grant, membership: memberships[0], subscription, pillars };
}
