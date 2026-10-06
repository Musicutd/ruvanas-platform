import { createHash, randomUUID } from "node:crypto";
import { HeadObjectCommand, ListMultipartUploadsCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { GENERAL_STUDIO_AUDIO_PROJECT_WHERE } from "./studio-general-asset-boundary.mjs";

const MIN_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const SAFE_SEGMENT = /^[a-zA-Z0-9_-]{1,128}$/;
const UUID_FILE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(webm|ogg|m4a|mp3|wav)$/i;
const TERMINAL = new Set(["COMPLETED", "ABORTED", "FAILED", "EXPIRED"]);

function fingerprint(value) {
  return createHash("sha256").update(value).digest("hex");
}

function validDate(value) {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function keyProject(key, organisationId) {
  const prefix = `quarantine/${organisationId}/audio-lab/`;
  if (typeof key !== "string" || !key.startsWith(prefix)) return null;
  const parts = key.slice(prefix.length).split("/");
  if (parts.length !== 2 || !SAFE_SEGMENT.test(parts[0]) || !UUID_FILE.test(parts[1])) return null;
  return parts[0];
}

function validSize(value) {
  return value !== null && value !== undefined && Number.isSafeInteger(Number(value)) && Number(value) >= 0;
}

function validAge(date, now) {
  if (!date || date.getTime() > now.getTime()) return "TIMESTAMP_UNVERIFIED";
  if (date.getTime() > now.getTime() - MIN_AGE_MS) return "TOO_RECENT";
  return null;
}

function count(items, skipped) {
  const counts = { skippedOtherQuarantine: skipped };
  for (const item of items) counts[item.classification] = (counts[item.classification] || 0) + 1;
  return counts;
}

function parseMultipartCursor(cursor, organisationId) {
  if (!cursor) return null;
  if (typeof cursor !== "string" || cursor.length > 8192 || !/^[A-Za-z0-9_-]+$/.test(cursor)) {
    throw new Error("The multipart cursor is invalid.");
  }
  let decoded;
  try { decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")); }
  catch { throw new Error("The multipart cursor is invalid."); }
  if (decoded?.version !== 1 || decoded.organisationId !== organisationId ||
    typeof decoded.keyMarker !== "string" || !decoded.keyMarker.startsWith(`quarantine/${organisationId}/audio-lab/`) ||
    typeof decoded.uploadIdMarker !== "string" || !decoded.uploadIdMarker ||
    decoded.keyMarker.length > 2048 || decoded.uploadIdMarker.length > 2048) {
    throw new Error("The multipart cursor belongs to another or invalid scope.");
  }
  return decoded;
}

function nextMultipartCursor(page, organisationId, previous) {
  if (!page.IsTruncated) return null;
  const keyMarker = page.NextKeyMarker;
  const uploadIdMarker = page.NextUploadIdMarker;
  if (typeof keyMarker !== "string" || !keyMarker.startsWith(`quarantine/${organisationId}/audio-lab/`) ||
    typeof uploadIdMarker !== "string" || !uploadIdMarker ||
    keyMarker.length > 2048 || uploadIdMarker.length > 2048 ||
    (previous?.keyMarker === keyMarker && previous?.uploadIdMarker === uploadIdMarker)) {
    throw new Error("The multipart listing was truncated without a usable next cursor.");
  }
  return Buffer.from(JSON.stringify({ version: 1, organisationId, keyMarker, uploadIdMarker })).toString("base64url");
}

async function boundaries(database, organisationId, projectIds) {
  if (!projectIds.length) return { existing: new Set(), ordinary: new Set() };
  const [projects, ordinaryProjects] = await Promise.all([
    database.audioProject.findMany({ where: { organisationId, id: { in: projectIds } }, select: { id: true } }),
    database.audioProject.findMany({ where: { organisationId, id: { in: projectIds },
      ...GENERAL_STUDIO_AUDIO_PROJECT_WHERE }, select: { id: true } })
  ]);
  return { existing: new Set(projects.map((row) => row.id)), ordinary: new Set(ordinaryProjects.map((row) => row.id)) };
}

async function exactMediaReferences(database, keys) {
  if (!keys.length) return new Set();
  const rows = await database.mediaAsset.findMany({ where: { storageKey: { in: keys } }, select: { storageKey: true } });
  // Deliberately global and status-agnostic: malformed cross-tenant or DELETED
  // references still prevent an unreferenced-object interpretation.
  return new Set(rows.map((row) => row.storageKey));
}

function sessionBoundary({ session, reservedByKey, organisationId, projectId, key, uploadId, projects, referenced }) {
  if (referenced) return "REFERENCED_MEDIA_REVIEW";
  if (reservedByKey && reservedByKey.id !== session?.id) return "KEY_RESERVED_BY_OTHER_SESSION_REVIEW";
  if (session && !scopedSession(session, organisationId, projectId, key, uploadId)) {
    return "SESSION_SCOPE_MISMATCH_REVIEW";
  }
  if (!projects.existing.has(projectId)) return "MISSING_PROJECT_REVIEW";
  if (!projects.ordinary.has(projectId)) return "PROTECTED_PROJECT_REVIEW";
  if (session && !TERMINAL.has(session.status)) return "UNSETTLED_SESSION_REVIEW";
  return null;
}

function scopedSession(session, organisationId, projectId, key, uploadId) {
  return Boolean(session && session.organisationId === organisationId && session.projectId === projectId &&
    session.quarantineKey === key && (!uploadId || session.multipartUploadId === uploadId));
}

async function quarantinePage({ database, storage, organisationId, now, limit, quarantineCursor }) {
  const prefix = `quarantine/${organisationId}/audio-lab/`;
  const page = await storage.client.send(new ListObjectsV2Command({
    Bucket: storage.bucketName, Prefix: prefix, MaxKeys: limit,
    ...(quarantineCursor ? { ContinuationToken: quarantineCursor } : {})
  }));
  if (page.IsTruncated && (!page.NextContinuationToken || page.NextContinuationToken === quarantineCursor)) {
    throw new Error("The quarantine listing was truncated without a usable next cursor.");
  }
  const listed = page.Contents || [];
  if (!Array.isArray(listed) || listed.length > limit) throw new Error("The quarantine listing exceeded its page bound.");
  const matched = listed.map((object) => ({ object, projectId: keyProject(object.Key, organisationId) }))
    .filter((entry) => entry.projectId);
  const keys = matched.map(({ object }) => object.Key);
  const [sessions, projects, mediaKeys] = await Promise.all([
    keys.length ? database.schoolAudioUploadSession.findMany({
      where: { quarantineKey: { in: keys } }, select: { id: true, organisationId: true, projectId: true,
        quarantineKey: true, multipartUploadId: true, status: true }
    }) : [],
    boundaries(database, organisationId, [...new Set(matched.map((entry) => entry.projectId))]),
    exactMediaReferences(database, keys)
  ]);
  const byKey = new Map(sessions.map((session) => [session.quarantineKey, session]));
  const items = [];
  for (const { object, projectId } of matched) {
    const key = object.Key;
    const session = byKey.get(key);
    const visibleSession = projects.ordinary.has(projectId) &&
      scopedSession(session, organisationId, projectId, key) ? session : null;
    const modified = validDate(object.LastModified);
    const item = { keyFingerprint: fingerprint(key), projectId, hasSession: Boolean(visibleSession),
      sessionStatus: visibleSession?.status || null, lastModified: modified?.toISOString() || null,
      sizeBytes: validSize(object.Size) ? Number(object.Size) : null, classification: "UNVERIFIED" };
    item.classification = sessionBoundary({ session, organisationId, projectId, key, projects,
      referenced: mediaKeys.has(key) }) || validAge(modified, now) || "UNVERIFIED";
    if (item.classification === "UNVERIFIED") {
      try {
        const head = await storage.client.send(new HeadObjectCommand({ Bucket: storage.bucketName, Key: key }));
        const headModified = validDate(head.LastModified);
        if (!validSize(object.Size) || !validSize(head.ContentLength) || !object.ETag ||
          head.ETag !== object.ETag || Number(head.ContentLength) !== Number(object.Size) ||
          headModified?.getTime() !== modified.getTime()) item.classification = "OBJECT_CHANGED_REVIEW";
        else if (head.Metadata?.quarantine !== "true" || head.Metadata?.project !== projectId) {
          item.classification = "PROVENANCE_UNVERIFIED";
        } else item.classification = "OLD_QUARANTINE_OBJECT_REVIEW";
      } catch { item.classification = "HEAD_UNVERIFIED"; }
    }
    items.push(item);
  }
  return { items, counts: count(items, listed.length - matched.length),
    hasMore: Boolean(page.IsTruncated), nextCursor: page.IsTruncated ? page.NextContinuationToken : null };
}

async function multipartPage({ database, storage, organisationId, now, limit, multipartCursor }) {
  const prefix = `quarantine/${organisationId}/audio-lab/`;
  const marker = parseMultipartCursor(multipartCursor, organisationId);
  const page = await storage.client.send(new ListMultipartUploadsCommand({
    Bucket: storage.bucketName, Prefix: prefix, MaxUploads: limit,
    ...(marker ? { KeyMarker: marker.keyMarker, UploadIdMarker: marker.uploadIdMarker } : {})
  }));
  const nextCursor = nextMultipartCursor(page, organisationId, marker);
  const listed = page.Uploads || [];
  if (!Array.isArray(listed) || listed.length > limit) throw new Error("The multipart listing exceeded its page bound.");
  const matched = listed.map((upload) => ({ upload, projectId: keyProject(upload.Key, organisationId) }))
    .filter((entry) => entry.projectId);
  const keys = matched.map(({ upload }) => upload.Key);
  const uploadIds = matched.map(({ upload }) => upload.UploadId).filter((value) => typeof value === "string" && value);
  const [sessions, projects, mediaKeys] = await Promise.all([
    matched.length ? database.schoolAudioUploadSession.findMany({ where: { OR: [
      { quarantineKey: { in: keys } }, { multipartUploadId: { in: uploadIds } }
    ] }, select: { id: true, organisationId: true, projectId: true, quarantineKey: true,
      multipartUploadId: true, status: true } }) : [],
    boundaries(database, organisationId, [...new Set(matched.map((entry) => entry.projectId))]),
    exactMediaReferences(database, keys)
  ]);
  const byUploadId = new Map(sessions.map((session) => [session.multipartUploadId, session]));
  const byKey = new Map(sessions.map((session) => [session.quarantineKey, session]));
  const items = [];
  for (const { upload, projectId } of matched) {
    const key = upload.Key;
    const uploadId = upload.UploadId;
    const session = byUploadId.get(uploadId);
    const visibleSession = projects.ordinary.has(projectId) &&
      scopedSession(session, organisationId, projectId, key, uploadId) ? session : null;
    const initiated = validDate(upload.Initiated);
    const item = { keyFingerprint: fingerprint(key),
      uploadFingerprint: typeof uploadId === "string" && uploadId ? fingerprint(JSON.stringify([key, uploadId])) : null,
      projectId, hasSession: Boolean(visibleSession), sessionStatus: visibleSession?.status || null,
      initiatedAt: initiated?.toISOString() || null, classification: "UNVERIFIED" };
    item.classification = !item.uploadFingerprint ? "UPLOAD_ID_UNVERIFIED" :
      sessionBoundary({ session, reservedByKey: byKey.get(key), organisationId, projectId, key, uploadId,
        projects, referenced: mediaKeys.has(key) }) || validAge(initiated, now) || "OLD_MULTIPART_UPLOAD_REVIEW";
    items.push(item);
  }
  return { items, counts: count(items, listed.length - matched.length),
    hasMore: Boolean(page.IsTruncated), nextCursor };
}

// Evidence only. Neither section authorises aborting a multipart upload or
// deleting a completed quarantine object, even after repeated observations.
export async function inventoryStudioAudioUploads({ database, storage, organisationId,
  now = new Date(), limit = 100, quarantineCursor = null, multipartCursor = null }) {
  if (!SAFE_SEGMENT.test(organisationId || "")) throw new Error("A single valid organisation ID is required.");
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error("A valid observation time is required.");
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error("The page limit must be 1–200.");
  if (quarantineCursor && (typeof quarantineCursor !== "string" || quarantineCursor.length > 8192)) {
    throw new Error("The quarantine cursor is invalid.");
  }
  if (!database || !storage?.client || !storage.bucketName) throw new Error("Read-only database and storage clients are required.");
  const [quarantine, multipart] = await Promise.all([
    quarantinePage({ database, storage, organisationId, now, limit, quarantineCursor }),
    multipartPage({ database, storage, organisationId, now, limit, multipartCursor })
  ]);
  return { schemaVersion: 1, runId: randomUUID(), organisationId, observedAt: now.toISOString(),
    readOnly: true, minimumAgeDays: 7, coverage: "BOUNDED_PAGE_ONLY", pages: { quarantine, multipart } };
}
