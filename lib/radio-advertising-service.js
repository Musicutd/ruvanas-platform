import { getActiveOrganisationContext } from "@/lib/auth";
import { resolveEntitlements } from "@/lib/entitlements.mjs";
import { prisma } from "@/lib/prisma";
import {
  canManageRadioAdvertising,
  estimateRadioAdvertisingPlays,
  radioAdvertisingBookingReadiness
} from "@/lib/radio-advertising.mjs";

const campaignInclude = {
  targets: true,
  schedules: true,
  promoVersion: { select: { id: true, version: true, promoAsset: { select: { id: true, name: true } } } }
};

function campaignEndpoints(campaign, stations) {
  const endpoints = new Map();
  for (const target of campaign?.targets || []) {
    if (target.targetType === "STATION") {
      const station = stations.find((item) => item.id === target.stationId);
      for (const channel of station?.channels || []) endpoints.set(channel.id, { stationId: station.id, channelId: channel.id });
    }
    if (target.targetType === "CHANNEL") {
      const station = stations.find((item) => item.channels.some((channel) => channel.id === target.channelId));
      if (station) endpoints.set(target.channelId, { stationId: station.id, channelId: target.channelId });
    }
  }
  return [...endpoints.values()];
}

export async function getRadioAdvertisingContext() {
  const context = await getActiveOrganisationContext({ subscription: { include: { plan: true, billingContract: true } } });
  if (!context) return { ok: false, status: 401, error: "Your session has expired. Please sign in again." };
  if (!context.membership) return { ok: false, status: 403, error: "Choose an organisation before opening radio advertising." };
  const organisation = context.membership.organisation;
  const entitlements = resolveEntitlements(organisation.subscription);
  if (!entitlements.serviceEnabled) return { ok: false, status: 403, error: "Online Radio access is required to use radio advertising." };
  if (!entitlements.retailMediaEnabled) return { ok: false, status: 403, error: "Retail Media must be enabled before commercial radio inventory can be used." };
  return { ok: true, context, organisation, membership: context.membership, user: context.user };
}

export async function loadRadioAdvertisingWorkspace(access) {
  const organisationId = access.organisation.id;
  const [stations, policies, campaigns, inventory, orders, proof] = await Promise.all([
    prisma.station.findMany({
      where: { organisationId, status: "ACTIVE" },
      select: { id: true, name: true, channels: { where: { status: "ACTIVE" }, select: { id: true, name: true }, orderBy: { name: "asc" } } },
      orderBy: { name: "asc" }
    }),
    prisma.radioAdvertisingPolicy.findMany({
      where: { organisationId },
      include: { station: { select: { id: true, name: true } }, channel: { select: { id: true, name: true } }, approvedBy: { select: { name: true, email: true } } },
      orderBy: [{ station: { name: "asc" } }, { channel: { name: "asc" } }]
    }),
    prisma.campaign.findMany({
      where: { organisationId, status: { not: "ARCHIVED" }, targets: { some: { targetType: { in: ["STATION", "CHANNEL"] } } } },
      include: campaignInclude,
      orderBy: { updatedAt: "desc" },
      take: 250
    }),
    prisma.retailMediaInventoryPackage.findMany({
      where: { organisationId, status: { not: "ARCHIVED" }, targets: { some: { targetType: { in: ["STATION", "CHANNEL"] } } } },
      include: { targets: true, dayparts: true, _count: { select: { orders: true } } },
      orderBy: { updatedAt: "desc" },
      take: 250
    }),
    prisma.retailMediaOrder.findMany({
      where: { organisationId, campaign: { targets: { some: { targetType: { in: ["STATION", "CHANNEL"] } } } } },
      include: { advertiser: { select: { id: true, name: true } }, inventoryPackage: { include: { targets: true, dayparts: true } }, campaign: { include: campaignInclude }, creatives: true },
      orderBy: { updatedAt: "desc" },
      take: 250
    }),
    prisma.proofOfPlayEvent.groupBy({
      by: ["campaignId"],
      where: { organisationId, campaignId: { not: null }, eventType: "COMPLETED", channelId: { not: null }, campaign: { targets: { some: { targetType: { in: ["STATION", "CHANNEL"] } } } } },
      _count: { _all: true }
    })
  ]);

  const proofByCampaign = new Map(proof.map((item) => [item.campaignId, item._count._all]));
  const committedByInventory = new Map();
  for (const order of orders) {
    if (!new Set(["APPROVED", "FULFILLED"]).has(order.status) || !order.campaign) continue;
    const endpointCount = campaignEndpoints(order.campaign, stations).length;
    committedByInventory.set(order.inventoryPackageId, (committedByInventory.get(order.inventoryPackageId) || 0) + estimateRadioAdvertisingPlays(order.campaign) * endpointCount);
  }
  const placements = orders.map((order) => {
    const endpoints = campaignEndpoints(order.campaign, stations);
    const stationId = endpoints[0]?.stationId || null;
    const channelId = endpoints[0]?.channelId || null;
    const placementPolicies = policies.filter((item) => endpoints.some((endpoint) => endpoint.channelId === item.channelId));
    const estimatedPlays = estimateRadioAdvertisingPlays(order.campaign) * endpoints.length;
    const committed = Math.max(0, (committedByInventory.get(order.inventoryPackageId) || 0) - (new Set(["APPROVED", "FULFILLED"]).has(order.status) ? estimatedPlays : 0));
    return {
      id: order.id,
      name: order.name,
      status: order.status,
      advertiser: order.advertiser,
      inventoryPackage: { id: order.inventoryPackage.id, name: order.inventoryPackage.name, maxPlays: order.inventoryPackage.maxPlays },
      campaign: order.campaign ? { id: order.campaign.id, name: order.campaign.name, status: order.campaign.status } : null,
      stationId,
      channelId,
      channelCount: endpoints.length,
      deliveredPlays: proofByCampaign.get(order.campaignId) || 0,
      readiness: radioAdvertisingBookingReadiness({ order, stationId, channelId, endpoints, policies: placementPolicies, committedPlays: committed, estimatedPlays })
    };
  });

  return {
    organisation: { id: organisationId, name: access.organisation.name, role: access.membership.role },
    permissions: { canManage: canManageRadioAdvertising(access.membership.role) },
    stations,
    policies,
    campaigns: campaigns.map((campaign) => ({
      id: campaign.id, name: campaign.name, status: campaign.status, priority: campaign.priority,
      effectiveFrom: campaign.effectiveFrom, effectiveTo: campaign.effectiveTo,
      promo: campaign.promoVersion.promoAsset.name, estimatedPlays: estimateRadioAdvertisingPlays(campaign)
    })),
    inventory: inventory.map((item) => ({ id: item.id, name: item.name, status: item.status, maxPlays: item.maxPlays, orderCount: item._count.orders })),
    placements,
    summary: {
      activePolicies: policies.filter((item) => item.status === "ACTIVE").length,
      publishedCampaigns: campaigns.filter((item) => item.status === "PUBLISHED").length,
      readyPlacements: placements.filter((item) => item.readiness.ready).length,
      completedPlays: [...proofByCampaign.values()].reduce((total, value) => total + value, 0)
    },
    evidenceNotice: "Placement totals use device-confirmed completed plays. Public audience analytics remain separate and do not prove reach, response or commercial outcome."
  };
}
