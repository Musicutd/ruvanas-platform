import { prisma } from "@/lib/prisma";
import {
  evaluateSmartPlaylistCandidates,
  smartPlaylistTrackQuery
} from "@/lib/smart-playlists.mjs";

const playlistInclude = {
  musicMode: { select: { id: true, name: true, slug: true, description: true, status: true, source: true } },
  rules: { orderBy: { position: "asc" } },
  createdBy: { select: { id: true, name: true } },
  publishedBy: { select: { id: true, name: true } }
};

const candidateInclude = {
  mediaAsset: {
    include: {
      genres: { include: { mediaGenre: { select: { id: true, name: true, slug: true } } } }
    }
  }
};

export function safeSmartPlaylist(playlist) {
  return {
    id: playlist.id,
    name: playlist.musicMode.name,
    slug: playlist.musicMode.slug,
    description: playlist.musicMode.description,
    status: playlist.status,
    version: playlist.version,
    materializedVersion: playlist.materializedVersion,
    needsPublish: playlist.version !== playlist.materializedVersion,
    maxTracks: playlist.maxTracks,
    defaultWeight: playlist.defaultWeight,
    sort: playlist.sort,
    rightsUse: playlist.rightsUse,
    territory: playlist.territory,
    trackCount: playlist.lastMaterializedCount,
    lastMaterializedAt: playlist.lastMaterializedAt?.toISOString() || null,
    publishedAt: playlist.publishedAt?.toISOString() || null,
    updatedAt: playlist.updatedAt.toISOString(),
    musicMode: playlist.musicMode,
    createdBy: playlist.createdBy,
    publishedBy: playlist.publishedBy,
    rules: playlist.rules.map((rule) => ({ id: rule.id, field: rule.field, operator: rule.operator, value: rule.value }))
  };
}

export async function listSmartPlaylists(organisationId) {
  const playlists = await prisma.smartPlaylist.findMany({
    where: { organisationId, status: { not: "ARCHIVED" } },
    include: playlistInclude,
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    take: 100
  });
  return playlists.map(safeSmartPlaylist);
}

async function playlistForEvaluation(client, organisationId, smartPlaylistId) {
  return client.smartPlaylist.findFirst({
    where: { id: smartPlaylistId, organisationId, status: { not: "ARCHIVED" } },
    include: playlistInclude
  });
}

async function evaluateWithClient(client, playlist, instant) {
  const query = smartPlaylistTrackQuery(playlist);
  const tracks = await client.track.findMany({ ...query, include: candidateInclude });
  return evaluateSmartPlaylistCandidates(tracks, playlist, instant);
}

export async function previewSmartPlaylist({ organisationId, smartPlaylistId, instant = new Date() }) {
  const playlist = await playlistForEvaluation(prisma, organisationId, smartPlaylistId);
  if (!playlist) return null;
  const selected = await evaluateWithClient(prisma, playlist, instant);
  return {
    playlist: safeSmartPlaylist(playlist),
    generatedAt: instant.toISOString(),
    count: selected.length,
    tracks: selected.map(({ track, eligibilityReason, explanations }) => ({
      id: track.id,
      title: track.title,
      artist: track.artist,
      album: track.album,
      releaseYear: track.releaseYear,
      isExplicit: track.isExplicit,
      libraryType: track.mediaAsset.libraryType,
      eligibilityReason,
      explanations
    }))
  };
}

export async function materializeSmartPlaylist({ organisationId, smartPlaylistId, actorUserId, instant = new Date() }) {
  return prisma.$transaction(async (tx) => {
    const playlist = await playlistForEvaluation(tx, organisationId, smartPlaylistId);
    if (!playlist) return null;
    const selected = await evaluateWithClient(tx, playlist, instant);
    if (!selected.length) {
      const error = new Error("No playable, rights-approved tracks match these rules. Review the preview before publishing.");
      error.code = "EMPTY_SMART_PLAYLIST";
      throw error;
    }

    await tx.musicModeTrack.deleteMany({ where: { musicModeId: playlist.musicModeId } });
    await tx.musicModeTrack.createMany({
      data: selected.map(({ track }) => ({
        musicModeId: playlist.musicModeId,
        trackId: track.id,
        weight: playlist.defaultWeight
      }))
    });
    const updated = await tx.smartPlaylist.update({
      where: { id: playlist.id },
      data: {
        status: "ACTIVE",
        materializedVersion: playlist.version,
        lastMaterializedAt: instant,
        lastMaterializedCount: selected.length,
        publishedAt: instant,
        publishedBy: { connect: { id: actorUserId } },
        musicMode: { update: { status: "ACTIVE", source: "SMART_PLAYLIST" } }
      },
      include: playlistInclude
    });
    await tx.auditLog.create({
      data: {
        organisationId,
        actorUserId,
        action: "SMART_PLAYLIST_PUBLISHED",
        entityType: "SmartPlaylist",
        entityId: playlist.id,
        details: {
          version: playlist.version,
          musicModeId: playlist.musicModeId,
          matchedTrackCount: selected.length,
          ruleCount: playlist.rules.length,
          rightsUse: playlist.rightsUse,
          territory: playlist.territory,
          failClosedRightsEligibility: true
        }
      }
    });
    return safeSmartPlaylist(updated);
  });
}

export async function archiveSmartPlaylist({ organisationId, smartPlaylistId, actorUserId }) {
  return prisma.$transaction(async (tx) => {
    const playlist = await tx.smartPlaylist.findFirst({ where: { id: smartPlaylistId, organisationId }, select: { id: true, musicModeId: true, status: true } });
    if (!playlist) return null;
    const updated = await tx.smartPlaylist.update({
      where: { id: playlist.id },
      data: { status: "ARCHIVED", musicMode: { update: { status: "ARCHIVED" } } },
      include: playlistInclude
    });
    await tx.auditLog.create({
      data: {
        organisationId,
        actorUserId,
        action: "SMART_PLAYLIST_ARCHIVED",
        entityType: "SmartPlaylist",
        entityId: playlist.id,
        details: { previousStatus: playlist.status, musicModeId: playlist.musicModeId }
      }
    });
    return safeSmartPlaylist(updated);
  });
}
