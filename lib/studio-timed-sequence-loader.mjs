import { resolveEntitlements } from "./entitlements.mjs";
import { planPublishedTimedChannelSequence } from "./studio-timed-sequence-plan.mjs";

function unavailable(reason) {
  return { ready: false, reason, listenerVerified: false, commandIssued: false };
}

// Read-only authority preparation for a future isolated encoder adapter. This
// neither downloads protected media nor modifies a worker, station or stream.
export async function loadPublishedTimedChannelSequence(database, {
  organisationId, channelId, playlistId, clock = () => new Date()
}) {
  if (!organisationId || !channelId || !playlistId) return unavailable("SEQUENCE_SCOPE_MISSING");
  const capturedAt = clock();
  if (!(capturedAt instanceof Date) || Number.isNaN(capturedAt.valueOf())) return unavailable("SEQUENCE_CLOCK_INVALID");
  try {
    const snapshot = await database.$transaction(async (tx) => {
      const channel = await tx.channel.findFirst({
        where: { id: channelId, organisationId, status: "ACTIVE" },
        include: { station: true }
      });
      if (!channel || channel.station?.productFamily !== "ONLINE") return { reason: "SEQUENCE_SCOPE_INVALID" };
      const organisation = await tx.organisation.findUnique({
        where: { id: organisationId },
        include: { subscription: { include: { plan: true, billingContract: true } } }
      });
      const entitlements = resolveEntitlements(organisation?.subscription, capturedAt);
      if (!entitlements.onlineRadioEnabled) return { reason: "SEQUENCE_SERVICE_INACTIVE" };
      const playlist = await tx.generatedPlaylist.findFirst({ where: { id: playlistId, organisationId, targetType: "CHANNEL", targetId: channelId } });
      if (!playlist?.publishedVersion) return { reason: "SEQUENCE_NOT_PUBLISHED_FOR_CHANNEL" };
      const version = await tx.generatedPlaylistVersion.findUnique({
        where: { generatedPlaylistId_version: { generatedPlaylistId: playlist.id, version: playlist.publishedVersion } },
        include: { items: { orderBy: { position: "asc" }, take: 2501, include: {
          track: { include: { mediaAsset: { include: { genres: { include: { mediaGenre: true } } } } } }
        } } }
      });
      const schedule = await tx.programmeSchedule.findUnique({
        where: { channelId_organisationId: { channelId, organisationId } },
        include: { versions: { where: { status: "PUBLISHED", isActive: true }, take: 2, include: { items: true } } }
      });
      const configuredGenres = await tx.mediaGenre.findMany({
        where: { active: true }, select: { name: true, slug: true, active: true, minimumCatalogueLevel: true }, take: 250
      });
      return { channel, playlist: { ...playlist, versions: version ? [version] : [] }, schedule,
        catalogueLevel: entitlements.licensedMusicCatalogueLevel, configuredGenres };
    }, { isolationLevel: "RepeatableRead" });
    if (snapshot.reason) return unavailable(snapshot.reason);
    const checkedAt = clock();
    if (!(checkedAt instanceof Date) || Number.isNaN(checkedAt.valueOf()) ||
        checkedAt < capturedAt || checkedAt.getTime() - capturedAt.getTime() > 10_000) {
      return unavailable("SEQUENCE_SNAPSHOT_STALE");
    }
    return { ...planPublishedTimedChannelSequence({ ...snapshot, organisationId, channelId, instant: checkedAt }), capturedAt };
  } catch {
    return unavailable("SEQUENCE_SNAPSHOT_FAILED");
  }
}
