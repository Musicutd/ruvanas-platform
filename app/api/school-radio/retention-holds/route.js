import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ORGANISATION_MANAGER_ROLES } from "@/lib/permissions.mjs";
import { requireActiveSchoolRadio } from "@/lib/school-radio-access";
import { assertSchoolRetentionHoldReference, loadSchoolPilotReadiness } from "@/lib/school-pilot-readiness-service";
import { SCHOOL_RETENTION_HOLD_SCOPES, SCHOOL_RETENTION_SAFETY_NOTICE } from "@/lib/school-pilot-readiness.mjs";

export const dynamic = "force-dynamic";

const holdSchema = z.object({
  scope: z.enum(SCHOOL_RETENTION_HOLD_SCOPES),
  referenceId: z.string().trim().max(191).optional().nullable(),
  reason: z.string().trim().min(10).max(1000)
});

export async function POST(request) {
  const access = await requireActiveSchoolRadio(ORGANISATION_MANAGER_ROLES);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const parsed = holdSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a hold scope and provide a clear reason." }, { status: 400 });

  try {
    const holdInput = await assertSchoolRetentionHoldReference(access.organisation.id, parsed.data);
    const existing = await prisma.schoolRetentionHold.findFirst({
      where: {
        organisationId: access.organisation.id,
        scope: holdInput.scope,
        referenceId: holdInput.referenceId,
        releasedAt: null
      },
      select: { id: true }
    });
    if (existing) return NextResponse.json({ error: "An active hold already covers this scope and reference." }, { status: 409 });

    await prisma.$transaction(async (tx) => {
      const hold = await tx.schoolRetentionHold.create({ data: {
        organisationId: access.organisation.id,
        ...holdInput,
        createdByUserId: access.user.id
      } });
      await tx.auditLog.create({ data: {
        organisationId: access.organisation.id,
        actorUserId: access.user.id,
        action: "SCHOOL_RETENTION_HOLD_CREATED",
        entityType: "SchoolRetentionHold",
        entityId: hold.id,
        details: { scope: hold.scope, referenceId: hold.referenceId, destructiveActionPerformed: false }
      } });
    });
    const report = await loadSchoolPilotReadiness(access.organisation.id);
    return NextResponse.json({ report, notice: SCHOOL_RETENTION_SAFETY_NOTICE }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The retention hold could not be created." }, { status: 409 });
  }
}

