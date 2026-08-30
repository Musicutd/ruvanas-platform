import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";
import { getJobOperations, retryDeadLetterJob } from "@/lib/job-notification-service";
import { prisma } from "@/lib/prisma";
import { getRequestId } from "@/lib/security-log";

const retrySchema = z.object({
  jobId: z.string().min(1),
  action: z.literal("RETRY"),
  note: z.string().trim().min(8).max(500)
});

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const access = await requirePlatformAdmin();
    if (!access.ok) return accessDenied(access);
    return NextResponse.json(await getJobOperations(prisma));
  } catch (error) {
    console.error("Load job operations error:", error);
    return NextResponse.json({ error: "Unable to load background job operations." }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const access = await requirePlatformAdmin();
    if (!access.ok) return accessDenied(access);
    if (access.user.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Super administrator access is required." }, { status: 403 });
    const parsed = retrySchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid retry request." }, { status: 400 });
    const existing = await prisma.job.findUnique({ where: { id: parsed.data.jobId }, select: { id: true, organisationId: true, status: true, type: true } });
    if (!existing) return NextResponse.json({ error: "Background job not found." }, { status: 404 });
    if (existing.status !== "DEAD_LETTER") return NextResponse.json({ error: "Only dead-letter jobs can be retried manually." }, { status: 409 });
    const retried = await prisma.$transaction(async (tx) => {
      const changed = await retryDeadLetterJob(tx, existing.id);
      if (!changed) return false;
      await tx.auditLog.create({
        data: {
          organisationId: existing.organisationId,
          actorUserId: access.user.id,
          action: "BACKGROUND_JOB_RETRIED",
          entityType: "Job",
          entityId: existing.id,
          details: { type: existing.type, note: parsed.data.note, requestId: getRequestId(request) }
        }
      });
      return true;
    });
    if (!retried) return NextResponse.json({ error: "The job state changed before it could be retried." }, { status: 409 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Retry background job error:", error);
    return NextResponse.json({ error: "Unable to retry the background job." }, { status: 500 });
  }
}
