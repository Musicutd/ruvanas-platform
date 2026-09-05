import { NextResponse } from "next/server";
import { contextForRadioClocks } from "@/lib/radio-clock-access";
import { canAuthorRadioClock, canPublishRadioClock } from "@/lib/radio-clocks.mjs";
import { BROADCAST_PROCESSING_TEMPLATES } from "@/lib/broadcast-audio-processing.mjs";
import { broadcastProcessingWorkspace, changeBroadcastProcessingProfileStatus, createBroadcastProcessingProfile, queueBroadcastProcessing, updateBroadcastProcessingProfile } from "@/lib/broadcast-audio-processing-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const access = await contextForRadioClocks();
    if (access.response) return access.response;
    const { membership } = access.context;
    const workspace = await broadcastProcessingWorkspace(membership.organisationId);
    return NextResponse.json({
      ok: true,
      canProcess: canAuthorRadioClock(membership.role),
      canManageProfiles: canPublishRadioClock(membership.role),
      templates: BROADCAST_PROCESSING_TEMPLATES,
      ...workspace
    });
  } catch (error) {
    console.error("Broadcast processing workspace error:", error);
    return NextResponse.json({ error: "Unable to load broadcast audio processing." }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const access = await contextForRadioClocks();
    if (access.response) return access.response;
    const { user, membership } = access.context;
    const body = await request.json().catch(() => ({}));
    const action = String(body.action || "").toUpperCase();
    if (action === "CREATE_PROFILE") {
      if (!canPublishRadioClock(membership.role)) return NextResponse.json({ error: "Only organisation owners and managers can create processing profiles." }, { status: 403 });
      const profile = await createBroadcastProcessingProfile({ organisationId: membership.organisationId, actorUserId: user.id, input: body.profile });
      return NextResponse.json({ ok: true, profile }, { status: 201 });
    }
    if (action === "QUEUE_PROCESSING") {
      if (!canAuthorRadioClock(membership.role)) return NextResponse.json({ error: "Only owners, managers and content editors can request broadcast processing." }, { status: 403 });
      const result = await queueBroadcastProcessing({ organisationId: membership.organisationId, actorUserId: user.id, profileId: String(body.profileId || ""), sourceRenderId: String(body.sourceRenderId || "") });
      return NextResponse.json({ ok: true, ...result }, { status: result.created ? 202 : 200 });
    }
    return NextResponse.json({ error: "Choose profile creation or broadcast processing." }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The broadcast processing request failed." }, { status: 409 });
  }
}

export async function PATCH(request) {
  try {
    const access = await contextForRadioClocks();
    if (access.response) return access.response;
    const { user, membership } = access.context;
    if (!canPublishRadioClock(membership.role)) return NextResponse.json({ error: "Only organisation owners and managers can change processing profiles." }, { status: 403 });
    const body = await request.json().catch(() => ({}));
    const action = String(body.action || "").toUpperCase();
    const profileId = String(body.profileId || "").trim();
    const expectedVersion = Number(body.expectedVersion);
    if (!profileId || !Number.isInteger(expectedVersion) || expectedVersion < 1) return NextResponse.json({ error: "The processing-profile request is invalid." }, { status: 400 });
    if (action === "UPDATE_PROFILE") {
      const profile = await updateBroadcastProcessingProfile({ organisationId: membership.organisationId, profileId, expectedVersion, actorUserId: user.id, input: body.profile });
      return NextResponse.json({ ok: true, profile });
    }
    if (!["ACTIVATE", "ARCHIVE"].includes(action)) return NextResponse.json({ error: "Choose update, activate or archive." }, { status: 400 });
    const profile = await changeBroadcastProcessingProfileStatus({ organisationId: membership.organisationId, profileId, expectedVersion, actorUserId: user.id, action });
    if (!profile) return NextResponse.json({ error: "The processing profile was not found." }, { status: 404 });
    return NextResponse.json({ ok: true, profile });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The processing-profile action failed." }, { status: 409 });
  }
}
