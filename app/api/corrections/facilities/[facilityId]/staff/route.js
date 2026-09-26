import { prisma } from "@/lib/prisma";
import { correctionsFacilityAccess, correctionsRequestContext } from "@/lib/corrections-access";
import { correctionsError, correctionsResponse } from "@/lib/corrections-http";
import { correctionsGrantAllowed } from "@/lib/corrections-workflow.mjs";

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
    prisma.organisationMember.findMany({ where: { organisationId: access.organisationId, role: { in: ["MANAGER", "CONTENT_EDITOR", "VIEWER"] } }, select: { id: true, role: true, user: { select: { name: true, email: true } } }, orderBy: { createdAt: "asc" } }),
    prisma.correctionsFacilityGrant.findMany({ where: { organisationId: access.organisationId, facilityId: facility.locationId }, select: { id: true, organisationMemberId: true, permission: true } })
  ]);
  return correctionsResponse({ ok: true, members, grants });
}

export async function POST(request, { params }) {
  const resolved = await ownerFacility(params);
  if (resolved.error) return resolved.error;
  const { access, facility } = resolved;
  const body = await request.json().catch(() => ({}));
  try {
    const member = await prisma.organisationMember.findFirst({ where: { id: body.memberId, organisationId: access.organisationId }, select: { id: true, role: true } });
    if (!member || !correctionsGrantAllowed(member.role, body.permission)) return correctionsResponse({ error: "Choose an eligible team member and matching facility role." }, 400);
    const grant = await prisma.$transaction(async (tx) => {
      const saved = await tx.correctionsFacilityGrant.upsert({ where: { organisationMemberId_facilityId: { organisationMemberId: member.id, facilityId: facility.locationId } }, create: { organisationId: access.organisationId, organisationMemberId: member.id, facilityId: facility.locationId, permission: body.permission, createdByUserId: access.context.user.id }, update: { permission: body.permission, createdByUserId: access.context.user.id } });
      await tx.auditLog.create({ data: { organisationId: access.organisationId, actorUserId: access.context.user.id, action: "CORRECTIONS_FACILITY_ACCESS_GRANTED", entityType: "CorrectionsFacilityGrant", entityId: saved.id, details: { facilityId: facility.locationId, memberId: member.id, permission: body.permission } } });
      return saved;
    });
    return correctionsResponse({ ok: true, grant: { id: grant.id, memberId: member.id, permission: grant.permission } });
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
      const grant = await tx.correctionsFacilityGrant.findUnique({ where: { organisationMemberId_facilityId: { organisationMemberId: body.memberId, facilityId: facility.locationId } } });
      if (!grant || grant.organisationId !== access.organisationId) return false;
      await tx.correctionsFacilityGrant.delete({ where: { id: grant.id } });
      await tx.auditLog.create({ data: { organisationId: access.organisationId, actorUserId: access.context.user.id, action: "CORRECTIONS_FACILITY_ACCESS_REVOKED", entityType: "CorrectionsFacilityGrant", entityId: grant.id, details: { facilityId: facility.locationId, memberId: body.memberId, permission: grant.permission } } });
      return true;
    });
    return correctionsResponse({ ok: true, removed });
  } catch (error) { return correctionsError(error); }
}
