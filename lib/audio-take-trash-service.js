import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { prisma } from "./prisma.js";
import { getR2Storage } from "./r2.js";
import { assertRecordingCanBeTrashed, audioTakePurgeAfter, canRestoreAudioTake } from "./audio-take-trash.mjs";
import {
  assertGeneralStudioAudioProject, assertGeneralStudioMediaAsset,
  GENERAL_STUDIO_AUDIO_PROJECT_WHERE, GENERAL_STUDIO_MEDIA_ASSET_WHERE
} from "./studio-general-asset-boundary.mjs";

const STORAGE_CLEANUP_RETRY_DELAY_MS = 60 * 60 * 1000;

async function findTake(database, { takeId, organisationId }) {
  const take = await database.audioTake.findFirst({
    where: { id: takeId, organisationId },
    include: { mediaAsset: { select: { id: true, name: true, storageKey: true, status: true } } }
  });
  if (!take) throw Object.assign(new Error("The recording was not found."), { status: 404 });
  return take;
}

// A Corrections session or submission can turn an existing Studio project
// private. Lock the parent rows before checking the shared boundary so the
// ordinary Trash endpoint and background purge cannot mutate its recordings.
async function withLockedGeneralTake(database, { takeId, organisationId }, work) {
  return database.$transaction(async (tx) => {
    const candidate = await findTake(tx, { takeId, organisationId });
    const projects = await tx.$queryRaw`SELECT id FROM "AudioProject" WHERE id = ${candidate.projectId} AND "organisationId" = ${organisationId} FOR UPDATE`;
    const assets = await tx.$queryRaw`SELECT id FROM "MediaAsset" WHERE id = ${candidate.mediaAssetId} AND "organisationId" = ${organisationId} FOR UPDATE`;
    if (!projects.length || !assets.length) throw Object.assign(new Error("The recording was not found."), { status: 404 });
    const take = await findTake(tx, { takeId, organisationId });
    await assertGeneralStudioAudioProject(tx, organisationId, take.projectId);
    await assertGeneralStudioMediaAsset(tx, organisationId, take.mediaAssetId);
    return work(tx, take);
  // The candidate lookup precedes the parent-row locks. At Serializable it
  // fixes a stale snapshot before a waiting Corrections submission commits;
  // a newly private relation could then be missed by the later predicates.
  // Read Committed reloads privacy and usage after those locks are acquired.
  }, { isolationLevel: "ReadCommitted", timeout: 30000 });
}

async function usageFor(database, take) {
  const [clipCount, rundownCount, promoVersion] = await Promise.all([
    database.audioClip.count({ where: { mediaAssetId: take.mediaAssetId } }),
    database.schoolRundownItem.count({ where: { OR: [{ sourceTakeId: take.id }, { sourceMediaAssetId: take.mediaAssetId }] } }),
    take.promoVersionId ? database.promoVersion.findUnique({
      where: { id: take.promoVersionId },
      select: {
        status: true,
        promoAsset: { select: { currentApprovedVersionId: true } },
        _count: { select: {
          campaigns: true, schoolAnnouncements: true, schoolSubmissions: true,
          liveFallbackSessions: true, playoutIntents: true, proofOfPlayEvents: true,
          radioClockItems: true, voiceTrackSegues: true, retailMediaCreatives: true,
          schoolEpisodeExchangeOffers: true, studioProductHandoffs: true
        } },
        processingJobs: { where: { status: { in: ["QUEUED", "RUNNING"] } }, select: { id: true } }
      }
    }) : null
  ]);
  const publicationCount = promoVersion
    ? Object.values(promoVersion._count).reduce((total, count) => total + count, 0)
      + (promoVersion.status === "APPROVED" || promoVersion.status === "SUPERSEDED" || promoVersion.promoAsset.currentApprovedVersionId === take.promoVersionId ? 1 : 0)
    : 0;
  return { clipCount, rundownCount, publicationCount, processingCount: promoVersion?.processingJobs.length || 0 };
}

async function audit(database, { organisationId, userId, action, take, details = {} }) {
  await database.auditLog.create({
    data: {
      organisationId,
      actorUserId: userId,
      action,
      entityType: "AudioTake",
      entityId: take.id,
      details: { mediaAssetId: take.mediaAssetId, name: take.mediaAsset.name, ...details }
    }
  });
}

export async function trashAudioTake({ database = prisma, takeId, organisationId, userId, now = new Date() }) {
  return withLockedGeneralTake(database, { takeId, organisationId }, async (tx, take) => {
    if (take.permanentlyDeletedAt) throw Object.assign(new Error("This recording has already been permanently deleted."), { status: 409 });
    if (take.trashedAt) return take;
    assertRecordingCanBeTrashed(await usageFor(tx, take));
    const purgeAfter = audioTakePurgeAfter(now);
    const updated = await tx.audioTake.update({ where: { id: take.id }, data: { trashedAt: now, purgeAfter } });
    await audit(tx, { organisationId, userId, action: "AUDIO_TAKE_TRASHED", take, details: { purgeAfter: purgeAfter.toISOString() } });
    return updated;
  });
}

