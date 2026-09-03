import { NextResponse } from "next/server";
import { getActiveOrganisationContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { bulkUpdateSubscriberNotifications, getSubscriberNotificationCentre } from "@/lib/job-notification-service";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const context = await getActiveOrganisationContext();
    if (!context) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    if (!context.membership) return NextResponse.json({ error: "No active organisation is available." }, { status: 403 });
    const search = new URL(request.url).searchParams;
    return NextResponse.json(await getSubscriberNotificationCentre(prisma, {
      organisationId: context.membership.organisationId,
      userId: context.user.id,
      view: search.get("view"),
      type: search.get("type"),
      take: search.get("take")
    }), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Load in-app notifications error:", error);
    return NextResponse.json({ error: "Unable to load notifications." }, { status: 500 });
  }
}

const bulkSchema = z.object({ action: z.enum(["MARK_ALL_READ", "DISMISS_READ"]) });

export async function PATCH(request) {
  try {
    const context = await getActiveOrganisationContext();
    if (!context) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    if (!context.membership) return NextResponse.json({ error: "No active organisation is available." }, { status: 403 });
    const parsed = bulkSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Choose a supported notification action." }, { status: 400 });
    const result = await bulkUpdateSubscriberNotifications(prisma, {
      organisationId: context.membership.organisationId,
      userId: context.user.id,
      action: parsed.data.action
    });
    return NextResponse.json({ ok: true, ...result }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Bulk update in-app notifications error:", error);
    return NextResponse.json({ error: "Unable to update the notification list." }, { status: 500 });
  }
}
