import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ORGANISATION_MANAGER_ROLES } from "@/lib/permissions.mjs";
import { requireActiveSchoolRadio } from "@/lib/school-radio-access";
import {
  SCHOOL_PILOT_EVENT_ACTIONS,
  SCHOOL_PILOT_OPERATIONS_NOTICE,
  SCHOOL_PILOT_RUN_ACTIONS,
  transitionSchoolPilotEvent,
  transitionSchoolPilotRun
} from "@/lib/school-pilot-operations.mjs";
import { loadCurrentSchoolPilotReadiness, loadSchoolPilotOperations } from "@/lib/school-pilot-operations-service";

export const dynamic = "force-dynamic";

const transitionSchema = z.discriminatedUnion("entity", [
  z.object({ entity: z.literal("RUN"), action: z.enum(SCHOOL_PILOT_RUN_ACTIONS), reason: z.string().trim().min(10).max(1000) }),
  z.object({ entity: z.literal("EVENT"), action: z.enum(SCHOOL_PILOT_EVENT_ACTIONS), notes: z.string().trim().min(10).max(2000) })
]);

export async function PATCH(request, { params }) {
  const access = await requireActiveSchoolRadio(ORGANISATION_MANAGER_ROLES);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const parsed = transitionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid action and provide a clear reason." }, { status: 400 });
  const { recordId } = await params;

  try {
    if (parsed.data.entity === "RUN") {
      const run = await prisma.schoolPilotRun.findFirst({
        where: { id: String(recordId || ""), organisationId: access.organisation.id }
      });
      if (!run) return NextResponse.json({ error: "The pilot run was not found." }, { status: 404 });
      const readiness = await loadCurrentSchoolPilotReadiness(access.organisation.id);
      const transition = transitionSchoolPilotRun(run.status, parsed.data, readiness);
      if (transition.status === "ACTIVE") {
        const otherOperationalRun = await prisma.schoolPilotRun.findFirst({
          where: {
            organisationId: access.organisation.id,
            id: { not: run.id },
            status: { in: ["ACTIVE", "PAUSED"] }
          },
          select: { id: true }
        });
        if (otherOperationalRun) return NextResponse.json({ error: "Finish or cancel the current operational pilot before starting another." }, { status: 409 });
      }
      await prisma.$transaction(async (tx) => {
        const updated = await tx.schoolPilotRun.update({
          where: { id: run.id },
          data: {
            status: transition.status,
            transitionReason: transition.transitionReason,
            startedAt: transition.startedAt,
            endedAt: transition.endedAt,
            readinessSnapshot: transition.readinessSnapshot,
            updatedByUserId: access.user.id
          }
        });
        await tx.auditLog.create({ data: {
          organisationId: access.organisation.id,
          actorUserId: access.user.id,
          action: `SCHOOL_PILOT_RUN_${transition.action}`,
          entityType: "SchoolPilotRun",
          entityId: run.id,
          details: {
            fromStatus: run.status,
            toStatus: updated.status,
            reason: transition.transitionReason,
            readinessStatus: readiness.status,
            automaticActionsPerformed: false
          }
        } });
      });
    } else {
      const event = await prisma.schoolPilotEvent.findFirst({
        where: { id: String(recordId || ""), organisationId: access.organisation.id }
      });
      if (!event) return NextResponse.json({ error: "The pilot event was not found." }, { status: 404 });
      if (event.kind !== "INCIDENT") return NextResponse.json({ error: "Drill records are complete when they are recorded." }, { status: 409 });
      const transition = transitionSchoolPilotEvent(event.status, parsed.data);
      const responseActions = transition.action === "ACKNOWLEDGE"
        ? [event.responseActions, transition.responseActions].filter(Boolean).join("\n")
        : undefined;
      await prisma.$transaction(async (tx) => {
        const updated = await tx.schoolPilotEvent.update({
          where: { id: event.id },
          data: {
            status: transition.status,
            responseActions,
            resolutionNotes: transition.resolutionNotes,
            acknowledgedAt: transition.acknowledgedAt,
            acknowledgedByUserId: transition.action === "ACKNOWLEDGE" ? access.user.id : undefined,
            resolvedAt: transition.resolvedAt,
            resolvedByUserId: transition.action === "RESOLVE" ? access.user.id : undefined
          }
        });
        await tx.auditLog.create({ data: {
          organisationId: access.organisation.id,
          actorUserId: access.user.id,
          action: `SCHOOL_PILOT_INCIDENT_${transition.action}`,
          entityType: "SchoolPilotEvent",
          entityId: event.id,
          details: {
            fromStatus: event.status,
            toStatus: updated.status,
            pilotRunId: event.pilotRunId,
            automaticActionsPerformed: false,
            studentIdentitiesIncluded: false
          }
        } });
      });
    }
    const report = await loadSchoolPilotOperations(access.organisation.id);
    return NextResponse.json({ report, notice: SCHOOL_PILOT_OPERATIONS_NOTICE });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The pilot operation could not be changed." }, { status: 409 });
  }
}
