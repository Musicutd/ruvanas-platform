import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { MAX_TIMED_PLAYLIST_CANDIDATES, generateTimedPlaylist } from "@/lib/timed-playlist-generator.mjs";
import { localMinuteToUtc } from "@/lib/advanced-scheduler.mjs";
import { musicTrackEligibility } from "@/lib/media-library-pro.mjs";

export const generatedPlaylistInclude = {
  versions: { orderBy: { version: "desc" }, include: { items: { orderBy: { position: "asc" }, include: { track: { select: { title: true, artist: true } } } } } },
  musicMode: { select: { id: true, name: true, status: true } }
};

export function safeGeneratedPlaylist(playlist) {
  return {
    id: playlist.id, name: playlist.name, status: playlist.status, targetType: playlist.targetType, targetId: playlist.targetId,
    timezone: playlist.timezone, scheduledDate: playlist.scheduledDate.toISOString().slice(0, 10), startMinute: playlist.startMinute, endMinute: playlist.endMinute,
    rightsUse: playlist.rightsUse, territory: playlist.territory, sourceScopes: playlist.sourceScopes, selectedGenreCodes: playlist.selectedGenreCodes,
    currentVersion: playlist.currentVersion, publishedVersion: playlist.publishedVersion, entitlementLevel: playlist.entitlementLevel,
    invalidReason: playlist.invalidReason, publishedAt: playlist.publishedAt?.toISOString() || null, musicMode: playlist.musicMode,
    versions: playlist.versions.map((version) => ({
      id: version.id, version: version.version, seed: version.seed, requestedDurationSeconds: version.requestedDurationSeconds,
      generatedDurationSeconds: version.generatedDurationSeconds, varianceSeconds: version.generatedDurationSeconds - version.requestedDurationSeconds,
      toleranceSeconds: version.toleranceSeconds, warnings: version.warnings, genreDistribution: version.genreDistribution,
      publishedAt: version.publishedAt?.toISOString() || null, generatedAt: version.generatedAt.toISOString(),
      items: version.items.map((item) => ({ id: item.id, position: item.position, trackId: item.trackId, artist: item.track.artist, title: item.track.title, startOffsetSeconds: item.startOffsetSeconds, endOffsetSeconds: item.endOffsetSeconds, durationSeconds: item.durationSeconds, genreCode: item.genreCode, sourceScope: item.sourceScope, explanation: item.explanation }))
    }))
  };
}

export async function candidateTracks(organisationId) {
  return prisma.track.findMany({
    where: { status: "READY", mediaAsset: { status: "READY", mediaType: "MUSIC", OR: [{ libraryType: "RUVANAS_CATALOGUE", organisationId: null }, { libraryType: "ORGANISATION_MUSIC", organisationId }] } },
    include: { mediaAsset: { include: { genres: { include: { mediaGenre: true } } } } },
    orderBy: { id: "asc" }, take: MAX_TIMED_PLAYLIST_CANDIDATES
  });
}

export async function createGeneratedDraft({ organisationId, actorUserId, input, catalogueLevel }) {
  const tracks = await candidateTracks(organisationId);
  const seed = crypto.randomBytes(16).toString("hex");
  const result = generateTimedPlaylist({ tracks, config: { ...input, organisationId, catalogueLevel }, seed });
  return prisma.$transaction(async (tx) => {
    const playlist = await tx.generatedPlaylist.create({ data: {
      organisationId, createdByUserId: actorUserId, name: input.name, targetType: input.targetType, targetId: input.targetId,
      timezone: input.timezone, scheduledDate: new Date(`${input.scheduledDate}T00:00:00.000Z`), startMinute: input.startMinute, endMinute: input.endMinute,
      rightsUse: input.rightsUse, territory: input.territory || null, sourceScopes: input.sourceScopes, selectedGenreCodes: input.selectedGenreCodes,
      entitlementLevel: catalogueLevel,
      versions: { create: { version: 1, seed, requestedDurationSeconds: result.requestedDurationSeconds, generatedDurationSeconds: result.generatedDurationSeconds, warnings: result.warnings, genreDistribution: result.genreDistribution, entitlementLevel: catalogueLevel, items: { create: result.items.map(({ track, ...item }) => item) } } }
    } });
    await tx.auditLog.create({ data: { organisationId, actorUserId, action: "TIMED_PLAYLIST_DRAFT_GENERATED", entityType: "GeneratedPlaylist", entityId: playlist.id, details: { targetType: input.targetType, targetId: input.targetId, version: 1, itemCount: result.items.length, boundedCandidates: MAX_TIMED_PLAYLIST_CANDIDATES } } });
    return tx.generatedPlaylist.findUnique({ where: { id: playlist.id }, include: generatedPlaylistInclude });
  });
}

