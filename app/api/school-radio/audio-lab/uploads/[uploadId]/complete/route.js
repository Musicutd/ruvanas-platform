import crypto from "crypto";
import {
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand
} from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getR2Storage } from "@/lib/r2";
import { ORGANISATION_CONTENT_ROLES } from "@/lib/permissions.mjs";
import { requireActiveStudio } from "@/lib/studio-access";
import { normalizeEditDecision, validateAudioLabUpload } from "@/lib/audio-lab.mjs";
import { validateAudioUpload } from "@/lib/audio-validation.mjs";
import { buildPromoProcessingJobs } from "@/lib/promo-versioning.mjs";
import { securityLog } from "@/lib/security-log";
import { recordedClipData } from "@/lib/studio-recording.mjs";
import { invalidateApprovedAudioOutputs } from "@/lib/audio-project-governance";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const schema = z.object({
  durationMs: z.number().int().positive().max(12 * 60 * 60 * 1000).optional().nullable(),
  deviceLabel: z.string().trim().max(200).optional().nullable(),
  checksumSha256: z.string().regex(/^[a-f0-9]{64}$/).optional().nullable(),
  targetTrackId: z.string().cuid().optional().nullable(),
  editDecision: z.record(z.unknown()).default({})
});

function multitrackVersionState(project, tracks) {
  return {
    title: project.title,
    multitrack: {
      mode: project.editDecision?.multitrack?.mode || "BEGINNER",
      ducking: project.editDecision?.multitrack?.ducking || { enabled: true, musicReductionDb: -12, attackMs: 120, releaseMs: 700 },
      master: project.editDecision?.multitrack?.master || { normalize: true, targetLufs: -16, limiter: true },
      tracks: tracks.map((track) => ({
        clientId: track.id,
        name: track.name,
        kind: track.kind,
        order: track.order,
        gainDb: track.gainDb,
        pan: track.pan,
        muted: track.muted,
        solo: track.solo,
        armed: track.armed,
        locked: track.locked,
        preset: track.effectChainJson?.preset || "NONE",
        automation: track.effectChainJson?.automation || [],
        clips: track.clips.map((clip) => ({
          clientId: clip.id,
          kind: clip.kind,
          mediaAssetId: clip.mediaAssetId,
          sourceStartMs: clip.sourceStartMs,
          sourceEndMs: clip.sourceEndMs,
          timelineStartMs: clip.timelineStartMs,
          gainDb: clip.gainDb,
          fadeInMs: clip.fadeInMs,
          fadeOutMs: clip.fadeOutMs,
          fadeInCurve: clip.fadeInCurve,
          fadeOutCurve: clip.fadeOutCurve,
          locked: clip.locked
        }))
      }))
    }
  };
}

