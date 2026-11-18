// Browser-safe validation; the server remains the authority for every action.
import { wallTimeToIso } from "./offer-ui.mjs";

const id = v => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,190}$/.test(v);
const text = (v, max, empty = false) => typeof v === "string" && v.length <= max && (empty || v.length > 0);
const exact = (v, keys) => v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const date = v => typeof v === "string" && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const positive = v => Number.isSafeInteger(v) && v > 0 && v <= 2147483647;
const unique = (rows, key) => new Set(rows.map(r => r[key])).size === rows.length;
export const PILOT_TIERS = ["REWARDS_STARTER", "REWARDS_PRO", "REWARDS_BUSINESS", "REWARDS_ENTERPRISE"];
export const PILOT_LIMIT_FIELDS = ["activeOffers", "locations", "staffSeats", "monthlyRedemptions", "analyticsRetentionDays"];
export const PILOT_LIMIT_LABELS = { activeOffers: "Active coupons", locations: "Shops", staffSeats: "Staff seats", monthlyRedemptions: "Monthly redemptions", analyticsRetentionDays: "Report retention (days)" };
const limits = v => exact(v, [...PILOT_LIMIT_FIELDS, "exportEnabled", "brandingEnabled"]) && PILOT_LIMIT_FIELDS.every(k => Number.isSafeInteger(v[k]) && v[k] >= 0 && v[k] <= 1_000_000_000) && typeof v.exportEnabled === "boolean" && typeof v.brandingEnabled === "boolean";

