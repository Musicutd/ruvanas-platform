import { NextResponse } from "next/server";
import { contextForRadioClocks } from "@/lib/radio-clock-access";
import { canPublishRadioClock } from "@/lib/radio-clocks.mjs";
import { publishRadioClock } from "@/lib/radio-clock-service";

export const dynamic = "force-dynamic";

export async function POST(_request, { params }) {
  try {
    const access = await contextForRadioClocks();
    if (access.response) return access.response;
    const { user, membership } = access.context;
    if (!canPublishRadioClock(membership.role)) return NextResponse.json({ error: "Only an owner or manager can publish a Radio Clock." }, { status: 403 });
    const { radioClockId } = await params;
    const clock = await publishRadioClock({ organisationId: membership.organisationId, radioClockId, actorUserId: user.id });
    if (!clock) return NextResponse.json({ error: "Radio Clock not found." }, { status: 404 });
    return NextResponse.json({ ok: true, clock });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to publish the Radio Clock." }, { status: 409 });
  }
}
