import crypto from "node:crypto";
import { localDateTimeParts } from "./opening-hours.mjs";

export const CAMPAIGN_MANIFEST_HORIZON_SECONDS = 300;
export const CAMPAIGN_MEDIA_GRACE_SECONDS = 15 * 60;

const PRIORITY_RANK = Object.freeze({ LOW: 1, NORMAL: 2, HIGH: 3, VERY_HIGH: 4 });

function dateText(value) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value || "").slice(0, 10);
}

function previousDate(value) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function targetMatchesPlayer(campaign, player) {
  const location = player.zone.location;
  const groupIds = new Set((location.groupMemberships || []).map((membership) => membership.locationGroupId));
  return (campaign.targets || []).some((target) =>
    target.targetType === "ALL_LOCATIONS" ||
    (target.targetType === "BRAND" && target.brandId === location.brandId) ||
    (target.targetType === "LOCATION_GROUP" && groupIds.has(target.locationGroupId)) ||
    (target.targetType === "LOCATION" && target.locationId === location.id) ||
    (target.targetType === "ZONE" && target.zoneId === player.zoneId)
  );
}

function schedulePosition(schedule, local) {
  if (schedule.windowMode === "EXACT_TIME") {
    return schedule.weekday === local.weekday && schedule.exactMinute === local.minute
      ? { offset: 0, sourceDate: local.date }
      : null;
  }

  if (schedule.endMinute > schedule.startMinute) {
    if (schedule.weekday !== local.weekday || local.minute < schedule.startMinute || local.minute >= schedule.endMinute) return null;
    return { offset: local.minute - schedule.startMinute, sourceDate: local.date };
  }

  if (schedule.weekday === local.weekday && local.minute >= schedule.startMinute) {
    return { offset: local.minute - schedule.startMinute, sourceDate: local.date };
  }
  if ((schedule.weekday + 1) % 7 === local.weekday && local.minute < schedule.endMinute) {
    return { offset: 1440 - schedule.startMinute + local.minute, sourceDate: previousDate(local.date) };
  }
  return null;
}

function dueAtPosition(schedule, position) {
  if (schedule.windowMode === "EXACT_TIME") return true;
  if (schedule.windowMode === "INTERVAL") return position.offset % schedule.intervalMinutes === 0;
  const rate = schedule.playsPerHour;
  return Math.floor((position.offset * rate) / 60) !== Math.floor(((position.offset - 1) * rate) / 60);
}

function scheduleItemId(playerId, campaign, plannedStart) {
  const source = [
    playerId,
    campaign.id,
    campaign.publicationRevision,
    campaign.publishedConfigurationHash || "unhashed",
    plannedStart.toISOString()
  ].join(":");
  return crypto.createHash("sha256").update(source).digest("hex");
}

function candidateRank(candidate) {
  return (candidate.mandatory ? 100 : 0) + (PRIORITY_RANK[candidate.priority] || 0);
}

function conflicts(candidate, accepted) {
  return accepted.some((other) => {
    const seconds = Math.abs(candidate.plannedStart.getTime() - other.plannedStart.getTime()) / 1000;
    if (candidate.campaignId === other.campaignId) {
      return seconds < Math.max(candidate.minSamePromoGapMinutes, other.minSamePromoGapMinutes) * 60;
    }
    return seconds < Math.max(candidate.minAnyPromoGapMinutes, other.minAnyPromoGapMinutes) * 60;
  });
}

export function compileCampaignPlayout({
  campaigns = [],
  player,
  instant = new Date(),
  horizonSeconds = CAMPAIGN_MANIFEST_HORIZON_SECONDS,
  isLocationOpenAt = () => true
}) {
  const bucketMs = horizonSeconds * 1000;
  const bucketStart = new Date(Math.floor(instant.getTime() / bucketMs) * bucketMs);
  const expiresAt = new Date(bucketStart.getTime() + bucketMs);
  const candidates = [];

  for (const campaign of campaigns) {
    if (campaign.status !== "PUBLISHED" || campaign.publicationRevision < 1 || !targetMatchesPlayer(campaign, player)) continue;
    const promoVersion = campaign.promoVersion;
    const mediaAsset = promoVersion?.mediaAsset;
    if (
      !new Set(["APPROVED", "SUPERSEDED"]).has(promoVersion?.status) ||
      promoVersion.promoAsset?.status !== "ACTIVE" ||
      mediaAsset?.status !== "READY" ||
      mediaAsset.organisationId !== player.organisationId
    ) continue;

    for (let cursor = bucketStart.getTime(); cursor < expiresAt.getTime(); cursor += 60_000) {
      const plannedStart = new Date(cursor);
      const local = localDateTimeParts(plannedStart, player.zone.location.timezone);
      for (const schedule of campaign.schedules || []) {
        const position = schedulePosition(schedule, local);
        if (!position || !dueAtPosition(schedule, position)) continue;
        if (position.sourceDate < dateText(campaign.effectiveFrom) || position.sourceDate > dateText(campaign.effectiveTo)) continue;
        if (campaign.respectOpeningHours && !isLocationOpenAt(plannedStart)) continue;

        candidates.push({
          scheduleItemId: scheduleItemId(player.id, campaign, plannedStart),
          campaignId: campaign.id,
          campaignName: campaign.name,
          publicationRevision: campaign.publicationRevision,
          sourceRevision: campaign.publishedConfigurationHash || `${campaign.id}:${campaign.publicationRevision}`,
          priority: campaign.priority,
          mandatory: campaign.mandatory,
          minSamePromoGapMinutes: campaign.minSamePromoGapMinutes,
          minAnyPromoGapMinutes: campaign.minAnyPromoGapMinutes,
          exactTimeHardStart: campaign.rule?.exactTimeHardStart === true && schedule.windowMode === "EXACT_TIME",
          promoVersionId: promoVersion.id,
          promoAssetId: promoVersion.promoAsset.id,
          promoName: promoVersion.promoAsset.name,
          mediaAssetId: mediaAsset.id,
          durationSeconds: promoVersion.durationSeconds ?? mediaAsset.durationSeconds,
          plannedStart,
          expiresAt: new Date(expiresAt.getTime() + CAMPAIGN_MEDIA_GRACE_SECONDS * 1000)
        });
      }
    }
  }

  const accepted = [];
  const discarded = [];
  for (const candidate of candidates.sort((left, right) =>
    candidateRank(right) - candidateRank(left) ||
    left.plannedStart - right.plannedStart ||
    left.campaignId.localeCompare(right.campaignId)
  )) {
    if (conflicts(candidate, accepted)) discarded.push(candidate);
    else accepted.push(candidate);
  }

  accepted.sort((left, right) => left.plannedStart - right.plannedStart || left.scheduleItemId.localeCompare(right.scheduleItemId));
  return {
    bucketStart,
    expiresAt,
    insertions: accepted,
    discarded
  };
}

export function playoutIntentCreateData({ insertion, player, channelId = null }) {
  return {
    scheduleItemId: insertion.scheduleItemId,
    organisationId: player.organisationId,
    playerId: player.id,
    zoneId: player.zoneId,
    channelId,
    campaignId: insertion.campaignId,
    promoVersionId: insertion.promoVersionId,
    mediaAssetId: insertion.mediaAssetId,
    publicationRevision: insertion.publicationRevision,
    sourceRevision: insertion.sourceRevision,
    plannedStart: insertion.plannedStart,
    expiresAt: insertion.expiresAt
  };
}
