import { NextResponse } from "next/server";
import { getActiveOrganisationContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canManageSubscriberLocations, createSubscriberLocation, subscriberLocationAllowance } from "@/lib/subscriber-locations.mjs";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const context = await getActiveOrganisationContext({ subscription: { include: { plan: true, billingContract: true } } });
    if (!context) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    if (!context.membership) return NextResponse.json({ error: "No active organisation is available." }, { status: 403 });
    const organisationId = context.membership.organisationId;
    const locations = await prisma.location.findMany({ where: { organisationId, status: { not: "CLOSED" } }, orderBy: [{ name: "asc" }, { id: "asc" }], select: { id: true, name: true, timezone: true, city: true, countryCode: true, status: true, zones: { where: { status: { not: "OFFLINE" } }, orderBy: [{ name: "asc" }, { id: "asc" }], select: { id: true, name: true, status: true } } } });
    const allowance = subscriberLocationAllowance(context.membership.organisation.subscription);
    return NextResponse.json({ ok: true, locations, allowance, canManage: allowance.enabled && canManageSubscriberLocations(context.membership.role) });
  } catch (error) {
    console.error("Subscriber locations list error:", error);
    return NextResponse.json({ error: "Unable to load Locations & Zones." }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const context = await getActiveOrganisationContext();
    if (!context) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    if (!context.membership) return NextResponse.json({ error: "No active organisation is available." }, { status: 403 });
    if (!canManageSubscriberLocations(context.membership.role)) return NextResponse.json({ error: "Only organisation owners and managers can create locations and areas." }, { status: 403 });
    const result = await createSubscriberLocation(prisma, { organisationId: context.membership.organisationId, actorUserId: context.user.id, input: await request.json().catch(() => ({})) });
    return NextResponse.json(result, { status: result.status });
  } catch (error) {
    console.error("Subscriber location creation error:", error);
    return NextResponse.json({ error: "Unable to create the location." }, { status: 500 });
  }
}
