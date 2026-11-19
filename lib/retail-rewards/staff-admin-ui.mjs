// Browser presentation only. The owner session, organisation, role ceilings,
// allowances and current version are checked independently on the server.
import { wallTimeToIso } from "./offer-ui.mjs";

export const STAFF_ROLE_CAPABILITIES = Object.freeze({
  MANAGER: Object.freeze(["READ", "MANAGE_OFFERS", "PUBLISH_OFFERS", "REDEEM", "REVERSE", "VIEW_INSIGHTS", "EXPORT"]),
  CONTENT_EDITOR: Object.freeze(["READ", "MANAGE_OFFERS", "VIEW_INSIGHTS"]),
  VIEWER: Object.freeze(["READ", "REDEEM"])
});
export const STAFF_CAPABILITY_LABELS = Object.freeze({ READ: "View shop coupons", MANAGE_OFFERS: "Create and edit coupons",
  PUBLISH_OFFERS: "Publish coupon terms", REDEEM: "Redeem shopper coupons", REVERSE: "Correct redemptions",
  VIEW_INSIGHTS: "View Rewards reports", EXPORT: "Export Rewards reports", MANAGE_STAFF: "Manage staff access" });
export const STAFF_ROLE_LABELS = Object.freeze({ MANAGER: "Manager", CONTENT_EDITOR: "Content editor", VIEWER: "Viewer" });
export const STAFF_PRESETS = Object.freeze([
  Object.freeze({ id: "cashier", label: "Cashier", description: "Redeem coupons at the selected shops only.", capabilities: Object.freeze(["REDEEM"]) }),
  Object.freeze({ id: "editor", label: "Coupon editor", description: "View and prepare coupons. Publishing stays separate.", capabilities: Object.freeze(["READ", "MANAGE_OFFERS"]) }),
  Object.freeze({ id: "manager", label: "Shop manager", description: "Manage and publish coupons, redeem them and view reports.", capabilities: Object.freeze(["READ", "MANAGE_OFFERS", "PUBLISH_OFFERS", "REDEEM", "VIEW_INSIGHTS"]) })
]);
const id = value => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,190}$/.test(value);
const version = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const date = value => typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const text = (value, max) => typeof value === "string" && value.length > 0 && value.length <= max;
const exact = (value, keys) => value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const integer = (value, max) => Number.isInteger(value) && value >= 0 && value <= max;
const unique = values => new Set(values).size === values.length;
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

export function staffOverview(value, expectedOrganisationId) {
  if (!exact(value, ["ok", "organisation", "members", "locations", "seatUsage", "grantExpiresAt", "checkedAt"]) || value.ok !== true ||
    !exact(value.organisation, ["id", "name"]) || !id(value.organisation.id) || !text(value.organisation.name, 500) ||
    expectedOrganisationId && value.organisation.id !== expectedOrganisationId || !date(value.grantExpiresAt) || !date(value.checkedAt) ||
    !exact(value.seatUsage, ["used", "limit"]) || !integer(value.seatUsage.used, 1_000_000_000) || !integer(value.seatUsage.limit, 1_000_000_000)) return null;
  if (!Array.isArray(value.locations) || value.locations.length > 100 || !unique(value.locations.map(row => row?.id)) ||
    !value.locations.every(row => exact(row, ["id", "name"]) && id(row.id) && text(row.name, 500))) return null;
  if (!Array.isArray(value.members) || value.members.length > 100 || !unique(value.members.map(row => row?.id))) return null;
  for (const member of value.members) {
    if (!exact(member, ["id", "displayName", "role", "allowedCapabilities", "version", "grants", "usesSeat"]) || !id(member.id) ||
      !text(member.displayName, 500) || !Object.hasOwn(STAFF_ROLE_CAPABILITIES, member.role) || !version(member.version) || typeof member.usesSeat !== "boolean" ||
      !Array.isArray(member.allowedCapabilities) || !same(member.allowedCapabilities, STAFF_ROLE_CAPABILITIES[member.role]) ||
      !Array.isArray(member.grants) || member.grants.length > 1000 || !unique(member.grants.map(row => row?.id))) return null;
    for (const grant of member.grants) {
      if (!exact(grant, ["id", "scope", "locationId", "capabilities", "startsAt", "expiresAt", "revokedAt"]) || !id(grant.id) ||
        !(grant.scope === "ALL_LOCATIONS" ? grant.locationId === null : grant.scope === "LOCATIONS" && id(grant.locationId)) ||
        !Array.isArray(grant.capabilities) || !grant.capabilities.length || grant.capabilities.length > 8 || !unique(grant.capabilities) ||
        !grant.capabilities.every(capability => Object.hasOwn(STAFF_CAPABILITY_LABELS, capability)) || !date(grant.startsAt) || !date(grant.expiresAt) ||
        grant.startsAt >= grant.expiresAt || grant.revokedAt !== null && !date(grant.revokedAt)) return null;
    }
  }
  return value;
}

