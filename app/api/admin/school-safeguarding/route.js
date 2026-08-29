import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/access-control";
import {
  assertSchoolSafeguardingReadyForReview,
  normalizeSchoolSafeguardingReview,
  schoolSafeguardingPolicySnapshot
} from "@/lib/school-safeguarding-readiness.mjs";
import { SCHOOL_PUBLICATION_POLICY_VERSION } from "@/lib/school-publication.mjs";

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
      let withdrawnPodcastCount = 0;
      if (reviewInput.decision === "CHANGES_REQUESTED") {
        const now = new Date();
        const publicPodcasts = await tx.schoolPodcastEpisode.findMany({ where: { organisationId: readiness.organisationId, status: "PUBLISHED", publicationScope: "PUBLIC" }, select: { id: true, publicationRevision: true } });
        withdrawnPodcastCount = publicPodcasts.length;
        if (publicPodcasts.length) {
          const reason = "School safeguarding approval was withdrawn for changes.";
          await tx.schoolPodcastEpisode.updateMany({ where: { id: { in: publicPodcasts.map((item) => item.id) } }, data: { status: "UNPUBLISHED", unpublishedAt: now, lastPolicyCheckAt: now, unpublishReason: reason } });
          await tx.schoolPublicationDecision.createMany({ data: publicPodcasts.map((item) => ({ organisationId: readiness.organisationId, podcastEpisodeId: item.id, actorUserId: access.user.id, decision: "AUTO_WITHDRAWN", reason, policyVersion: SCHOOL_PUBLICATION_POLICY_VERSION, policySnapshot: { readinessId: readiness.id, publicationRevision: item.publicationRevision } })) });
        }
      }
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
          guardedStudentAccessEligible: reviewInput.decision === "APPROVED",
          publicPublishingPolicyEligible: reviewInput.decision === "APPROVED",
          withdrawnPodcastCount
        }
      } });
      return created;
    });
    return NextResponse.json({ review, guardedStudentAccessEligible: review.decision === "APPROVED", publicPublishingPolicyEligible: review.decision === "APPROVED" }, { status: 201 });
  } catch (error) {
    if (error?.message === "READINESS_NOT_FOUND") return NextResponse.json({ error: "Safeguarding readiness pack not found." }, { status: 404 });
    if (error?.message === "READINESS_NOT_REVIEWABLE") return NextResponse.json({ error: "This pack is no longer awaiting review. Refresh the page to see its current status." }, { status: 409 });
    if (error instanceof Error && /Explain|Choose/.test(error.message)) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error("School safeguarding review error:", error);
    return NextResponse.json({ error: "The safeguarding decision could not be recorded." }, { status: 500 });
  }
}
