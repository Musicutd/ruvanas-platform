import { NextResponse } from "next/server";
import { getActiveOrganisationContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getInAppNotifications } from "@/lib/job-notification-service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const context = await getActiveOrganisationContext();
    if (!context) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    if (!context.membership) return NextResponse.json({ error: "No active organisation is available." }, { status: 403 });
    return NextResponse.json(await getInAppNotifications(prisma, {
      organisationId: context.membership.organisationId,
      userId: context.user.id
    }));
  } catch (error) {
    console.error("Load in-app notifications error:", error);
    return NextResponse.json({ error: "Unable to load notifications." }, { status: 500 });
  }
}
