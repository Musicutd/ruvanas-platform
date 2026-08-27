import crypto from "node:crypto";
import { createPlaybackProofToken } from "./playback-proof.mjs";

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

function playableEntries(musicMode) {
  return (musicMode?.tracks || []).filter(({ weight, track }) =>
    Number.isInteger(weight) && weight >= 1 && weight <= 1000 &&
    track?.status === "READY" &&
    track.mediaAsset?.status === "READY" &&
    track.mediaAsset?.mediaType === "MUSIC" &&
    track.mediaAsset?.libraryType === "RUVANAS_CATALOGUE" &&
    track.mediaAsset?.organisationId === null
  );
}

function musicScheduleItemId(seed, trackId, index) {
  return crypto.createHash("sha256").update(`music:${seed}:${trackId}:${index}`).digest("hex");
}

export function buildPlayerManifest({ player, resolution, campaignPlayout = null, proofSecret, instant = new Date() }) {
  const bucketMs = PLAYER_MANIFEST_TTL_SECONDS * 1000;
  const bucketStart = Math.floor(instant.getTime() / bucketMs) * bucketMs;
  const expiresAt = new Date(bucketStart + bucketMs);
  const mode = resolution.musicMode || null;
  const seed = `${player.id}:${resolution.scheduleId || "none"}:${resolution.scheduleVersion || 0}:${mode?.id || "none"}:${bucketStart}`;
  const rotation = deterministicWeightedRotation(playableEntries(mode), seed);
  const musicItems = rotation.map(({ weight, track }, index) => ({
    weight,
    track,
    scheduleItemId: musicScheduleItemId(seed, track.id, index)
  }));
  const campaignItems = campaignPlayout?.insertions || [];
  const signatureInput = [
    seed,
    ...musicItems.map(({ scheduleItemId, weight }) => `${scheduleItemId}:${weight}`),
    ...campaignItems.map((item) => `${item.scheduleItemId}:${item.sourceRevision}`)
  ].join("|");
  const version = crypto.createHash("sha256").update(signatureInput).digest("hex").slice(0, 24);

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
    state: musicItems.length || campaignItems.length
      ? "READY"
      : mode ? "NO_PLAYABLE_TRACKS" : resolution.reason,
    schedule: mode ? {
      id: resolution.scheduleId,
      version: resolution.scheduleVersion,
      slotId: resolution.slotId,
      source: resolution.reason
    } : null,
    musicMode: mode ? { id: mode.id, name: mode.name, slug: mode.slug } : null,
    playlist: musicItems.map(({ weight, track, scheduleItemId }, index) => ({
      itemType: "MUSIC",
      scheduleItemId,
      position: index + 1,
      trackId: track.id,
      title: track.title,
      artist: track.artist,
      album: track.album,
      durationSeconds: track.mediaAsset.durationSeconds,
      weight,
      mediaUrl: `/api/player/media/${track.mediaAsset.id}`,
      proofToken: createPlaybackProofToken({
        playerId: player.id,
        manifestVersion: version,
        scheduleItemId,
        contentId: track.id
      }, proofSecret)
    })),
    insertions: campaignItems.map((item) => ({
      itemType: "PROMO",
      scheduleItemId: item.scheduleItemId,
      campaignId: item.campaignId,
      campaignName: item.campaignName,
      promoVersionId: item.promoVersionId,
      title: item.promoName,
      artist: "Promotion",
      durationSeconds: item.durationSeconds,
      plannedStart: item.plannedStart.toISOString(),
      hardStart: item.exactTimeHardStart,
      mandatory: item.mandatory,
      priority: item.priority,
      mediaUrl: `/api/player/media/${item.mediaAssetId}`,
      proofToken: createPlaybackProofToken({
        playerId: player.id,
        manifestVersion: version,
        scheduleItemId: item.scheduleItemId,
        contentId: item.promoVersionId
      }, proofSecret)
    }))
  };
}
