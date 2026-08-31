import { createHash } from "node:crypto";
import {
  CopyObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import {
  assertBackupObject,
  backupObjectKey,
  buildBackupMetadata,
  createSnapshotManifest,
  encodeCopySource,
  latestSnapshotKey,
  normalizeBackupConfiguration,
  normalizeSnapshotId,
  restoreDrillKey,
  safeEvidenceReference,
  safeRecoveryErrorCode,
  selectRestoreDrillObject,
  snapshotManifestKey,
  validateSnapshotManifest
} from "../lib/protected-media-recovery.mjs";

const mode = String(process.argv[2] || "verify").toLowerCase();
const option = (name) => process.argv.slice(3).find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3) || null;
let configuration;
let client;

function log(event, details = {}) {
  process.stdout.write(`${JSON.stringify({ timestamp: new Date().toISOString(), event, ...details })}\n`);
}

async function listObjects(bucket, prefix = undefined) {
  const objects = [];
  let continuationToken;
  do {
    const page = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: continuationToken }));
    for (const item of page.Contents || []) {
      if (item.Key && Number(item.Size) >= 0) objects.push({ key: item.Key, size: Number(item.Size), etag: item.ETag || null });
    }
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);
  return objects.sort((left, right) => left.key.localeCompare(right.key));
}

async function bodyBytes(body) {
  if (typeof body?.transformToByteArray === "function") return Buffer.from(await body.transformToByteArray());
  const chunks = [];
  for await (const chunk of body || []) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function getObjectIntegrity(bucket, key, etag = undefined) {
  const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key, IfMatch: etag }));
  const hash = createHash("sha256");
  let size = 0;
  if (response.Body && Symbol.asyncIterator in Object(response.Body)) {
    for await (const chunk of response.Body) {
      const bytes = Buffer.from(chunk);
      size += bytes.byteLength;
      hash.update(bytes);
    }
  } else {
    const bytes = await bodyBytes(response.Body);
    size = bytes.byteLength;
    hash.update(bytes);
  }
  return { size, sha256: hash.digest("hex") };
}

async function readJson(bucket, key) {
  const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return JSON.parse((await bodyBytes(response.Body)).toString("utf8"));
}

async function resolveSnapshotId(requested) {
  if (requested) return normalizeSnapshotId(requested);
  const latest = await readJson(configuration.backupBucket, latestSnapshotKey(configuration.backupPrefix));
  return normalizeSnapshotId(latest.snapshotId);
}

async function readManifest(requestedSnapshot) {
  const snapshotId = await resolveSnapshotId(requestedSnapshot);
  const manifest = validateSnapshotManifest(await readJson(configuration.backupBucket, snapshotManifestKey(configuration.backupPrefix, snapshotId)));
  return { snapshotId, manifest };
}

async function assertPrefixUnused(prefix, errorCode) {
  const existing = await listObjects(configuration.backupBucket, `${prefix.replace(/\/+$/g, "")}/`);
  if (existing.length > 0) {
    throw Object.assign(new Error("The protected-media recovery identifier is already in use."), { code: errorCode });
  }
}

async function createBackup() {
  const snapshotId = normalizeSnapshotId(option("snapshot"));
  await assertPrefixUnused(`${configuration.backupPrefix}/${snapshotId}`, "BACKUP_SNAPSHOT_ALREADY_EXISTS");
  const sourceObjects = await listObjects(configuration.sourceBucket);
  const copied = [];
  let completedBytes = 0;
  for (const source of sourceObjects) {
    const sourceHead = await client.send(new HeadObjectCommand({ Bucket: configuration.sourceBucket, Key: source.key }));
    const integrity = await getObjectIntegrity(configuration.sourceBucket, source.key, sourceHead.ETag);
    const backupKey = backupObjectKey({ backupPrefix: configuration.backupPrefix, snapshotId, sourceKey: source.key });
    const metadata = buildBackupMetadata({
      snapshotId,
      sourceKey: source.key,
      sourceSize: integrity.size,
      sourceEtag: source.etag,
      sha256: integrity.sha256,
      existing: sourceHead.Metadata
    });
    await client.send(new CopyObjectCommand({
      Bucket: configuration.backupBucket,
      Key: backupKey,
      CopySource: encodeCopySource(configuration.sourceBucket, source.key),
      CopySourceIfMatch: sourceHead.ETag,
      MetadataDirective: "REPLACE",
      Metadata: metadata,
      ContentType: sourceHead.ContentType,
      CacheControl: sourceHead.CacheControl,
      ContentDisposition: sourceHead.ContentDisposition,
      ContentEncoding: sourceHead.ContentEncoding,
      ContentLanguage: sourceHead.ContentLanguage
    }));
    const backupHead = await client.send(new HeadObjectCommand({ Bucket: configuration.backupBucket, Key: backupKey }));
    const manifestEntry = { key: source.key, backupKey, size: integrity.size, etag: source.etag, sha256: integrity.sha256, contentType: sourceHead.ContentType || null };
    assertBackupObject({ manifestEntry, contentLength: backupHead.ContentLength, metadata: backupHead.Metadata });
    copied.push(manifestEntry);
    completedBytes += integrity.size;
    log("protected_media_backup_progress", { snapshotId, completedObjects: copied.length, totalObjects: sourceObjects.length, completedBytes });
  }
  const manifest = createSnapshotManifest({ snapshotId, objects: copied });
  await client.send(new PutObjectCommand({ Bucket: configuration.backupBucket, Key: snapshotManifestKey(configuration.backupPrefix, snapshotId), Body: JSON.stringify(manifest), ContentType: "application/json", Metadata: { "ruvanas-snapshot-id": snapshotId } }));
  await client.send(new PutObjectCommand({ Bucket: configuration.backupBucket, Key: latestSnapshotKey(configuration.backupPrefix), Body: JSON.stringify({ snapshotId, createdAt: manifest.createdAt }), ContentType: "application/json" }));
  log("protected_media_backup_completed", { snapshotId, objectCount: manifest.objectCount, totalBytes: manifest.totalBytes, evidenceReference: safeEvidenceReference("BACKUP_VERIFICATION", snapshotId) });
}

