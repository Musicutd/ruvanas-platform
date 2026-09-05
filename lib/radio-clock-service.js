import { prisma } from "@/lib/prisma";
import { musicModeIsPlayable } from "@/lib/music-mode-playback.mjs";
import { musicTrackEligibility } from "@/lib/media-library-pro.mjs";
import {
  assertRadioClockPublishable,
  radioClockSourceId,
  radioClockTimeline
} from "@/lib/radio-clocks.mjs";

const mediaAssetSelect = { id: true, status: true, libraryType: true, organisationId: true, durationSeconds: true };

const clockInclude = {
  createdBy: { select: { id: true, name: true } },
  publishedBy: { select: { id: true, name: true } },
  items: {
    orderBy: { position: "asc" },
    include: {
      musicMode: { select: { id: true, name: true, status: true } },
      track: { select: { id: true, title: true, artist: true, status: true } },
      promoVersion: { select: { id: true, version: true, status: true, qcStatus: true, promoAsset: { select: { name: true } } } },
      voiceTrackSegue: { select: { id: true, title: true, status: true, version: true, voiceTrimStartMs: true, voiceTrimEndMs: true, outgoingOverlapMs: true, incomingOverlapMs: true } },
      schoolRundown: { select: { id: true, status: true, revision: true, approvedRevision: true, episode: { select: { title: true } } } }
    }
  }
};

const playbackModeInclude = {
  tracks: { include: { track: { include: { mediaAsset: true } } } }
};

function sourceSummary(item) {
  if (item.musicMode) return { id: item.musicMode.id, name: item.musicMode.name, status: item.musicMode.status };
  if (item.track) return { id: item.track.id, name: `${item.track.artist} — ${item.track.title}`, status: item.track.status };
  if (item.promoVersion) return { id: item.promoVersion.id, name: `${item.promoVersion.promoAsset.name} · v${item.promoVersion.version}`, status: item.promoVersion.status };
  if (item.voiceTrackSegue) return { id: item.voiceTrackSegue.id, name: item.voiceTrackSegue.title, status: item.voiceTrackSegue.status };
  if (item.schoolRundown) return { id: item.schoolRundown.id, name: item.schoolRundown.episode.title, status: item.schoolRundown.status };
  return null;
}

export function safeRadioClock(clock) {
  const timeline = radioClockTimeline(clock.items, clock.durationSeconds);
  return {
    id: clock.id,
    name: clock.name,
    slug: clock.slug,
    description: clock.description,
    status: clock.status,
    version: clock.version,
    publishedVersion: clock.publishedVersion,
    needsPublish: clock.version !== clock.publishedVersion,
    durationSeconds: clock.durationSeconds,
    plannedSeconds: timeline.plannedSeconds,
    remainingSeconds: timeline.remainingSeconds,
    readyToPublish: timeline.readyToPublish,
    publishedAt: clock.publishedAt?.toISOString() || null,
    updatedAt: clock.updatedAt.toISOString(),
    createdBy: clock.createdBy,
    publishedBy: clock.publishedBy,
    items: timeline.items.map((item) => ({
      id: item.id,
      position: item.position,
      type: item.type,
      label: item.label,
      offsetSeconds: item.offsetSeconds,
      endsAtSeconds: item.endsAtSeconds,
      durationSeconds: item.durationSeconds,
      transition: item.transition,
      transitionSeconds: item.transitionSeconds,
      sourceId: radioClockSourceId(item),
      source: sourceSummary(item)
    }))
  };
}

export async function listRadioClocks(organisationId) {
  const clocks = await prisma.radioClock.findMany({
    where: { organisationId, status: { not: "ARCHIVED" } },
    include: clockInclude,
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    take: 100
  });
  return clocks.map(safeRadioClock);
}

