import { getActiveOrganisationContext } from "@/lib/auth";
import { resolveEntitlements } from "@/lib/entitlements.mjs";
import { prisma } from "@/lib/prisma";
import { canManageStationNetwork, stationNetworkSummary } from "@/lib/station-network.mjs";

export const stationNetworkInclude = {
  ownerOrganisation: { select: { id: true, name: true, slug: true } },
  agreements: {
    include: {
      station: { select: { id: true, name: true, slug: true, status: true } },
      stationOrganisation: { select: { id: true, name: true, slug: true } }
    },
    orderBy: [{ status: "asc" }, { invitedAt: "desc" }]
  }
};

const participatingStationNetworkInclude = {
  ...stationNetworkInclude,
  agreements: {
    ...stationNetworkInclude.agreements,
    where: { status: { in: ["INVITED", "ACTIVE"] } }
  }
};

export async function getStationNetworkContext() {
  const context = await getActiveOrganisationContext({
    subscription: { include: { plan: true, billingContract: true } },
    stations: { select: { id: true, name: true, slug: true, status: true }, orderBy: { name: "asc" } }
  });
  if (!context) return { ok: false, status: 401, error: "Your session has expired. Please sign in again." };
  if (!context.membership) return { ok: false, status: 403, error: "Choose an organisation before opening station networks." };
  const organisation = context.membership.organisation;
  if (!resolveEntitlements(organisation.subscription).serviceEnabled) {
    return { ok: false, status: 403, error: "Online Radio access is required to use station networks." };
  }
  return { ok: true, context, organisation, membership: context.membership, user: context.user };
}

export async function loadStationNetworkWorkspace(access) {
  const organisationId = access.organisation.id;
  const [ownedNetworks, participatingNetworks] = await Promise.all([
    prisma.stationNetwork.findMany({
      where: { ownerOrganisationId: organisationId },
      include: stationNetworkInclude,
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }]
    }),
    prisma.stationNetwork.findMany({
      where: {
        ownerOrganisationId: { not: organisationId },
        agreements: { some: { stationOrganisationId: organisationId, status: { in: ["INVITED", "ACTIVE"] } } }
      },
      include: participatingStationNetworkInclude,
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }]
    })
  ]);
  const networks = [...ownedNetworks, ...participatingNetworks];
  return {
    organisation: { id: organisationId, name: access.organisation.name, role: access.membership.role },
    permissions: { canCreate: access.membership.role === "OWNER" },
    ownStations: access.organisation.stations,
    networks: networks.map((network) => stationNetworkSummary(network, {
      activeOrganisationId: organisationId,
      activeRole: access.membership.role
    }))
  };
}

export async function loadAccessibleStationNetwork(networkId, access) {
  const owned = await prisma.stationNetwork.findFirst({
    where: { id: networkId, ownerOrganisationId: access.organisation.id },
    include: stationNetworkInclude
  });
  if (owned) return owned;
  return prisma.stationNetwork.findFirst({
    where: { id: networkId, agreements: { some: { stationOrganisationId: access.organisation.id, status: { in: ["INVITED", "ACTIVE"] } } } },
    include: participatingStationNetworkInclude
  });
}

export async function requireManagedStationNetwork(networkId, access) {
  if (!canManageStationNetwork(access.membership.role)) return null;
  return prisma.stationNetwork.findFirst({
    where: { id: networkId, ownerOrganisationId: access.organisation.id },
    include: stationNetworkInclude
  });
}
