import { prisma } from "./prisma.js";
import { musicTrackEligibility } from "./media-library-pro.mjs";
import { assertVoiceTrackSegueApprovable, normalizeVoiceTrackSegue, safeVoiceTrackSegue } from "./voice-tracking-segue.mjs";

const mediaAsset = { select: { id: true, status: true, organisationId: true, libraryType: true, durationSeconds: true } };
const include = {
  channel: { select: { id: true, name: true, station: { select: { name: true } } } },
  audioProject: { select: { id: true, title: true, type: true } },
  audioRender: { select: { id: true, status: true } },
  voicePromoVersion: { include: { mediaAsset, promoAsset: { select: { name: true } } } },
  outgoingTrack: { include: { mediaAsset } },
  incomingTrack: { include: { mediaAsset } }
};

async function loadSources(client, organisationId, input = {}, now = new Date()) {
  input = input || {};
  const [channel, render, outgoingTrack, incomingTrack] = await Promise.all([
    client.channel.findFirst({ where: { id: input.channelId, organisationId, status: "ACTIVE" }, select: { id: true } }),
    client.audioRender.findFirst({ where: { id: input.audioRenderId, organisationId, status: "SUCCEEDED", project: { organisationId }, outputPromoVersion: { is: { status: "APPROVED", qcStatus: "PASSED", promoAsset: { organisationId }, mediaAsset: { status: "READY", organisationId } } } }, include: { project: { select: { id: true, type: true } }, outputPromoVersion: { include: { mediaAsset: true } } } }),
    client.track.findFirst({ where: { id: input.outgoingTrackId }, include: { mediaAsset: true } }),
    client.track.findFirst({ where: { id: input.incomingTrackId }, include: { mediaAsset: true } })
  ]);
  if (!channel) throw new Error("Choose an active channel owned by this organisation.");
  if (!render?.outputPromoVersion || !["VOICE_TRACK", "MULTITRACK", "QUICK_RECORD"].includes(render.project.type)) throw new Error("Choose an approved AudioLab or multitrack render from this organisation.");
  for (const [track, label] of [[outgoingTrack, "outgoing"], [incomingTrack, "incoming"]]) {
    if (!track || !musicTrackEligibility(track, { organisationId, requiredUse: "ONLINE_RADIO", instant: now }).playable) throw new Error(`The ${label} track is unavailable or not cleared for Online Radio.`);
  }
  const durations = {
    voiceDurationMs: Number(render.outputPromoVersion.durationSeconds || render.outputPromoVersion.mediaAsset.durationSeconds || 0) * 1000,
    outgoingDurationMs: Number(outgoingTrack.mediaAsset.durationSeconds || 0) * 1000,
    incomingDurationMs: Number(incomingTrack.mediaAsset.durationSeconds || 0) * 1000
  };
  const normalized = normalizeVoiceTrackSegue(input, durations);
  return { normalized, channel, render, outgoingTrack, incomingTrack };
}

export async function voiceTrackSegueCatalogue(organisationId, now = new Date()) {
  const [channels, renders, candidateTracks, segues] = await Promise.all([
    prisma.channel.findMany({ where: { organisationId, status: "ACTIVE" }, select: { id: true, name: true, station: { select: { name: true } } }, orderBy: { name: "asc" }, take: 100 }),
    prisma.audioRender.findMany({ where: { organisationId, status: "SUCCEEDED", outputPromoVersion: { is: { status: "APPROVED", qcStatus: "PASSED", promoAsset: { organisationId }, mediaAsset: { status: "READY", organisationId } } } }, include: { project: { select: { id: true, title: true, type: true } }, outputPromoVersion: { include: { mediaAsset: { select: { id: true, durationSeconds: true } }, promoAsset: { select: { name: true } } } } }, orderBy: { completedAt: "desc" }, take: 100 }),
    prisma.track.findMany({ where: { status: "READY", mediaAsset: { status: "READY", mediaType: "MUSIC", OR: [{ libraryType: "RUVANAS_CATALOGUE", organisationId: null }, { libraryType: "ORGANISATION_MUSIC", organisationId }] } }, include: { mediaAsset: true }, orderBy: [{ artist: "asc" }, { title: "asc" }], take: 500 }),
    prisma.voiceTrackSegue.findMany({ where: { organisationId, status: { not: "ARCHIVED" } }, include, orderBy: { updatedAt: "desc" }, take: 100 })
  ]);
  const tracks = candidateTracks.filter((track) => musicTrackEligibility(track, { organisationId, requiredUse: "ONLINE_RADIO", instant: now }).playable);
  return {
    channels: channels.map((channel) => ({ id: channel.id, name: channel.station ? `${channel.station.name} / ${channel.name}` : channel.name })),
    renders: renders.filter((render) => ["VOICE_TRACK", "MULTITRACK", "QUICK_RECORD"].includes(render.project.type)).map((render) => ({ id: render.id, projectId: render.project.id, name: `${render.project.title} · ${render.outputPromoVersion.promoAsset.name}`, durationMs: Number(render.outputPromoVersion.durationSeconds || render.outputPromoVersion.mediaAsset.durationSeconds || 0) * 1000, streamUrl: `/api/media/${render.outputPromoVersion.mediaAsset.id}/stream` })),
    tracks: tracks.map((track) => ({ id: track.id, name: `${track.artist} — ${track.title}`, durationMs: Number(track.mediaAsset.durationSeconds || 0) * 1000, streamUrl: `/api/media/${track.mediaAssetId}/stream` })),
    segues: segues.map(safeVoiceTrackSegue)
  };
}

