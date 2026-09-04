import { NextResponse } from "next/server";
import { contextForAdvancedScheduler } from "@/lib/advanced-scheduler-access";
import { canPublishProgrammeSchedule } from "@/lib/advanced-scheduler.mjs";
import { archiveProgrammeSchedule } from "@/lib/advanced-scheduler-service";

export async function POST(_request, { params }) {
  const access = await contextForAdvancedScheduler();
  if (access.response) return access.response;
  const { user, membership } = access.context;
  if (!canPublishProgrammeSchedule(membership.role)) return NextResponse.json({ error: "Only organisation owners and managers can take a schedule off air." }, { status: 403 });
  const { scheduleId } = await params;
  const result = await archiveProgrammeSchedule({ organisationId: membership.organisationId, scheduleId, actorUserId: user.id });
  if (!result) return NextResponse.json({ error: "Channel schedule not found." }, { status: 404 });
  return NextResponse.json({ ok: true, result });
}
