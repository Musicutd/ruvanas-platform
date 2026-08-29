import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/access-control";
import {
  assertSchoolSafeguardingReadyForReview,
  normalizeSchoolSafeguardingReview,
  schoolSafeguardingPolicySnapshot
} from "@/lib/school-safeguarding-readiness.mjs";

export const dynamic = "force-dynamic";

const decisionSchema = z.object({
  readinessId: z.string().min(1),
  decision: z.enum(["CHANGES_REQUESTED", "APPROVED"]),
  notes: z.string().trim().max(4000).optional().nullable()
});

async function requireSuperAdmin() {
  const access = await requirePlatformAdmin();
  if (!access.ok) return access;
  if (access.user.role !== "SUPER_ADMIN") {
    return { ok: false, status: 403, error: "Only a Ruvanas Super Admin can decide school safeguarding readiness." };
  }
  return access;
}

export async function POST(request) {
  const access = await requireSuperAdmin();
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const parsed = decisionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check the review decision and try again." }, { status: 400 });

  try {
    const reviewInput = normalizeSchoolSafeguardingReview(parsed.data);
    const review = await prisma.$transaction(async (tx) => {
      const readiness = await tx.schoolSafeguardingReadiness.findUnique({ where: { id: parsed.data.readinessId } });
      if (!readiness) throw new Error("READINESS_NOT_FOUND");
      if (readiness.status !== "READY_FOR_REVIEW") throw new Error("READINESS_NOT_REVIEWABLE");
      assertSchoolSafeguardingReadyForReview(readiness);

      const updated = await tx.schoolSafeguardingReadiness.updateMany({
        where: { id: readiness.id, status: "READY_FOR_REVIEW" },
        data: { status: reviewInput.decision }
      });
      if (updated.count !== 1) throw new Error("READINESS_NOT_REVIEWABLE");

      const created = await tx.schoolSafeguardingReview.create({
        data: {
          readinessId: readiness.id,
          organisationId: readiness.organisationId,
          reviewerUserId: access.user.id,
          decision: reviewInput.decision,
          notes: reviewInput.notes,
          policySnapshot: schoolSafeguardingPolicySnapshot(readiness)
        }
      });
      await tx.auditLog.create({ data: {
        organisationId: readiness.organisationId,
        actorUserId: access.user.id,
        action: reviewInput.decision === "APPROVED" ? "SCHOOL_SAFEGUARDING_READINESS_APPROVED" : "SCHOOL_SAFEGUARDING_CHANGES_REQUESTED",
        entityType: "SchoolSafeguardingReview",
        entityId: created.id,
        details: {
          readinessId: readiness.id,
          decision: reviewInput.decision,
          policyVersion: "school-safeguarding-readiness-v1",
          directStudentAccessEnabled: false,
          publicPublishingEnabled: false
        }
      } });
      return created;
    });
    return NextResponse.json({ review, studentAccessEnabled: false, publicPublishingEnabled: false }, { status: 201 });
  } catch (error) {
    if (error?.message === "READINESS_NOT_FOUND") return NextResponse.json({ error: "Safeguarding readiness pack not found." }, { status: 404 });
    if (error?.message === "READINESS_NOT_REVIEWABLE") return NextResponse.json({ error: "This pack is no longer awaiting review. Refresh the page to see its current status." }, { status: 409 });
    if (error instanceof Error && /Explain|Choose/.test(error.message)) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error("School safeguarding review error:", error);
    return NextResponse.json({ error: "The safeguarding decision could not be recorded." }, { status: 500 });
  }
}
