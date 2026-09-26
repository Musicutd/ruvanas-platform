import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { correctionsCanCreateFacility, correctionsRequestContext } from "@/lib/corrections-access";
import { correctionsCaps } from "@/lib/corrections-policy.mjs";
import { makeLocationSlug } from "@/lib/subscriber-locations.mjs";
import { isValidIanaTimezone } from "@/lib/opening-hours.mjs";
import { runSerializableTransaction } from "@/lib/transaction-retry.mjs";

export const dynamic = "force-dynamic";
const reply = (result) => NextResponse.json(result, { status: result.status || 200 });

export async function GET() {
  const access = await correctionsRequestContext();
  if (!access.ok) return reply(access);
  const owner = correctionsCanCreateFacility(access);
  const facilities = await prisma.correctionsFacility.findMany({
    where: { location: { organisationId: access.organisationId, status: { not: "CLOSED" }, ...(!owner ? { correctionsFacilityGrants: { some: { organisationId: access.organisationId, organisationMemberId: access.context.membership.id } } } : {}) } },
    orderBy: { location: { name: "asc" } },
    include: { location: { select: { id: true, name: true, timezone: true, countryCode: true, status: true, zones: { orderBy: { name: "asc" }, select: { id: true, name: true, status: true } } } } }
  });
  const assignments = owner ? [] : await prisma.correctionsFacilityGrant.findMany({ where: { organisationId: access.organisationId, organisationMemberId: access.context.membership.id }, select: { facilityId: true, permission: true } });
  const assignmentByFacility = new Map(assignments.map((item) => [item.facilityId, item.permission]));
  const profile = await prisma.correctionsProfile.findUnique({ where: { organisationId: access.organisationId } });
  const zoneCount = await prisma.zone.count({ where: { location: { organisationId: access.organisationId, correctionsFacility: { isNot: null }, status: { not: "CLOSED" } } } });
  return reply({ ok: true, facilities: facilities.map((item) => ({ ...item, canEdit: owner || (access.context.membership.role === "MANAGER" && assignmentByFacility.get(item.locationId) === "MANAGER"), programmeRole: owner ? "OWNER" : assignmentByFacility.get(item.locationId) || "VIEWER" })), profile, caps: correctionsCaps(access.entitlements), zoneCount, canCreate: owner, playbackEnabled: false });
}

export async function POST(request) {
  const access = await correctionsRequestContext();
  if (!access.ok) return reply(access);
  if (!correctionsCanCreateFacility(access)) return reply({ status: 403, error: "Only the organisation owner can add a facility." });
  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const firstZoneName = typeof body.firstZoneName === "string" ? body.firstZoneName.trim() : "";
  const timezone = typeof body.timezone === "string" ? body.timezone.trim() : "";
  const countryCode = typeof body.countryCode === "string" ? body.countryCode.trim().toUpperCase() : "";
  const slug = makeLocationSlug(name);
  const zoneSlug = makeLocationSlug(firstZoneName);
  if (name.length < 2 || name.length > 160 || firstZoneName.length < 2 || firstZoneName.length > 160 || !slug || !zoneSlug || !isValidIanaTimezone(timezone) || !/^[A-Z]{2}$/.test(countryCode)) {
    return reply({ status: 400, error: "Enter a facility name, first secure area, valid timezone and two-letter country code." });
  }
  try {
    const result = await runSerializableTransaction(prisma, async (tx) => {
      const caps = correctionsCaps(access.entitlements);
      const existing = await tx.correctionsFacility.count({ where: { location: { organisationId: access.organisationId, status: { not: "CLOSED" } } } });
      if (existing >= caps.facilities) return { status: 409, error: `This plan allows ${caps.facilities} ${caps.facilities === 1 ? "facility" : "facilities"}. Ask Ruvanas to change your plan before adding another.` };
      const existingZoneCount = await tx.zone.count({ where: { location: { organisationId: access.organisationId, correctionsFacility: { isNot: null }, status: { not: "CLOSED" } } } });
      if (existingZoneCount >= caps.zones) return { status: 409, error: "This plan's secure-area allowance is full." };
      const location = await tx.location.create({ data: {
        organisationId: access.organisationId, name, slug, timezone, countryCode, status: "DRAFT",
        zones: { create: { name: firstZoneName, slug: zoneSlug, status: "OFFLINE" } },
        correctionsFacility: { create: { youthFacility: body.youthFacility === true } }
      }, select: { id: true, name: true, zones: { select: { id: true, name: true } } } });
      await tx.correctionsProfile.upsert({ where: { organisationId: access.organisationId }, create: { organisationId: access.organisationId }, update: {} });
      await tx.auditLog.create({ data: { organisationId: access.organisationId, actorUserId: access.context.user.id, action: "CORRECTIONS_FACILITY_CREATED", entityType: "Location", entityId: location.id, details: { firstZoneId: location.zones[0]?.id, youthFacility: body.youthFacility === true } } });
      return { ok: true, status: 201, facility: location };
    });
    return reply(result);
  } catch (error) {
    if (error?.code === "P2002") return reply({ status: 409, error: "A facility or secure area with that name already exists." });
    console.error("Corrections facility creation failed:", error);
    return reply({ status: 500, error: "The facility could not be created." });
  }
}
