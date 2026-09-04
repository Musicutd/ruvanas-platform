import { NextResponse } from "next/server";
import { contextForRadioClocks } from "@/lib/radio-clock-access";
import { previewRadioClock } from "@/lib/radio-clock-service";

export const dynamic = "force-dynamic";

export async function GET(_request, { params }) {
  try {
    const access = await contextForRadioClocks();
    if (access.response) return access.response;
    const { radioClockId } = await params;
    const clock = await previewRadioClock({ organisationId: access.context.membership.organisationId, radioClockId });
    if (!clock) return NextResponse.json({ error: "Radio Clock not found." }, { status: 404 });
    return NextResponse.json({ ok: true, generatedAt: new Date().toISOString(), clock });
  } catch (error) {
    console.error("Radio clock preview error:", error);
    return NextResponse.json({ error: "Unable to preview the Radio Clock." }, { status: 500 });
  }
}
