import { genreCodesForTrack, sourceScopeForTrack } from "./autodj-genre-entitlements.mjs";
import { musicTrackEligibility } from "./media-library-pro.mjs";
import { findPublishedProgrammeConflict } from "./subscriber-playlists.mjs";

export async function activeProgrammeConflict(db, { organisationId, channelId, startsAt, endsAt }) {
  const schedule = await db.programmeSchedule.findFirst({
    where: { organisationId, channelId },
    include: { versions: { where: { status: "PUBLISHED", isActive: true }, take: 1, include: { items: true } } }
  });
  const version = schedule?.versions?.[0];
  return version ? findPublishedProgrammeConflict(version, { startsAt, endsAt }, schedule.timezone) : null;
}

export async function loadEligibleSubscriberMusic(db, { organisationId, requiredUse, territory = null, catalogueLevel = null, sourceScopes = null, instant = new Date(), configuredGenres = [] }) {
  const tracks = await db.track.findMany({
    where: {
      status: "READY",
      mediaAsset: { status: "READY", mediaType: "MUSIC", OR: [
        { libraryType: "ORGANISATION_MUSIC", organisationId },
        { libraryType: "RUVANAS_CATALOGUE", organisationId: null }
      ] }
    },
    include: { mediaAsset: { include: { genres: { include: { mediaGenre: true } } } }, distributorItems: { select: { status: true, autoDjReady: true, canonicalGenre: { select: { active: true, providerReviewStatus: true, minimumCatalogueLevel: true, slug: true, name: true } } } } },
    orderBy: { id: "asc" },
    take: 5000
  });
  const scopes = sourceScopes ? new Set(sourceScopes) : null;
  return tracks.filter((track) => (
    !(requiredUse === "SCHOOL_RADIO" && track.isExplicit) &&
    (!scopes || scopes.has(sourceScopeForTrack(track))) &&
    musicTrackEligibility(track, { organisationId, requiredUse, territory, licensedCatalogueLevel: catalogueLevel, configuredGenres, instant }).playable &&
    Number(track.mediaAsset.durationSeconds) > 2
  )).map((track) => ({ track, genreCodes: genreCodesForTrack(track) }));
}

export function rightsUseForChannel(channel) {
  if (channel?.musicRightsUse) return channel.musicRightsUse;
  const family = channel?.station?.productFamily;
  return {
    RETAIL: "RETAIL_RADIO", SCHOOL: "SCHOOL_RADIO", ONLINE: "ONLINE_RADIO",
    HEALTH: "HEALTH_RADIO", FAITH: "FAITH_RADIO", ORGANISATIONS: "ORGANISATIONS_RADIO"
  }[family] || null;
}

export function safeSimplePlaylist(playlist) {
  return {
    id: playlist.id, name: playlist.musicMode?.name || playlist.name, status: playlist.status,
    durationMinutes: playlist.durationMinutes, buildMode: playlist.simpleBuildMode, rightsUse: playlist.rightsUse,
    genreCodes: Array.isArray(playlist.genreCodes) ? playlist.genreCodes : [],
    updatedAt: playlist.updatedAt
  };
}