async function bodyToBuffer(body) {
  if (!body) return Buffer.alloc(0);
  if (typeof body.transformToByteArray === "function") return Buffer.from(await body.transformToByteArray());
  const chunks = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export async function POST(request, { params }) {
  const access = await requireActiveStudio(ORGANISATION_CONTENT_ROLES);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "The recording details are invalid." }, { status: 400 });

  const session = await prisma.schoolAudioUploadSession.findFirst({
    where: { id: String(params.uploadId || ""), organisationId: access.organisation.id, createdByUserId: access.user.id, status: { in: ["INITIATED", "UPLOADING"] }, expiresAt: { gt: new Date() } },
    include: {
      parts: { orderBy: { partNumber: "asc" } },
      project: {
        select: {
          id: true,
          title: true,
          type: true,
          currentVersion: true,
          editDecision: true,
          tracks: { orderBy: { order: "asc" }, include: { clips: { orderBy: { timelineStartMs: "asc" } } } }
        }
      }
    }
  });
  if (!session) return NextResponse.json({ error: "The upload session has expired or is unavailable." }, { status: 404 });
  const receivedBytes = session.parts.reduce((total, part) => total + BigInt(part.sizeBytes), 0n);
  if (session.parts.length !== session.partCount || receivedBytes !== session.expectedSizeBytes) {
    return NextResponse.json({ error: "The recording upload is incomplete. Retry the missing parts first." }, { status: 409 });
  }
  const targetTrack = parsed.data.targetTrackId
    ? session.project.tracks.find((track) => track.id === parsed.data.targetTrackId)
    : null;
  if (parsed.data.targetTrackId && session.project.type !== "MULTITRACK") {
    return NextResponse.json({ error: "Direct recording is available only for a multitrack project." }, { status: 409 });
  }
  if (parsed.data.targetTrackId && (!targetTrack || !targetTrack.armed || targetTrack.locked)) {
    return NextResponse.json({ error: "Choose an armed, unlocked track from this multitrack project." }, { status: 409 });
  }
  if (targetTrack && !parsed.data.durationMs) {
    return NextResponse.json({ error: "A recording duration is required before placing audio on a track." }, { status: 400 });
  }

  const r2 = getR2Storage();
  const settings = validateAudioLabUpload({ sizeBytes: Number(session.expectedSizeBytes), mimeType: session.mimeType });
  const finalKey = `organisations/${access.organisation.id}/school-audio/${session.projectId}/${crypto.randomUUID()}.${settings.extension}`;
  const editDecision = normalizeEditDecision(parsed.data.editDecision);

  try {
    await prisma.schoolAudioUploadSession.update({ where: { id: session.id }, data: { status: "COMPLETING" } });
    await r2.client.send(new CompleteMultipartUploadCommand({
      Bucket: r2.bucketName,
      Key: session.quarantineKey,
      UploadId: session.multipartUploadId,
      MultipartUpload: { Parts: session.parts.map((part) => ({ PartNumber: part.partNumber, ETag: part.eTag })) }
    }));
    const [head, sampleObject] = await Promise.all([
      r2.client.send(new HeadObjectCommand({ Bucket: r2.bucketName, Key: session.quarantineKey })),
      r2.client.send(new GetObjectCommand({ Bucket: r2.bucketName, Key: session.quarantineKey, Range: "bytes=0-63" }))
    ]);
    if (BigInt(head.ContentLength || 0) !== session.expectedSizeBytes) throw new Error("The stored recording size did not match the upload.");
    const sample = await bodyToBuffer(sampleObject.Body);
    const validation = validateAudioUpload({ buffer: sample, fileName: session.originalName, claimedType: session.mimeType });
    if (!validation.ok) throw new Error(validation.error);

    await r2.client.send(new CopyObjectCommand({
      Bucket: r2.bucketName,
      CopySource: `${r2.bucketName}/${session.quarantineKey}`,
      Key: finalKey,
      ContentType: validation.contentType,
      MetadataDirective: "REPLACE",
      Metadata: { quarantine: "false", source: "audiolab", project: session.projectId, ...(parsed.data.checksumSha256 ? { clientsha256: parsed.data.checksumSha256 } : {}) }
    }));
    await r2.client.send(new DeleteObjectCommand({ Bucket: r2.bucketName, Key: session.quarantineKey }));

    const result = await prisma.$transaction(async (tx) => {
      const mediaAsset = await tx.mediaAsset.create({ data: { organisationId: access.organisation.id, libraryType: "ORGANISATION_PROMO", name: session.project.title, originalName: session.originalName, storageKey: finalKey, mimeType: validation.contentType, sizeBytes: session.expectedSizeBytes, durationSeconds: parsed.data.durationMs ? Math.max(1, Math.round(parsed.data.durationMs / 1000)) : null, mediaType: "ANNOUNCEMENT", status: "READY" } });
      const promoAsset = await tx.promoAsset.create({ data: { organisationId: access.organisation.id, name: session.project.title, mediaType: "ANNOUNCEMENT", languageCode: "und" } });
      const promoVersion = await tx.promoVersion.create({ data: { promoAssetId: promoAsset.id, mediaAssetId: mediaAsset.id, version: 1, status: "IN_REVIEW", qcStatus: "PENDING", sourceType: "STUDIO", sourceReference: `audio-project:${session.projectId}`, languageCode: "und", checksumSha256: parsed.data.checksumSha256 || null, durationSeconds: mediaAsset.durationSeconds, submittedById: access.user.id, submittedAt: new Date(), processingJobs: { create: buildPromoProcessingJobs() } } });
      const take = await tx.audioTake.create({ data: { organisationId: access.organisation.id, projectId: session.projectId, mediaAssetId: mediaAsset.id, promoVersionId: promoVersion.id, recordedByUserId: access.user.id, deviceLabel: parsed.data.deviceLabel || null, durationMs: parsed.data.durationMs || null, status: "READY", sourceEditDecision: editDecision } });
      let placement = null;
      let invalidatedApprovals = 0;
      if (targetTrack) {
        const [currentProject, currentTargetTrack] = await Promise.all([
          tx.audioProject.findUnique({ where: { id: session.projectId }, select: { id: true, title: true, currentVersion: true, editDecision: true } }),
          tx.audioTrack.findFirst({ where: { id: targetTrack.id, projectId: session.projectId, armed: true, locked: false }, include: { clips: { orderBy: { timelineStartMs: "asc" } } } })
        ]);
        if (!currentProject || !currentTargetTrack) throw new Error("The destination track is no longer armed and available.");
        const clip = await tx.audioClip.create({
          data: { trackId: currentTargetTrack.id, ...recordedClipData({ mediaAssetId: mediaAsset.id, durationMs: parsed.data.durationMs, clips: currentTargetTrack.clips }) }
        });
        invalidatedApprovals = await invalidateApprovedAudioOutputs(tx, session.projectId);
        const tracks = await tx.audioTrack.findMany({ where: { projectId: session.projectId }, orderBy: { order: "asc" }, include: { clips: { orderBy: { timelineStartMs: "asc" } } } });
        const nextVersion = currentProject.currentVersion + 1;
        await tx.audioProjectVersion.create({
          data: { projectId: session.projectId, version: nextVersion, state: multitrackVersionState(currentProject, tracks), reason: `Recorded directly onto ${currentTargetTrack.name}`, createdByUserId: access.user.id }
        });
        await tx.audioProject.update({ where: { id: session.projectId }, data: { status: "READY", currentVersion: nextVersion } });
        placement = { trackId: currentTargetTrack.id, trackName: currentTargetTrack.name, clipId: clip.id, timelineStartMs: clip.timelineStartMs };
      } else {
        await tx.audioProject.update({ where: { id: session.projectId }, data: { status: "READY", editDecision } });
      }
      await tx.schoolAudioUploadSession.update({ where: { id: session.id }, data: { status: "COMPLETED", completedAt: new Date() } });
      await tx.auditLog.create({ data: { organisationId: access.organisation.id, actorUserId: access.user.id, action: targetTrack ? "STUDIO_RECORDING_PLACED_ON_TRACK" : "AUDIO_LAB_TAKE_CREATED", entityType: "AudioTake", entityId: take.id, details: { projectId: session.projectId, mediaAssetId: mediaAsset.id, promoVersionId: promoVersion.id, immutableSource: true, editDecision, placement, invalidatedApprovals } } });
      return { take, mediaAsset, promoVersion, placement };
    });
    return NextResponse.json({ takeId: result.take.id, mediaAssetId: result.mediaAsset.id, promoVersionId: result.promoVersion.id, reviewStatus: result.promoVersion.status, placement: result.placement, streamUrl: `/api/media/${result.mediaAsset.id}/stream` }, { status: 201 });
  } catch (error) {
    await prisma.$transaction([
      prisma.schoolAudioUploadSession.update({ where: { id: session.id }, data: { status: "FAILED" } }),
      prisma.audioProject.update({ where: { id: session.projectId }, data: { status: session.project.type === "MULTITRACK" ? "READY" : "DRAFT" } })
    ]).catch(() => {});
    try { await r2.client.send(new DeleteObjectCommand({ Bucket: r2.bucketName, Key: session.quarantineKey })); } catch {}
    try { await r2.client.send(new DeleteObjectCommand({ Bucket: r2.bucketName, Key: finalKey })); } catch {}
    securityLog("error", "AUDIO_LAB_UPLOAD_FAILED", request, { uploadId: session.id, projectId: session.projectId, error: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ error: error instanceof Error ? error.message : "The recording could not be finalised." }, { status: 500 });
  }
}

