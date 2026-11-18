// Read-only presentation. These checks never grant access or stand in for a
// shopper claim and cashier redemption through their own accounts.
export const PILOT_READINESS_UI_CODES = Object.freeze({
  environment: ["ENVIRONMENT_COMPATIBLE", "PRIVATE_PREVIEW_BLOCKED", "ENVIRONMENT_INVALID", "FEATURES_DISABLED", "AUTH_CONFIGURATION_UNAVAILABLE"],
  owner: ["OWNER_READY", "OWNER_MISSING"],
  entitlement: ["ENTITLEMENT_READY", "ENTITLEMENT_MISSING", "ENTITLEMENT_INACTIVE"],
  shops: ["SHOPS_READY", "SHOPS_MISSING", "SHOPS_INACTIVE"],
  coupons: ["COUPONS_READY", "COUPONS_MISSING", "COUPONS_NOT_APPROVED", "COUPONS_INACTIVE"],
  cashiers: ["CASHIERS_READY", "CASHIERS_MISSING", "CASHIERS_INACTIVE"],
  shoppers: ["SHOPPERS_READY", "SHOPPERS_MISSING", "SHOPPERS_INACTIVE"]
});
export const PILOT_READINESS_KEYS = Object.freeze(Object.keys(PILOT_READINESS_UI_CODES));
const keys = (value, names) => value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
const count = value => Number.isInteger(value) && value >= 0 && value <= 100;
const id = value => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,190}$/.test(value);
const date = value => typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const expectedStatus = code => code === "ENVIRONMENT_COMPATIBLE" || code.endsWith("_READY") ? "READY" : code.endsWith("_MISSING") || code === "COUPONS_NOT_APPROVED" ? "MISSING" : "BLOCKED";
export function pilotReadiness(value, organisationId) {
  if (!keys(value, ["ok", "organisation", "configured", "eligibleNow", "endToEndTest", "checks", "pendingInvitations", "checkedAt"]) || value.ok !== true ||
    !keys(value.organisation, ["id", "name"]) || !id(organisationId) || value.organisation.id !== organisationId ||
    typeof value.organisation.name !== "string" || !value.organisation.name.length || value.organisation.name.length > 500 ||
    typeof value.configured !== "boolean" || typeof value.eligibleNow !== "boolean" || value.endToEndTest !== "NOT_VERIFIED" || !count(value.pendingInvitations) || !date(value.checkedAt) ||
    !Array.isArray(value.checks) || value.checks.length !== PILOT_READINESS_KEYS.length) return null;
  for (const [index, check] of value.checks.entries()) {
    if (!keys(check, ["key", "status", "code", "configuredCount", "eligibleCount"]) || check.key !== PILOT_READINESS_KEYS[index] ||
      !["READY", "BLOCKED", "MISSING"].includes(check.status) || !PILOT_READINESS_UI_CODES[check.key].includes(check.code) ||
      !count(check.configuredCount) || !count(check.eligibleCount) || check.eligibleCount > check.configuredCount ||
      check.key === "environment" && check.configuredCount > 1 || check.status !== expectedStatus(check.code) ||
      (check.status === "READY") !== (check.eligibleCount > 0) || check.status === "MISSING" && check.configuredCount !== 0) return null;
  }
  if (value.configured !== value.checks.filter(check => check.key !== "environment").every(check => check.configuredCount > 0) ||
    value.eligibleNow !== value.checks.every(check => check.eligibleCount > 0)) return null;
  return value;
}