export async function createVoiceTrackSegue({ organisationId, actorUserId, input }) {
  const sources = await loadSources(prisma, organisationId, input);
  const { timeline: _timeline, ...normalized } = sources.normalized;
  return prisma.$transaction(async (tx) => {
    const created = await tx.voiceTrackSegue.create({ data: {
      ...normalized,
      organisationId,
      audioProjectId: sources.render.project.id,
      voicePromoVersionId: sources.render.outputPromoVersion.id,
      createdByUserId: actorUserId
    }, include });
    await tx.auditLog.create({ data: { organisationId, actorUserId, action: "VOICE_TRACK_SEGUE_CREATED", entityType: "VoiceTrackSegue", entityId: created.id, details: { channelId: created.channelId, audioProjectId: created.audioProjectId, audioRenderId: created.audioRenderId, outgoingTrackId: created.outgoingTrackId, incomingTrackId: created.incomingTrackId, version: created.version } } });
    return safeVoiceTrackSegue(created);
  });
}

export async function updateVoiceTrackSegue({ organisationId, segueId, actorUserId, input, expectedVersion }) {
  const existing = await prisma.voiceTrackSegue.findFirst({ where: { id: segueId, organisationId, status: "DRAFT" }, select: { id: true, version: true } });
  if (!existing) return null;
  if (existing.version !== expectedVersion) throw new Error("This voice track changed in another browser. Refresh before saving.");
  const sources = await loadSources(prisma, organisationId, input);
  const { timeline: _timeline, ...normalized } = sources.normalized;
  return prisma.$transaction(async (tx) => {
    const changed = await tx.voiceTrackSegue.updateMany({ where: { id: segueId, organisationId, status: "DRAFT", version: expectedVersion }, data: { ...normalized, audioProjectId: sources.render.project.id, voicePromoVersionId: sources.render.outputPromoVersion.id, version: { increment: 1 } } });
    if (!changed.count) throw new Error("This voice track changed in another browser. Refresh before saving.");
    const updated = await tx.voiceTrackSegue.findUnique({ where: { id: segueId }, include });
    await tx.auditLog.create({ data: { organisationId, actorUserId, action: "VOICE_TRACK_SEGUE_UPDATED", entityType: "VoiceTrackSegue", entityId: segueId, details: { version: updated.version } } });
    return safeVoiceTrackSegue(updated);
  });
}

export async function changeVoiceTrackSegueStatus({ organisationId, segueId, actorUserId, action, expectedVersion, previewAcknowledged = false }) {
  const existing = await prisma.voiceTrackSegue.findFirst({ where: { id: segueId, organisationId }, include });
  if (!existing) return null;
  if (existing.version !== expectedVersion) throw new Error("This voice track changed in another browser. Refresh before continuing.");
  if (action === "APPROVE") {
    assertVoiceTrackSegueApprovable(existing, { previewAcknowledged });
    for (const [track, label] of [[existing.outgoingTrack, "outgoing"], [existing.incomingTrack, "incoming"]]) {
      if (!musicTrackEligibility(track, { organisationId, requiredUse: "ONLINE_RADIO", instant: new Date() }).playable) throw new Error(`The ${label} track is no longer cleared for Online Radio.`);
    }
  }
  if (action === "ARCHIVE" && existing.status === "ARCHIVED") throw new Error("This voice track is already archived.");
  const status = action === "APPROVE" ? "APPROVED" : "ARCHIVED";
  return prisma.$transaction(async (tx) => {
    const changed = await tx.voiceTrackSegue.updateMany({ where: { id: segueId, organisationId, version: expectedVersion }, data: { status, ...(status === "APPROVED" ? { approvedByUserId: actorUserId, approvedAt: new Date() } : {}), version: { increment: 1 } } });
    if (!changed.count) throw new Error("This voice track changed in another browser. Refresh before continuing.");
    const updated = await tx.voiceTrackSegue.findUnique({ where: { id: segueId }, include });
    await tx.auditLog.create({ data: { organisationId, actorUserId, action: `VOICE_TRACK_SEGUE_${status}`, entityType: "VoiceTrackSegue", entityId: segueId, details: { version: updated.version, channelId: updated.channelId } } });
    return safeVoiceTrackSegue(updated);
  });
}
