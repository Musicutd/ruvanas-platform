import crypto from "node:crypto";
import { prisma } from "./prisma.js";
import { broadcastProcessingSnapshot, normalizeBroadcastProcessingProfile, safeBroadcastProcessingProfile } from "./broadcast-audio-processing.mjs";

const renderInclude = {
  project: { select: { id: true, title: true, type: true } },
  outputMediaAsset: { select: { id: true, name: true, durationSeconds: true, status: true } },
  broadcastProcessingProfile: { select: { id: true, name: true } }
};

function safeOutput(render) {
  const report = render.resultJson && typeof render.resultJson === "object" ? render.resultJson : {};
  return {
    id: render.id,
    projectId: render.project.id,
    projectTitle: render.project.title,
    profile: render.broadcastProcessingProfile,
    profileRevision: render.broadcastProcessingProfileRevision,
    status: render.status,
    qcStatus: render.processingQcStatus,
    qcNotes: render.processingQcNotes,
    loudnessLufs: render.loudnessLufs,
    truePeakDbfs: Number.isFinite(Number(report.truePeakDbfs)) ? Number(report.truePeakDbfs) : null,
    loudnessRangeLu: Number.isFinite(Number(report.loudnessRangeLu)) ? Number(report.loudnessRangeLu) : null,
    createdAt: render.createdAt,
    completedAt: render.completedAt,
    streamUrl: render.outputMediaAsset?.status === "READY" ? `/api/media/${render.outputMediaAsset.id}/stream` : null
  };
}

export async function broadcastProcessingWorkspace(organisationId) {
  const [profiles, sourceRenders, outputs] = await Promise.all([
    prisma.broadcastProcessingProfile.findMany({ where: { organisationId, status: { not: "ARCHIVED" } }, orderBy: [{ status: "asc" }, { updatedAt: "desc" }], take: 50 }),
    prisma.audioRender.findMany({
      where: { organisationId, status: "SUCCEEDED", broadcastProcessingProfileId: null, outputMediaAsset: { is: { organisationId, status: "READY" } } },
      include: renderInclude,
      orderBy: { completedAt: "desc" },
      take: 100
    }),
    prisma.audioRender.findMany({
      where: { organisationId, broadcastProcessingProfileId: { not: null } },
      include: renderInclude,
      orderBy: { createdAt: "desc" },
      take: 100
    })
  ]);
  return {
    profiles: profiles.map(safeBroadcastProcessingProfile),
    sourceRenders: sourceRenders.map((render) => ({ id: render.id, projectTitle: render.project.title, projectType: render.project.type, durationSeconds: render.outputMediaAsset?.durationSeconds || null })),
    outputs: outputs.map(safeOutput)
  };
}

export async function createBroadcastProcessingProfile({ organisationId, actorUserId, input }) {
  const normalized = normalizeBroadcastProcessingProfile(input);
  return prisma.$transaction(async (tx) => {
    const profile = await tx.broadcastProcessingProfile.create({ data: { ...normalized, organisationId, createdByUserId: actorUserId } });
    await tx.auditLog.create({ data: { organisationId, actorUserId, action: "BROADCAST_PROCESSING_PROFILE_CREATED", entityType: "BroadcastProcessingProfile", entityId: profile.id, details: { codec: profile.codec, targetLufs: profile.targetLufs, truePeakDbfs: profile.truePeakDbfs, version: profile.version } } });
    return safeBroadcastProcessingProfile(profile);
  });
}

export async function updateBroadcastProcessingProfile({ organisationId, profileId, expectedVersion, actorUserId, input }) {
  const normalized = normalizeBroadcastProcessingProfile(input);
  return prisma.$transaction(async (tx) => {
    const changed = await tx.broadcastProcessingProfile.updateMany({ where: { id: profileId, organisationId, status: "DRAFT", version: expectedVersion }, data: { ...normalized, version: { increment: 1 } } });
    if (!changed.count) throw new Error("This draft profile changed or is no longer editable. Refresh before continuing.");
    const profile = await tx.broadcastProcessingProfile.findUnique({ where: { id: profileId } });
    await tx.auditLog.create({ data: { organisationId, actorUserId, action: "BROADCAST_PROCESSING_PROFILE_UPDATED", entityType: "BroadcastProcessingProfile", entityId: profileId, details: { version: profile.version } } });
    return safeBroadcastProcessingProfile(profile);
  });
}

