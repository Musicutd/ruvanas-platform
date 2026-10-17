import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveOrganisationContext, getCurrentUser } from "@/lib/auth";
import { isOrganisationRoleAllowed, ORGANISATION_MANAGER_ROLES } from "@/lib/access-control";
import { isWithinLimit, resolveEntitlements } from "@/lib/entitlements.mjs";
import slugify from "@/lib/slugify";
import { onlineDraftSubscription, lockOnlineDraftOrganisation } from "@/lib/private-preview-online-draft.mjs";

export async function POST(request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const body = await request.json();

  // Only name and description are accepted from clients.
  // Any streaming-related fields sent in the body are ignored on purpose.
  const { name, description } = body;
  const organisationId =
    typeof body.organisationId === "string" ? body.organisationId.trim() : "";

  if (!name) {
    return NextResponse.json({ error: "Station name is required." }, { status: 400 });
  }

  const include = {
    subscription: { include: { plan: true, billingContract: true } },
    stations: true
  };
  const activeContext = organisationId
    ? null
    : await getActiveOrganisationContext(include);
  const membership = organisationId
    ? await prisma.organisationMember.findUnique({
        where: {
          userId_organisationId: { userId: user.id, organisationId }
        },
        include: { organisation: { include } }
      })
    : activeContext?.membership;

  if (!membership) {
    return NextResponse.json(
      { error: "You do not have access to the selected organisation." },
      { status: 403 }
    );
  }

  if (!isOrganisationRoleAllowed(membership.role, ORGANISATION_MANAGER_ROLES)) {
    return NextResponse.json(
      { error: "You do not have permission to create stations for this organisation." },
      { status: 403 }
    );
  }

  const org = membership.organisation;
  const entitlements = resolveEntitlements(org.subscription);
  const sandboxDraftOnly = onlineDraftSubscription(org.subscription);
  if (sandboxDraftOnly && (typeof name !== "string" || name.trim().length < 2 || name.length > 120 ||
    (description !== undefined && (typeof description !== "string" || description.length > 2000)))) {
    return NextResponse.json({ error: "Use a station name of 2–120 characters and a description of at most 2,000 characters." }, { status: 400 });
  }
  const stationCount = org.stations.length;

  if (!entitlements.onlineRadioEnabled) {
    return NextResponse.json(
      { error: "Online Radio is required to create a station." },
      { status: 403 }
    );
  }

  if (!isWithinLimit(stationCount, entitlements.stationLimit)) {
    return NextResponse.json(
      { error: `Your plan allows up to ${entitlements.stationLimit} station${entitlements.stationLimit === 1 ? "" : "s"}.` },
      { status: 403 }
    );
  }

  let station;
  try { station = await prisma.$transaction(async (tx) => {
    if (sandboxDraftOnly) {
      await lockOnlineDraftOrganisation(tx, org.id);
      if (await tx.station.count({ where: { organisationId: org.id } }) >= 1) throw Object.assign(new Error("This test workspace allows one private draft station."), { code: "DRAFT_LIMIT" });
    }
    const stationSlug = slugify(name) + "-" + Math.random().toString(36).slice(2, 7);
    const createdStation = await tx.station.create({
      data: {
        organisationId: org.id,
        productFamily: "ONLINE",
        name,
        description: description || null,
        slug: stationSlug,
        status: "PENDING_SETUP",
        listenerLimit: entitlements.listenerLimit,
        storageLimitGb: entitlements.storageLimitGb,
        maxBitrateKbps: entitlements.maxBitrateKbps,
        channels: { create: { name, slug: `online-${stationSlug}`, status: "DRAFT", musicRightsUse: "ONLINE_RADIO", organisation: { connect: { id: org.id } } } }
      }
    });

    await tx.auditLog.create({
      data: {
        organisationId: org.id,
        actorUserId: user.id,
        action: "STATION_CREATED",
        entityType: "Station",
        entityId: createdStation.id,
        details: {
          name: createdStation.name,
          slug: createdStation.slug,
          channelRegistered: true,
          planCode: entitlements.planCode
        }
      }
    });

    return createdStation;
  }); } catch (error) {
    if (error?.code === "DRAFT_LIMIT") return NextResponse.json({ error: error.message }, { status: 409 });
    throw error;
  }

  return NextResponse.json({ success: true, station });
}


