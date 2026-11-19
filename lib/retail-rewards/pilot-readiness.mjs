import { z } from "zod";
import { ORGANISATION_MEMBER_ROLES } from "../permissions.mjs";
import { readPrivatePreviewPolicy } from "../private-preview-policy.mjs";
import { readPilotPreviewPolicy } from "./pilot-preview-policy.mjs";
import { rewardIdSchema as id, rewardStaffGrantSchema } from "./contracts.mjs";
import { resolveRewardsEntitlements } from "./entitlements.mjs";
import { readShopperFeaturePolicy, publicSlugSchema } from "./shopper-contracts.mjs";
import { readShopperAuthPolicy } from "./shopper-auth-contracts.mjs";
import { readCheckoutPolicy } from "./checkout-contracts.mjs";
import { offerTermsSchema } from "./offer-contracts.mjs";
import { STAFF_ADMIN_ROLE_CAPABILITIES } from "./staff-admin-contracts.mjs";
import { pilotReadinessSchema } from "./pilot-readiness-contracts.mjs";

const date = z.date().refine(value => Number.isFinite(value.getTime()));
const version = z.number().int().min(1).max(2_147_483_647);
const userRole = z.enum(["SUPER_ADMIN", "SUPPORT", "OWNER", "MANAGER", "CONTENT_EDITOR", "VIEWER", "STUDENT"]);
const grantSelect = { id: true, organisationId: true, organisationMemberId: true, scope: true, locationId: true, capabilities: true, startsAt: true, expiresAt: true, revokedAt: true };
const profileSelect = { id: true, organisationId: true, locationId: true, publicSlug: true, displayName: true, description: true, locality: true,
  countryCode: true, status: true, networkOptIn: true, publishedAt: true, revokedAt: true };
const offerSelect = { id: true, organisationId: true, programId: true, state: true, publishedRevision: true, publishedStartsAt: true, publishedEndsAt: true,
  publishedSnapshot: { select: { organisationId: true, offerId: true, revision: true, terms: true } },
  locations: { where: { scope: "PUBLISHED" }, take: 101, select: { organisationId: true, offerId: true, locationId: true, scope: true } },
  discovery: { select: { organisationId: true, offerId: true, publicSlug: true, revision: true, discoverable: true, approvedAt: true, revokedAt: true } } };
const memberSchema = z.object({ id, organisationId: id, userId: id, role: userRole,
  user: z.object({ id, role: userRole, privatePreviewAccess: z.object({ userId: id }).strict().nullable() }).strict(),
  rewardStaffGrants: z.array(z.unknown()).max(1000) }).strict();
const locationSchema = z.object({ id, organisationId: id, status: z.enum(["DRAFT", "ACTIVE", "PAUSED", "CLOSED"]) }).strict();
const text = max => z.string().max(max).refine(value => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value));
const profileSchema = z.object({ id, organisationId: id, locationId: id, publicSlug: publicSlugSchema, displayName: text(140).min(1), description: text(2000),
  locality: text(120), countryCode: z.string().regex(/^[A-Z]{2}$/), status: z.enum(["DRAFT", "PUBLISHED"]), networkOptIn: z.boolean(),
  publishedAt: date.nullable(), revokedAt: date.nullable() }).strict();
const discoverySchema = z.object({ organisationId: id, offerId: id, publicSlug: publicSlugSchema, revision: version,
  discoverable: z.boolean(), approvedAt: date.nullable(), revokedAt: date.nullable() }).strict();
const offerSchema = z.object({ id, organisationId: id, programId: id, state: z.enum(["DRAFT", "PUBLISHED", "PAUSED", "CANCELLED"]), publishedRevision: version.nullable(),
  publishedStartsAt: date.nullable(), publishedEndsAt: date.nullable(),
  publishedSnapshot: z.object({ organisationId: id, offerId: id, revision: version, terms: z.unknown() }).strict().nullable(),
  locations: z.array(z.object({ organisationId: id, offerId: id, locationId: id, scope: z.literal("PUBLISHED") }).strict()).max(100),
  discovery: discoverySchema.nullable() }).strict();
