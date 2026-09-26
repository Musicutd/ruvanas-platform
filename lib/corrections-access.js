import { getActiveOrganisationContext } from "@/lib/auth";
import { resolveEntitlements } from "@/lib/entitlements.mjs";
import { subscriberProductAccess } from "@/lib/product-access.mjs";
import { prisma } from "@/lib/prisma";
import { correctionsFacilityPermission } from "@/lib/corrections-policy.mjs";
import { correctionsProgrammePermission } from "@/lib/corrections-workflow.mjs";

export async function correctionsRequestContext() {
  const context = await getActiveOrganisationContext({ subscription: { include: { plan: true, billingContract: true } } });
  if (!context) return { ok: false, status: 401, error: "Sign in to continue." };
  if (!context.membership) return { ok: false, status: 403, error: "Select an organisation first." };
  if (context.user.role === "STUDENT") return { ok: false, status: 403, error: "Contributor access is not available in this stage." };
  const entitlements = resolveEntitlements(context.membership.organisation.subscription);
  if (!subscriberProductAccess(entitlements, "CORRECTIONS").allowed) {
    return { ok: false, status: 403, error: "Ruvanas Inside is not active for this organisation." };
  }
  return { ok: true, context, entitlements, organisationId: context.membership.organisationId };
}

export function correctionsCanCreateFacility(access) {
  return access.ok && access.context.membership.role === "OWNER";
}

export async function correctionsFacilityAccess(access, locationId, { edit = false } = {}) {
  if (!access.ok || !locationId) return null;
  const facility = await prisma.correctionsFacility.findFirst({
    where: { locationId, location: { organisationId: access.organisationId, status: { not: "CLOSED" } } },
    include: { location: { select: { id: true, name: true, organisationId: true, timezone: true, countryCode: true, zones: { orderBy: { name: "asc" }, select: { id: true, name: true, status: true } } } } }
  });
  if (!facility) return null;
  if (access.context.membership.role === "OWNER") return facility;
  const assigned = await prisma.correctionsFacilityGrant.findUnique({
    where: { organisationMemberId_facilityId: { organisationMemberId: access.context.membership.id, facilityId: locationId } },
    select: { permission: true, organisationId: true, organisationMemberId: true, facilityId: true }
  });
  if (!correctionsFacilityPermission({ role: access.context.membership.role, organisationId: access.organisationId, memberId: access.context.membership.id, locationId, assignment: assigned, edit })) return null;
  return facility;
}

export async function correctionsProgrammeFacilityAccess(access, facilityId, action = "READ") {
  const facility = await correctionsFacilityAccess(access, facilityId);
  if (!facility) return null;
  const assignment = access.context.membership.role === "OWNER" ? null : await prisma.correctionsFacilityGrant.findUnique({
    where: { organisationMemberId_facilityId: { organisationMemberId: access.context.membership.id, facilityId } },
    select: { organisationId: true, organisationMemberId: true, facilityId: true, permission: true }
  });
  if (!correctionsProgrammePermission({ role: access.context.membership.role, organisationId: access.organisationId, memberId: access.context.membership.id, facilityId, assignment, action })) return null;
  return facility;
}
