import { prisma } from "@/lib/prisma";
import { correctionsFacilityAccess, correctionsRequestContext } from "@/lib/corrections-access";
import { correctionsError, correctionsResponse } from "@/lib/corrections-http";
import { correctionsGrantAllowed } from "@/lib/corrections-workflow.mjs";
import { correctionsCurrentFacilityEdit } from "@/lib/corrections-facility-write-authority.mjs";

export const dynamic = "force-dynamic";

async function ownerFacility(params) {
  const access = await correctionsRequestContext();
  if (!access.ok) return { error: correctionsResponse(access) };
  if (access.context.membership.role !== "OWNER") return { error: correctionsResponse({ error: "Only the organisation owner can manage Inside staff access." }, 403) };
  const facility = await correctionsFacilityAccess(access, params.facilityId);
  if (!facility) return { error: correctionsResponse({ error: "Facility not found." }, 404) };
  return { access, facility };
}

export async function GET(_request, { params }) {
  const resolved = await ownerFacility(params);
  if (resolved.error) return resolved.error;
  const { access, facility } = resolved;
  const [members, grants] = await Promise.all([
    prisma.organisationMember.findMany({ where: { organisationId: access.organisationId, role: { in: ["OWNER", "MANAGER", "CONTENT_EDITOR", "VIEWER"] } }, select: { id: true, role: true, user: { select: { name: true, email: true } } }, orderBy: { createdAt: "asc" } }),
    prisma.correctionsFacilityGrant.findMany({ where: { organisationId: access.organisationId, facilityId: facility.locationId }, select: { id: true, organisationMemberId: true, permission: true, canPriorityActivate: true, canPriorityStop: true, canEmergencyActivate: true, canEmergencyClear: true } })
  ]);
  return correctionsResponse({ ok: true, members, grants });
}

export async function POST(request, { params }) {
  const resolved = await ownerFacility(params);
  if (resolved.error) return resolved.error;
  const { access, facility } = resolved;
  const body = await request.json().catch(() => ({}));
  if (typeof body.memberId !== "string" || !body.memberId) return correctionsResponse({ error: "Choose an eligible team member and matching facility role." }, 400);
  try {
    const result = await prisma.$transaction(async (tx) => {
      const currentOwner = await correctionsCurrentFacilityEdit(tx, {
        organisationId: access.organisationId, memberId: access.context.membership.id,
        facilityId: facility.locationId, ownerOnly: true
      });
      if (!currentOwner) return { denied: true };
      // Serialise grant creation with UPDATE_ROLE. If the role change wins,
      // read its new role; if this grant wins, UPDATE_ROLE reconciles it.
      const members = await tx.$queryRaw`SELECT "id", "role" FROM "OrganisationMember" WHERE "id" = ${body.memberId} AND "organisationId" = ${access.organisationId} FOR SHARE`;
      const member = members[0];
      if (!member || !(correctionsGrantAllowed(member.role, body.permission) || (member.role === "OWNER" && body.permission === "MANAGER"))) return null;
      const elevated = body.permission === "MANAGER" && ["OWNER", "MANAGER"].includes(member.role);
      const capabilities = { canPriorityActivate: elevated && body.canPriorityActivate === true, canPriorityStop: elevated && body.canPriorityStop === true, canEmergencyActivate: elevated && body.canEmergencyActivate === true, canEmergencyClear: elevated && body.canEmergencyClear === true };
      const saved = await tx.correctionsFacilityGrant.upsert({ where: { organisationMemberId_facilityId: { organisationMemberId: member.id, facilityId: facility.locationId } }, create: { organisationId: access.organisationId, organisationMemberId: member.id, facilityId: facility.locationId, permission: body.permission, ...capabilities, createdByUserId: access.context.user.id }, update: { permission: body.permission, ...capabilities, createdByUserId: access.context.user.id } });
      await tx.auditLog.create({ data: { organisationId: access.organisationId, actorUserId: access.context.user.id, action: "CORRECTIONS_FACILITY_ACCESS_GRANTED", entityType: "CorrectionsFacilityGrant", entityId: saved.id, details: { facilityId: facility.locationId, memberId: member.id, permission: body.permission, ...capabilities } } });
      return { grant: saved, memberId: member.id, capabilities };
    });
    if (result?.denied) return correctionsResponse({ error: "Your facility authority changed. Please sign in again." }, 403);
    if (!result) return correctionsResponse({ error: "Choose an eligible team member and matching facility role." }, 400);
    return correctionsResponse({ ok: true, grant: { id: result.grant.id, memberId: result.memberId, permission: result.grant.permission, ...result.capabilities } });
  } catch (error) { return correctionsError(error); }
}

export async function DELETE(request, { params }) {
  const resolved = await ownerFacility(params);
  if (resolved.error) return resolved.error;
  const { access, facility } = resolved;
  const body = await request.json().catch(() => ({}));
  if (typeof body.memberId !== "string" || !body.memberId) return correctionsResponse({ error: "Choose a team member." }, 400);
  try {
    const removed = await prisma.$transaction(async (tx) => {
      const currentOwner = await correctionsCurrentFacilityEdit(tx, {
        organisationId: access.organisationId, memberId: access.context.membership.id,
        facilityId: facility.locationId, ownerOnly: true
      });
      if (!currentOwner) return null;
      const grant = await tx.correctionsFacilityGrant.findUnique({ where: { organisationMemberId_facilityId: { organisationMemberId: body.memberId, facilityId: facility.locationId } } });
      if (!grant || grant.organisationId !== access.organisationId) return false;
      await tx.correctionsFacilityGrant.delete({ where: { id: grant.id } });
      await tx.auditLog.create({ data: { organisationId: access.organisationId, actorUserId: access.context.user.id, action: "CORRECTIONS_FACILITY_ACCESS_REVOKED", entityType: "CorrectionsFacilityGrant", entityId: grant.id, details: { facilityId: facility.locationId, memberId: body.memberId, permission: grant.permission } } });
      return true;
    });
    if (removed === null) return correctionsResponse({ error: "Your facility authority changed. Please sign in again." }, 403);
    return correctionsResponse({ ok: true, removed });
  } catch (error) { return correctionsError(error); }
}
