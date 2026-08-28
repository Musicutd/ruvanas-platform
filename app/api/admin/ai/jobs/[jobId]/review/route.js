import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";
import { getRequestId } from "@/lib/security-log";
import { assertAIReviewTransition, normalizeHumanReview } from "@/lib/ai-governance.mjs";

const schema = z.object({
  decision: z.enum(["APPROVED", "REJECTED"]),
  editedText: z.string().optional(),
  reviewNote: z.string().optional()
});

async function requireSuperAdmin() {
  const access = await requirePlatformAdmin();
  if (!access.ok) return access;
  if (access.user.role !== "SUPER_ADMIN") return { ok: false, status: 403, error: "Only a Ruvanas Super Admin can approve or reject assistant drafts." };
  return access;
}

export async function PATCH(request, { params }) {
  try {
    const access = await requireSuperAdmin();
    if (!access.ok) return accessDenied(access);
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid review." }, { status: 400 });

    const job = await prisma.aIJob.findUnique({ where: { id: String(params.jobId || "") } });
    if (!job) return NextResponse.json({ error: "Assistant draft not found." }, { status: 404 });
    assertAIReviewTransition(job.status, parsed.data.decision);
    const review = normalizeHumanReview(parsed.data);
    const operationRequestId = getRequestId(request);

    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.aIJob.update({
        where: { id: job.id },
        data: {
          status: review.status,
          approvedText: review.approvedText,
          reviewNote: review.reviewNote,
          reviewedByUserId: access.user.id,
          reviewedAt: new Date()
        },
        include: { metadata: true, organisation: { select: { name: true } }, requestedBy: { select: { name: true, email: true } }, reviewedBy: { select: { name: true, email: true } } }
      });
      await tx.recommendationFeedback.upsert({
        where: { aiJobId_userId: { aiJobId: job.id, userId: access.user.id } },
        create: { aiJobId: job.id, userId: access.user.id, decision: review.status, comment: review.reviewNote },
        update: { decision: review.status, comment: review.reviewNote, createdAt: new Date() }
      });
      await tx.auditLog.create({
        data: {
          organisationId: job.organisationId,
          actorUserId: access.user.id,
          action: review.status === "APPROVED" ? "AI_DRAFT_APPROVED" : "AI_DRAFT_REJECTED",
          entityType: "AIJob",
          entityId: job.id,
          details: { assistantType: job.assistantType, editedBeforeApproval: review.approvedText !== job.draftText, autoPublished: false, requestId: operationRequestId }
        }
      });
      return saved;
    });

    return NextResponse.json({ job: updated, notice: review.status === "APPROVED" ? "Draft approved as an internal artifact. It has not been published or scheduled." : "Draft rejected and closed." });
  } catch (error) {
    if (error instanceof Error && /cannot move|Choose|Approved draft|required|characters/.test(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error("AI draft review error:", error);
    return NextResponse.json({ error: "Unable to review the assistant draft." }, { status: 500 });
  }
}

