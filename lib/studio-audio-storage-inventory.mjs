import { createHash, randomUUID } from "node:crypto";
import { HeadObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { GENERAL_STUDIO_AUDIO_PROJECT_WHERE, GENERAL_STUDIO_MEDIA_ASSET_WHERE } from "./studio-general-asset-boundary.mjs";

const MIN_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const SECOND_OBSERVATION_MS = 24 * 60 * 60 * 1000;
const UUID_FILE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(webm|ogg|m4a|mp3|wav)$/i;
const SAFE_SEGMENT = /^[a-zA-Z0-9_-]{1,128}$/;

function fingerprint(value) {
  return createHash("sha256").update(value).digest("hex");
}

function validDate(value) {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function directTakeKey(key, organisationId) {
  const prefix = `organisations/${organisationId}/school-audio/`;
  if (typeof key !== "string" || !key.startsWith(prefix)) return null;
  const parts = key.slice(prefix.length).split("/");
  if (parts.length !== 2 || parts[0] === "renders" || !SAFE_SEGMENT.test(parts[0]) || !UUID_FILE.test(parts[1])) return null;
  return { projectId: parts[0] };
}

function objectFingerprint(key, etag, size, modified) {
  if (!etag || size === null || size === undefined || !Number.isSafeInteger(Number(size)) || Number(size) < 0 || !modified) return null;
  return fingerprint(JSON.stringify([key, etag, Number(size), modified.toISOString()]));
}

function previousObservation(previous, section, keyFingerprint, currentFingerprint, now, identity = null) {
  if (!previous || !currentFingerprint) return false;
  const observedAt = validDate(previous.observedAt);
  if (!observedAt || now.getTime() - observedAt.getTime() < SECOND_OBSERVATION_MS) return false;
  return previous.pages?.[section]?.items?.some((item) =>
    item.keyFingerprint === keyFingerprint && item.objectFingerprint === currentFingerprint &&
    (!identity || (item.takeId === identity.takeId && item.mediaAssetId === identity.mediaAssetId)) &&
    ["UNREFERENCED_REVIEW", "STABLE_UNREFERENCED_REVIEW", "LEGACY_TOMBSTONE_OBJECT_REVIEW",
      "STABLE_LEGACY_TOMBSTONE_REVIEW"].includes(item.classification)) === true;
}

function isNotFound(error) {
  // A generic 404 can mean NoSuchBucket or another configuration failure.
  // Only an explicit object-key error supports an absent-object observation.
  return error?.name === "NoSuchKey" || error?.Code === "NoSuchKey";
}

function countByClassification(items, skipped = 0) {
  const counts = { skippedOtherSchoolAudio: skipped };
  for (const item of items) counts[item.classification] = (counts[item.classification] || 0) + 1;
  return counts;
}

function validateOptions({ organisationId, limit, now, previous }) {
  if (!SAFE_SEGMENT.test(organisationId || "")) throw new Error("A single valid organisation ID is required.");
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error("The inventory page limit must be between 1 and 200.");
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error("A valid observation time is required.");
  if (previous && (previous.schemaVersion !== 1 || previous.organisationId !== organisationId)) {
    throw new Error("The previous report belongs to another inventory scope or schema.");
  }
}

async function findProjectBoundaries(database, organisationId, projectIds) {
  if (!projectIds.length) return { existing: new Set(), ordinary: new Set(), active: new Set() };
  const [projects, ordinaryProjects, sessions] = await Promise.all([
    database.audioProject.findMany({ where: { organisationId, id: { in: projectIds } }, select: { id: true } }),
    database.audioProject.findMany({ where: { organisationId, id: { in: projectIds }, ...GENERAL_STUDIO_AUDIO_PROJECT_WHERE }, select: { id: true } }),
    database.schoolAudioUploadSession.findMany({ where: {
      organisationId, projectId: { in: projectIds }, status: { in: ["INITIATED", "UPLOADING", "COMPLETING"] }
    }, select: { projectId: true } })
  ]);
  return {
    existing: new Set(projects.map((item) => item.id)),
    ordinary: new Set(ordinaryProjects.map((item) => item.id)),
    active: new Set(sessions.map((item) => item.projectId))
  };
}

async function inventoryFinalPage({ database, storage, organisationId, now, limit, finalCursor, previous }) {
  const prefix = `organisations/${organisationId}/school-audio/`;
  const page = await storage.client.send(new ListObjectsV2Command({
    Bucket: storage.bucketName, Prefix: prefix, MaxKeys: limit,
    ...(finalCursor ? { ContinuationToken: finalCursor } : {})
  }));
  if (page.IsTruncated && (!page.NextContinuationToken || page.NextContinuationToken === finalCursor)) {
    throw new Error("The object listing was truncated without a usable next cursor.");
  }
  const listed = page.Contents || [];
  if (listed.length > limit) throw new Error("The object listing exceeded the requested page bound.");
  const matching = listed.map((object) => ({ object, parsed: directTakeKey(object.Key, organisationId) }))
    .filter((entry) => entry.parsed);
  const keys = matching.map(({ object }) => object.Key);
  const referenced = keys.length ? await database.mediaAsset.findMany({
    // Deliberately global: a malformed cross-tenant reference still prevents
    // this read-only report from treating the exact object as unreferenced.
    where: { storageKey: { in: keys } }, select: { storageKey: true }
  }) : [];
  const referencedKeys = new Set(referenced.map((item) => item.storageKey));
  const projects = await findProjectBoundaries(database, organisationId,
    [...new Set(matching.map((entry) => entry.parsed.projectId))]);
  const cutoff = now.getTime() - MIN_AGE_MS;
  const items = [];
  for (const { object, parsed } of matching) {
    const key = object.Key;
    const keyFingerprint = fingerprint(key);
    const listedModified = validDate(object.LastModified);
    const item = {
      keyFingerprint, projectId: parsed.projectId,
      sizeBytes: object.Size != null && Number.isSafeInteger(Number(object.Size)) && Number(object.Size) >= 0
        ? Number(object.Size) : null,
      lastModified: listedModified?.toISOString() || null,
      classification: "UNVERIFIED"
    };
    if (referencedKeys.has(key)) item.classification = "REFERENCED_DB";
    else if (!projects.existing.has(parsed.projectId)) item.classification = "MISSING_PROJECT_REVIEW";
    else if (!projects.ordinary.has(parsed.projectId)) item.classification = "PROTECTED_PROJECT_REVIEW";
    else if (projects.active.has(parsed.projectId)) item.classification = "ACTIVE_UPLOAD_REVIEW";
    else if (!listedModified || listedModified.getTime() > now.getTime()) item.classification = "TIMESTAMP_UNVERIFIED";
    else if (listedModified.getTime() > cutoff) item.classification = "TOO_RECENT";
    else {
      try {
        const head = await storage.client.send(new HeadObjectCommand({ Bucket: storage.bucketName, Key: key }));
        const headModified = validDate(head.LastModified);
        const unchanged = head.ETag === object.ETag && object.Size != null && head.ContentLength != null &&
          Number.isSafeInteger(Number(object.Size)) && Number(object.Size) >= 0 &&
          Number(head.ContentLength) === Number(object.Size) && headModified?.getTime() === listedModified.getTime();
        if (!unchanged) item.classification = "OBJECT_CHANGED_REVIEW";
        else if (head.Metadata?.source !== "audiolab" || head.Metadata?.project !== parsed.projectId) {
          item.classification = "PROVENANCE_UNVERIFIED";
        } else {
          item.objectFingerprint = objectFingerprint(key, head.ETag, head.ContentLength, headModified);
          item.classification = previousObservation(previous, "final", keyFingerprint, item.objectFingerprint, now)
            ? "STABLE_UNREFERENCED_REVIEW" : "UNREFERENCED_REVIEW";
        }
      } catch {
        item.classification = "HEAD_UNVERIFIED";
      }
    }
    items.push(item);
  }
  return {
    items, counts: countByClassification(items, listed.length - matching.length),
    nextCursor: page.IsTruncated ? page.NextContinuationToken : null,
    hasMore: Boolean(page.IsTruncated)
  };
}

async function inventoryLegacyPage({ database, storage, organisationId, now, limit, legacyAfterId, previous }) {
  const prefix = `organisations/${organisationId}/school-audio/`;
  const rows = await database.audioTake.findMany({
    where: {
      organisationId, permanentlyDeletedAt: { not: null, lte: new Date(now.getTime() - MIN_AGE_MS) },
      purgeAfter: null, ...(legacyAfterId ? { id: { gt: legacyAfterId } } : {}),
      mediaAsset: { is: { storageKey: { startsWith: prefix } } }
    },
    orderBy: { id: "asc" }, take: limit + 1,
    select: { id: true, projectId: true, mediaAssetId: true,
      mediaAsset: { select: { storageKey: true, status: true } } }
  });
  const selected = rows.slice(0, limit);
  const projects = await findProjectBoundaries(database, organisationId,
    [...new Set(selected.map((row) => row.projectId))]);
  const ordinaryMedia = selected.length ? await database.mediaAsset.findMany({
    where: { id: { in: selected.map((row) => row.mediaAssetId) }, organisationId,
      ...GENERAL_STUDIO_MEDIA_ASSET_WHERE }, select: { id: true }
  }) : [];
  const ordinaryMediaIds = new Set(ordinaryMedia.map((media) => media.id));
  const items = [];
  let skipped = 0;
  for (const row of selected) {
    const key = row.mediaAsset.storageKey;
    const parsed = directTakeKey(key, organisationId);
    if (!parsed) { skipped += 1; continue; }
    const item = {
      keyFingerprint: fingerprint(key), takeId: row.id, mediaAssetId: row.mediaAssetId,
      projectId: row.projectId, classification: "UNVERIFIED"
    };
    if (row.mediaAsset.status !== "DELETED") item.classification = "ROW_STATE_UNVERIFIED";
    else if (!projects.existing.has(row.projectId)) item.classification = "MISSING_PROJECT_REVIEW";
    else if (parsed.projectId !== row.projectId) item.classification = "KEY_PROJECT_MISMATCH_REVIEW";
    else if (!projects.ordinary.has(row.projectId) || !ordinaryMediaIds.has(row.mediaAssetId)) {
      item.classification = "PROTECTED_LEGACY_OBJECT_REVIEW";
    }
    else {
      try {
        const head = await storage.client.send(new HeadObjectCommand({ Bucket: storage.bucketName, Key: key }));
        const modified = validDate(head.LastModified);
        item.objectFingerprint = objectFingerprint(key, head.ETag, head.ContentLength, modified);
        if (!item.objectFingerprint) item.classification = "HEAD_UNVERIFIED";
        else if (modified.getTime() > now.getTime()) item.classification = "TIMESTAMP_UNVERIFIED";
        else if (modified.getTime() > now.getTime() - MIN_AGE_MS) item.classification = "TOO_RECENT";
        else if (head.Metadata?.source !== "audiolab" || head.Metadata?.project !== row.projectId) {
          item.classification = "PROVENANCE_UNVERIFIED";
        }
        else item.classification = previousObservation(previous, "legacy", item.keyFingerprint, item.objectFingerprint,
          now, { takeId: row.id, mediaAssetId: row.mediaAssetId })
          ? "STABLE_LEGACY_TOMBSTONE_REVIEW" : "LEGACY_TOMBSTONE_OBJECT_REVIEW";
      } catch (error) {
        item.classification = isNotFound(error) ? "OBJECT_NOT_FOUND_OBSERVED" : "HEAD_UNVERIFIED";
      }
    }
    items.push(item);
  }
  return {
    items, counts: countByClassification(items, skipped),
    nextAfterId: rows.length > limit ? selected.at(-1).id : null,
    hasMore: rows.length > limit
  };
}

// Inventory only. A stable observation is still not deletion authorisation:
// historical final keys were never pinned to their upload sessions.
export async function inventoryStudioAudioStorage({
  database, storage, organisationId, now = new Date(), limit = 100,
  finalCursor = null, legacyAfterId = null, previous = null
}) {
  validateOptions({ organisationId, limit, now, previous });
  if (!database || !storage?.client || !storage.bucketName) throw new Error("Read-only database and storage clients are required.");
  const [final, legacy] = await Promise.all([
    inventoryFinalPage({ database, storage, organisationId, now, limit, finalCursor, previous }),
    inventoryLegacyPage({ database, storage, organisationId, now, limit, legacyAfterId, previous })
  ]);
  return {
    schemaVersion: 1, runId: randomUUID(), organisationId, observedAt: now.toISOString(),
    minimumAgeDays: 7, readOnly: true, coverage: "BOUNDED_PAGE_ONLY",
    pages: { final, legacy }
  };
}