async function verifyBackup() {
  const { snapshotId, manifest } = await readManifest(option("snapshot"));
  let verifiedBytes = 0;
  for (const entry of manifest.objects) {
    const head = await client.send(new HeadObjectCommand({ Bucket: configuration.backupBucket, Key: entry.backupKey }));
    const integrity = await getObjectIntegrity(configuration.backupBucket, entry.backupKey, head.ETag);
    assertBackupObject({ manifestEntry: entry, contentLength: head.ContentLength, metadata: head.Metadata, sha256: integrity.sha256 });
    verifiedBytes += integrity.size;
  }
  log("protected_media_backup_verified", { snapshotId, result: "PASSED", objectCount: manifest.objectCount, verifiedBytes, evidenceReference: safeEvidenceReference("BACKUP_VERIFICATION", snapshotId) });
}

async function runRestoreDrill() {
  const startedAt = new Date();
  const { snapshotId, manifest } = await readManifest(option("snapshot"));
  const entry = selectRestoreDrillObject(manifest);
  const drillId = normalizeSnapshotId(option("drill") || `drill-${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}`);
  await assertPrefixUnused(`${configuration.drillPrefix}/${drillId}`, "RESTORE_DRILL_ALREADY_EXISTS");
  const restoredKey = restoreDrillKey({ drillPrefix: configuration.drillPrefix, drillId, sourceKey: entry.key });
  await client.send(new CopyObjectCommand({
    Bucket: configuration.backupBucket,
    Key: restoredKey,
    CopySource: encodeCopySource(configuration.backupBucket, entry.backupKey),
    MetadataDirective: "REPLACE",
    Metadata: { "ruvanas-restore-drill-id": drillId, "ruvanas-source-snapshot": snapshotId, "ruvanas-expected-sha256": entry.sha256 },
    ContentType: entry.contentType || "application/octet-stream"
  }));
  const restoredHead = await client.send(new HeadObjectCommand({ Bucket: configuration.backupBucket, Key: restoredKey }));
  const integrity = await getObjectIntegrity(configuration.backupBucket, restoredKey, restoredHead.ETag);
  assertBackupObject({ manifestEntry: entry, contentLength: restoredHead.ContentLength, sha256: integrity.sha256 });
  const durationMinutes = Math.max(1, Math.ceil((Date.now() - startedAt.getTime()) / 60_000));
  log("protected_media_restore_drill_completed", { snapshotId, drillId, result: "PASSED", durationMinutes, restoredBytes: integrity.size, evidenceReference: safeEvidenceReference("RESTORE_DRILL", drillId) });
}

try {
  configuration = normalizeBackupConfiguration(process.env);
  client = new S3Client({
    region: "auto",
    endpoint: configuration.endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId: configuration.accessKeyId, secretAccessKey: configuration.secretAccessKey }
  });
  if (mode === "backup") await createBackup();
  else if (mode === "verify") await verifyBackup();
  else if (mode === "drill") await runRestoreDrill();
  else throw Object.assign(new Error("Choose backup, verify, or drill."), { code: "RECOVERY_MODE_INVALID" });
} catch (error) {
  log("protected_media_recovery_failed", { mode, errorCode: safeRecoveryErrorCode(error) });
  process.exitCode = 1;
}
