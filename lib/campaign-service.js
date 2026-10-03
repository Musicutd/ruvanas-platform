import { prisma } from "@/lib/prisma";
import {
  expandCampaignTargets,
  previewCampaign
} from "@/lib/campaign-scheduling.mjs";
import {
  GENERAL_STUDIO_CHANNEL_WHERE,
  GENERAL_STUDIO_STATION_WHERE
} from "@/lib/studio-general-output-boundary.mjs";

export function persistedTargetToInput(target) {
  return {
    targetType: target.targetType,
    targetId:
      target.brandId ||
      target.locationGroupId ||
      target.locationId ||
      target.zoneId ||
      target.stationId ||
      target.channelId ||
      null
  };
}

export function persistedCampaignToInput(campaign) {
  return {
    organisationId: campaign.organisationId,
    promoVersionId: campaign.promoVersionId,
    name: campaign.name,
    priority: campaign.priority,
    schedulingMode: campaign.schedulingMode,
    mandatory: campaign.mandatory,
    respectOpeningHours: campaign.respectOpeningHours,
    effectiveFrom: campaign.effectiveFrom.toISOString().slice(0, 10),
    effectiveTo: campaign.effectiveTo.toISOString().slice(0, 10),
    maxPromoMinutesPerHour: campaign.maxPromoMinutesPerHour,
    minSamePromoGapMinutes: campaign.minSamePromoGapMinutes,
    minAnyPromoGapMinutes: campaign.minAnyPromoGapMinutes,
    exactTimeHardStart: campaign.rule?.exactTimeHardStart || false,
    playsPerHour: campaign.rule?.playsPerHour || null,
    intervalMinutes: campaign.rule?.intervalMinutes || null,
    targets: campaign.targets.map(persistedTargetToInput),
    schedules: campaign.schedules.map((schedule) => ({
      weekday: schedule.weekday,
      windowMode: schedule.windowMode,
      startMinute: schedule.startMinute,
      endMinute: schedule.endMinute,
      exactMinute: schedule.exactMinute,
      playsPerHour: schedule.playsPerHour,
      intervalMinutes: schedule.intervalMinutes
    }))
  };
}

export function visibleCampaignTargets(targets, topology) {
  const collections = {
    BRAND: topology.brands,
    LOCATION_GROUP: topology.groups,
    LOCATION: topology.locations,
    ZONE: topology.zones,
    STATION: topology.stations,
    CHANNEL: topology.channels
  };
  const visibleIds = Object.fromEntries(Object.entries(collections).map(([type, items]) =>
    [type, new Set(items.map((item) => item.id))]
  ));
  return targets.filter((target) => {
    const input = Object.hasOwn(target, "targetId") ? target : persistedTargetToInput(target);
    return input.targetType === "ALL_LOCATIONS" || visibleIds[input.targetType]?.has(input.targetId);
  });
}

