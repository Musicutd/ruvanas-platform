import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ORGANISATION_MANAGER_ROLES } from "@/lib/permissions.mjs";
import { requireActiveSchoolRadio } from "@/lib/school-radio-access";
import {
  normalizeSchoolPilotEvent,
  normalizeSchoolPilotRun,
  SCHOOL_PILOT_EVENT_CATEGORIES,
  SCHOOL_PILOT_EVENT_KINDS,
  SCHOOL_PILOT_EVENT_OUTCOMES,
  SCHOOL_PILOT_EVENT_SEVERITIES,
  SCHOOL_PILOT_OPERATIONS_NOTICE
} from "@/lib/school-pilot-operations.mjs";
import { loadSchoolPilotOperations } from "@/lib/school-pilot-operations-service";

export const dynamic = "force-dynamic";

const createRunSchema = z.object({
  action: z.literal("CREATE_RUN"),
  title: z.string().trim().min(3).max(160),
  plannedStartAt: z.string().datetime(),
  plannedEndAt: z.string().datetime(),
  notes: z.string().trim().max(2000).optional().nullable()
});

const recordEventSchema = z.object({
  action: z.literal("RECORD_EVENT"),
  pilotRunId: z.string().trim().min(1).max(191),
  kind: z.enum(SCHOOL_PILOT_EVENT_KINDS),
  category: z.enum(SCHOOL_PILOT_EVENT_CATEGORIES),
  severity: z.enum(SCHOOL_PILOT_EVENT_SEVERITIES),
  outcome: z.enum(SCHOOL_PILOT_EVENT_OUTCOMES).optional().nullable(),
  summary: z.string().trim().min(10).max(1000),
  responseActions: z.string().trim().max(2000).optional().nullable(),
  occurredAt: z.string().datetime()
});

const operationSchema = z.discriminatedUnion("action", [createRunSchema, recordEventSchema]);

export async function GET() {
  const access = await requireActiveSchoolRadio(ORGANISATION_MANAGER_ROLES);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const report = await loadSchoolPilotOperations(access.organisation.id);
  return NextResponse.json({ report, notice: SCHOOL_PILOT_OPERATIONS_NOTICE }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request) {
  const access = await requireActiveSchoolRadio(ORGANISATION_MANAGER_ROLES);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const parsed = operationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check the pilot-operation details and try again." }, { status: 400 });

  try {
    if (parsed.data.action === "CREATE_RUN") {
      const input = normalizeSchoolPilotRun(parsed.data);
      await prisma.$transaction(async (tx) => {
        const run = await tx.schoolPilotRun.create({ data: {
          organisationId: access.organisation.id,
          ...input,
          createdByUserId: access.user.id,
          updatedByUserId: access.user.id
        } });
        await tx.auditLog.create({ data: {
          organisationId: access.organisation.id,
          actorUserId: access.user.id,
          action: "SCHOOL_PILOT_RUN_CREATED",
          entityType: "SchoolPilotRun",
          entityId: run.id,
          details: {
            plannedStartAt: run.plannedStartAt,
            plannedEndAt: run.plannedEndAt,
            automaticActionsPerformed: false,
            studentIdentitiesIncluded: false
          }
        } });
      });
    } else {
      const input = normalizeSchoolPilotEvent(parsed.data);
      const run = await prisma.schoolPilotRun.findFirst({
        where: { id: input.pilotRunId, organisationId: access.organisation.id },
        select: { id: true }
      });
      if (!run) return NextResponse.json({ error: "The pilot run was not found in this organisation." }, { status: 404 });
      await prisma.$transaction(async (tx) => {
        const event = await tx.schoolPilotEvent.create({ data: {
          organisationId: access.organisation.id,
          ...input,
          createdByUserId: access.user.id,
          resolvedByUserId: input.kind === "DRILL" ? access.user.id : null
        } });
        await tx.auditLog.create({ data: {
          organisationId: access.organisation.id,
          actorUserId: access.user.id,
          action: event.kind === "DRILL" ? "SCHOOL_PILOT_DRILL_RECORDED" : "SCHOOL_PILOT_INCIDENT_RECORDED",
          entityType: "SchoolPilotEvent",
          entityId: event.id,
          details: {
            pilotRunId: event.pilotRunId,
            category: event.category,
            severity: event.severity,
            outcome: event.outcome,
            automaticActionsPerformed: false,
            studentIdentitiesIncluded: false
          }
        } });
      });
    }
    const report = await loadSchoolPilotOperations(access.organisation.id);
    return NextResponse.json({ report, notice: SCHOOL_PILOT_OPERATIONS_NOTICE }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Pilot operations could not be updated." }, { status: 409 });
  }
}
