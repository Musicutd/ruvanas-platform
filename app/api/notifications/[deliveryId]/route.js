import { NextResponse } from "next/server";
import { z } from "zod";
import { getActiveOrganisationContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { updateInAppDelivery } from "@/lib/job-notification-service";

const schema = z.object({ action: z.enum(["READ", "DISMISS"]) });

export async function PATCH(request, { params }) {
  try {
    const context = await getActiveOrganisationContext();
    if (!context) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    if (!context.membership) return NextResponse.json({ error: "No active organisation is available." }, { status: 403 });
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Choose a supported notification action." }, { status: 400 });
    const updated = await updateInAppDelivery(prisma, {
      deliveryId: params.deliveryId,
      organisationId: context.membership.organisationId,
      userId: context.user.id,
      action: parsed.data.action
    });
    if (!updated) return NextResponse.json({ error: "Notification not found." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Update in-app notification error:", error);
    return NextResponse.json({ error: "Unable to update the notification." }, { status: 500 });
  }
}
