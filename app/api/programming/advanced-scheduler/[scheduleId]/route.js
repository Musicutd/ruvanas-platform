import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { contextForAdvancedScheduler } from "@/lib/advanced-scheduler-access";
import { canAuthorProgrammeSchedule, parseProgrammeScheduleInput } from "@/lib/advanced-scheduler.mjs";
import { programmeScheduleInclude, safeProgrammeSchedule, validateProgrammeScheduleSources } from "@/lib/advanced-scheduler-service";

export async function PUT(request, { params }) {
  try {
    const access = await contextForAdvancedScheduler();
    if (access.response) return access.response;
    const { user, membership } = access.context;
    if (!canAuthorProgrammeSchedule(membership.role)) return NextResponse.json({ error: "Only owners, managers and content editors can prepare schedule versions." }, { status: 403 });
    const parsed = parseProgrammeScheduleInput(await request.json().catch(() => null));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const { scheduleId } = await params;
    const organisationId = membership.organisationId;
    const schedule = await prisma.programmeSchedule.findFirst({ where: { id: scheduleId, organisationId }, select: { id: true, channelId: true } });
    if (!schedule) return NextResponse.json({ error: "Channel schedule not found." }, { status: 404 });
    if (schedule.channelId !== parsed.data.channelId) return NextResponse.json({ error: "A schedule's channel cannot be changed. Create a schedule for the other channel instead." }, { status: 409 });
    await validateProgrammeScheduleSources(prisma, organisationId, parsed.data.items);
    await prisma.$transaction(async (tx) => {
      const latest = await tx.programmeScheduleVersion.findFirst({ where: { scheduleId, organisationId }, orderBy: { version: "desc" }, select: { version: true } });
      const nextVersion = (latest?.version || 0) + 1;
      await tx.programmeSchedule.update({ where: { id: scheduleId }, data: { name: parsed.data.name, timezone: parsed.data.timezone } });
      await tx.programmeScheduleVersion.create({ data: { organisationId, scheduleId, version: nextVersion, createdByUserId: user.id, items: { create: parsed.data.items } } });
      await tx.auditLog.create({ data: { organisationId, actorUserId: user.id, action: "PROGRAMME_SCHEDULE_VERSION_CREATED", entityType: "ProgrammeSchedule", entityId: scheduleId, details: { channelId: schedule.channelId, version: nextVersion, itemCount: parsed.data.items.length } } });
    });
    const updated = await prisma.programmeSchedule.findUnique({ where: { id: scheduleId }, include: programmeScheduleInclude });
    return NextResponse.json({ ok: true, schedule: safeProgrammeSchedule(updated) });
  } catch (error) {
    if (error?.code === "P2002") return NextResponse.json({ error: "This schedule changed at the same time. Reload and try again." }, { status: 409 });
    console.error("Advanced scheduler version error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to create the next schedule version." }, { status: 500 });
  }
}