const enrollmentSchema = z.object({ shopperId: id, organisationId: id, shopper: z.object({ id, status: z.enum(["DISABLED", "ACTIVE", "SUSPENDED"]), authVersion: version,
  credential: z.object({ shopperId: id }).strict().nullable(),
  membership: z.object({ id, shopperId: id, status: z.enum(["DISABLED", "ACTIVE", "SUSPENDED"]), source: z.literal("MANUAL_INTERNAL"), startsAt: date, expiresAt: date,
    revokedAt: date.nullable(), version }).strict().nullable(),
  invitation: z.object({ id, shopperId: id, authVersion: version, createdAt: date, expiresAt: date, acceptedAt: date.nullable(), revokedAt: date.nullable() }).strict().nullable()
}).strict() }).strict();
const equalIds = (a, b) => a.length === b.length && new Set(a).size === a.length && new Set(b).size === b.length && [...a].sort().every((value, i) => value === [...b].sort()[i]);
function parse(schema, value, abort) { const result = schema.safeParse(value); if (!result.success) abort("UNAVAILABLE"); return result.data; }
function rows(schema, values, organisationId, abort) {
  if (!Array.isArray(values)) abort("UNAVAILABLE"); if (values.length > 100) abort("REVIEW_TOO_LARGE");
  const result = values.map(value => parse(schema, value, abort));
  if (result.some(value => value.organisationId !== organisationId) || new Set(result.map(value => value.id ?? value.shopperId)).size !== result.length) abort("UNAVAILABLE");
  return result;
}
const normal = member => member.user.id === member.userId && member.user.privatePreviewAccess === null && ORGANISATION_MEMBER_ROLES.includes(member.user.role);
function check(key, configuredCount, eligibleCount, code) {
  const upper = key.toUpperCase(); return { key, status: eligibleCount ? "READY" : configuredCount ? "BLOCKED" : "MISSING",
    code: code || `${upper}_${eligibleCount ? "READY" : configuredCount ? "INACTIVE" : "MISSING"}`, configuredCount, eligibleCount };
}
function environmentCheck(env, organisationId) {
  const preview = readPrivatePreviewPolicy(env), policies = [readShopperFeaturePolicy(env), readShopperAuthPolicy(env), readCheckoutPolicy(env)];
  const pilotPreview = readPilotPreviewPolicy(env);
  let code = "ENVIRONMENT_COMPATIBLE";
  if (!preview.valid || policies.some(policy => !policy.valid)) code = "ENVIRONMENT_INVALID";
  else if (preview.enabled && !pilotPreview.valid) code = "ENVIRONMENT_INVALID";
  else if (preview.enabled && (!pilotPreview.enabled || !pilotPreview.organisationIds.includes(organisationId))) code = "PRIVATE_PREVIEW_BLOCKED";
  else if (policies.some(policy => !policy.enabled)) code = "FEATURES_DISABLED";
  else if (typeof env.SESSION_SECRET !== "string" || env.SESSION_SECRET.length < 32) code = "AUTH_CONFIGURATION_UNAVAILABLE";
  return { key: "environment", status: code === "ENVIRONMENT_COMPATIBLE" ? "READY" : "BLOCKED", code,
    configuredCount: preview.valid && policies.every(policy => policy.valid) ? 1 : 0, eligibleCount: code === "ENVIRONMENT_COMPATIBLE" ? 1 : 0 };
}

/** Pure snapshot evaluation. Eligibility describes stored configuration at one
 * observed instant, never a login, available usage quota, or successful redeem. */
