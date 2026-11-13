import { z } from "zod";
import { ORGANISATION_MEMBER_ROLES, PLATFORM_ADMIN_ROLES } from "../permissions.mjs";
import { rewardActionSchema, rewardIdSchema, rewardStaffGrantSchema, REWARDS_ACTIONS } from "./contracts.mjs";
import { resolveRewardsEntitlements } from "./entitlements.mjs";
import { readRewardsFeaturePolicy } from "./feature-policy.mjs";
import { rewardsDenied } from "./errors.mjs";

const roleActions = Object.freeze({
  OWNER: REWARDS_ACTIONS,
  MANAGER: Object.freeze(REWARDS_ACTIONS.filter((action) => action !== "MANAGE_STAFF")),
  CONTENT_EDITOR: Object.freeze(["READ", "MANAGE_OFFERS", "VIEW_INSIGHTS"]),
  VIEWER: Object.freeze(["READ", "REDEEM"])
});
const requestSchema = z.object({ action: rewardActionSchema, locationId: rewardIdSchema.optional() }).strict();
const memberSchema = z.object({
  id: rewardIdSchema, userId: rewardIdSchema, organisationId: rewardIdSchema,
  role: z.enum(ORGANISATION_MEMBER_ROLES)
});
// Existing authentication returns every membership, including School/student
// and platform roles. Only the selected tenant must hold a Rewards-capable role.
const contextMemberSchema = memberSchema.extend({
  role: z.enum([...ORGANISATION_MEMBER_ROLES, ...PLATFORM_ADMIN_ROLES, "STUDENT"])
});
const sessionSchema = z.object({
  id: rewardIdSchema, userId: rewardIdSchema, activeOrganisationId: rewardIdSchema,
  expiresAt: z.date(), revokedAt: z.date().nullable(), authMethod: z.enum(["PASSWORD", "SSO"])
});
const locationSchema = z.object({ id: rewardIdSchema, organisationId: rewardIdSchema, status: z.literal("ACTIVE") }).strict();
const allLocations = Object.freeze({ kind: "ALL_LOCATIONS", locationIds: Object.freeze([]) });

function readNow(clock) {
  const now = clock();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error("Invalid policy clock");
  return new Date(now.getTime());
}

function identityFromContext(context, now) {
  if (!context?.session || !context?.user) return { error: "UNAUTHENTICATED" };
  const sessionResult = sessionSchema.safeParse(context.session);
  if (!sessionResult.success) return { error: "UNAUTHENTICATED" };
  const session = sessionResult.data;
  if (session.revokedAt !== null || session.expiresAt <= now || context.user.id !== session.userId) {
    return { error: "UNAUTHENTICATED" };
  }
  // Preview access remains governed by its existing allowlist. This new module
  // cannot become a preview escape hatch, even with a forged normal auth method.
  if (context.user.privatePreviewAccess != null) return { error: "FORBIDDEN" };
  const memberResult = memberSchema.safeParse(context.membership);
  const membersResult = z.array(contextMemberSchema).max(1000).safeParse(context.memberships);
  if (!memberResult.success || !membersResult.success) return { error: "FORBIDDEN" };
  const member = memberResult.data;
  const members = membersResult.data;
  if (member.userId !== session.userId || member.organisationId !== session.activeOrganisationId ||
      members.some((row) => row.userId !== session.userId) ||
      new Set(members.map((row) => row.id)).size !== members.length ||
      new Set(members.map((row) => row.organisationId)).size !== members.length) return { error: "FORBIDDEN" };
  const fresh = members.find((row) => row.organisationId === member.organisationId);
  if (!fresh || fresh.id !== member.id || fresh.role !== member.role) return { error: "FORBIDDEN" };
  const organisation = context.membership.organisation;
  if (organisation?.id !== member.organisationId ||
      !rewardIdSchema.safeParse(organisation.subscription?.id).success ||
      organisation.subscription.organisationId !== member.organisationId) return { error: "NOT_ENTITLED" };
  return { session, member, subscription: organisation.subscription };
}

function staffScope(rows, member, action, now) {
  const result = z.array(rewardStaffGrantSchema).max(1000).safeParse(rows);
  if (!result.success) return null;
  if (new Set(result.data.map((row) => row.id)).size !== result.data.length ||
      result.data.some((row) => row.organisationId !== member.organisationId || row.organisationMemberId !== member.id)) return null;
  const matching = result.data.filter((row) => row.revokedAt === null && row.startsAt <= now && now < row.expiresAt && row.capabilities.includes(action));
  if (matching.length === 0) return null;
  if (matching.some((row) => row.scope === "ALL_LOCATIONS")) return allLocations;
  // Combine only scopes attached to this action. A READ grant for every shop
  // must never expand a cashier's REDEEM grant for a single shop.
  return Object.freeze({ kind: "LOCATIONS", locationIds: Object.freeze([...new Set(matching.flatMap((row) => row.locationIds))].sort()) });
}

