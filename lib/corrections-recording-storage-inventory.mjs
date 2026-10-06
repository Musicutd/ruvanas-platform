import { createHash, randomUUID } from "node:crypto";
import { HeadObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";

const SAFE_ID = /^[a-zA-Z0-9_-]{1,128}$/;
const UUID_AUDIO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(mp3|wav|ogg|m4a|webm)$/i;
const MIN_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const fingerprint = (value) => createHash("sha256").update(value).digest("hex");

function validateOptions({ organisationId, limit, cursor, now = new Date() }) {
  if (!SAFE_ID.test(organisationId || "")) throw new Error("A single valid organisation ID is required.");
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error("The page limit must be 1-200.");
  if (cursor !== null && (typeof cursor !== "string" || !cursor.length || cursor.length > 4096 || /[\u0000-\u001f\u007f]/.test(cursor))) {
    throw new Error("A bounded storage continuation cursor is required.");
  }
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error("A valid observation time is required.");
}

export function parseCorrectionsRecordingInventoryOptions(argv, environment = process.env) {
  if (environment.CORRECTIONS_RECORDING_INVENTORY_READ_ONLY !== "1") {
    throw new Error("Explicit private read-only inventory opt-in is required.");
  }
  const options = {};
  for (const argument of argv) {
    const match = /^--(organisation-id|limit|cursor)=(.+)$/.exec(argument);
    if (!match || options[match[1]] !== undefined) throw new Error("Use only the documented single-organisation inventory options.");
    options[match[1]] = match[2];
  }
  const result = { organisationId: options["organisation-id"],
    limit: options.limit === undefined ? 100 : Number(options.limit), cursor: options.cursor ?? null };
  validateOptions(result);
  return result;
}

function validDate(value) {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function validSize(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function recordingProject(key, prefix) {
  const parts = key.slice(prefix.length).split("/");
  return parts.length === 2 && SAFE_ID.test(parts[0]) && UUID_AUDIO.test(parts[1]) ? parts[0] : null;
}

async function referencedKeys(database, keys) {
  if (!keys.length) return new Set();
  // Exact keys only, globally and status-agnostically. Even a malformed
  // cross-product/tenant reference must not disappear from this observation.
  const [media, signage, orders, uploads] = await Promise.all([
    database.mediaAsset.findMany({ where: { storageKey: { in: keys } }, select: { storageKey: true } }),
    database.digitalSignageAsset.findMany({ where: { storageKey: { in: keys } }, select: { storageKey: true } }),
    database.productionOrderFile.findMany({ where: { storageKey: { in: keys } }, select: { storageKey: true } }),
    database.schoolAudioUploadSession.findMany({ where: { quarantineKey: { in: keys } }, select: { quarantineKey: true } })
  ]);
  return new Set([...media, ...signage, ...orders].map((row) => row.storageKey)
    .concat(uploads.map((row) => row.quarantineKey)));
}

// Operator evidence only: never downloads audio, writes, deletes, grants
// contributor access, approves a submission, or produces disposal candidates.
export async function inventoryCorrectionsRecordingStorage({
  database, storage, organisationId, now = new Date(), limit = 100, cursor = null
}) {
  validateOptions({ organisationId, now, limit, cursor });
  if (!database || !storage?.client || !storage.bucketName) throw new Error("Read-only database and storage clients are required.");
  const organisation = await database.organisation.findUnique({ where: { id: organisationId }, select: { id: true } });
  if (!organisation) throw new Error("The selected organisation does not exist.");
  const prefix = `organisations/${organisationId}/corrections-studio/`;
  const page = await storage.client.send(new ListObjectsV2Command({
    Bucket: storage.bucketName, Prefix: prefix, MaxKeys: limit,
    ...(cursor ? { ContinuationToken: cursor } : {})
  }));
  const listed = page.Contents ?? [];
  if (!Array.isArray(listed) || listed.length > limit) throw new Error("The storage listing exceeded its page bound.");
  if (listed.some((object) => typeof object?.Key !== "string" || !object.Key.startsWith(prefix))) {
    throw new Error("The storage listing returned an out-of-scope object.");
  }
  if (page.IsTruncated) {
    validateOptions({ organisationId, now, limit, cursor: page.NextContinuationToken ?? null });
    if (!page.NextContinuationToken || page.NextContinuationToken === cursor) {
      throw new Error("The storage listing has no usable continuation cursor.");
    }
  }
  const matching = listed.map((object) => ({ object, projectId: recordingProject(object.Key, prefix) }))
    .filter((entry) => entry.projectId);
  const keys = matching.map(({ object }) => object.Key);
  const projectIds = [...new Set(matching.map((entry) => entry.projectId))];
  const projectWhere = { organisationId, id: { in: projectIds } };
  const [references, projects, supervised, active] = await Promise.all([
    referencedKeys(database, keys),
    projectIds.length ? database.audioProject.findMany({ where: projectWhere, select: { id: true } }) : [],
    // EXISTS predicates return at most one row per listed project, not its
    // unbounded session history. No session IDs or contributor details read.
    projectIds.length ? database.audioProject.findMany({ where: { ...projectWhere, correctionsStudioSessions: { some: {
      organisationId, facility: { organisationId }, programme: { organisationId }, contributor: { organisationId }
    } } }, select: { id: true } }) : [],
    // Any ACTIVE association is conservatively in-progress, even if expired
    // or malformed across tenants. This read never expires or repairs it.
    projectIds.length ? database.audioProject.findMany({ where: { ...projectWhere,
      correctionsStudioSessions: { some: { status: "ACTIVE" } } }, select: { id: true } }) : []
  ]);
  const existingProjects = new Set(projects.map((row) => row.id));
  const supervisedProjects = new Set(supervised.map((row) => row.id));
  const activeProjects = new Set(active.map((row) => row.id));
  const items = [];
  for (const { object, projectId } of matching) {
    const modified = validDate(object.LastModified);
    const item = { keyFingerprint: fingerprint(object.Key), projectFingerprint: fingerprint(projectId),
      classification: "UNVERIFIED" };
    if (references.has(object.Key)) item.classification = "REFERENCED_DB";
    else if (!existingProjects.has(projectId)) item.classification = "MISSING_OR_OUT_OF_SCOPE_PROJECT_REVIEW";
    else if (activeProjects.has(projectId)) item.classification = "SESSION_IN_PROGRESS_REVIEW";
    else if (!supervisedProjects.has(projectId)) item.classification = "PROJECT_CONTEXT_UNVERIFIED";
    else if (!modified || modified.getTime() > now.getTime()) item.classification = "TIMESTAMP_UNVERIFIED";
    else if (modified.getTime() > now.getTime() - MIN_AGE_MS) item.classification = "TOO_RECENT_REVIEW";
    else {
      try {
        const head = await storage.client.send(new HeadObjectCommand({ Bucket: storage.bucketName, Key: object.Key }));
        const headModified = validDate(head.LastModified);
        if (typeof object.ETag !== "string" || !object.ETag.length || head.ETag !== object.ETag ||
            !validSize(object.Size) || !validSize(head.ContentLength) || head.ContentLength !== object.Size ||
            headModified?.getTime() !== modified.getTime()) item.classification = "OBJECT_CHANGED_REVIEW";
        else if (head.Metadata?.source !== "corrections-supervised-studio" || head.Metadata?.project !== projectId ||
            !/^[0-9a-f]{64}$/.test(head.Metadata?.checksum || "")) item.classification = "PROVENANCE_UNVERIFIED";
        else {
          item.objectFingerprint = fingerprint(JSON.stringify([object.Key, head.ETag, head.ContentLength,
            headModified.toISOString(), head.Metadata.checksum]));
          item.classification = "NO_DATABASE_REFERENCE_OBSERVED_REVIEW";
        }
      } catch {
        // NoSuchKey, a generic 404 and dependency failure are all uncertain.
        // None proves historical erasure or allows disposal of private bytes.
        item.classification = "HEAD_UNVERIFIED";
      }
    }
    items.push(item);
  }
  const counts = { skippedOtherCorrectionsStudio: listed.length - matching.length };
  for (const item of items) counts[item.classification] = (counts[item.classification] || 0) + 1;
  return { schemaVersion: 1, kind: "CORRECTIONS_RECORDING_STORAGE", runId: randomUUID(), organisationId, observedAt: now.toISOString(),
    readOnly: true, coverage: "BOUNDED_PAGE_ONLY", disposalCandidates: false, minimumAgeDays: 7,
    page: { items, counts, hasMore: Boolean(page.IsTruncated), nextCursor: page.IsTruncated ? page.NextContinuationToken : null } };
}