export function evaluatePilotReadiness({ organisationId, state, members: rawMembers, locations: rawLocations, profiles: rawProfiles,
  offers: rawOffers, enrollments: rawEnrollments, env, now, abort }) {
  parse(date, now, abort);
  if (state.organisation.id !== organisationId) abort("UNAVAILABLE");
  const members = rows(memberSchema, rawMembers, organisationId, abort), locations = rows(locationSchema, rawLocations, organisationId, abort),
    profiles = rows(profileSchema, rawProfiles, organisationId, abort), offers = rows(offerSchema, rawOffers, organisationId, abort),
    enrollments = rows(enrollmentSchema, rawEnrollments, organisationId, abort);
  if (members.some(member => member.user.id !== member.userId || member.user.privatePreviewAccess && member.user.privatePreviewAccess.userId !== member.userId)) abort("UNAVAILABLE");
  if (new Set(members.map(member => member.userId)).size !== members.length || new Set(profiles.map(profile => profile.locationId)).size !== profiles.length) abort("UNAVAILABLE");
  const staff = new Map();
  for (const member of members) {
    const grants = member.rewardStaffGrants.map(row => { if (!row || typeof row !== "object") abort("UNAVAILABLE");
      const { locationId, ...projection } = row;
      const grant = parse(rewardStaffGrantSchema, { ...projection, locationIds: locationId === null ? [] : [locationId] }, abort);
      if (grant.organisationId !== organisationId || grant.organisationMemberId !== member.id || (grant.scope === "ALL_LOCATIONS") !== (locationId === null)) abort("UNAVAILABLE");
      return grant;
    });
    if (new Set(grants.map(grant => grant.id)).size !== grants.length) abort("UNAVAILABLE"); staff.set(member.id, grants);
  }
  const owners = members.filter(member => normal(member) && member.role === "OWNER");
  const configuredEntitlement = Boolean(state.program && state.grant);
  if (state.program && state.program.organisationId !== organisationId || state.grant && state.grant.organisationId !== organisationId) abort("UNAVAILABLE");
  const authority = { organisationId, subscription: state.subscription, program: state.program && { id: state.program.id, organisationId, status: state.program.status }, grant: state.grant, now };
  const readEntitled = Boolean(state.program?.networkOptIn === true && resolveRewardsEntitlements({ ...authority, action: "READ" }).allowed);
  const redeemEntitled = readEntitled && resolveRewardsEntitlements({ ...authority, action: "REDEEM" }).allowed;
  const configuredShops = new Set(), eligibleShops = new Set();
  for (const profile of profiles) {
    const location = locations.find(row => row.id === profile.locationId); if (!location) abort("UNAVAILABLE");
    if (profile.status === "PUBLISHED" && profile.networkOptIn && profile.revokedAt === null && profile.publishedAt) {
      configuredShops.add(location.id);
      if (location.status === "ACTIVE" && profile.publishedAt <= now) eligibleShops.add(location.id);
    }
  }
  let configuredCoupons = 0, eligibleCoupons = 0; const configuredCouponShops = new Set(), eligibleCouponShops = new Set();
  for (const offer of offers) {
    const d = offer.discovery, snapshot = offer.publishedSnapshot;
    if (d && (d.organisationId !== organisationId || d.offerId !== offer.id)) abort("UNAVAILABLE");
    if (offer.locations.some(row => row.organisationId !== organisationId || row.offerId !== offer.id)) abort("UNAVAILABLE");
    if (offer.publishedRevision === null) { if (snapshot || offer.publishedStartsAt || offer.publishedEndsAt || offer.locations.length || d) abort("UNAVAILABLE"); continue; }
    if (!snapshot || snapshot.organisationId !== organisationId || snapshot.offerId !== offer.id || snapshot.revision !== offer.publishedRevision ||
      !offer.publishedStartsAt || !offer.publishedEndsAt) abort("UNAVAILABLE");
    const terms = parse(offerTermsSchema, snapshot.terms, abort);
    if (terms.startsAt !== offer.publishedStartsAt.toISOString() || terms.endsAt !== offer.publishedEndsAt.toISOString() ||
      !equalIds(terms.locationIds, offer.locations.map(row => row.locationId)) || terms.locationIds.some(id => !locations.some(location => location.id === id))) abort("UNAVAILABLE");
    if (offer.state !== "PUBLISHED" || offer.programId !== state.program?.id || !d || !d.discoverable || d.revokedAt !== null || !d.approvedAt || d.revision !== offer.publishedRevision) continue;
    const configuredScope = terms.locationIds.filter(id => configuredShops.has(id)), activeScope = terms.locationIds.filter(id => eligibleShops.has(id));
    if (configuredScope.length) { configuredCoupons++; configuredScope.forEach(id => configuredCouponShops.add(id)); }
    if (activeScope.length && d.approvedAt <= now && offer.publishedStartsAt <= now && now < offer.publishedEndsAt && readEntitled) {
      eligibleCoupons++; activeScope.forEach(id => eligibleCouponShops.add(id));
    }
  }
  let configuredCashiers = 0, eligibleCashiers = 0;
  for (const member of members.filter(normal)) {
    const owner = member.role === "OWNER";
    if (!owner && !STAFF_ADMIN_ROLE_CAPABILITIES[member.role]?.includes("REDEEM")) continue;
    const grants = staff.get(member.id).filter(row => row.revokedAt === null && row.capabilities.includes("REDEEM"));
    const match = (scope, current) => [...scope].some(locationId => owner || grants.some(row =>
      (row.scope === "ALL_LOCATIONS" || row.locationIds.includes(locationId)) && (!current || row.startsAt <= now && now < row.expiresAt)));
    if (match(configuredCouponShops, false)) configuredCashiers++;
    if (redeemEntitled && match(eligibleCouponShops, true)) eligibleCashiers++;
  }
  let configuredShoppers = 0, eligibleShoppers = 0, pendingInvitations = 0;
  for (const enrollment of enrollments) {
    const shopper = enrollment.shopper, m = shopper.membership, i = shopper.invitation, c = shopper.credential;
    if (shopper.id !== enrollment.shopperId || m && m.shopperId !== shopper.id || i && i.shopperId !== shopper.id || c && c.shopperId !== shopper.id) abort("UNAVAILABLE");
    if (m && m.startsAt >= m.expiresAt || i && (i.createdAt >= i.expiresAt || i.expiresAt - i.createdAt > 86_400_000 ||
      i.acceptedAt && (i.acceptedAt < i.createdAt || i.acceptedAt >= i.expiresAt))) abort("UNAVAILABLE");
    const membershipReady = Boolean(m && m.status === "ACTIVE" && m.revokedAt === null && m.startsAt <= now && now < m.expiresAt);
    if (shopper.status === "DISABLED" && !c && i && i.acceptedAt === null && i.revokedAt === null && i.authVersion === shopper.authVersion &&
      i.createdAt <= now && now < i.expiresAt && membershipReady) pendingInvitations++;
    if (c && i?.acceptedAt && i.revokedAt === null && i.authVersion === shopper.authVersion && m) {
      configuredShoppers++;
      if (shopper.status === "ACTIVE" && i.acceptedAt <= now && membershipReady) eligibleShoppers++;
    }
  }
  const checks = [environmentCheck(env, organisationId), check("owner", owners.length, owners.length),
    check("entitlement", configuredEntitlement ? 1 : 0, redeemEntitled ? 1 : 0),
    check("shops", configuredShops.size, eligibleShops.size), check("coupons", configuredCoupons, eligibleCoupons,
      configuredCoupons === 0 && offers.some(row => row.publishedRevision) ? "COUPONS_NOT_APPROVED" : undefined),
    check("cashiers", configuredCashiers, eligibleCashiers), check("shoppers", configuredShoppers, eligibleShoppers)];
  return parse(pilotReadinessSchema, { ok: true, organisation: { id: organisationId, name: state.organisation.name },
    configured: checks.slice(1).every(row => row.configuredCount > 0), eligibleNow: checks.every(row => row.eligibleCount > 0),
    endToEndTest: "NOT_VERIFIED", checks, pendingInvitations, checkedAt: now.toISOString() }, abort);
}

