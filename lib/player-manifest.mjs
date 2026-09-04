import crypto from "node:crypto";
import { createPlaybackProofToken } from "./playback-proof.mjs";
import { playableLiveMusicModeEntries } from "./music-mode-playback.mjs";
import {
  buildLiveChannelClock,
  LIVE_CHANNEL_CROSSFADE_SECONDS
} from "./live-channel-clock.mjs";
import { appendPlayerListenerToken } from "./player-listener-lease.mjs";
import { playoutDecisionEvidence } from "./playout-resolver.mjs";

export const PLAYER_MANIFEST_TTL_SECONDS = 300;
export const PLAYER_MANIFEST_REFRESH_SECONDS = 240;
export const PLAYER_MANIFEST_MAX_TRACKS = 100;

function digestNumber(seed) {
  const digest = crypto.createHash("sha256").update(seed).digest();
  return (digest.readUIntBE(0, 6) + 1) / (2 ** 48 + 1);
}

export function deterministicWeightedRotation(entries, seed, limit = PLAYER_MANIFEST_MAX_TRACKS) {
  return entries
    .map((entry) => ({
      entry,
      score: -Math.log(digestNumber(`${seed}:${entry.track.id}`)) / entry.weight
    }))
    .sort((left, right) => left.score - right.score || left.entry.track.id.localeCompare(right.entry.track.id))
    .slice(0, limit)
    .map(({ entry }) => entry);
}

function musicScheduleItemId(seed, trackId, index) {
  return crypto.createHash("sha256").update(`music:${seed}:${trackId}:${index}`).digest("hex");
}

function safePlayoutDecision(decision) {
  if (!decision) return null;
  const evidence = playoutDecisionEvidence(decision);
  return {
    decisionId: decision.decisionId,
    ...evidence,
    validFrom: evidence.validFrom.toISOString(),
    validUntil: evidence.validUntil.toISOString(),
    nextDecisionAt: evidence.nextDecisionAt.toISOString(),
    fallbackChain: evidence.fallbackChain.map((candidate) => ({ ...candidate })),
    unavailableReasons: evidence.unavailableReasons.map((candidate) => ({ ...candidate })),
    operatorAlert: decision.operatorAlert ? { ...decision.operatorAlert } : null
  };
}

