import { NextResponse } from "next/server";
import { contextForRadioClocks } from "@/lib/radio-clock-access";
import { canAuthorRadioClock, canPublishRadioClock } from "@/lib/radio-clocks.mjs";
import { changeVoiceTrackSegueStatus, createVoiceTrackSegue, updateVoiceTrackSegue, voiceTrackSegueCatalogue } from "@/lib/voice-tracking-segue-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const access = await contextForRadioClocks();
    if (access.response) return access.response;
    const { membership } = access.context;
    const catalogue = await voiceTrackSegueCatalogue(membership.organisationId);
    return NextResponse.json({ ok: true, canAuthor: canAuthorRadioClock(membership.role), canApprove: canPublishRadioClock(membership.role), ...catalogue });
  } catch (error) {
    console.error("Voice tracking list error:", error);
    return NextResponse.json({ error: "Unable to load Voice Tracking." }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const access = await contextForRadioClocks();
    if (access.response) return access.response;
    const { user, membership } = access.context;
    if (!canAuthorRadioClock(membership.role)) return NextResponse.json({ error: "Only owners, managers and content editors can build voice tracks." }, { status: 403 });
    const input = await request.json().catch(() => null);
    const segue = await createVoiceTrackSegue({ organisationId: membership.organisationId, actorUserId: user.id, input });
    return NextResponse.json({ ok: true, segue }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to create the voice track." }, { status: 400 });
  }
}

export async function PATCH(request) {
  try {
    const access = await contextForRadioClocks();
    if (access.response) return access.response;
    const { user, membership } = access.context;
    const body = await request.json().catch(() => ({}));
    const action = String(body.action || "SAVE").toUpperCase();
    const segueId = String(body.segueId || "").trim();
    const expectedVersion = Number(body.expectedVersion);
    if (!segueId || !Number.isInteger(expectedVersion) || expectedVersion < 1) return NextResponse.json({ error: "The voice-track request is invalid." }, { status: 400 });
    if (action === "SAVE") {
      if (!canAuthorRadioClock(membership.role)) return NextResponse.json({ error: "Only owners, managers and content editors can edit voice tracks." }, { status: 403 });
      const segue = await updateVoiceTrackSegue({ organisationId: membership.organisationId, segueId, actorUserId: user.id, input: body, expectedVersion });
      if (!segue) return NextResponse.json({ error: "The draft voice track was not found." }, { status: 404 });
      return NextResponse.json({ ok: true, segue });
    }
    if (!["APPROVE", "ARCHIVE"].includes(action)) return NextResponse.json({ error: "Choose save, approve or archive." }, { status: 400 });
    if (!canPublishRadioClock(membership.role)) return NextResponse.json({ error: "Only organisation owners and managers can approve or archive voice tracks." }, { status: 403 });
    const segue = await changeVoiceTrackSegueStatus({ organisationId: membership.organisationId, segueId, actorUserId: user.id, action, expectedVersion, previewAcknowledged: body.previewAcknowledged === true });
    if (!segue) return NextResponse.json({ error: "The voice track was not found." }, { status: 404 });
    return NextResponse.json({ ok: true, segue });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The voice-track action failed." }, { status: 409 });
  }
}
