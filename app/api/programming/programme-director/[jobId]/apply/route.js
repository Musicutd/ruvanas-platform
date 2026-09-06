import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { contextForAdvancedScheduler } from "@/lib/advanced-scheduler-access";
import { parseProgrammeScheduleInput } from "@/lib/advanced-scheduler.mjs";
import { validateProgrammeScheduleSources } from "@/lib/advanced-scheduler-service";
import { canReviewProgrammeDirector, programmeDirectorPlanForSchedule } from "@/lib/ai-programme-director.mjs";
import { getRequestId } from "@/lib/security-log";

export async function POST(request, { params }) {
  try {
    const access = await contextForAdvancedScheduler();
    if (access.response) return access.response;
    const { user, membership } = access.context;
    if (!canReviewProgrammeDirector(membership.role)) return NextResponse.json({ error: "Only an owner or manager can apply an approved recommendation to a schedule draft." }, { status: 403 });
    const { jobId } = await params;
    const organisationId = membership.organisationId;
    const job = await prisma.aIJob.findFirst({
      where: { id: jobId, organisationId, assistantType: "PROGRAMME_DIRECTOR" },
      include: { feedback: true }
    });
    if (!job) return NextResponse.json({ error: "Programme recommendation not found." }, { status: 404 });
    if (job.status !== "APPROVED") return NextResponse.json({ error: "Approve this recommendation before creating a schedule draft." }, { status: 409 });
    if (job.feedback.some((entry) => entry.decision === "APPLIED_TO_DRAFT")) return NextResponse.json({ error: "This recommendation has already been applied to a schedule draft." }, { status: 409 });

    const storedPlan = job.input?.programmePlan;
    if (!storedPlan) return NextResponse.json({ error: "This recommendation has no governed schedule plan. Request a fresh recommendation." }, { status: 409 });
    const parsed = parseProgrammeScheduleInput(programmeDirectorPlanForSchedule(storedPlan));
    if (!parsed.ok) return NextResponse.json({ error: `The stored recommendation is no longer valid: ${parsed.error}` }, { status: 409 });
    const channel = await prisma.channel.findFirst({ where: { id: parsed.data.channelId, organisationId, status: "ACTIVE" }, select: { id: true } });
    if (!channel) return NextResponse.json({ error: "The recommended channel is no longer active." }, { status: 409 });
    const currentSchedule = await prisma.programmeSchedule.findFirst({
      where: { channelId: channel.id, organisationId },
      select: { id: true, versions: { orderBy: { version: "desc" }, take: 1, select: { id: true, version: true } } }
    });
    if (storedPlan.scheduleId && (currentSchedule?.id !== storedPlan.scheduleId || currentSchedule.versions[0]?.id !== storedPlan.baselineVersionId)) {
      return NextResponse.json({ error: "The programme schedule has changed since this recommendation was created. Request a fresh recommendation before applying it." }, { status: 409 });
    }
    if (!storedPlan.scheduleId && currentSchedule) return NextResponse.json({ error: "A programme schedule was created after this recommendation. Request a fresh recommendation before applying it." }, { status: 409 });
    await validateProgrammeScheduleSources(prisma, organisationId, parsed.data.items, { requireReady: true });
    const operationRequestId = getRequestId(request);

    const result = await prisma.$transaction(async (tx) => {
      const feedback = await tx.recommendationFeedback.findFirst({ where: { aiJobId: job.id, decision: "APPLIED_TO_DRAFT" }, select: { id: true } });
      if (feedback) throw new Error("ALREADY_APPLIED");
      let scheduleId;
      let version;
      if (currentSchedule) {
        const latest = await tx.programmeScheduleVersion.findFirst({ where: { scheduleId: currentSchedule.id, organisationId }, orderBy: { version: "desc" }, select: { id: true, version: true } });
        if (latest?.id !== storedPlan.baselineVersionId) throw new Error("STALE_RECOMMENDATION");
        version = (latest?.version || 0) + 1;
        await tx.programmeSchedule.update({ where: { id: currentSchedule.id }, data: { name: parsed.data.name, timezone: parsed.data.timezone } });
        await tx.programmeScheduleVersion.create({ data: { organisationId, scheduleId: currentSchedule.id, version, createdByUserId: user.id, items: { create: parsed.data.items } } });
        scheduleId = currentSchedule.id;
      } else {
        const created = await tx.programmeSchedule.create({
          data: { organisationId, channelId: channel.id, name: parsed.data.name, timezone: parsed.data.timezone, createdByUserId: user.id, versions: { create: { version: 1, createdByUserId: user.id, items: { create: parsed.data.items } } } },
          select: { id: true }
        });
        scheduleId = created.id;
        version = 1;
      }
      await tx.recommendationFeedback.upsert({
        where: { aiJobId_userId: { aiJobId: job.id, userId: user.id } },
        create: { aiJobId: job.id, userId: user.id, decision: "APPLIED_TO_DRAFT", comment: "Applied to a new schedule draft." },
        update: { decision: "APPLIED_TO_DRAFT", createdAt: new Date() }
      });
      await tx.auditLog.create({
        data: { organisationId, actorUserId: user.id, action: "AI_PROGRAMME_PLAN_APPLIED_TO_DRAFT", entityType: "AIJob", entityId: job.id, details: { scheduleId, version, channelId: channel.id, itemCount: parsed.data.items.length, liveScheduleChanged: false, publicationRequiredSeparately: true, requestId: operationRequestId } }
      });
      return { scheduleId, version };
    });
    return NextResponse.json({ ok: true, result, notice: `Schedule draft version ${result.version} created. Live radio has not changed; preview and publish it through Programming when ready.` });
  } catch (error) {
    if (error?.message === "ALREADY_APPLIED") return NextResponse.json({ error: "This recommendation has already been applied to a schedule draft." }, { status: 409 });
    if (error?.message === "STALE_RECOMMENDATION") return NextResponse.json({ error: "The programme schedule changed during this operation. Request a fresh recommendation." }, { status: 409 });
    if (error?.code === "P2002") return NextResponse.json({ error: "The schedule changed at the same time. Reload and request a fresh recommendation." }, { status: 409 });
    if (error instanceof Error && /governed review controls/.test(error.message)) return NextResponse.json({ error: error.message }, { status: 409 });
    console.error("Programme Director apply error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to create the schedule draft." }, { status: 500 });
  }
}