export async function regenerateGeneratedDraft({ organisationId, playlistId, actorUserId, catalogueLevel }) {
  const existing = await prisma.generatedPlaylist.findFirst({ where: { id: playlistId, organisationId, status: { not: "ARCHIVED" } } });
  if (!existing) return null;
  const tracks = await candidateTracks(organisationId);
  const version = existing.currentVersion + 1;
  const seed = crypto.randomBytes(16).toString("hex");
  const result = generateTimedPlaylist({ tracks, config: { ...existing, organisationId, catalogueLevel }, seed });
  return prisma.$transaction(async (tx) => {
    await tx.generatedPlaylistVersion.create({ data: { generatedPlaylistId: existing.id, version, seed, requestedDurationSeconds: result.requestedDurationSeconds, generatedDurationSeconds: result.generatedDurationSeconds, warnings: result.warnings, genreDistribution: result.genreDistribution, entitlementLevel: catalogueLevel, items: { create: result.items.map(({ track, ...item }) => item) } } });
    await tx.generatedPlaylist.update({ where: { id: existing.id }, data: { currentVersion: version, status: "DRAFT", invalidReason: null, entitlementLevel: catalogueLevel } });
    await tx.auditLog.create({ data: { organisationId, actorUserId, action: "TIMED_PLAYLIST_REGENERATED", entityType: "GeneratedPlaylist", entityId: existing.id, details: { version, previousPublishedVersion: existing.publishedVersion, itemCount: result.items.length } } });
    return tx.generatedPlaylist.findUnique({ where: { id: existing.id }, include: generatedPlaylistInclude });
  });
}

function programmeItemData(item) {
  return { position: item.position, label: item.label, recurrence: item.recurrence, sourceType: item.sourceType, weekday: item.weekday, startMinute: item.startMinute, startsAt: item.startsAt, durationMinutes: item.durationMinutes, priority: item.priority, musicModeId: item.musicModeId, radioClockId: item.radioClockId, schoolRundownId: item.schoolRundownId };
}