export function pilotOrganisations(value) {
  return Array.isArray(value) && value.length <= 10 && value.every(r => exact(r, ["id", "name"]) && id(r.id) && text(r.name, 500)) && unique(value, "id") ? value : [];
}
export function pilotOverview(value, organisationId) {
  if (!exact(value, ["ok", "organisation", "program", "grant", "locations", "offers", "shoppers", "preparedShoppers", "audit", "checkedAt"]) || value.ok !== true ||
    !exact(value.organisation, ["id", "name"]) || value.organisation.id !== organisationId || !id(organisationId) || !text(value.organisation.name, 500) || !date(value.checkedAt)) return null;
  const p = value.program, g = value.grant;
  if (p !== null && !(exact(p, ["id", "status", "timezone", "networkOptIn"]) && id(p.id) && ["DISABLED", "ACTIVE", "PAUSED"].includes(p.status) && text(p.timezone, 100) && typeof p.networkOptIn === "boolean")) return null;
  if (g !== null && !(exact(g, ["id", "tier", "status", "expiresAt", "limits"]) && id(g.id) && PILOT_TIERS.includes(g.tier) && ["DISABLED", "TRIAL", "ACTIVE", "PAST_DUE", "SUSPENDED", "CANCELLED", "EXPIRED"].includes(g.status) && date(g.expiresAt) && limits(g.limits))) return null;
  for (const key of ["locations", "offers", "shoppers", "preparedShoppers", "audit"]) if (!Array.isArray(value[key]) || value[key].length > (key === "audit" ? 50 : 100) || !unique(value[key], ["shoppers", "preparedShoppers"].includes(key) ? "shopperId" : "id")) return null;
  if (!value.preparedShoppers.every(r => exact(r, ["shopperId", "email", "displayName", "authVersion", "preparedAt"]) && id(r.shopperId) && text(r.email, 254) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email) && text(r.displayName, 80) && r.authVersion === 1 && date(r.preparedAt))) return null;
  if (value.preparedShoppers.some(r => value.shoppers.some(s => s.shopperId === r.shopperId))) return null;
  if (!value.locations.every(r => exact(r, ["id", "name", "status", "profile"]) && id(r.id) && text(r.name, 500) && ["DRAFT", "ACTIVE"].includes(r.status) && (r.profile === null ||
    exact(r.profile, ["id", "publicSlug", "displayName", "description", "locality", "countryCode", "status", "networkOptIn"]) && id(r.profile.id) && text(r.profile.publicSlug, 100) && text(r.profile.displayName, 140) && text(r.profile.description, 2000, true) && text(r.profile.locality, 120) && /^[A-Z]{2}$/.test(r.profile.countryCode) && ["DRAFT", "PUBLISHED"].includes(r.profile.status) && typeof r.profile.networkOptIn === "boolean"))) return null;
  if (!value.offers.every(r => exact(r, ["id", "title", "revision", "startsAt", "endsAt", "locationIds", "discovery"]) && id(r.id) && text(r.title, 140) && positive(r.revision) && date(r.startsAt) && date(r.endsAt) && r.startsAt < r.endsAt && Array.isArray(r.locationIds) && r.locationIds.length <= 100 && r.locationIds.every(id) && new Set(r.locationIds).size === r.locationIds.length && (r.discovery === null || exact(r.discovery, ["publicSlug", "revision", "discoverable"]) && text(r.discovery.publicSlug, 100) && positive(r.discovery.revision) && typeof r.discovery.discoverable === "boolean"))) return null;
  if (!value.shoppers.every(r => exact(r, ["shopperId", "displayName", "status", "invitationStatus", "invitationExpiresAt", "membershipExpiresAt"]) && id(r.shopperId) && text(r.displayName, 80) && ["DISABLED", "ACTIVE", "SUSPENDED"].includes(r.status) && ["PENDING", "ACCEPTED", "REVOKED", "EXPIRED"].includes(r.invitationStatus) && date(r.invitationExpiresAt) && date(r.membershipExpiresAt))) return null;
  if (!value.audit.every(r => exact(r, ["id", "action", "targetType", "targetId", "createdAt"]) && id(r.id) && ["PROGRAM_PREPARED", "SHOP_PUBLISHED", "OFFER_APPROVED", "SHOPPER_INVITED", "INVITATION_REISSUED", "INVITATION_REVOKED"].includes(r.action) && ["PROGRAM", "SHOP", "OFFER", "SHOPPER"].includes(r.targetType) && id(r.targetId) && date(r.createdAt))) return null;
  return value;
}
export function pilotMutationResult(operation, value, expected = {}) {
  if (!value || value.ok !== true) return null;
  if (operation === "prepare") return exact(value, ["ok", "programId", "expiresAt"]) && id(value.programId) && date(value.expiresAt) ? value : null;
  if (operation === "activateLocation") return exact(value, ["ok", "locationId", "status"]) && value.locationId === expected.locationId && value.status === "ACTIVE" ? value : null;
  if (operation === "publishShop") return exact(value, ["ok", "profileId"]) && id(value.profileId) ? value : null;
  if (operation === "approveOffer") return exact(value, ["ok", "offerId", "revision"]) && value.offerId === expected.offerId && value.revision === expected.revision ? value : null;
  if (operation === "revoke") return exact(value, ["ok", "shopperId"]) && value.shopperId === expected.shopperId ? value : null;
  if (["invite", "invitePrepared", "reissue"].includes(operation)) return exact(value, ["ok", "shopperId", "invitationToken", "invitationExpiresAt", "membershipExpiresAt"]) && id(value.shopperId) && (!expected.shopperId || value.shopperId === expected.shopperId) && /^[a-f0-9]{64}$/.test(value.invitationToken) && date(value.invitationExpiresAt) && date(value.membershipExpiresAt) && value.invitationExpiresAt <= value.membershipExpiresAt ? value : null;
  return null;
}
export function pilotExpiry(value, now = new Date(), latest) {
  const iso = wallTimeToIso(value, "Europe/Malta"), until = new Date(iso);
  if (!(now instanceof Date) || !Number.isFinite(now.getTime()) || until <= now || until - now > 30 * 86400000 || latest && until > new Date(latest)) throw new Error("Choose an expiry in the next 30 days, within the pilot’s access period.");
  return iso;
}
export function pilotFormLimits(values) {
  const result = { exportEnabled: values.exportEnabled === true, brandingEnabled: values.brandingEnabled === true };
  for (const key of PILOT_LIMIT_FIELDS) { if (!/^(?:0|[1-9]\d{0,9})$/.test(String(values[key])) || Number(values[key]) > 1_000_000_000) throw new Error("Enter an explicit whole number of zero or more for every allowance."); result[key] = Number(values[key]); }
  return result;
}
export function pilotMessage(code) {
  return ({ FEATURE_DISABLED: "Pilot setup is currently disabled. No change was made.", FORBIDDEN: "This action requires the authorised Super Admin and an allowed test organisation.", UNAUTHENTICATED: "Please sign in as Super Admin again.", NOT_ENTITLED: "Prepare this organisation’s current pilot access first.", CONFLICT: "The saved state changed or a record already exists. Refresh the pilot before trying again.", INVALID_REQUEST: "Check the required fields, selected shop and expiry.", RATE_LIMITED: "Please wait before trying again.", OFFER_UNAVAILABLE: "This published coupon is no longer available. Refresh and review its current revision.", LOCATION_UNAVAILABLE: "This shop is no longer available. Refresh the pilot.", INVITATION_UNAVAILABLE: "This invitation can no longer be changed. Refresh its saved status." })[code] || "The result could not be confirmed. Refresh the pilot before retrying; a change may have completed. If an invitation was created, reissue its pending code to replace a lost code.";
}

