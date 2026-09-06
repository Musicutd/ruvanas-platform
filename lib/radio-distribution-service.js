import { getActiveOrganisationContext } from "@/lib/auth";
import { resolveEntitlements } from "@/lib/entitlements.mjs";
import { prisma } from "@/lib/prisma";
import { canManageRadioDistribution, redactedRadioDistributionDestination } from "@/lib/radio-distribution.mjs";

export const radioDistributionInclude = {
  station: { select: { id: true, name: true, slug: true, status: true, publicPlayerEnabled: true, stationWebsiteEnabled: true, streamConfig: { select: { streamUrl: true } } } },
  channel: { select: { id: true, name: true, status: true, stationId: true } },
  connection: { select: {
    status: true, endpointUrl: true, lastSuccessfulSyncAt: true, lastErrorAt: true, lastErrorMessage: true,
    events: { orderBy: { createdAt: "desc" }, take: 8, select: { id: true, eventType: true, status: true, attemptCount: true, lastError: true, nextAttemptAt: true, deliveredAt: true, createdAt: true } }
  } }
};

export async function getRadioDistributionContext() {
  const context = await getActiveOrganisationContext({ subscription: { include: { plan: true, billingContract: true } } });
  if (!context) return { ok: false, status: 401, error: "Your session has expired. Please sign in again." };
  if (!context.membership) return { ok: false, status: 403, error: "Choose an organisation before opening station distribution." };
  const organisation = context.membership.organisation;
  if (!resolveEntitlements(organisation.subscription).serviceEnabled) return { ok: false, status: 403, error: "Online Radio access is required to use station distribution." };
  return { ok: true, context, organisation, membership: context.membership, user: context.user };
}

export async function findOwnedRadioDistributionDestination(id, access) {
  return prisma.radioDistributionDestination.findFirst({ where: { id, organisationId: access.organisation.id }, include: radioDistributionInclude });
}

export async function loadRadioDistributionWorkspace(access) {
  const organisationId = access.organisation.id;
  const [stations, destinations] = await Promise.all([
    prisma.station.findMany({ where: { organisationId }, orderBy: { name: "asc" }, select: {
      id: true, name: true, slug: true, status: true, publicPlayerEnabled: true, stationWebsiteEnabled: true,
      streamConfig: { select: { streamUrl: true } },
      channels: { where: { status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, name: true, status: true, stationId: true } }
    } }),
    prisma.radioDistributionDestination.findMany({ where: { organisationId }, orderBy: [{ status: "asc" }, { updatedAt: "desc" }], take: 250, include: radioDistributionInclude })
  ]);
  const safe = destinations.map(redactedRadioDistributionDestination);
  return {
    organisation: { id: access.organisation.id, name: access.organisation.name },
    permissions: { canManage: canManageRadioDistribution(access.membership.role), role: access.membership.role },
    stations,
    destinations: safe,
    summary: {
      total: safe.length,
      active: safe.filter((item) => item.status === "ACTIVE").length,
      attention: safe.filter((item) => item.connection?.status === "DEGRADED" || item.connection?.deliveries?.some((event) => ["FAILED", "ABANDONED"].includes(event.status))).length,
      delivered: safe.reduce((total, item) => total + (item.connection?.deliveries || []).filter((event) => event.status === "DELIVERED").length, 0)
    }
  };
}
