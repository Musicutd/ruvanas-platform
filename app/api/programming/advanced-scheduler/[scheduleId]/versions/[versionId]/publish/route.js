import { NextResponse } from "next/server";
import { contextForAdvancedScheduler } from "@/lib/advanced-scheduler-access";
import { canPublishProgrammeSchedule } from "@/lib/advanced-scheduler.mjs";
import { publishProgrammeScheduleVersion } from "@/lib/advanced-scheduler-service";

export async function POST(request, { params }) {
  try {
    const access = await contextForAdvancedScheduler();
    if (access.response) return access.response;
    const { user, membership } = access.context;
    if (!canPublishProgrammeSchedule(membership.role)) return NextResponse.json({ error: "Only organisation owners and managers can publish a channel schedule." }, { status: 403 });
    const { scheduleId, versionId } = await params;
    const body = await request.json().catch(() => ({}));
    const version = await publishProgrammeScheduleVersion({ organisationId: membership.organisationId, scheduleId, versionId, actorUserId: user.id, conflictsAcknowledged: body?.conflictsAcknowledged === true });
    if (!version) return NextResponse.json({ error: "Draft schedule version not found." }, { status: 404 });
    return NextResponse.json({ ok: true, version });
  } catch (error) {
    if (error?.code === "P2002") return NextResponse.json({ error: "Another version became active at the same time. Reload before retrying." }, { status: 409 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to publish the channel schedule." }, { status: 409 });
  }
}
