import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ORGANISATION_MANAGER_ROLES } from "@/lib/permissions.mjs";
import { requireActiveSchoolRadio } from "@/lib/school-radio-access";
import { deriveSchoolPilotReadiness, normalizeSchoolPilotChecklist, SCHOOL_RETENTION_SAFETY_NOTICE } from "@/lib/school-pilot-readiness.mjs";
import { loadSchoolPilotReadiness } from "@/lib/school-pilot-readiness-service";

export const dynamic = "force-dynamic";

const checklistSchema = z.object({
  staffTrainingConfirmed: z.boolean(),
  emergencyWithdrawalDrillConfirmed: z.boolean(),
  retentionReviewConfirmed: z.boolean(),
  supportContactsConfirmed: z.boolean(),
  recoveryPlanConfirmed: z.boolean(),
  notes: z.string().trim().max(2000).optional().nullable()
});

export async function GET() {
  const access = await requireActiveSchoolRadio(ORGANISATION_MANAGER_ROLES);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const report = await loadSchoolPilotReadiness(access.organisation.id);
  return NextResponse.json({ report, notice: SCHOOL_RETENTION_SAFETY_NOTICE }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function PATCH(request) {
  const access = await requireActiveSchoolRadio(ORGANISATION_MANAGER_ROLES);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const parsed = checklistSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check each pilot-readiness item and try again." }, { status: 400 });

  try {
    const checklist = normalizeSchoolPilotChecklist(parsed.data);
    const [safeguarding, activeHoldCount] = await Promise.all([
      prisma.schoolSafeguardingReadiness.findUnique({
        where: { organisationId: access.organisation.id },
        select: { status: true, rawRecordingRetentionDays: true, consentEvidenceRetentionDays: true }
      }),
      prisma.schoolRetentionHold.count({ where: { organisationId: access.organisation.id, releasedAt: null } })
    ]);
    const readiness = deriveSchoolPilotReadiness({ checklist, safeguarding: safeguarding || {}, activeHoldCount });
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      const saved = await tx.schoolPilotReadiness.upsert({
        where: { organisationId: access.organisation.id },
        create: {
          organisationId: access.organisation.id,
          ...checklist,
          status: readiness.status,
          updatedByUserId: access.user.id,
          readyAt: readiness.readyForPilot ? now : null
        },
        update: {
          ...checklist,
          status: readiness.status,
          updatedByUserId: access.user.id,
          readyAt: readiness.readyForPilot ? now : null
        }
      });
      await tx.auditLog.create({ data: {
        organisationId: access.organisation.id,
        actorUserId: access.user.id,
        action: "SCHOOL_PILOT_READINESS_UPDATED",
        entityType: "SchoolPilotReadiness",
        entityId: saved.id,
        details: {
          status: readiness.status,
          completedChecks: readiness.completedChecks,
          totalChecks: readiness.totalChecks,
          activeHoldCount,
          destructiveActionPerformed: false
        }
      } });
    });
    const report = await loadSchoolPilotReadiness(access.organisation.id);
    return NextResponse.json({ report, notice: SCHOOL_RETENTION_SAFETY_NOTICE });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Pilot readiness could not be saved." }, { status: 409 });
  }
}
