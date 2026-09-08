import { NextResponse } from "next/server";
import { getActiveOrganisationContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canManageSubscriberLocations, renameSubscriberZone } from "@/lib/subscriber-locations.mjs";

export async function PATCH(request, { params }) {
  try {
    const context = await getActiveOrganisationContext();
    if (!context) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    if (!context.membership || !canManageSubscriberLocations(context.membership.role)) return NextResponse.json({ error: "Only organisation owners and managers can rename areas." }, { status: 403 });
    const body = await request.json().catch(() => ({}));
    const result = await renameSubscriberZone(prisma, { organisationId: context.membership.organisationId, locationId: params.locationId, zoneId: params.zoneId, actorUserId: context.user.id, name: body.name });
    return NextResponse.json(result, { status: result.status });
  } catch (error) {
    console.error("Subscriber zone rename error:", error);
    return NextResponse.json({ error: "Unable to rename the area / zone." }, { status: 500 });
  }
}