export function buildPlayerManifest({ player, resolution, playoutDecision = null, campaignPlayout = null, schoolPlayout = null, proofSecret, listenerToken = null, instant = new Date() }) {
  const bucketMs = PLAYER_MANIFEST_TTL_SECONDS * 1000;
  const bucketStart = Math.floor(instant.getTime() / bucketMs) * bucketMs;
  const expiresAt = new Date(bucketStart + bucketMs);
  const mode = resolution.musicMode || null;
  const channelId = player.zone?.channelAssignments?.[0]?.channel?.id || null;
  const streamId = channelId ? `channel:${channelId}` : `schedule:${resolution.scheduleId || "none"}`;
  const seed = `${streamId}:${resolution.scheduleId || "none"}:${resolution.scheduleVersion || 0}:${mode?.id || "none"}`;
  const rotation = deterministicWeightedRotation(
    playableLiveMusicModeEntries(mode, instant),
    seed
  );
  const musicItems = rotation.map(({ weight, track }, index) => ({
    weight,
    track,
    scheduleItemId: musicScheduleItemId(seed, track.id, index)
  }));
  const campaignItems = campaignPlayout?.insertions || [];
  const schoolItems = schoolPlayout?.insertions || [];
  const insertionItems = [
    ...campaignItems.map((item) => ({ ...item, itemType: "PROMO" })),
    ...schoolItems.map((item) => ({ ...item, itemType: "SCHOOL_ANNOUNCEMENT" }))
  ].sort((left, right) => left.plannedStart - right.plannedStart || left.scheduleItemId.localeCompare(right.scheduleItemId));
  const decisionEvidence = safePlayoutDecision(playoutDecision);
  const signatureInput = [
    seed,
    resolution.liveAnchorAt instanceof Date ? resolution.liveAnchorAt.toISOString() : "shared-channel-epoch",
    decisionEvidence
      ? `${decisionEvidence.sourceType}:${decisionEvidence.sourceId || "none"}:${decisionEvidence.sourceRevision || "unversioned"}`
      : "legacy-decision",
    ...musicItems.map(({ scheduleItemId, weight }) => `${scheduleItemId}:${weight}`),
    ...insertionItems.map((item) => `${item.scheduleItemId}:${item.sourceRevision}`)
  ].join("|");
  const version = crypto.createHash("sha256").update(signatureInput).digest("hex").slice(0, 24);
  const live = musicItems.length ? buildLiveChannelClock({
    playlist: musicItems,
    streamId,
    instant,
    crossfadeSeconds: LIVE_CHANNEL_CROSSFADE_SECONDS,
    epochMs: resolution.liveAnchorAt instanceof Date ? resolution.liveAnchorAt.getTime() : undefined
  }) : null;

  return {
    version,
    generatedAt: instant.toISOString(),
    expiresAt: expiresAt.toISOString(),
    refreshAfterSeconds: PLAYER_MANIFEST_REFRESH_SECONDS,
    player: {
      id: player.id,
      name: player.name,
      location: player.zone.location.name,
      zone: player.zone.name,
      timezone: player.zone.location.timezone
    },
    state: musicItems.length || insertionItems.length
      ? "READY"
      : mode ? "NO_PLAYABLE_TRACKS" : resolution.reason,
    schedule: mode ? {
      id: resolution.scheduleId,
      version: resolution.scheduleVersion,
      slotId: resolution.slotId,
      source: resolution.reason,
      sourceLabel: resolution.sourceLabel || null,
      fallbackCause: resolution.fallbackCause || null
    } : null,
    programmingSource: resolution.reason,
    programmingAlert: resolution.alert || null,
    playoutDecision: decisionEvidence,
    musicMode: mode ? { id: mode.id, name: mode.name, slug: mode.slug } : null,
    live,
    playlist: musicItems.map(({ weight, track, scheduleItemId }, index) => ({
      itemType: "MUSIC",
      scheduleItemId,
      position: index + 1,
      programmingSource: resolution.reason,
      trackId: track.id,
      title: track.title,
      artist: track.artist,
      album: track.album,
      durationSeconds: track.mediaAsset.durationSeconds,
      weight,
      mediaUrl: appendPlayerListenerToken(`/api/player/media/${track.mediaAsset.id}`, listenerToken),
      proofToken: createPlaybackProofToken({
        playerId: player.id,
        manifestVersion: version,
        scheduleItemId,
        contentId: track.id
      }, proofSecret),
      programmingSourceProofToken: createPlaybackProofToken({
        playerId: player.id,
        manifestVersion: version,
        scheduleItemId,
        contentId: track.id,
        programmingSource: resolution.reason
      }, proofSecret)
    })),
    insertions: insertionItems.map((item) => ({
      itemType: item.itemType,
      scheduleItemId: item.scheduleItemId,
      campaignId: item.campaignId || null,
      campaignName: item.campaignName || null,
      schoolBroadcastSlotId: item.schoolBroadcastSlotId || null,
      schoolRundownItemId: item.schoolRundownItemId || null,
      announcementId: item.announcementId || null,
      episodeId: item.episodeId || null,
      announcementTitle: item.announcementTitle || null,
      promoVersionId: item.promoVersionId || null,
      title: item.itemType === "SCHOOL_ANNOUNCEMENT" ? (item.displayTitle || item.announcementTitle) : item.promoName,
      artist: item.itemType === "SCHOOL_ANNOUNCEMENT" ? (item.displayArtist || "School announcement") : "Promotion",
      durationSeconds: item.durationSeconds,
      plannedStart: item.plannedStart.toISOString(),
      hardStart: item.itemType === "SCHOOL_ANNOUNCEMENT" ? true : item.exactTimeHardStart,
      mandatory: item.itemType === "SCHOOL_ANNOUNCEMENT" ? true : item.mandatory,
      priority: item.itemType === "SCHOOL_ANNOUNCEMENT" ? "VERY_HIGH" : item.priority,
      programmingSource: item.itemType === "SCHOOL_ANNOUNCEMENT" ? "SCHOOL_PROGRAMMING" : "CAMPAIGN",
      mediaUrl: appendPlayerListenerToken(`/api/player/media/${item.mediaAssetId}`, listenerToken),
      proofToken: createPlaybackProofToken({
        playerId: player.id,
        manifestVersion: version,
        scheduleItemId: item.scheduleItemId,
        contentId: item.promoVersionId || item.mediaAssetId
      }, proofSecret),
      programmingSourceProofToken: createPlaybackProofToken({
        playerId: player.id,
        manifestVersion: version,
        scheduleItemId: item.scheduleItemId,
        contentId: item.promoVersionId || item.mediaAssetId,
        programmingSource: item.itemType === "SCHOOL_ANNOUNCEMENT" ? "SCHOOL_PROGRAMMING" : "CAMPAIGN"
      }, proofSecret)
    }))
  };
}


