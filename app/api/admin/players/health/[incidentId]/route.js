import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";
import { incidentTransition } from "@/lib/player-health.mjs";
import { getRequestId } from "@/lib/security-log";

const actionSchema = z.object({
  action: z.enum(["ACKNOWLEDGE", "RESOLVE"]),
  note: z.string().trim().min(3).max(2_000)
});

export async function PATCH(request, { params }) {
  try {
    const access = await requirePlatformAdmin();
    if (!access.ok) return accessDenied(access);
    const parsed = actionSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Choose an action and add a short operational note." }, { status: 400 });
    const { incidentId } = await params;
    const incident = await prisma.playerHealthIncident.findUnique({ where: { id: String(incidentId || "") } });
    if (!incident) return NextResponse.json({ error: "Player health incident not found." }, { status: 404 });
    const transition = incidentTransition(incident.status, parsed.data.action, parsed.data.note);
    const changed = await prisma.$transaction(async (tx) => {
      const updated = await tx.playerHealthIncident.updateMany({
        where: { id: incident.id, status: incident.status },
        data: parsed.data.action === "ACKNOWLEDGE"
          ? { ...transition, acknowledgedById: access.user.id }
          : { ...transition, resolvedById: access.user.id }
      });
      if (updated.count !== 1) throw new Error("The incident changed while you were reviewing it. Reload and try again.");
      await tx.auditLog.create({
        data: {
          organisationId: incident.organisationId,
          actorUserId: access.user.id,
          action: `PLAYER_HEALTH_INCIDENT_${parsed.data.action}`,
          entityType: "PlayerHealthIncident",
          entityId: incident.id,
          details: { playerId: incident.playerId, fromStatus: incident.status, toStatus: transition.status, requestId: getRequestId(request) }
        }
      });
      return tx.playerHealthIncident.findUnique({ where: { id: incident.id } });
    });
    return NextResponse.json({ ok: true, incident: changed });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to update the health incident." }, { status: 409 });
  }
}

