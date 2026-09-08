import { NextResponse } from "next/server";
import { getActiveOrganisationContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { addSubscriberZone, canManageSubscriberLocations } from "@/lib/subscriber-locations.mjs";

export async function POST(request, { params }) {
  try {
    const context = await getActiveOrganisationContext();
    if (!context) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    if (!context.membership || !canManageSubscriberLocations(context.membership.role)) return NextResponse.json({ error: "Only organisation owners and managers can add areas." }, { status: 403 });
    const result = await addSubscriberZone(prisma, { organisationId: context.membership.organisationId, locationId: params.locationId, actorUserId: context.user.id, input: await request.json().catch(() => ({})) });
    return NextResponse.json(result, { status: result.status });
  } catch (error) {
    console.error("Subscriber zone creation error:", error);
    return NextResponse.json({ error: "Unable to create the area / zone." }, { status: 500 });
  }
}
