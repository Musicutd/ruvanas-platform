import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canApproveStationNetworkAgreement, canManageStationNetwork, stationNetworkAgreementTransition } from "@/lib/station-network.mjs";
import { getStationNetworkContext } from "@/lib/station-network-service";

export async function PATCH(request, { params }) {
  const access = await getStationNetworkContext();
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const agreement = await prisma.stationNetworkAgreement.findFirst({
    where: { id: params.agreementId, stationNetworkId: params.networkId },
    include: { network: { select: { id: true, ownerOrganisationId: true, status: true } }, station: { select: { id: true, slug: true } } }
  });
  if (!agreement) return NextResponse.json({ error: "Station network membership not found." }, { status: 404 });

  const isNetworkSide = agreement.network.ownerOrganisationId === access.organisation.id;
  const isStationSide = agreement.stationOrganisationId === access.organisation.id;
  if (!isNetworkSide && !isStationSide) return NextResponse.json({ error: "You do not have access to this station membership." }, { status: 403 });
  const body = await request.json();
  const action = String(body.action || "").trim().toUpperCase();
  let actorSide;
  if (isNetworkSide && action === "REVOKE") {
    if (!canManageStationNetwork(access.membership.role)) return NextResponse.json({ error: "A network owner or manager must remove a station." }, { status: 403 });
    actorSide = "NETWORK";
  } else if (isStationSide && ["ACCEPT", "DECLINE", "LEAVE"].includes(action)) {
    if (!canApproveStationNetworkAgreement(access.membership.role)) return NextResponse.json({ error: "The station organisation owner must approve or end network membership." }, { status: 403 });
    actorSide = "STATION";
  } else {
    return NextResponse.json({ error: "That action is not available to this organisation." }, { status: 403 });
  }
  if (action === "ACCEPT" && agreement.network.status !== "ACTIVE") return NextResponse.json({ error: "The network must be active before this invitation can be accepted." }, { status: 409 });

  try {
    const nextStatus = stationNetworkAgreementTransition({ currentStatus: agreement.status, action, actorSide });
    const now = new Date();
    const saved = await prisma.$transaction(async (tx) => {
      const updated = await tx.stationNetworkAgreement.update({
        where: { id: agreement.id },
        data: nextStatus === "ACTIVE"
          ? { status: nextStatus, decidedByUserId: access.user.id, decidedAt: now, revokedByUserId: null, revokedAt: null }
          : nextStatus === "DECLINED"
            ? { status: nextStatus, decidedByUserId: access.user.id, decidedAt: now }
            : { status: nextStatus, revokedByUserId: access.user.id, revokedAt: now }
      });
      await tx.auditLog.create({
        data: {
          organisationId: access.organisation.id,
          stationNetworkId: agreement.network.id,
          actorUserId: access.user.id,
          action: `STATION_NETWORK_MEMBERSHIP_${action}`,
          entityType: "StationNetworkAgreement",
          entityId: agreement.id,
          details: { stationId: agreement.station.id, stationOrganisationId: agreement.stationOrganisationId, fromStatus: agreement.status, toStatus: nextStatus }
        }
      });
      return updated;
    });
    return NextResponse.json({ success: true, agreement: saved });
  } catch (error) {
    return NextResponse.json({ error: error.message || "Unable to update station network membership." }, { status: 409 });
  }
}
