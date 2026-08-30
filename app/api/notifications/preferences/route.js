import { NextResponse } from "next/server";
import { z } from "zod";
import { getActiveOrganisationContext } from "@/lib/auth";
import { NOTIFICATION_TYPES } from "@/lib/job-notification.mjs";
import { setInAppPreference } from "@/lib/job-notification-service";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  type: z.enum(NOTIFICATION_TYPES),
  enabled: z.boolean()
});

async function contextOrResponse() {
  const context = await getActiveOrganisationContext();
  if (!context) return { response: NextResponse.json({ error: "Not authenticated." }, { status: 401 }) };
  if (!context.membership) return { response: NextResponse.json({ error: "No active organisation is available." }, { status: 403 }) };
  return { context };
}

export async function GET() {
  try {
    const access = await contextOrResponse();
    if (access.response) return access.response;
    const preferences = await prisma.notificationPreference.findMany({
      where: {
        organisationId: access.context.membership.organisationId,
        userId: access.context.user.id,
        channel: "IN_APP"
      },
      select: { type: true, enabled: true }
    });
    const saved = new Map(preferences.map((preference) => [preference.type, preference.enabled]));
    return NextResponse.json({
      channel: "IN_APP",
      preferences: NOTIFICATION_TYPES.map((type) => ({ type, enabled: saved.get(type) !== false })),
      futureChannels: ["EMAIL", "WEBHOOK"]
    });
  } catch (error) {
    console.error("Load notification preferences error:", error);
    return NextResponse.json({ error: "Unable to load notification preferences." }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const access = await contextOrResponse();
    if (access.response) return access.response;
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Choose a supported notification preference." }, { status: 400 });
    const preference = await setInAppPreference(prisma, {
      organisationId: access.context.membership.organisationId,
      userId: access.context.user.id,
      ...parsed.data
    });
    return NextResponse.json({ ok: true, preference: { type: preference.type, channel: preference.channel, enabled: preference.enabled } });
  } catch (error) {
    console.error("Update notification preference error:", error);
    return NextResponse.json({ error: "Unable to update the notification preference." }, { status: 500 });
  }
}