export async function radioClockSources(organisationId, instant = new Date()) {
  const [musicModes, tracks, promos, voiceTracks, rundowns] = await Promise.all([
    prisma.musicMode.findMany({
      where: { organisationId, status: "ACTIVE" },
      include: playbackModeInclude,
      orderBy: { name: "asc" },
      take: 200
    }),
    prisma.track.findMany({
      where: {
        status: "READY",
        mediaAsset: {
          status: "READY",
          mediaType: "MUSIC",
          OR: [
            { libraryType: "RUVANAS_CATALOGUE", organisationId: null },
            { libraryType: "ORGANISATION_MUSIC", organisationId }
          ]
        }
      },
      include: { mediaAsset: { select: mediaAssetSelect } },
      orderBy: [{ artist: "asc" }, { title: "asc" }],
      take: 500
    }),
    prisma.promoVersion.findMany({
      where: { promoAsset: { organisationId }, status: "APPROVED", qcStatus: "PASSED", mediaAsset: { status: "READY" } },
      select: { id: true, version: true, durationSeconds: true, promoAsset: { select: { name: true } } },
      orderBy: { updatedAt: "desc" },
      take: 200
    }),
    prisma.voiceTrackSegue.findMany({
      where: { organisationId, status: "APPROVED" },
      select: { id: true, title: true, voiceTrimStartMs: true, voiceTrimEndMs: true, outgoingOverlapMs: true, incomingOverlapMs: true },
      orderBy: { updatedAt: "desc" },
      take: 200
    }),
    prisma.schoolRundown.findMany({
      where: { organisationId, status: "APPROVED", approvedRevision: { not: null } },
      select: { id: true, revision: true, approvedRevision: true, episode: { select: { title: true } }, _count: { select: { items: true } } },
      orderBy: { updatedAt: "desc" },
      take: 100
    })
  ]);
  return {
    musicModes: musicModes.filter((mode) => musicModeIsPlayable(mode, instant, { organisationId, requiredUse: "ONLINE_RADIO" })).map((mode) => ({ id: mode.id, name: mode.name })),
    tracks: tracks.filter((track) => musicTrackEligibility(track, { organisationId, requiredUse: "ONLINE_RADIO", instant }).playable).map((track) => ({ id: track.id, name: `${track.artist} — ${track.title}`, durationSeconds: track.mediaAsset.durationSeconds })),
    promos: promos.map((promo) => ({ id: promo.id, name: `${promo.promoAsset.name} · v${promo.version}`, durationSeconds: promo.durationSeconds })),
    voiceTracks: voiceTracks.map((segue) => ({ id: segue.id, name: segue.title, durationSeconds: Math.max(1, Math.ceil((segue.voiceTrimEndMs - segue.voiceTrimStartMs - segue.incomingOverlapMs + segue.incomingIntroEndMs) / 1000)) })),
    rundowns: rundowns.filter((rundown) => rundown.revision === rundown.approvedRevision && rundown._count.items > 0).map((rundown) => ({ id: rundown.id, name: rundown.episode.title }))
  };
}

