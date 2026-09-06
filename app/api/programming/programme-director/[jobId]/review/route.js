import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { contextForAdvancedScheduler } from "@/lib/advanced-scheduler-access";
import { canReviewProgrammeDirector } from "@/lib/ai-programme-director.mjs";
import { assertAIReviewTransition, normalizeHumanReview } from "@/lib/ai-governance.mjs";
import { getRequestId } from "@/lib/security-log";

const schema = z.object({ decision: z.enum(["APPROVED", "REJECTED"]), editedText: z.string().optional(), reviewNote: z.string().optional() });

export async function PATCH(request, { params }) {
  try {
    const access = await contextForAdvancedScheduler();
    if (access.response) return access.response;
    const { user, membership } = access.context;
    if (!canReviewProgrammeDirector(membership.role)) return NextResponse.json({ error: "Only an owner or manager can approve programme recommendations." }, { status: 403 });
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid review." }, { status: 400 });
    const { jobId } = await params;
    const job = await prisma.aIJob.findFirst({ where: { id: jobId, organisationId: membership.organisationId, assistantType: "PROGRAMME_DIRECTOR" } });
    if (!job) return NextResponse.json({ error: "Programme recommendation not found." }, { status: 404 });
    assertAIReviewTransition(job.status, parsed.data.decision);
    const review = normalizeHumanReview(parsed.data);
    const operationRequestId = getRequestId(request);
    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.aIJob.update({
        where: { id: job.id },
        data: { status: review.status, approvedText: review.approvedText, reviewNote: review.reviewNote, reviewedByUserId: user.id, reviewedAt: new Date() },
        include: { requestedBy: { select: { id: true, name: true, email: true } }, reviewedBy: { select: { id: true, name: true, email: true } }, metadata: true }
      });
      await tx.recommendationFeedback.upsert({
        where: { aiJobId_userId: { aiJobId: job.id, userId: user.id } },
        create: { aiJobId: job.id, userId: user.id, decision: review.status, comment: review.reviewNote },
        update: { decision: review.status, comment: review.reviewNote, createdAt: new Date() }
      });
      await tx.auditLog.create({ data: { organisationId: membership.organisationId, actorUserId: user.id, action: review.status === "APPROVED" ? "AI_PROGRAMME_RECOMMENDATION_APPROVED" : "AI_PROGRAMME_RECOMMENDATION_REJECTED", entityType: "AIJob", entityId: job.id, details: { channelId: job.input?.programmePlan?.channelId || null, editedBeforeApproval: review.approvedText !== job.draftText, liveScheduleChanged: false, requestId: operationRequestId } } });
      return saved;
    });
    return NextResponse.json({ ok: true, job: { ...updated, createdAt: updated.createdAt.toISOString(), reviewedAt: updated.reviewedAt?.toISOString() || null, plan: updated.input?.programmePlan || null }, notice: review.status === "APPROVED" ? "Recommendation approved. Live programming is unchanged; you may now create a schedule draft." : "Recommendation rejected and closed." });
  } catch (error) {
    if (error instanceof Error && /cannot move|Choose|Approved draft|required|characters/.test(error.message)) return NextResponse.json({ error: error.message }, { status: 409 });
    console.error("Programme Director review error:", error);
    return NextResponse.json({ error: "Unable to review the programme recommendation." }, { status: 500 });
  }
}