/**
 * Policy preflight, not an HTTP handler or transaction boundary. Dependencies
 * must be trusted server adapters, freshly loading the authenticated context and
 * explicitly tenant-filtered projections on every request. No adapter is wired
 * in RR-01a. Later services must apply locationScope to every resource query,
 * and recheck authority/quotas inside their write transaction.
 */
export async function requireRetailRewardsAccess(input, dependencies = {}) {
  try {
    const { env = {}, clock = () => new Date(), loadContext, loadRewardsState, loadStaffGrants, loadLocation } = dependencies;
    if (!readRewardsFeaturePolicy(env).enabled) return rewardsDenied("FEATURE_DISABLED");
    const parsed = requestSchema.safeParse(input);
    if (!parsed.success) return rewardsDenied("INVALID_REQUEST");
    const request = parsed.data;
    if (["REDEEM", "REVERSE"].includes(request.action) && !request.locationId) return rewardsDenied("INVALID_REQUEST");
    if (typeof loadContext !== "function" || typeof loadRewardsState !== "function") return rewardsDenied("UNAVAILABLE");
    const startedAt = readNow(clock);
    const identity = identityFromContext(await loadContext(), readNow(clock));
    if (identity.error) return rewardsDenied(identity.error);
    const { member, session, subscription } = identity;
    if (!roleActions[member.role].includes(request.action)) return rewardsDenied("FORBIDDEN");
    const state = await loadRewardsState(Object.freeze({ organisationId: member.organisationId, subscriptionId: subscription.id }));
    const entitlementInput = { organisationId: member.organisationId, subscription, grant: state?.grant, program: state?.program, action: request.action };
    let entitlement = resolveRewardsEntitlements({ ...entitlementInput, now: readNow(clock) });
    if (!entitlement.allowed) return rewardsDenied(entitlement.code);
    let rows;
    let scope = allLocations;
    if (member.role !== "OWNER") {
      if (entitlement.limits.staffSeats === 0) return rewardsDenied("FORBIDDEN");
      if (typeof loadStaffGrants !== "function") return rewardsDenied("UNAVAILABLE");
      rows = await loadStaffGrants(Object.freeze({ organisationId: member.organisationId, organisationMemberId: member.id }));
      scope = staffScope(rows, member, request.action, readNow(clock));
      if (!scope) return rewardsDenied("FORBIDDEN");
    }
    if (request.locationId) {
      if (scope.kind === "LOCATIONS" && !scope.locationIds.includes(request.locationId)) return rewardsDenied("LOCATION_UNAVAILABLE");
      if (typeof loadLocation !== "function") return rewardsDenied("UNAVAILABLE");
      const location = locationSchema.safeParse(await loadLocation(Object.freeze({ organisationId: member.organisationId, locationId: request.locationId })));
      if (!location.success || location.data.id !== request.locationId || location.data.organisationId !== member.organisationId) return rewardsDenied("LOCATION_UNAVAILABLE");
    }
    const finishedAt = readNow(clock);
    if (finishedAt < startedAt) return rewardsDenied("UNAVAILABLE");
    if (session.expiresAt <= finishedAt) return rewardsDenied("UNAUTHENTICATED");
    if (!readRewardsFeaturePolicy(env).enabled) return rewardsDenied("FEATURE_DISABLED");
    entitlement = resolveRewardsEntitlements({ ...entitlementInput, now: finishedAt });
    if (!entitlement.allowed) return rewardsDenied(entitlement.code);
    if (member.role !== "OWNER") {
      scope = staffScope(rows, member, request.action, finishedAt);
      if (!scope) return rewardsDenied("FORBIDDEN");
      if (request.locationId && scope.kind === "LOCATIONS" && !scope.locationIds.includes(request.locationId)) return rewardsDenied("LOCATION_UNAVAILABLE");
    }
    return Object.freeze({
      ok: true, organisationId: member.organisationId, userId: member.userId,
      organisationMemberId: member.id, action: request.action,
      locationId: request.locationId ?? null, locationScope: scope,
      tier: entitlement.tier, limits: entitlement.limits
    });
  } catch {
    return rewardsDenied("UNAVAILABLE");
  }
}