export async function changeBroadcastProcessingProfileStatus({ organisationId, profileId, expectedVersion, actorUserId, action }) {
  const existing = await prisma.broadcastProcessingProfile.findFirst({ where: { id: profileId, organisationId }, select: { id: true, status: true, version: true } });
  if (!existing) return null;
  if (existing.version !== expectedVersion) throw new Error("This profile changed in another browser. Refresh before continuing.");
  const status = action === "ACTIVATE" ? "ACTIVE" : action === "ARCHIVE" ? "ARCHIVED" : null;
  if (!status) throw new Error("Choose activate or archive.");
  if (status === "ACTIVE" && existing.status !== "DRAFT") throw new Error("Only a reviewed draft profile can be activated.");
  if (status === "ARCHIVED") {
    const pending = await prisma.audioRender.count({ where: { organisationId, broadcastProcessingProfileId: profileId, status: { in: ["QUEUED", "RUNNING"] } } });
    if (pending) throw new Error("Wait for the profile's queued audio jobs to finish before archiving it.");
  }
  return prisma.$transaction(async (tx) => {
    const changed = await tx.broadcastProcessingProfile.updateMany({ where: { id: profileId, organisationId, version: expectedVersion }, data: { status, version: { increment: 1 } } });
    if (!changed.count) throw new Error("This profile changed in another browser. Refresh before continuing.");
    const profile = await tx.broadcastProcessingProfile.findUnique({ where: { id: profileId } });
    await tx.auditLog.create({ data: { organisationId, actorUserId, action: `BROADCAST_PROCESSING_PROFILE_${status}`, entityType: "BroadcastProcessingProfile", entityId: profileId, details: { version: profile.version } } });
    return safeBroadcastProcessingProfile(profile);
  });
}

export async function queueBroadcastProcessing({ organisationId, actorUserId, profileId, sourceRenderId }) {
  const [profile, source] = await Promise.all([
    prisma.broadcastProcessingProfile.findFirst({ where: { id: profileId, organisationId, status: "ACTIVE" } }),
    prisma.audioRender.findFirst({ where: { id: sourceRenderId, organisationId, status: "SUCCEEDED", broadcastProcessingProfileId: null, outputMediaAsset: { is: { organisationId, status: "READY" } }, project: { organisationId } }, include: { project: { select: { id: true } }, version: { select: { id: true, version: true } } } })
  ]);
  if (!profile) throw new Error("Choose an active broadcast processing profile owned by this organisation.");
  if (!source) throw new Error("Choose a completed source render owned by this organisation.");
  const snapshot = broadcastProcessingSnapshot(profile);
  const processingKey = crypto.createHash("sha256").update(JSON.stringify({ organisationId, versionId: source.version.id, profile: snapshot })).digest("hex");
  const existing = await prisma.audioRender.findUnique({ where: { processingKey }, include: renderInclude });
  if (existing) return { created: false, output: safeOutput(existing) };
  const preset = snapshot.codec === "WAV" ? "WAV_MASTER" : "SCHOOL_RADIO_MP3";
  try {
    const render = await prisma.$transaction(async (tx) => {
      const created = await tx.audioRender.create({ data: {
        organisationId,
        projectId: source.project.id,
        versionId: source.version.id,
        requestedByUserId: actorUserId,
        preset,
        broadcastProcessingProfileId: profile.id,
        broadcastProcessingProfileRevision: snapshot.revision,
        processingProfileJson: snapshot,
        processingKey,
        processingQcStatus: "PENDING"
      }, include: renderInclude });
      await tx.auditLog.create({ data: { organisationId, actorUserId, action: "BROADCAST_AUDIO_PROCESSING_QUEUED", entityType: "AudioRender", entityId: created.id, details: { sourceRenderId, projectId: source.project.id, versionId: source.version.id, profileId: profile.id, profileRevision: snapshot.revision } } });
      return created;
    });
    return { created: true, output: safeOutput(render) };
  } catch (error) {
    if (error?.code === "P2002") {
      const duplicate = await prisma.audioRender.findUnique({ where: { processingKey }, include: renderInclude });
      if (duplicate) return { created: false, output: safeOutput(duplicate) };
    }
    throw error;
  }
}