export async function publishGeneratedPlaylist({ organisationId, playlistId, actorUserId, catalogueLevel, configuredGenres = [] }) {
  const current = await prisma.generatedPlaylist.findFirst({ where: { id: playlistId, organisationId, status: { in: ["DRAFT", "PUBLISHED"] } } });
  if (!current) return null;
  const version = await prisma.generatedPlaylistVersion.findUnique({
    where: { generatedPlaylistId_version: { generatedPlaylistId: current.id, version: current.currentVersion } },
    include: { items: { orderBy: { position: "asc" }, include: { track: { include: { mediaAsset: { include: { genres: { include: { mediaGenre: true } } } } } } } } }
  });
  if (!version?.items.length) {
    const error = new Error("This draft has no playable items and cannot be published."); error.code = "EMPTY_GENERATION"; throw error;
  }
  const invalid = version.items.find((item) => !musicTrackEligibility(item.track, { organisationId, requiredUse: current.rightsUse, territory: current.territory, licensedCatalogueLevel: catalogueLevel, selectedGenreCodes: current.selectedGenreCodes, configuredGenres }).playable);
  if (invalid) {
    const error = new Error("One or more generated tracks are no longer allowed by the current plan, rights or territory. Regenerate before publishing."); error.code = "GENERATION_INVALIDATED"; throw error;
  }
  const startsAt = localMinuteToUtc(current.scheduledDate.toISOString().slice(0, 10), current.startMinute, current.timezone);
  const durationMinutes = current.endMinute - current.startMinute;
  return prisma.$transaction(async (tx) => {
    let musicModeId = current.musicModeId;
    if (!musicModeId) {
      const mode = await tx.musicMode.create({ data: { organisationId, name: current.name, slug: `timed-${current.id}`, description: `Frozen timed AutoDJ sequence ${current.scheduledDate.toISOString().slice(0, 10)}.`, source: "GENERATED_PLAYLIST", status: "ACTIVE" } });
      musicModeId = mode.id;
    } else {
      await tx.musicMode.update({ where: { id: musicModeId }, data: { name: current.name, status: "ACTIVE", source: "GENERATED_PLAYLIST" } });
      await tx.musicModeTrack.deleteMany({ where: { musicModeId } });
    }
    await tx.musicModeTrack.createMany({ data: version.items.map((item) => ({ musicModeId, trackId: item.trackId, weight: 100, position: item.position })) });

    if (["LOCATION", "ZONE"].includes(current.targetType)) {
      await tx.musicSchedule.create({ data: { organisationId, locationId: current.targetType === "LOCATION" ? current.targetId : null, zoneId: current.targetType === "ZONE" ? current.targetId : null, name: current.name, version: current.currentVersion, status: "PUBLISHED", timezone: current.timezone, effectiveFrom: current.scheduledDate, effectiveTo: current.scheduledDate, publishedAt: new Date(), slots: { create: { musicModeId, weekday: current.scheduledDate.getUTCDay(), startMinute: current.startMinute, endMinute: current.endMinute, priority: 50 } } } });
    } else {
      let schedule = await tx.programmeSchedule.findUnique({ where: { channelId_organisationId: { channelId: current.targetId, organisationId } }, include: { versions: { where: { isActive: true }, include: { items: true }, take: 1 } } });
      if (!schedule) schedule = await tx.programmeSchedule.create({ data: { organisationId, channelId: current.targetId, name: `${current.name} programming`, timezone: current.timezone, createdByUserId: actorUserId }, include: { versions: true } });
      const last = await tx.programmeScheduleVersion.findFirst({ where: { scheduleId: schedule.id }, orderBy: { version: "desc" }, select: { version: true } });
      const previousItems = schedule.versions?.[0]?.items?.map(programmeItemData) || [];
      await tx.programmeScheduleVersion.updateMany({ where: { scheduleId: schedule.id, isActive: true }, data: { isActive: false, status: "ARCHIVED" } });
      await tx.programmeScheduleVersion.create({ data: { organisationId, scheduleId: schedule.id, version: (last?.version || 0) + 1, status: "PUBLISHED", isActive: true, createdByUserId: actorUserId, publishedByUserId: actorUserId, publishedAt: new Date(), items: { create: [...previousItems.map((item, position) => ({ ...item, position })), { position: previousItems.length, label: current.name, recurrence: "ONE_OFF", sourceType: "MUSIC_MODE", startsAt, durationMinutes, priority: 50, musicModeId }] } } });
    }
    await tx.generatedPlaylistVersion.update({ where: { id: version.id }, data: { publishedAt: new Date() } });
    await tx.generatedPlaylist.update({ where: { id: current.id }, data: { musicModeId, status: "PUBLISHED", publishedVersion: current.currentVersion, entitlementLevel: catalogueLevel, invalidReason: null, publishedByUserId: actorUserId, publishedAt: new Date() } });
    await tx.auditLog.create({ data: { organisationId, actorUserId, action: "TIMED_PLAYLIST_PUBLISHED", entityType: "GeneratedPlaylist", entityId: current.id, details: { version: current.currentVersion, itemCount: version.items.length, targetType: current.targetType, targetId: current.targetId, scheduleReused: true } } });
    return tx.generatedPlaylist.findUnique({ where: { id: current.id }, include: generatedPlaylistInclude });
  });
}