export async function restoreAudioTake({ database = prisma, takeId, organisationId, userId, now = new Date() }) {
  return withLockedGeneralTake(database, { takeId, organisationId }, async (tx, take) => {
    if (!canRestoreAudioTake(take, now)) throw Object.assign(new Error("This recording can no longer be restored."), { status: 409 });
    if (take.mediaAsset.status !== "READY") throw Object.assign(new Error("The recording file is no longer available."), { status: 409 });
    const updated = await tx.audioTake.update({ where: { id: take.id }, data: { trashedAt: null, purgeAfter: null } });
    await audit(tx, { organisationId, userId, action: "AUDIO_TAKE_RESTORED", take });
    return updated;
  });
}

export async function permanentlyDeleteAudioTake({ database = prisma, takeId, organisationId, userId, now = new Date(), storage = getR2Storage() }) {
  await withLockedGeneralTake(database, { takeId, organisationId }, async (tx, take) => {
    if (take.permanentlyDeletedAt) return take;
    if (!take.trashedAt) throw Object.assign(new Error("Move this recording to Trash before deleting it permanently."), { status: 409 });
    assertRecordingCanBeTrashed(await usageFor(tx, take));
    await tx.mediaAsset.update({ where: { id: take.mediaAssetId }, data: { status: "DELETED" } });
    // Keep this due until the object-store deletion has actually succeeded.
    // The worker can then retry a failed or interrupted cleanup without
    // restoring access to the already-tombstoned recording.
    const updated = await tx.audioTake.update({ where: { id: take.id }, data: { status: "ARCHIVED", purgeAfter: now, permanentlyDeletedAt: now } });
    if (take.promoVersionId) await tx.promoVersion.update({ where: { id: take.promoVersionId }, data: { status: "REJECTED", qcStatus: "FAILED", qcNotes: "Source recording deleted by its owner." } });
    await audit(tx, { organisationId, userId, action: "AUDIO_TAKE_PERMANENTLY_DELETED", take, details: { deletedAt: now.toISOString() } });
    return updated;
  });
  // Commit the inaccessible database tombstone before touching object storage.
  // Recheck the current privacy boundary while parent rows remain locked. If a
  // project became Corrections after tombstoning, leave the object untouched.
  // Repeating an already-deleted request or the worker safely retries cleanup.
  try {
    return await withLockedGeneralTake(database, { takeId, organisationId }, async (tx, take) => {
      await storage.client.send(new DeleteObjectCommand({ Bucket: storage.bucketName, Key: take.mediaAsset.storageKey }));
      return tx.audioTake.update({ where: { id: take.id }, data: { purgeAfter: null } });
    });
  } catch (error) {
    if (error?.code === "CORRECTIONS_STUDIO_OUTPUT_BLOCKED") throw error;
    // A persistent object-store outage must not monopolise the worker's
    // oldest-first batch. Move only a still-pending tombstone to the next
    // retry window; a concurrent successful cleanup has already cleared it.
    try {
      await database.audioTake.updateMany({
        where: { id: takeId, organisationId, permanentlyDeletedAt: { not: null }, purgeAfter: { not: null } },
        data: { purgeAfter: new Date(now.getTime() + STORAGE_CLEANUP_RETRY_DELAY_MS) }
      });
    } catch (scheduleError) {
      console.error("AUDIO_TAKE_STORAGE_RETRY_SCHEDULE_FAILED", { takeId, organisationId,
        error: scheduleError instanceof Error ? scheduleError.message : "unknown" });
    }
    console.error("AUDIO_TAKE_STORAGE_CLEANUP_FAILED", { takeId, organisationId, error: error instanceof Error ? error.message : "unknown" });
    throw Object.assign(new Error("The recording is unavailable in Studio, but storage cleanup needs review."), { status: 502, code: "AUDIO_TAKE_STORAGE_CLEANUP_FAILED" });
  }
}

export async function purgeExpiredAudioTakes(database = prisma, { now = new Date(), limit = 20, storage = null } = {}) {
  const due = await database.audioTake.findMany({
    // Permanently private evidence must never consume the worker's entire
    // oldest-first batch and starve later ordinary cleanups. The locked
    // deletion still rechecks privacy if it changes after this selection.
    where: {
      trashedAt: { not: null }, purgeAfter: { lte: now },
      project: { is: GENERAL_STUDIO_AUDIO_PROJECT_WHERE },
      mediaAsset: { is: GENERAL_STUDIO_MEDIA_ASSET_WHERE }
    },
    orderBy: { purgeAfter: "asc" },
    take: limit,
    select: { id: true, organisationId: true, recordedByUserId: true }
  });
  const deletionStorage = due.length ? (storage || getR2Storage()) : null;
  const result = { scanned: due.length, deleted: 0, blocked: 0, failed: 0 };
  for (const take of due) {
    try {
      await permanentlyDeleteAudioTake({ database, takeId: take.id, organisationId: take.organisationId, userId: take.recordedByUserId, now, storage: deletionStorage });
      result.deleted += 1;
    } catch (error) {
      if (error?.code === "CORRECTIONS_STUDIO_OUTPUT_BLOCKED" || /Remove this recording/.test(error instanceof Error ? error.message : "")) result.blocked += 1;
      else result.failed += 1;
    }
  }
  return result;
}

