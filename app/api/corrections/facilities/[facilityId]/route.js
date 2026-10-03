import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { correctionsFacilityAccess, correctionsRequestContext } from "@/lib/corrections-access";
import { correctionsCaps, normalizeCorrectionsPolicy } from "@/lib/corrections-policy.mjs";
import { normalizeSubscriberZoneInput } from "@/lib/subscriber-locations.mjs";
import { runSerializableTransaction } from "@/lib/transaction-retry.mjs";
import { correctionsCurrentFacilityEdit } from "@/lib/corrections-facility-write-authority.mjs";

export const dynamic = "force-dynamic";
const reply = (result) => NextResponse.json(result, { status: result.status || 200 });

const currentFacilityEdit = (tx, access, facilityId, options) => correctionsCurrentFacilityEdit(tx, {
  organisationId: access.organisationId,
  memberId: access.context.membership.id,
  facilityId,
  ...options
});

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
        const current = await currentFacilityEdit(tx, access, facility.locationId);
        if (!current) return { status: 403, error: "Facility access was changed. Please sign in again." };
        const count = await tx.zone.count({ where: { location: { organisationId: access.organisationId, correctionsFacility: { isNot: null }, status: { not: "CLOSED" } } } });
        if (count >= correctionsCaps(current.entitlements).zones) return { status: 409, error: "This plan's secure-area allowance is full." };
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
      const result = await runSerializableTransaction(prisma, async (tx) => {
        const current = await currentFacilityEdit(tx, access, facility.locationId);
        if (!current) return { status: 403, error: "Facility access was changed. Please sign in again." };
        const saved = await tx.correctionsFacility.update({ where: { locationId: facility.locationId }, data: { ...input, youthFacility: body.youthFacility === true, ...(current.role === "OWNER" ? { dualApprovalRequired: body.dualApprovalRequired === true } : {}), policyVersion: { increment: 1 }, policyConfiguredAt: new Date() } });
        await tx.auditLog.create({ data: { organisationId: access.organisationId, actorUserId: access.context.user.id, action: "CORRECTIONS_FACILITY_POLICY_SAVED", entityType: "CorrectionsFacility", entityId: facility.locationId, details: { youthFacility: saved.youthFacility, dualApprovalRequired: saved.dualApprovalRequired, policyVersion: saved.policyVersion, allowedGenres: input.allowedGenres, restrictedGenres: input.restrictedGenres, blockedTrackCount: input.blockedTrackIds.length, blockedArtistCount: input.blockedArtists.length } } });
        return { ok: true, policy: saved };
      });
      return reply(result);
    } catch (error) {
      console.error("Corrections facility policy failed:", error);
      return reply({ status: 500, error: "The facility policy could not be saved." });
    }
  }
  if (body.action === "SAVE_ANNOUNCEMENT_POLICY") {
    if (access.context.membership.role !== "OWNER") return reply({ status: 403, error: "Only the organisation owner may set facility broadcast policy." });
    if (!["CREATOR_PUBLISH", "EXPLICIT", "DUAL"].includes(body.announcementApprovalMode)) return reply({ status: 400, error: "Choose a standard announcement approval policy." });
    if (body.emergencyDualControl === true && body.emergencyEnabled === true) return reply({ status: 409, error: "Dual-control Emergency activation is reserved for a later guarded stage; it cannot be enabled for live use yet." });
    try {
      const result = await runSerializableTransaction(prisma, async (tx) => {
        if (!await currentFacilityEdit(tx, access, facility.locationId, { ownerOnly: true })) return { status: 403, error: "Facility access was changed. Please sign in again." };
        const policy = await tx.correctionsFacility.update({ where: { locationId: facility.locationId }, data: { announcementApprovalMode: body.announcementApprovalMode, priorityEnabled: body.priorityEnabled === true, emergencyEnabled: body.emergencyEnabled === true, emergencyDrillsEnabled: body.emergencyDrillsEnabled === true, emergencyDualControl: false } });
        await tx.auditLog.create({ data: { organisationId: access.organisationId, actorUserId: access.context.user.id, action: "CORRECTIONS_ANNOUNCEMENT_POLICY_SAVED", entityType: "CorrectionsFacility", entityId: facility.locationId, details: { approvalMode: policy.announcementApprovalMode, priorityEnabled: policy.priorityEnabled, emergencyEnabled: policy.emergencyEnabled, emergencyDrillsEnabled: policy.emergencyDrillsEnabled } } });
        return { ok: true, policy };
      });
      return reply(result);
    } catch { return reply({ status: 500, error: "Broadcast policy could not be saved." }); }
  }
  return reply({ status: 400, error: "Choose a valid facility action." });
}
