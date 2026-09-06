import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOrganisationAccess, ORGANISATION_CONTENT_ROLES, ORGANISATION_MANAGER_ROLES } from "@/lib/access-control";
import { listenerRequestTransition, LISTENER_REQUEST_ACTIONS, safeListenerRequest } from "@/lib/listener-interaction.mjs";
import { getRequestId } from "@/lib/security-log";

export async function PATCH(request, { params }) {
  try {
    const body = await request.json().catch(() => null);
    const action = String(body?.action || "").toUpperCase();
    if (!LISTENER_REQUEST_ACTIONS.includes(action)) return NextResponse.json({ error: "Choose a supported moderation action." }, { status: 400 });
    const requestRecord = await prisma.listenerRequest.findFirst({ where: { id: String(params.requestId || ""), stationId: String(params.stationId || "") } });
    if (!requestRecord) return NextResponse.json({ error: "Listener request not found." }, { status: 404 });
    const access = await requireOrganisationAccess(requestRecord.organisationId, ["UNBLOCK"].includes(action) || body?.blockSession === true ? ORGANISATION_MANAGER_ROLES : ORGANISATION_CONTENT_ROLES);
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
    const note = String(body?.note || "").trim();
    const instant = new Date();
    if (action === "UNBLOCK") {
      const updated = await prisma.$transaction(async (tx) => {
        const result = await tx.listenerRequestBlock.updateMany({ where: { stationId: requestRecord.stationId, sessionHash: requestRecord.sessionHash, active: true }, data: { active: false, revokedAt: instant, revokedByUserId: access.user.id } });
        await tx.auditLog.create({ data: { organisationId: requestRecord.organisationId, actorUserId: access.user.id, action: "LISTENER_REQUEST_SESSION_UNBLOCKED", entityType: "ListenerRequest", entityId: requestRecord.id, details: { affected: result.count, requestId: getRequestId(request) } } });
        return result.count;
      });
      return NextResponse.json({ ok: true, unblocked: updated > 0 }, { headers: { "Cache-Control": "no-store" } });
    }
    const transition = listenerRequestTransition(requestRecord.status, action, note);
    const changed = await prisma.$transaction(async (tx) => {
      const update = await tx.listenerRequest.updateMany({ where: { id: requestRecord.id, status: requestRecord.status }, data: { ...transition, reviewedByUserId: access.user.id, reviewedAt: instant } });
      if (update.count !== 1) throw new Error("This request changed while you were reviewing it. Reload and try again.");
      if (action === "REJECT" && body?.blockSession === true) {
        await tx.listenerRequestBlock.upsert({
          where: { stationId_sessionHash: { stationId: requestRecord.stationId, sessionHash: requestRecord.sessionHash } },
          create: { organisationId: requestRecord.organisationId, stationId: requestRecord.stationId, sessionHash: requestRecord.sessionHash, reason: transition.reviewNote, createdByUserId: access.user.id },
          update: { active: true, reason: transition.reviewNote, createdByUserId: access.user.id, revokedAt: null, revokedByUserId: null }
        });
      }
      await tx.auditLog.create({ data: { organisationId: requestRecord.organisationId, actorUserId: access.user.id, action: `LISTENER_REQUEST_${action}`, entityType: "ListenerRequest", entityId: requestRecord.id, details: { stationId: requestRecord.stationId, fromStatus: requestRecord.status, toStatus: transition.status, sessionBlocked: action === "REJECT" && body?.blockSession === true, requestId: getRequestId(request) } } });
      return tx.listenerRequest.findUnique({ where: { id: requestRecord.id } });
    });
    return NextResponse.json({ ok: true, request: safeListenerRequest(changed, action === "REJECT" && body?.blockSession === true) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to update the listener request." }, { status: 409, headers: { "Cache-Control": "no-store" } });
  }
}