export async function validateRadioClockSources(client, organisationId, items, { requireReady = false, instant = new Date() } = {}) {
  const ids = (type) => [...new Set(items.filter((item) => item.type === type).map(radioClockSourceId).filter(Boolean))];
  const [musicModes, tracks, promos, voiceTracks, rundowns] = await Promise.all([
    client.musicMode.findMany({ where: { id: { in: ids("MUSIC_MODE") }, organisationId }, include: playbackModeInclude }),
    client.track.findMany({
      where: {
        id: { in: ids("MUSIC_TRACK") },
        mediaAsset: { OR: [{ libraryType: "RUVANAS_CATALOGUE", organisationId: null }, { libraryType: "ORGANISATION_MUSIC", organisationId }] }
      },
      include: { mediaAsset: { select: mediaAssetSelect } }
    }),
    client.promoVersion.findMany({ where: { id: { in: ids("PROMO") }, promoAsset: { organisationId } }, include: { mediaAsset: { select: mediaAssetSelect } } }),
    client.voiceTrackSegue.findMany({ where: { id: { in: ids("VOICE_TRACK") }, organisationId }, include: { audioRender: { select: { status: true } }, voicePromoVersion: { include: { mediaAsset: { select: mediaAssetSelect } } }, outgoingTrack: { include: { mediaAsset: { select: mediaAssetSelect } } }, incomingTrack: { include: { mediaAsset: { select: mediaAssetSelect } } } } }),
    client.schoolRundown.findMany({ where: { id: { in: ids("SHOW_RUNDOWN") }, organisationId }, include: { _count: { select: { items: true } } } })
  ]);
  const found = {
    MUSIC_MODE: new Map(musicModes.map((item) => [item.id, item])),
    MUSIC_TRACK: new Map(tracks.map((item) => [item.id, item])),
    PROMO: new Map(promos.map((item) => [item.id, item])),
    VOICE_TRACK: new Map(voiceTracks.map((item) => [item.id, item])),
    SHOW_RUNDOWN: new Map(rundowns.map((item) => [item.id, item]))
  };
  for (const item of items) {
    if (item.type === "MARKER") continue;
    const source = found[item.type].get(radioClockSourceId(item));
    if (!source) throw new Error(`${item.label} uses a source outside this organisation or library.`);
    if (!requireReady) continue;
    if (item.type === "MUSIC_MODE" && !musicModeIsPlayable(source, instant, { organisationId, requiredUse: "ONLINE_RADIO" })) throw new Error(`${item.label} needs an active music mode with playable tracks.`);
    if (item.type === "MUSIC_TRACK" && !musicTrackEligibility(source, { organisationId, requiredUse: "ONLINE_RADIO", instant }).playable) throw new Error(`${item.label} needs a ready track cleared for Online Radio.`);
    if (item.type === "PROMO" && (source.status !== "APPROVED" || source.qcStatus !== "PASSED" || source.mediaAsset.status !== "READY")) throw new Error(`${item.label} needs an approved, quality-checked promo.`);
    if (item.type === "VOICE_TRACK" && (source.status !== "APPROVED" || source.audioRender.status !== "SUCCEEDED" || source.voicePromoVersion.status !== "APPROVED" || source.voicePromoVersion.qcStatus !== "PASSED" || source.voicePromoVersion.mediaAsset.status !== "READY" || !musicTrackEligibility(source.outgoingTrack, { organisationId, requiredUse: "ONLINE_RADIO", instant }).playable || !musicTrackEligibility(source.incomingTrack, { organisationId, requiredUse: "ONLINE_RADIO", instant }).playable)) throw new Error(`${item.label} needs a current approved voice-track segue.`);
    if (item.type === "SHOW_RUNDOWN" && (source.status !== "APPROVED" || source.approvedRevision !== source.revision || source._count.items < 1)) throw new Error(`${item.label} needs the current approved Show Builder rundown.`);
  }
}

export async function previewRadioClock({ organisationId, radioClockId }) {
  const clock = await prisma.radioClock.findFirst({ where: { id: radioClockId, organisationId, status: { not: "ARCHIVED" } }, include: clockInclude });
  return clock ? safeRadioClock(clock) : null;
}

export async function publishRadioClock({ organisationId, radioClockId, actorUserId, instant = new Date() }) {
  return prisma.$transaction(async (tx) => {
    const clock = await tx.radioClock.findFirst({ where: { id: radioClockId, organisationId, status: { not: "ARCHIVED" } }, include: clockInclude });
    if (!clock) return null;
    assertRadioClockPublishable(clock);
    await validateRadioClockSources(tx, organisationId, clock.items, { requireReady: true, instant });
    const updated = await tx.radioClock.update({
      where: { id: clock.id },
      data: { status: "PUBLISHED", publishedVersion: clock.version, publishedAt: instant, publishedBy: { connect: { id: actorUserId } } },
      include: clockInclude
    });
    await tx.auditLog.create({
      data: {
        organisationId,
        actorUserId,
        action: "RADIO_CLOCK_PUBLISHED",
        entityType: "RadioClock",
        entityId: clock.id,
        details: { version: clock.version, durationSeconds: clock.durationSeconds, itemCount: clock.items.length, exactHour: true }
      }
    });
    return safeRadioClock(updated);
  });
}

export async function archiveRadioClock({ organisationId, radioClockId, actorUserId }) {
  return prisma.$transaction(async (tx) => {
    const clock = await tx.radioClock.findFirst({ where: { id: radioClockId, organisationId }, select: { id: true, status: true, version: true } });
    if (!clock) return null;
    const updated = await tx.radioClock.update({ where: { id: clock.id }, data: { status: "ARCHIVED" }, include: clockInclude });
    await tx.auditLog.create({ data: { organisationId, actorUserId, action: "RADIO_CLOCK_ARCHIVED", entityType: "RadioClock", entityId: clock.id, details: { previousStatus: clock.status, version: clock.version } } });
    return safeRadioClock(updated);
  });
}

export { clockInclude };