const titles = { environment: "Compatible test environment", owner: "Client Admin owner", entitlement: "Rewards access and allowances", shops: "Published shop profiles", coupons: "Approved coupon revisions", cashiers: "Shop checkout access", shoppers: "Accepted shopper access" };
const messages = {
  ENVIRONMENT_COMPATIBLE: "Required feature and sign-in settings are compatible. The separate account sign-ins still need testing.",
  PRIVATE_PREVIEW_BLOCKED: "Private preview is enabled here. Its tester sign-in is incompatible with the separate Client Admin, cashier and shopper accounts needed for this pilot.",
  ENVIRONMENT_INVALID: "The environment configuration is not suitable for the pilot. Have the Super Admin review it before testing.",
  FEATURES_DISABLED: "Required Rewards features are disabled. This check does not enable them.",
  AUTH_CONFIGURATION_UNAVAILABLE: "Required sign-in configuration is unavailable. The Super Admin must review it before testing.",
  OWNER_READY: "An eligible Client Admin owner is configured for this organisation.",
  OWNER_MISSING: "No eligible Client Admin owner is available for this organisation.",
  ENTITLEMENT_READY: "The programme and Rewards grant are current, with the required allowances.",
  ENTITLEMENT_MISSING: "The programme or explicit Rewards grant has not been prepared.",
  ENTITLEMENT_INACTIVE: "Stored Rewards access is not currently eligible. Review its status, expiry, allowances and organisation subscription.",
  SHOPS_READY: "Published, opted-in shop profiles are currently eligible for this pilot.",
  SHOPS_MISSING: "No published shop profile is configured for the pilot.",
  SHOPS_INACTIVE: "Stored shop profiles are not currently eligible. Review the active shops and publication settings.",
  COUPONS_READY: "At least one current coupon revision has eligible shop profiles and discovery approval.",
  COUPONS_MISSING: "No coupon revision is configured for this pilot.",
  COUPONS_NOT_APPROVED: "A coupon needs discovery approval for its exact current revision.",
  COUPONS_INACTIVE: "Stored coupons are not eligible now. Review validity dates, published revisions and shop availability.",
  CASHIERS_READY: "An eligible Client Admin owner or authorised cashier can redeem at a matching coupon shop.",
  CASHIERS_MISSING: "No eligible owner or matching shop-scoped cashier grant is configured.",
  CASHIERS_INACTIVE: "Stored checkout access is not currently eligible. Review the owner or cashier’s role, matching coupon shop, permissions and expiry.",
  SHOPPERS_READY: "At least one invited shopper has accepted and has current access.",
  SHOPPERS_MISSING: "No accepted shopper account is configured for this pilot. Review pending invitations or prepare one if needed.",
  SHOPPERS_INACTIVE: "Prepared shopper access is not eligible now. A pending invitation alone does not establish an accepted, active shopper."
};
const actions = {
  environment: { text: "Super Admin: review a separately scoped pilot environment and its sign-in configuration. This page does not change private preview or account access." },
  owner: { text: "Super Admin: arrange an existing eligible owner through organisation account management. This page does not create or impersonate a Client Admin." },
  entitlement: { text: "Review the pilot’s current access and explicit allowances.", tab: "access", label: "Review access" },
  shops: { text: "Choose an existing shop and review its published profile.", tab: "shops", label: "Review shops" },
  coupons: { text: "Client Admin: publish the coupon through your own account. Super Admin: review the exact revision for discovery.", tab: "coupons", label: "Review coupons" },
  cashiers: { text: "Client Admin owner: sign in with your own account to review checkout access. If another cashier will serve shoppers, use Rewards staff access to assign that existing member REDEEM permission for the exact shop. The cashier uses their own account." },
  shoppers: { text: "Review or prepare a shopper invitation. The intended shopper must accept it and sign in through their own shopper account.", tab: "shoppers", label: "Review shoppers" }
};
export function pilotReadinessRow(check) {
  if (!check || !Object.hasOwn(PILOT_READINESS_UI_CODES, check.key) || !PILOT_READINESS_UI_CODES[check.key].includes(check.code)) return null;
  return { title: titles[check.key], message: messages[check.code], action: check.status === "READY" ? null : actions[check.key] };
}
export function pilotNextStep(value) {
  if (!pilotReadiness(value, value?.organisation?.id)) return null;
  const check = value.checks.find(row => row.status !== "READY");
  return check ? { key: check.key, ...pilotReadinessRow(check) } : { key: "test", title: "Run the full journey with each role", message: "Configured access is not proof of a completed transaction. Use the Client Admin, shopper and cashier’s own accounts to test discovery, claiming, redemption and repeat-use limits.", action: null };
}
export function pilotReadinessMessage(code) {
  return ({ FORBIDDEN: "Readiness is unavailable for this Super Admin session or selected pilot.", UNAUTHENTICATED: "Sign in again to check pilot readiness.", FEATURE_DISABLED: "Pilot readiness is disabled in this environment.", RATE_LIMITED: "Please wait a moment, then review the pilot again." })[code] || "Readiness could not be verified. Review the pilot again before relying on its status. No readiness result is shown from an earlier check.";
}
