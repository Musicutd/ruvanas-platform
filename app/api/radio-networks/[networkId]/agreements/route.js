import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { STATION_NETWORK_TERMS_VERSION } from "@/lib/station-network.mjs";
import { getStationNetworkContext, requireManagedStationNetwork } from "@/lib/station-network-service";

export async function POST(request, { params }) {
  const access = await getStationNetworkContext();
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const network = await requireManagedStationNetwork(params.networkId, access);
  if (!network) return NextResponse.json({ error: "Only the network operator's owners and managers may invite stations." }, { status: 403 });
  if (network.status !== "ACTIVE") return NextResponse.json({ error: "Resume this network before inviting a station." }, { status: 409 });

  const body = await request.json();
  const stationSlug = String(body.stationSlug || "").trim().toLowerCase();
  if (!stationSlug) return NextResponse.json({ error: "Enter the exact station slug supplied by its owner." }, { status: 400 });
  const station = await prisma.station.findUnique({
    where: { slug: stationSlug },
    select: { id: true, name: true, slug: true, status: true, organisationId: true }
  });
  if (!station || station.status !== "ACTIVE") {
    return NextResponse.json({ error: "No active station matches that exact slug." }, { status: 404 });
  }

  const existing = await prisma.stationNetworkAgreement.findUnique({
    where: { stationNetworkId_stationId: { stationNetworkId: network.id, stationId: station.id } }
  });
  if (existing && ["ACTIVE", "INVITED"].includes(existing.status)) {
    return NextResponse.json({ error: existing.status === "ACTIVE" ? "That station already belongs to this network." : "That station already has a pending invitation." }, { status: 409 });
  }

  const sameOrganisation = station.organisationId === access.organisation.id;
  const now = new Date();
  const agreement = await prisma.$transaction(async (tx) => {
    const data = {
      stationOrganisationId: station.organisationId,
      status: sameOrganisation ? "ACTIVE" : "INVITED",
      termsVersion: STATION_NETWORK_TERMS_VERSION,
      invitedByUserId: access.user.id,
      invitedAt: now,
      decidedByUserId: sameOrganisation ? access.user.id : null,
      decidedAt: sameOrganisation ? now : null,
      revokedByUserId: null,
      revokedAt: null
    };
    const saved = existing
      ? await tx.stationNetworkAgreement.update({ where: { id: existing.id }, data })
      : await tx.stationNetworkAgreement.create({ data: { stationNetworkId: network.id, stationId: station.id, ...data } });
    await tx.auditLog.create({
      data: {
        organisationId: access.organisation.id,
        stationNetworkId: network.id,
        actorUserId: access.user.id,
        action: sameOrganisation ? "STATION_NETWORK_MEMBERSHIP_ACTIVATED" : "STATION_NETWORK_INVITATION_SENT",
        entityType: "StationNetworkAgreement",
        entityId: saved.id,
        details: { stationId: station.id, stationSlug: station.slug, stationOrganisationId: station.organisationId, termsVersion: STATION_NETWORK_TERMS_VERSION }
      }
    });
    return saved;
  });
  return NextResponse.json({ success: true, agreement, requiresStationOwnerApproval: !sameOrganisation }, { status: existing ? 200 : 201 });
}
