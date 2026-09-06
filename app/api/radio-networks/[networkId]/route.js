import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeStationNetworkInput, normalizeStationNetworkStatus, stationNetworkSummary } from "@/lib/station-network.mjs";
import { getStationNetworkContext, loadAccessibleStationNetwork, requireManagedStationNetwork, stationNetworkInclude } from "@/lib/station-network-service";

export async function GET(_request, { params }) {
  const access = await getStationNetworkContext();
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const network = await loadAccessibleStationNetwork(params.networkId, access);
  if (!network) return NextResponse.json({ error: "Station network not found." }, { status: 404 });
  return NextResponse.json({ network: stationNetworkSummary(network, { activeOrganisationId: access.organisation.id, activeRole: access.membership.role }) });
}

export async function PATCH(request, { params }) {
  const access = await getStationNetworkContext();
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const network = await requireManagedStationNetwork(params.networkId, access);
  if (!network) return NextResponse.json({ error: "Only the network operator's owners and managers may change this network." }, { status: 403 });
  if (network.status === "ARCHIVED") return NextResponse.json({ error: "Archived station networks are read-only." }, { status: 409 });
  try {
    const body = await request.json();
    const input = normalizeStationNetworkInput({ name: body.name ?? network.name, description: Object.hasOwn(body, "description") ? body.description : network.description });
    const status = body.status ? normalizeStationNetworkStatus(body.status) : network.status;
    if (status === "ARCHIVED" && access.membership.role !== "OWNER") {
      return NextResponse.json({ error: "An organisation owner must archive a station network." }, { status: 403 });
    }
    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.stationNetwork.update({ where: { id: network.id }, data: { ...input, status }, include: stationNetworkInclude });
      await tx.auditLog.create({ data: { organisationId: access.organisation.id, stationNetworkId: network.id, actorUserId: access.user.id, action: "STATION_NETWORK_UPDATED", entityType: "StationNetwork", entityId: network.id, details: { status, name: input.name } } });
      return saved;
    });
    return NextResponse.json({ success: true, network: stationNetworkSummary(updated, { activeOrganisationId: access.organisation.id, activeRole: access.membership.role }) });
  } catch (error) {
    return NextResponse.json({ error: error.message || "Unable to update the station network." }, { status: 400 });
  }
}
