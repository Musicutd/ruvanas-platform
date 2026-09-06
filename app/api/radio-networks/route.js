import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import slugify from "@/lib/slugify";
import { normalizeStationNetworkInput } from "@/lib/station-network.mjs";
import { getStationNetworkContext, loadStationNetworkWorkspace } from "@/lib/station-network-service";

function failure(access) {
  return NextResponse.json({ error: access.error }, { status: access.status });
}

export async function GET() {
  const access = await getStationNetworkContext();
  if (!access.ok) return failure(access);
  return NextResponse.json(await loadStationNetworkWorkspace(access));
}

export async function POST(request) {
  const access = await getStationNetworkContext();
  if (!access.ok) return failure(access);
  if (access.membership.role !== "OWNER") {
    return NextResponse.json({ error: "An organisation owner must create the network agreement boundary." }, { status: 403 });
  }

  try {
    const input = normalizeStationNetworkInput(await request.json());
    const network = await prisma.$transaction(async (tx) => {
      const created = await tx.stationNetwork.create({
        data: {
          ownerOrganisationId: access.organisation.id,
          name: input.name,
          description: input.description,
          slug: `${slugify(input.name)}-${Math.random().toString(36).slice(2, 7)}`,
          createdByUserId: access.user.id
        }
      });
      await tx.auditLog.create({
        data: {
          organisationId: access.organisation.id,
          stationNetworkId: created.id,
          actorUserId: access.user.id,
          action: "STATION_NETWORK_CREATED",
          entityType: "StationNetwork",
          entityId: created.id,
          details: { name: created.name, agreementBoundary: "explicit-station-membership" }
        }
      });
      return created;
    });
    return NextResponse.json({ success: true, network }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error.message || "Unable to create the station network." }, { status: 400 });
  }
}