export async function loadCampaignTopology(organisationId) {
  // Generic promotions must never expose or target private Ruvanas Inside facilities.
  const [brands, groups, locations, stations, channels] = await Promise.all([
    prisma.brand.findMany({
      where: { organisationId },
      select: { id: true, name: true, _count: { select: { locations: true } }, locations: {
        where: { correctionsFacility: { is: null } }, select: { id: true }, take: 1
      } },
      orderBy: { name: "asc" }
    }),
    prisma.locationGroup.findMany({
      where: { organisationId },
      select: {
        id: true,
        name: true,
        _count: { select: { locations: true } },
        locations: { where: { location: { correctionsFacility: { is: null } } }, select: { locationId: true } }
      },
      orderBy: { name: "asc" }
    }),
    prisma.location.findMany({
      where: { organisationId, status: { not: "CLOSED" }, correctionsFacility: { is: null } },
      select: {
        id: true,
        name: true,
        brandId: true,
        timezone: true,
        openingHours: { select: { id: true }, take: 1 },
        zones: {
          where: { status: { not: "OFFLINE" } },
          select: { id: true, name: true, locationId: true },
          orderBy: { name: "asc" }
        }
      },
      orderBy: { name: "asc" }
    }),
    prisma.station.findMany({
      where: { organisationId, status: { not: "SUSPENDED" }, ...GENERAL_STUDIO_STATION_WHERE },
      select: { id: true, name: true, channels: { where: { status: "ACTIVE", ...GENERAL_STUDIO_CHANNEL_WHERE }, select: { id: true } } },
      orderBy: { name: "asc" }
    }),
    prisma.channel.findMany({
      where: { organisationId, status: "ACTIVE", ...GENERAL_STUDIO_CHANNEL_WHERE },
      select: { id: true, name: true, stationId: true, zoneAssignments: { where: { activeTo: null, zone: { location: { correctionsFacility: { is: null } } } }, select: { zoneId: true } } },
      orderBy: { name: "asc" }
    })
  ]);

  return {
    brands: brands.filter((brand) => brand._count.locations === 0 || brand.locations.length > 0)
      .map((brand) => ({ id: brand.id, name: brand.name })),
    groups: groups.filter((group) => group._count.locations === 0 || group.locations.length > 0).map((group) => ({
      id: group.id,
      name: group.name,
      locationIds: group.locations.map((membership) => membership.locationId)
    })),
    locations: locations.map((location) => ({
      id: location.id,
      name: location.name,
      brandId: location.brandId,
      timezone: location.timezone,
      openingHoursConfigured: location.openingHours.length > 0
    })),
    zones: locations.flatMap((location) => location.zones),
    stations: stations.map((station) => ({ id: station.id, name: station.name, channelIds: station.channels.map((channel) => channel.id) })),
    channels: channels.map((channel) => ({ id: channel.id, name: channel.name, stationId: channel.stationId, zoneIds: channel.zoneAssignments.map((assignment) => assignment.zoneId) }))
  };
}

export async function prepareCampaignPreview(campaign, { excludeCampaignId = null } = {}) {
  const [promoVersion, topology, existingCampaigns] = await Promise.all([
    prisma.promoVersion.findFirst({
      where: {
        id: campaign.promoVersionId,
        promoAsset: { organisationId: campaign.organisationId }
      },
      include: {
        promoAsset: { select: { id: true, name: true, status: true } },
        mediaAsset: { select: { id: true, status: true, durationSeconds: true } }
      }
    }),
    loadCampaignTopology(campaign.organisationId),
    prisma.campaign.findMany({
      where: {
        organisationId: campaign.organisationId,
        status: "PUBLISHED",
        ...(excludeCampaignId ? { id: { not: excludeCampaignId } } : {})
      },
      include: { targets: true, rule: true, schedules: true }
    })
  ]);

  if (!promoVersion) throw new Error("The selected promotional version does not belong to this organisation.");
  if (promoVersion.status !== "APPROVED" || promoVersion.promoAsset.status !== "ACTIVE") {
    throw new Error("Only an approved version of an active promotional asset can be scheduled.");
  }
  if (promoVersion.mediaAsset.status !== "READY") {
    throw new Error("The approved promotional audio is not ready for playback.");
  }

  const targetZones = expandCampaignTargets({ ...topology, targets: campaign.targets });
  const existing = existingCampaigns.map((item) => {
    const input = persistedCampaignToInput(item);
    // Historical published campaigns may name a now-private target. Ignore only
    // that target in conflict previews; do not permit a new generic private target.
    const visibleTargets = visibleCampaignTargets(input.targets, topology);
    return {
      id: item.id,
      name: item.name,
      mandatory: item.mandatory,
      effectiveFrom: input.effectiveFrom,
      effectiveTo: input.effectiveTo,
      schedules: input.schedules,
      targetZoneIds: visibleTargets.length ? expandCampaignTargets({
        ...topology,
        targets: visibleTargets
      }).map((zone) => zone.id) : []
    };
  });

  return {
    promoVersion,
    topology,
    targetZones,
    preview: previewCampaign({
      campaign,
      durationSeconds:
        promoVersion.durationSeconds ?? promoVersion.mediaAsset.durationSeconds,
      targetZones,
      existingCampaigns: existing
    })
  };
}
