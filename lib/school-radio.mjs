import crypto from "node:crypto";
import { showItemDurationMs, showItemMedia, showItemNeedsSource } from "./show-builder.mjs";
import { isCatalogueLicenceCurrent } from "./catalogue-upload.mjs";

export const SCHOOL_RADIO_POLICY_VERSION = "school-radio-v1";
export const SCHOOL_RADIO_HORIZON_SECONDS = 300;
export const SCHOOL_RADIO_MEDIA_GRACE_SECONDS = 15 * 60;

const REVIEW_ACTIONS = Object.freeze({
  SUBMIT: new Set(["DRAFT", "CHANGES_REQUESTED"]),
  APPROVE: new Set(["IN_REVIEW"]),
  REQUEST_CHANGES: new Set(["IN_REVIEW"]),
  REJECT: new Set(["IN_REVIEW"]),
  ARCHIVE: new Set(["DRAFT", "IN_REVIEW", "APPROVED", "CHANGES_REQUESTED", "REJECTED"])
});

const EPISODE_REVIEW_ACTIONS = Object.freeze({
  SUBMIT: new Set(["DRAFT", "CHANGES_REQUESTED"]),
  APPROVE: new Set(["IN_REVIEW"]),
  REQUEST_CHANGES: new Set(["IN_REVIEW"]),
  REJECT: new Set(["IN_REVIEW"]),
  ARCHIVE: new Set(["DRAFT", "IN_REVIEW", "APPROVED", "CHANGES_REQUESTED", "REJECTED"])
});

export function transitionSchoolAnnouncement({ currentStatus, action, notes = null }) {
  if (!REVIEW_ACTIONS[action]?.has(currentStatus)) {
    throw new Error(`A ${currentStatus.toLowerCase().replaceAll("_", " ")} announcement cannot be changed with ${action.toLowerCase().replaceAll("_", " ")}.`);
  }
  const reviewNotes = typeof notes === "string" && notes.trim() ? notes.trim() : null;
  if (new Set(["REQUEST_CHANGES", "REJECT"]).has(action) && !reviewNotes) {
    throw new Error("Review notes are required for this decision.");
  }
  if (action === "SUBMIT") return { status: "IN_REVIEW", submittedAt: new Date(), reviewedAt: null, reviewedByUserId: null, reviewNotes: null };
  if (action === "APPROVE") return { status: "APPROVED", reviewedAt: new Date(), reviewNotes };
  if (action === "REQUEST_CHANGES") return { status: "CHANGES_REQUESTED", reviewedAt: new Date(), reviewNotes };
  if (action === "REJECT") return { status: "REJECTED", reviewedAt: new Date(), reviewNotes };
  return { status: "ARCHIVED", reviewedAt: new Date(), reviewNotes };
}

export function transitionSchoolEpisode({ currentStatus, action, notes = null, hasSubmission = false }) {
  if (!EPISODE_REVIEW_ACTIONS[action]?.has(currentStatus)) {
    throw new Error(`A ${currentStatus.toLowerCase().replaceAll("_", " ")} episode cannot be changed with ${action.toLowerCase().replaceAll("_", " ")}.`);
  }
  const reviewNotes = typeof notes === "string" && notes.trim() ? notes.trim() : null;
  if (action === "SUBMIT" && !hasSubmission) throw new Error("Add an audio submission before sending the episode for review.");
  if (new Set(["REQUEST_CHANGES", "REJECT"]).has(action) && !reviewNotes) {
    throw new Error("Review notes are required for this decision.");
  }
  if (action === "SUBMIT") return { status: "IN_REVIEW", submittedAt: new Date(), approvedAt: null };
  if (action === "APPROVE") return { status: "APPROVED", approvedAt: new Date() };
  if (action === "REQUEST_CHANGES") return { status: "CHANGES_REQUESTED", approvedAt: null };
  if (action === "REJECT") return { status: "REJECTED", approvedAt: null };
  return { status: "ARCHIVED", approvedAt: null };
}

export function consentIsCurrent(record, instant = new Date()) {
  return Boolean(
    record &&
    record.status === "GRANTED" &&
    (!record.expiresAt || new Date(record.expiresAt) > instant) &&
    !record.revokedAt
  );
}

