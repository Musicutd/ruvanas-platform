import { NextResponse } from "next/server";
import { contextForAdvancedScheduler } from "@/lib/advanced-scheduler-access";
import { previewProgrammeSchedule } from "@/lib/advanced-scheduler-service";

export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  try {
    const access = await contextForAdvancedScheduler();
    if (access.response) return access.response;
    const { scheduleId } = await params;
    const url = new URL(request.url);
    const versionId = url.searchParams.get("versionId") || "";
    const days = Number(url.searchParams.get("days") || 7);
    if (!versionId) return NextResponse.json({ error: "Choose a schedule version to preview." }, { status: 400 });
    const preview = await previewProgrammeSchedule({ organisationId: access.context.membership.organisationId, scheduleId, versionId, days });
    if (!preview) return NextResponse.json({ error: "Schedule version not found." }, { status: 404 });
    return NextResponse.json({ ok: true, preview });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to compile the schedule preview." }, { status: 400 });
  }
}
