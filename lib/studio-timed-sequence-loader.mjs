import { resolveEntitlements } from "./entitlements.mjs";
import { planPublishedTimedChannelSequence } from "./studio-timed-sequence-plan.mjs";
import { readStudioOnlineAuthority } from "./studio-online-authority.mjs";
import { inspectTimedSequenceAuthority } from "./studio-timed-sequence-authority.mjs";

function unavailable(reason) {
  return { ready: false, reason, listenerVerified: false, commandIssued: false };
}

function unavailableAuthority(reason) {
  return { consistent: false, reason, sourceCommandAllowed: false, listenerVerified: false };
}

async function readSequenceSnapshot(tx, { organisationId, channelId, playlistId, capturedAt }) {
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
}

function checkedInstant(clock, capturedAt) {
  const checkedAt = clock();
  return checkedAt instanceof Date && !Number.isNaN(checkedAt.valueOf()) &&
    checkedAt >= capturedAt && checkedAt.getTime() - capturedAt.getTime() <= 10_000 ? checkedAt : null;
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
    const snapshot = await database.$transaction((tx) => readSequenceSnapshot(tx, {
      organisationId, channelId, playlistId, capturedAt
    }), { isolationLevel: "RepeatableRead" });
    if (snapshot.reason) return unavailable(snapshot.reason);
    const checkedAt = checkedInstant(clock, capturedAt);
    if (!checkedAt) return unavailable("SEQUENCE_SNAPSHOT_STALE");
    return { ...planPublishedTimedChannelSequence({ ...snapshot, organisationId, channelId, instant: checkedAt }), capturedAt };
  } catch {
    return unavailable("SEQUENCE_SNAPSHOT_FAILED");
  }
}

// Read the frozen version and all potentially conflicting Online Radio
// programming in one repeatable-read transaction. This is a diagnostic for an
// isolated future output bridge, not a Centova source command or play proof.
export async function loadPublishedTimedChannelAuthority(database, {
  organisationId, channelId, playlistId, clock = () => new Date()
}) {
  if (!organisationId || !channelId || !playlistId) return unavailableAuthority("SEQUENCE_SCOPE_MISSING");
  const capturedAt = clock();
  if (!(capturedAt instanceof Date) || Number.isNaN(capturedAt.valueOf())) return unavailableAuthority("SEQUENCE_CLOCK_INVALID");
  try {
    const snapshot = await database.$transaction(async (tx) => {
      const rows = await readSequenceSnapshot(tx, { organisationId, channelId, playlistId, capturedAt });
      if (rows.reason) return { reason: rows.reason };
      const sequence = planPublishedTimedChannelSequence({ ...rows, organisationId, channelId, instant: capturedAt });
      if (!sequence.ready) return { reason: sequence.reason };
      const durationMs = sequence.endsAt.getTime() - capturedAt.getTime();
      if (!Number.isInteger(durationMs) || durationMs < 1 || durationMs > 12 * 60 * 60 * 1000) {
        return { reason: "SEQUENCE_AUTHORITY_DURATION_INVALID" };
      }
      const authority = await readStudioOnlineAuthority(tx, {
        organisationId, stationId: rows.channel.stationId, channelId, durationMs, instant: capturedAt
      });
      if (!authority.complete) return { reason: authority.reason };
      return { sequence: { ...sequence, capturedAt }, authority };
    }, { isolationLevel: "RepeatableRead" });
    if (snapshot.reason) return unavailableAuthority(snapshot.reason);
    const checkedAt = checkedInstant(clock, capturedAt);
    if (!checkedAt) return unavailableAuthority("SEQUENCE_SNAPSHOT_STALE");
    return inspectTimedSequenceAuthority({ ...snapshot, instant: checkedAt });
  } catch {
    return unavailableAuthority("SEQUENCE_SNAPSHOT_FAILED");
  }
}
