import { prisma } from "@/lib/prisma";
import { expandCampaignTargets } from "@/lib/campaign-scheduling.mjs";
import { loadCampaignTopology, persistedTargetToInput } from "@/lib/campaign-service";
import { crossMediaReadiness } from "@/lib/retail-media-cross-media.mjs";

function inventoryTargetToInput(target) {
  return {
    targetType: target.targetType,
    targetId: target.brandId || target.locationGroupId || target.zoneId
  };
}

export async function loadCrossMediaOrder(orderId) {
  return prisma.retailMediaOrder.findUnique({
    where: { id: orderId },
    include: {
      inventoryPackage: { include: { targets: true, dayparts: true } },
      campaign: { include: { targets: true, schedules: true } },
      creatives: true,
      visualCreatives: true,
      visualPlaylists: {
        include: {
          items: { select: { assetId: true } },
          devices: { select: { device: { select: { zoneId: true } } } }
        },
        orderBy: { createdAt: "asc" }
      },
      fulfilledBy: { select: { id: true, name: true, email: true } }
    }
  });
}

export async function prepareCrossMediaReadiness(order) {
  const topology = await loadCampaignTopology(order.organisationId);
  const inventoryZoneIds = expandCampaignTargets({
    ...topology,
    targets: order.inventoryPackage.targets.map(inventoryTargetToInput)
  }).map((zone) => zone.id);
  const campaignZoneIds = order.campaign ? expandCampaignTargets({
    ...topology,
    targets: order.campaign.targets.map(persistedTargetToInput)
  }).map((zone) => zone.id) : [];

  return crossMediaReadiness({
    orderId: order.id,
    orderStatus: order.status,
    inventory: {
      id: order.inventoryPackage.id,
      status: order.inventoryPackage.status,
      effectiveFrom: order.inventoryPackage.effectiveFrom,
      effectiveTo: order.inventoryPackage.effectiveTo,
      targetZoneIds: inventoryZoneIds,
      dayparts: order.inventoryPackage.dayparts
    },
    audio: {
      required: order.creatives.length > 0,
      approvedPromoVersionIds: order.creatives.filter((creative) => creative.status === "APPROVED").map((creative) => creative.promoVersionId),
      campaign: order.campaign ? {
        id: order.campaign.id,
        status: order.campaign.status,
        promoVersionId: order.campaign.promoVersionId,
        effectiveFrom: order.campaign.effectiveFrom,
        effectiveTo: order.campaign.effectiveTo,
        targetZoneIds: campaignZoneIds,
        schedules: order.campaign.schedules
      } : null
    },
    visual: {
      required: order.visualCreatives.length > 0,
      approvedAssetIds: order.visualCreatives.filter((creative) => creative.status === "APPROVED").map((creative) => creative.signageAssetId),
      playlists: order.visualPlaylists.map((playlist) => ({
        id: playlist.id,
        name: playlist.name,
        status: playlist.status,
        version: playlist.version,
        startsAt: playlist.startsAt,
        endsAt: playlist.endsAt,
        activeDays: playlist.activeDays,
        dailyStartMinute: playlist.dailyStartMinute,
        dailyEndMinute: playlist.dailyEndMinute,
        assetIds: playlist.items.map((item) => item.assetId),
        deviceZoneIds: playlist.devices.map(({ device }) => device.zoneId)
      }))
    }
  });
}
