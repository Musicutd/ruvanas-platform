import { NextResponse } from "next/server";
import { getActiveOrganisationContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canManageSubscriberLocations, renameSubscriberLocation } from "@/lib/subscriber-locations.mjs";
import { subscriberWorkflowRequestAllowed } from "@/lib/private-preview-subscriber-testing.mjs";

export async function PATCH(request, { params }) {
  try {
    const context = await getActiveOrganisationContext();
    if (!context) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    if (!context.membership || !canManageSubscriberLocations(context.membership.role)) return NextResponse.json({ error: "Only organisation owners and managers can rename locations." }, { status: 403 });
    const { locationId } = await params;
    if (!subscriberWorkflowRequestAllowed(context, { pathname: `/api/locations/${locationId}`, method: "PATCH" })) return NextResponse.json({ error: "Shop setup is unavailable for this session. Ask your administrator to check tester access." }, { status: 403 });
    const body = await request.json().catch(() => ({}));
    const result = await renameSubscriberLocation(prisma, { organisationId: context.membership.organisationId, locationId, actorUserId: context.user.id, name: body.name });
    return NextResponse.json(result, { status: result.status });
  } catch (error) {
    console.error("Subscriber location rename error:", error);
    return NextResponse.json({ error: "Unable to rename the location." }, { status: 500 });
  }
}