export function validateEpisodePublication({ publicationScope, episodeStatus, contributorConsents = [], publicPublishingEnabled = false }) {
  if (publicationScope !== "PUBLIC") return { allowed: true, scope: "INTERNAL_ONLY" };
  if (!publicPublishingEnabled) throw new Error("Public School Radio publishing is not enabled for this organisation.");
  if (episodeStatus !== "APPROVED") throw new Error("Only a staff-approved episode can be published publicly.");
  if (!contributorConsents.length || contributorConsents.some((record) => !consentIsCurrent(record))) {
    throw new Error("Every student contributor needs current recorded consent before public publishing.");
  }
  return { allowed: true, scope: "PUBLIC" };
}

export function validateSchoolBroadcastSlot({ locationId = null, zoneId = null, startsAt, endsAt }) {
  if (Boolean(locationId) === Boolean(zoneId)) {
    throw new Error("Choose exactly one location or one zone.");
  }
  const start = startsAt instanceof Date ? startsAt : new Date(startsAt);
  const end = endsAt instanceof Date ? endsAt : new Date(endsAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
    throw new Error("The broadcast slot must have a valid end time after its start time.");
  }
  return { locationId: locationId || null, zoneId: zoneId || null, startsAt: start, endsAt: end };
}

function targetMatches(slot, player) {
  return slot.zoneId === player.zoneId || slot.locationId === player.zone.locationId;
}

function schoolScheduleItemId(playerId, slot, sourceId = "announcement") {
  return crypto.createHash("sha256").update([
    "school",
    playerId,
    slot.id,
    slot.revision,
    sourceId,
    new Date(slot.startsAt).toISOString()
  ].join(":" )).digest("hex");
}

function mediaAllowedForPlayer(mediaAsset, player) {
  return mediaAsset?.status === "READY" && (
    mediaAsset.organisationId === player.organisationId ||
    (mediaAsset.organisationId === null && mediaAsset.libraryType === "RUVANAS_CATALOGUE")
  );
}

