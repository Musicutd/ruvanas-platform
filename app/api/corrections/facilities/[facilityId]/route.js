import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { correctionsFacilityAccess, correctionsRequestContext } from "@/lib/corrections-access";
import { correctionsCaps, normalizeCorrectionsPolicy } from "@/lib/corrections-policy.mjs";
import { normalizeSubscriberZoneInput } from "@/lib/subscriber-locations.mjs";
import { runSerializableTransaction } from "@/lib/transaction-retry.mjs";

export const dynamic = "force-dynamic";
const reply = (result) => NextResponse.json(result, { status: result.status || 200 });

export async function PATCH(request, { params }) {
  const access = await correctionsRequestContext();
  if (!access.ok) return reply(access);
  const facility = await correctionsFacilityAccess(access, params.facilityId, { edit: true });
  if (!facility) return reply({ status: 404, error: "Facility unavailable to this account." });
  const body = await request.json().catch(() => ({}));
  if (body.action === "ADD_ZONE") {
    let zoneInput;
    try { zoneInput = normalizeSubscriberZoneInput({ name: body.name }); }
    catch (error) { return reply({ status: 400, error: error.message }); }
    try {
      const result = await runSerializableTransaction(prisma, async (tx) => {
        const count = await tx.zone.count({ where: { location: { organisationId: access.organisationId, correctionsFacility: { isNot: null }, status: { not: "CLOSED" } } } });
        if (count >= correctionsCaps(access.entitlements).zones) return { status: 409, error: "This plan's secure-area allowance is full." };
        const zone = await tx.zone.create({ data: { locationId: facility.locationId, ...zoneInput, status: "OFFLINE" } });
        await tx.auditLog.create({ data: { organisationId: access.organisationId, actorUserId: access.context.user.id, action: "CORRECTIONS_ZONE_CREATED", entityType: "Zone", entityId: zone.id, details: { locationId: facility.locationId } } });
        return { ok: true, status: 201, zone };
      });
      return reply(result);
    } catch (error) {
      if (error?.code === "P2002") return reply({ status: 409, error: "That secure-area name already exists here." });
      console.error("Corrections area creation failed:", error);
      return reply({ status: 500, error: "The secure area could not be created." });
    }
  }
  if (body.action === "SAVE_POLICY") {
    let input;
    try { input = normalizeCorrectionsPolicy(body); }
    catch (error) { return reply({ status: 400, error: error.message }); }
    try {
      const policy = await prisma.$transaction(async (tx) => {
        const saved = await tx.correctionsFacility.update({ where: { locationId: facility.locationId }, data: { ...input, youthFacility: body.youthFacility === true, ...(access.context.membership.role === "OWNER" ? { dualApprovalRequired: body.dualApprovalRequired === true } : {}), policyVersion: { increment: 1 }, policyConfiguredAt: new Date() } });
        await tx.auditLog.create({ data: { organisationId: access.organisationId, actorUserId: access.context.user.id, action: "CORRECTIONS_FACILITY_POLICY_SAVED", entityType: "CorrectionsFacility", entityId: facility.locationId, details: { youthFacility: saved.youthFacility, dualApprovalRequired: saved.dualApprovalRequired, policyVersion: saved.policyVersion, allowedGenres: input.allowedGenres, restrictedGenres: input.restrictedGenres, blockedTrackCount: input.blockedTrackIds.length, blockedArtistCount: input.blockedArtists.length } } });
        return saved;
      });
      return reply({ ok: true, policy });
    } catch (error) {
      console.error("Corrections facility policy failed:", error);
      return reply({ status: 500, error: "The facility policy could not be saved." });
    }
  }
  return reply({ status: 400, error: "Choose a valid facility action." });
}
