import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { MAX_TIMED_PLAYLIST_CANDIDATES, generateTimedPlaylist } from "@/lib/timed-playlist-generator.mjs";
import { localMinuteToUtc } from "@/lib/advanced-scheduler.mjs";
import { musicTrackEligibility } from "@/lib/media-library-pro.mjs";
import { assertFutureTimedReplacement, programmeItemData, replacePublishedAreaSchedule, replacePublishedProgrammeItem, uniquePublishedModeTracks } from "@/lib/generated-playlist-publication.mjs";

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

export async function publishGeneratedPlaylist({ organisationId, playlistId, actorUserId, catalogueLevel, configuredGenres = [] }) {
  const current = await prisma.generatedPlaylist.findFirst({ where: { id: playlistId, organisationId, status: { in: ["DRAFT", "PUBLISHED"] } } });
  if (!current) return null;
  if (current.currentVersion <= current.publishedVersion) {
    const error = new Error("This timed playlist version is already published. Generate and review a new draft before publishing again.");
    error.code = "ALREADY_PUBLISHED";
    throw error;
  }
  if (current.publishedVersion > 0 && process.env.RUVANAS_TIMED_PLAYLIST_REPLACEMENT_ENABLED !== "1") {
    const error = new Error("Replacing an existing timed playlist is not enabled until its database and playback checks are complete. The published version remains unchanged.");
    error.code = "REPLACEMENT_NOT_READY";
    throw error;
  }
  const startsAt = localMinuteToUtc(current.scheduledDate.toISOString().slice(0, 10), current.startMinute, current.timezone);
  const durationMinutes = current.endMinute - current.startMinute;
  if (current.publishedVersion > 0) assertFutureTimedReplacement(startsAt);
  return prisma.$transaction(async (tx) => {
    const claimed = await tx.generatedPlaylist.updateMany({
      where: { id: current.id, organisationId, status: { in: ["DRAFT", "PUBLISHED"] }, currentVersion: current.currentVersion, publishedVersion: { lt: current.currentVersion } },
      data: { publishedVersion: current.currentVersion }
    });
    if (claimed.count !== 1) {
      const error = new Error("This timed playlist changed or was already published. Refresh before publishing.");
      error.code = "ALREADY_PUBLISHED";
      throw error;
    }
    const version = await tx.generatedPlaylistVersion.findUnique({
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
    const replacing = current.publishedVersion > 0;
    if (replacing) {
      const expectedSlug = current.publishedVersion === 1 ? `timed-${current.id}` : `timed-${current.id}-v${current.publishedVersion}`;
      const oldMode = await tx.musicMode.findFirst({ where: { id: current.musicModeId || "", organisationId, source: "GENERATED_PLAYLIST", slug: expectedSlug }, select: { id: true } });
      if (!oldMode) {
        const error = new Error("The previously published music mode is missing or no longer belongs to this timed playlist. Nothing was replaced.");
        error.code = "REPLACEMENT_CONFLICT";
        throw error;
      }
    }
    // Preserve the old mode and its tracks for historical schedule versions and any other references.
    const mode = await tx.musicMode.create({ data: { organisationId, name: current.name, slug: replacing ? `timed-${current.id}-v${current.currentVersion}` : `timed-${current.id}`, description: `Frozen timed AutoDJ sequence ${current.scheduledDate.toISOString().slice(0, 10)}.`, source: "GENERATED_PLAYLIST", status: "ACTIVE" } });
    const musicModeId = mode.id;
    await tx.musicModeTrack.createMany({ data: uniquePublishedModeTracks(version.items, musicModeId) });

    if (["LOCATION", "ZONE"].includes(current.targetType)) {
      const targetWhere = current.targetType === "LOCATION" ? { locationId: current.targetId } : { zoneId: current.targetId };
      const overlappingSchedules = await tx.musicSchedule.findMany({ where: { organisationId, ...targetWhere, status: "PUBLISHED", AND: [
        { OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: current.scheduledDate } }] },
        { OR: [{ effectiveTo: null }, { effectiveTo: { gte: current.scheduledDate } }] }
      ] }, include: { slots: true }, take: 2 });
      if (replacing) {
        const scheduleId = replacePublishedAreaSchedule({ schedules: overlappingSchedules, oldMusicModeId: current.musicModeId, scheduledDate: current.scheduledDate, startMinute: current.startMinute, endMinute: current.endMinute, timezone: current.timezone });
        const archived = await tx.musicSchedule.updateMany({ where: { id: scheduleId, organisationId, status: "PUBLISHED" }, data: { status: "ARCHIVED" } });
        if (archived.count !== 1) {
          const error = new Error("The published listening-area schedule changed. Nothing was replaced."); error.code = "REPLACEMENT_CONFLICT"; throw error;
        }
      } else if (overlappingSchedules.length) {
        const error = new Error("A published schedule already covers this listening area and date. Review it before publishing a timed playlist.");
        error.code = "REPLACEMENT_CONFLICT";
        throw error;
      }
      const latest = await tx.musicSchedule.findFirst({ where: { organisationId, ...targetWhere }, orderBy: { version: "desc" }, select: { version: true } });
      await tx.musicSchedule.create({ data: { organisationId, locationId: current.targetType === "LOCATION" ? current.targetId : null, zoneId: current.targetType === "ZONE" ? current.targetId : null, name: current.name, version: (latest?.version || 0) + 1, status: "PUBLISHED", timezone: current.timezone, effectiveFrom: current.scheduledDate, effectiveTo: current.scheduledDate, publishedAt: new Date(), slots: { create: { musicModeId, weekday: current.scheduledDate.getUTCDay(), startMinute: current.startMinute, endMinute: current.endMinute, priority: 50 } } } });
    } else {
      let schedule = await tx.programmeSchedule.findUnique({ where: { channelId_organisationId: { channelId: current.targetId, organisationId } } });
      if (!schedule && replacing) {
        const error = new Error("The published channel schedule is missing. Nothing was replaced."); error.code = "REPLACEMENT_CONFLICT"; throw error;
      }
      if (!schedule) schedule = await tx.programmeSchedule.create({ data: { organisationId, channelId: current.targetId, name: `${current.name} programming`, timezone: current.timezone, createdByUserId: actorUserId } });
      const last = await tx.programmeScheduleVersion.findFirst({ where: { scheduleId: schedule.id }, orderBy: { version: "desc" }, select: { version: true } });
      const activeVersions = await tx.programmeScheduleVersion.findMany({ where: { scheduleId: schedule.id, organisationId, isActive: true }, include: { items: true }, take: 2 });
      if (activeVersions.length > 1) {
        const error = new Error("This channel has more than one active programme version. Nothing was published."); error.code = "REPLACEMENT_CONFLICT"; throw error;
      }
      const replacement = replacing ? replacePublishedProgrammeItem({ schedule, activeVersions, oldMusicModeId: current.musicModeId, newMusicModeId: musicModeId, startsAt, durationMinutes, timezone: current.timezone, name: current.name }) : null;
      const previousItems = !replacing ? (activeVersions[0]?.items || []).sort((a, b) => a.position - b.position).map(programmeItemData) : [];
      const archived = await tx.programmeScheduleVersion.updateMany({ where: { scheduleId: schedule.id, organisationId, isActive: true }, data: { isActive: false, status: "ARCHIVED" } });
      if (replacing && archived.count !== 1) {
        const error = new Error("The active channel schedule changed. Nothing was replaced."); error.code = "REPLACEMENT_CONFLICT"; throw error;
      }
      await tx.programmeScheduleVersion.create({ data: { organisationId, scheduleId: schedule.id, version: (last?.version || 0) + 1, status: "PUBLISHED", isActive: true, createdByUserId: actorUserId, publishedByUserId: actorUserId, publishedAt: new Date(), items: { create: replacement?.items || [...previousItems.map((item, position) => ({ ...item, position })), { position: previousItems.length, label: current.name, recurrence: "ONE_OFF", sourceType: "MUSIC_MODE", startsAt, durationMinutes, priority: 50, musicModeId }] } } });
    }
    await tx.generatedPlaylistVersion.update({ where: { id: version.id }, data: { publishedAt: new Date() } });
    await tx.generatedPlaylist.update({ where: { id: current.id }, data: { musicModeId, status: "PUBLISHED", publishedVersion: current.currentVersion, entitlementLevel: catalogueLevel, invalidReason: null, publishedByUserId: actorUserId, publishedAt: new Date() } });
    await tx.auditLog.create({ data: { organisationId, actorUserId, action: replacing ? "TIMED_PLAYLIST_REPLACED" : "TIMED_PLAYLIST_PUBLISHED", entityType: "GeneratedPlaylist", entityId: current.id, details: { version: current.currentVersion, previousPublishedVersion: current.publishedVersion, itemCount: version.items.length, targetType: current.targetType, targetId: current.targetId, previousMusicModeId: current.musicModeId, musicModeId } } });
    return tx.generatedPlaylist.findUnique({ where: { id: current.id }, include: generatedPlaylistInclude });
  }, { isolationLevel: "Serializable" });
}
