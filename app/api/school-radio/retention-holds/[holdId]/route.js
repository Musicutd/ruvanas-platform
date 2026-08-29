import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ORGANISATION_MANAGER_ROLES } from "@/lib/permissions.mjs";
import { requireActiveSchoolRadio } from "@/lib/school-radio-access";
import { normalizeSchoolRetentionHoldRelease, SCHOOL_RETENTION_SAFETY_NOTICE } from "@/lib/school-pilot-readiness.mjs";
import { loadSchoolPilotReadiness } from "@/lib/school-pilot-readiness-service";

export const dynamic = "force-dynamic";

const releaseSchema = z.object({ reason: z.string().trim().min(10).max(1000) });

export async function PATCH(request, { params }) {
  const access = await requireActiveSchoolRadio(ORGANISATION_MANAGER_ROLES);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const parsed = releaseSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Provide a clear reason for releasing this hold." }, { status: 400 });

  try {
    const release = normalizeSchoolRetentionHoldRelease(parsed.data);
    const { holdId } = await params;
    const existing = await prisma.schoolRetentionHold.findFirst({
      where: { id: String(holdId || ""), organisationId: access.organisation.id }
    });
    if (!existing) return NextResponse.json({ error: "The retention hold was not found." }, { status: 404 });
    if (existing.releasedAt) return NextResponse.json({ error: "This retention hold has already been released." }, { status: 409 });
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      const released = await tx.schoolRetentionHold.updateMany({
        where: { id: existing.id, organisationId: access.organisation.id, releasedAt: null },
        data: { releasedByUserId: access.user.id, releaseReason: release.reason, releasedAt: now }
      });
      if (released.count !== 1) throw new Error("This retention hold has already been released.");
      await tx.auditLog.create({ data: {
        organisationId: access.organisation.id,
        actorUserId: access.user.id,
        action: "SCHOOL_RETENTION_HOLD_RELEASED",
        entityType: "SchoolRetentionHold",
        entityId: existing.id,
        details: { scope: existing.scope, referenceId: existing.referenceId, releaseReason: release.reason, destructiveActionPerformed: false }
      } });
    });
    const report = await loadSchoolPilotReadiness(access.organisation.id);
    return NextResponse.json({ report, notice: SCHOOL_RETENTION_SAFETY_NOTICE });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The retention hold could not be released." }, { status: 409 });
  }
}

