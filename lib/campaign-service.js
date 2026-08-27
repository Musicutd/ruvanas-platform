import { prisma } from "@/lib/prisma";
import {
  expandCampaignTargets,
  previewCampaign
} from "@/lib/campaign-scheduling.mjs";

export function persistedTargetToInput(target) {
  return {
    targetType: target.targetType,
    targetId:
      target.brandId ||
      target.locationGroupId ||
      target.locationId ||
      target.zoneId ||
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

export async function loadCampaignTopology(organisationId) {
  const [brands, groups, locations] = await Promise.all([
    prisma.brand.findMany({
      where: { organisationId },
      select: { id: true, name: true },
      orderBy: { name: "asc" }
    }),
    prisma.locationGroup.findMany({
      where: { organisationId },
      select: {
        id: true,
        name: true,
        locations: { select: { locationId: true } }
      },
      orderBy: { name: "asc" }
    }),
    prisma.location.findMany({
      where: { organisationId, status: { not: "CLOSED" } },
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
    })
  ]);

  return {
    brands,
    groups: groups.map((group) => ({
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
    zones: locations.flatMap((location) => location.zones)
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
    return {
      id: item.id,
      name: item.name,
      mandatory: item.mandatory,
      effectiveFrom: input.effectiveFrom,
      effectiveTo: input.effectiveTo,
      schedules: input.schedules,
      targetZoneIds: expandCampaignTargets({
        ...topology,
        targets: input.targets
      }).map((zone) => zone.id)
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
