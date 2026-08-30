import { NextResponse } from "next/server";
import { z } from "zod";
import { getActiveOrganisationContext } from "@/lib/auth";
import { NOTIFICATION_TYPES } from "@/lib/job-notification.mjs";
import { setNotificationPreference } from "@/lib/job-notification-service";
import { isNotificationEmailConfigured } from "@/lib/notification-email-service";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  type: z.enum(NOTIFICATION_TYPES),
  channel: z.enum(["IN_APP", "EMAIL"]).default("IN_APP"),
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
        channel: { in: ["IN_APP", "EMAIL"] }
      },
      select: { type: true, channel: true, enabled: true }
    });
    const saved = new Map(preferences.map((preference) => [`${preference.channel}:${preference.type}`, preference.enabled]));
    const emailConfigured = isNotificationEmailConfigured();
    return NextResponse.json({
      emailConfigured,
      preferences: [
        ...NOTIFICATION_TYPES.map((type) => ({ type, channel: "IN_APP", enabled: saved.get(`IN_APP:${type}`) !== false })),
        ...NOTIFICATION_TYPES.map((type) => ({ type, channel: "EMAIL", enabled: saved.get(`EMAIL:${type}`) === true }))
      ],
      webhookManagedInIntegrations: true
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
    if (parsed.data.channel === "EMAIL" && parsed.data.enabled && !isNotificationEmailConfigured()) {
      return NextResponse.json({ error: "Email notifications are not available until the provider is configured." }, { status: 409 });
    }
    const preference = await setNotificationPreference(prisma, {
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
