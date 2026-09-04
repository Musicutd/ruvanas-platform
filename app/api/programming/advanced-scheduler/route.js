import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { contextForAdvancedScheduler } from "@/lib/advanced-scheduler-access";
import { canAuthorProgrammeSchedule, parseProgrammeScheduleInput } from "@/lib/advanced-scheduler.mjs";
import { listProgrammeSchedules, programmeScheduleInclude, programmeSchedulerSources, safeProgrammeSchedule, validateProgrammeScheduleSources } from "@/lib/advanced-scheduler-service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const access = await contextForAdvancedScheduler();
    if (access.response) return access.response;
    const { membership } = access.context;
    const [schedules, sources] = await Promise.all([listProgrammeSchedules(membership.organisationId), programmeSchedulerSources(membership.organisationId)]);
    return NextResponse.json({ ok: true, canAuthor: canAuthorProgrammeSchedule(membership.role), canPublish: ["OWNER", "MANAGER"].includes(membership.role), schedules, sources });
  } catch (error) {
    console.error("Advanced scheduler list error:", error);
    return NextResponse.json({ error: "Unable to load the Advanced Scheduler." }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const access = await contextForAdvancedScheduler();
    if (access.response) return access.response;
    const { user, membership } = access.context;
    if (!canAuthorProgrammeSchedule(membership.role)) return NextResponse.json({ error: "Only owners, managers and content editors can prepare channel schedules." }, { status: 403 });
    const parsed = parseProgrammeScheduleInput(await request.json().catch(() => null));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const organisationId = membership.organisationId;
    const channel = await prisma.channel.findFirst({ where: { id: parsed.data.channelId, organisationId, status: "ACTIVE" }, select: { id: true } });
    if (!channel) return NextResponse.json({ error: "Choose an active channel owned by this organisation." }, { status: 404 });
    await validateProgrammeScheduleSources(prisma, organisationId, parsed.data.items);
    const created = await prisma.$transaction(async (tx) => {
      const schedule = await tx.programmeSchedule.create({
        data: {
          organisationId,
          channelId: channel.id,
          name: parsed.data.name,
          timezone: parsed.data.timezone,
          createdByUserId: user.id,
          versions: { create: { version: 1, createdByUserId: user.id, items: { create: parsed.data.items } } }
        }
      });
      await tx.auditLog.create({ data: { organisationId, actorUserId: user.id, action: "PROGRAMME_SCHEDULE_DRAFT_CREATED", entityType: "ProgrammeSchedule", entityId: schedule.id, details: { channelId: channel.id, version: 1, itemCount: parsed.data.items.length, typedSources: true } } });
      return schedule;
    });
    const schedule = await prisma.programmeSchedule.findUnique({ where: { id: created.id }, include: programmeScheduleInclude });
    return NextResponse.json({ ok: true, schedule: safeProgrammeSchedule(schedule) }, { status: 201 });
  } catch (error) {
    if (error?.code === "P2002") return NextResponse.json({ error: "This channel already has an Advanced Scheduler. Open it to prepare the next version." }, { status: 409 });
    console.error("Advanced scheduler create error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to create the channel schedule." }, { status: 500 });
  }
}