export async function collectPilotReadiness(tx, organisationId, abort) {
  const [members, locations, profiles, offers, enrollments] = await Promise.all([
    tx.organisationMember.findMany({ where: { organisationId }, orderBy: { id: "asc" }, take: 101, select: { id: true, organisationId: true, userId: true, role: true,
      user: { select: { id: true, role: true, privatePreviewAccess: { select: { userId: true } } } },
      rewardStaffGrants: { take: 1001, orderBy: { id: "asc" }, select: grantSelect } } }),
    tx.location.findMany({ where: { organisationId }, orderBy: { id: "asc" }, take: 101, select: { id: true, organisationId: true, status: true } }),
    tx.rewardPublicShopProfile.findMany({ where: { organisationId }, take: 101, select: profileSelect }),
    tx.rewardOffer.findMany({ where: { organisationId }, orderBy: { id: "asc" }, take: 101, select: offerSelect }),
    tx.rewardPilotShopperEnrollment.findMany({ where: { organisationId }, orderBy: { shopperId: "asc" }, take: 101, select: { shopperId: true, organisationId: true,
      shopper: { select: { id: true, status: true, authVersion: true, credential: { select: { shopperId: true } },
        membership: { select: { id: true, shopperId: true, status: true, source: true, startsAt: true, expiresAt: true, revokedAt: true, version: true } },
        invitation: { select: { id: true, shopperId: true, authVersion: true, createdAt: true, expiresAt: true, acceptedAt: true, revokedAt: true } } } } } })
  ]);
  if ([members, locations, profiles, offers, enrollments].some(rows => !Array.isArray(rows))) abort("UNAVAILABLE");
  if ([members, locations, profiles, offers, enrollments].some(rows => rows.length > 100) || members.some(member => member.rewardStaffGrants?.length > 1000) ||
    offers.some(offer => offer.locations?.length > 100)) abort("REVIEW_TOO_LARGE");
  return { members, locations, profiles, offers, enrollments };
}