export function compileSchoolRadioPlayout({
  slots = [],
  player,
  instant = new Date(),
  horizonSeconds = SCHOOL_RADIO_HORIZON_SECONDS
}) {
  const bucketMs = horizonSeconds * 1000;
  const bucketStart = new Date(Math.floor(instant.getTime() / bucketMs) * bucketMs);
  const horizonEnd = new Date(bucketStart.getTime() + bucketMs);
  const insertions = [];

  for (const slot of slots) {
    const plannedStart = new Date(slot.startsAt);
    if (
      slot.status !== "APPROVED" ||
      !targetMatches(slot, player) ||
      new Date(slot.endsAt) <= plannedStart
    ) continue;

    const announcement = slot.announcement;
    if (announcement) {
      const promoVersion = announcement.promoVersion;
      const mediaAsset = promoVersion?.mediaAsset;
      if (
        announcement.status !== "APPROVED" || announcement.organisationId !== player.organisationId ||
        plannedStart < bucketStart || plannedStart >= horizonEnd ||
        !new Set(["APPROVED", "SUPERSEDED"]).has(promoVersion?.status) ||
        promoVersion?.promoAsset?.status !== "ACTIVE" || !mediaAllowedForPlayer(mediaAsset, player)
      ) continue;
      insertions.push({
        scheduleItemId: schoolScheduleItemId(player.id, slot), schoolBroadcastSlotId: slot.id,
        schoolRundownItemId: null, announcementId: announcement.id, episodeId: null,
        announcementTitle: announcement.title, displayTitle: announcement.title, displayArtist: "School announcement",
        publicationRevision: slot.revision, sourceRevision: `${slot.id}:${slot.revision}:${announcement.policyVersion}`,
        promoVersionId: promoVersion.id, mediaAssetId: mediaAsset.id,
        durationSeconds: promoVersion.durationSeconds ?? mediaAsset.durationSeconds,
        plannedStart, expiresAt: new Date(new Date(slot.endsAt).getTime() + SCHOOL_RADIO_MEDIA_GRACE_SECONDS * 1000)
      });
      continue;
    }

    const episode = slot.episode;
    const rundown = episode?.rundown;
    if (
      !episode || episode.organisationId !== player.organisationId || episode.status !== "APPROVED" ||
      !rundown || rundown.status !== "APPROVED" || rundown.approvedRevision !== rundown.revision
    ) continue;
    let elapsedMs = 0;
    for (const item of rundown.items || []) {
      if (item.type === "HARD_TIME" && Number.isInteger(item.cueOffsetMs)) {
        elapsedMs = Math.max(elapsedMs, item.cueOffsetMs);
        continue;
      }
      if (!showItemNeedsSource(item.type)) continue;
      if (item.type === "MUSIC_TRACK" && (item.sourceTrack?.status !== "READY" || !isCatalogueLicenceCurrent(item.sourceTrack?.licenceExpiresAt, instant))) continue;
      const source = showItemMedia(item);
      if (!source || !mediaAllowedForPlayer(source.mediaAsset, player)) continue;
      const itemStart = new Date(plannedStart.getTime() + elapsedMs);
      const durationMs = showItemDurationMs(item);
      elapsedMs += Math.max(1000, durationMs - (item.transitionPreset === "CROSSFADE" ? 1000 : 0));
      if (itemStart < bucketStart || itemStart >= horizonEnd || itemStart >= new Date(slot.endsAt)) continue;
      insertions.push({
        scheduleItemId: schoolScheduleItemId(player.id, slot, item.id), schoolBroadcastSlotId: slot.id,
        schoolRundownItemId: item.id, announcementId: null, episodeId: episode.id,
        announcementTitle: episode.title, displayTitle: item.label, displayArtist: source.artist,
        publicationRevision: slot.revision,
        sourceRevision: `${slot.id}:${slot.revision}:${rundown.id}:${rundown.revision}:${item.id}`,
        promoVersionId: source.promoVersionId, mediaAssetId: source.mediaAsset.id,
        durationSeconds: Math.max(1, Math.round(durationMs / 1000)), plannedStart: itemStart,
        expiresAt: new Date(new Date(slot.endsAt).getTime() + SCHOOL_RADIO_MEDIA_GRACE_SECONDS * 1000)
      });
    }
  }

  insertions.sort((left, right) => left.plannedStart - right.plannedStart || left.scheduleItemId.localeCompare(right.scheduleItemId));
  return { bucketStart, expiresAt: horizonEnd, insertions };
}

export function schoolPlayoutIntentCreateData({ insertion, player, channelId = null }) {
  const location = player.zone.location;
  return {
    scheduleItemId: insertion.scheduleItemId,
    organisationId: player.organisationId,
    playerId: player.id,
    zoneId: player.zoneId,
    channelId,
    campaignId: null,
    schoolBroadcastSlotId: insertion.schoolBroadcastSlotId,
    schoolRundownItemId: insertion.schoolRundownItemId || null,
    promoVersionId: insertion.promoVersionId || null,
    mediaAssetId: insertion.mediaAssetId,
    locationId: location.id,
    locationName: location.name,
    locationTimezone: location.timezone,
    locationGroups: (location.groupMemberships || []).map((membership) => ({
      id: membership.locationGroupId,
      name: membership.locationGroup?.name || membership.locationGroupName || membership.locationGroupId
    })),
    publicationRevision: insertion.publicationRevision,
    sourceRevision: insertion.sourceRevision,
    plannedStart: insertion.plannedStart,
    expiresAt: insertion.expiresAt
  };
}

export function mergeSharedInsertions({ campaignPlayout, schoolPlayout, minimumGapSeconds = 60 }) {
  const schoolInsertions = schoolPlayout?.insertions || [];
  const acceptedCampaigns = (campaignPlayout?.insertions || []).filter((campaign) =>
    !schoolInsertions.some((announcement) =>
      Math.abs(announcement.plannedStart.getTime() - campaign.plannedStart.getTime()) < minimumGapSeconds * 1000
    )
  );
  const displacedCampaigns = (campaignPlayout?.insertions || []).filter((campaign) => !acceptedCampaigns.includes(campaign));
  return {
    campaignPlayout: { ...(campaignPlayout || {}), insertions: acceptedCampaigns, discarded: [...(campaignPlayout?.discarded || []), ...displacedCampaigns] },
    schoolPlayout: schoolPlayout || { insertions: [] }
  };
}