export function staffPresets(member) {
  return STAFF_PRESETS.filter(preset => preset.capabilities.every(capability => member?.allowedCapabilities?.includes(capability)));
}
export function staffGrantState(grant, now = new Date()) {
  if (grant.revokedAt !== null) return "Revoked";
  if (new Date(grant.expiresAt) <= now) return "Expired";
  if (new Date(grant.startsAt) > now) return "Starts later";
  return "Current";
}
export function staffSaveInput(data, memberId, form, now = new Date()) {
  const checked = staffOverview(data), member = checked?.members.find(row => row.id === memberId);
  if (!member) throw new Error("Refresh and choose a current team member.");
  if (!Array.isArray(form.locationIds) || !form.locationIds.length || form.locationIds.length > 20 || !unique(form.locationIds) ||
    form.locationIds.some(locationId => !checked.locations.some(location => location.id === locationId))) throw new Error("Choose between 1 and 20 available shops.");
  if (!Array.isArray(form.capabilities) || !form.capabilities.length || !unique(form.capabilities) ||
    form.capabilities.some(capability => !member.allowedCapabilities.includes(capability))) throw new Error("Choose permissions allowed by this member’s role.");
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error("Refresh before setting an expiry.");
  const expiresAt = wallTimeToIso(form.expiresAt, "Europe/Malta");
  if (new Date(expiresAt) <= now || new Date(expiresAt) > new Date(checked.grantExpiresAt)) throw new Error("Choose a future expiry no later than your Rewards access ends.");
  if (form.confirm !== true) throw new Error("Confirm the exact shops, permissions and expiry before saving.");
  return { memberId, expectedVersion: member.version, locationIds: [...form.locationIds].sort(), capabilities: [...form.capabilities].sort(), expiresAt, confirm: true };
}
export function staffMutationResult(value, memberId) {
  return exact(value, ["ok", "memberId", "version", "changedRows", "checkedAt"]) && value.ok === true && value.memberId === memberId &&
    id(memberId) && version(value.version) && integer(value.changedRows, 1020) && date(value.checkedAt) ? value : null;
}
export function staffMessage(code) {
  return ({ FEATURE_DISABLED: "Staff access setup is currently disabled.", UNAUTHENTICATED: "Please sign in again, then reload this page.",
    FORBIDDEN: "Only this organisation’s owner can manage Rewards staff access.", NOT_ENTITLED: "Current Rewards access is required. Ask your administrator to review it.",
    CONFLICT: "This member’s saved access or role changed. Refresh, review the current access and make your selection again.",
    LOCATION_UNAVAILABLE: "One of the selected shops is no longer available. Refresh and choose again.",
    MEMBER_UNAVAILABLE: "This team member is no longer available for Rewards access. Refresh the team list.",
    INVALID_REQUEST: "Check the team member, shops, permissions and expiry before saving.",
    LIMIT_REACHED: "The selected access exceeds the current Rewards allowance. Review staff seats and selected shops.",
    RATE_LIMITED: "Please wait a moment, then refresh before trying again.",
    ORGANISATION_CHANGED: "The signed-in organisation changed. Reload this page before managing its staff." })[code] ||
    "The result could not be confirmed. Refresh and review the saved access before trying again; your change may have completed.";
}
