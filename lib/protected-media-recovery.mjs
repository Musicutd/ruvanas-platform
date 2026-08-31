import { createHash } from "node:crypto";

export const PROTECTED_MEDIA_BACKUP_VERSION = 1;
export const DEFAULT_BACKUP_PREFIX = "ruvanas-backups";
export const DEFAULT_DRILL_PREFIX = "ruvanas-restore-drills";

function clean(value, limit = 240) {
  return String(value || "").trim().replace(/[\r\n\t]+/g, " ").slice(0, limit);
}

function required(value, label) {
  const resolved = clean(value, 512);
  if (!resolved) throw Object.assign(new Error(`${label} is required.`), { code: "BACKUP_CONFIGURATION_INCOMPLETE" });
  return resolved;
}

function normalizedSize(value) {
  const size = Number(value);
  if (!Number.isSafeInteger(size) || size < 0) {
    throw Object.assign(new Error("Protected-media object sizes must be non-negative safe integers."), { code: "BACKUP_OBJECT_SIZE_INVALID" });
  }
  return size;
}

function normalizedSha256(value) {
  const sha256 = required(value, "Object SHA-256").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(sha256)) {
    throw Object.assign(new Error("Protected-media checksums must be SHA-256 values."), { code: "BACKUP_CHECKSUM_INVALID" });
  }
  return sha256;
}

export function normalizeBackupPrefix(value, fallback = DEFAULT_BACKUP_PREFIX) {
  const prefix = clean(value || fallback, 180).replace(/^\/+|\/+$/g, "");
  if (!prefix || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(prefix) || prefix.includes("..")) {
    throw Object.assign(new Error("Backup prefixes must use safe path characters."), { code: "BACKUP_PREFIX_INVALID" });
  }
  return prefix;
}

export function normalizeSnapshotId(value, now = new Date()) {
  const generated = new Date(now).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const snapshotId = clean(value || generated, 80);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$/.test(snapshotId)) {
    throw Object.assign(new Error("Snapshot identifiers must use safe reference characters."), { code: "SNAPSHOT_ID_INVALID" });
  }
  return snapshotId;
}

export function normalizeBackupConfiguration(environment = process.env) {
  const sourceBucket = required(environment.R2_BUCKET_NAME, "R2_BUCKET_NAME");
  const backupBucket = required(environment.R2_BACKUP_BUCKET_NAME, "R2_BACKUP_BUCKET_NAME");
  if (sourceBucket === backupBucket) {
    throw Object.assign(new Error("The protected-media backup bucket must be separate from production."), { code: "BACKUP_BUCKET_NOT_ISOLATED" });
  }
  return {
    endpoint: required(environment.R2_ENDPOINT, "R2_ENDPOINT"),
    accessKeyId: required(environment.R2_ACCESS_KEY_ID, "R2_ACCESS_KEY_ID"),
    secretAccessKey: required(environment.R2_SECRET_ACCESS_KEY, "R2_SECRET_ACCESS_KEY"),
    sourceBucket,
    backupBucket,
    backupPrefix: normalizeBackupPrefix(environment.R2_BACKUP_PREFIX),
    drillPrefix: normalizeBackupPrefix(environment.R2_RESTORE_DRILL_PREFIX, DEFAULT_DRILL_PREFIX)
  };
}

export function encodeCopySource(bucket, key) {
  return `${encodeURIComponent(required(bucket, "Source bucket"))}/${String(key || "").split("/").map((part) => encodeURIComponent(part)).join("/")}`;
}

export function backupObjectKey({ backupPrefix, snapshotId, sourceKey }) {
  const key = String(sourceKey || "").replace(/^\/+/, "");
  if (!key) throw Object.assign(new Error("Source object key is required."), { code: "SOURCE_OBJECT_KEY_MISSING" });
  return `${normalizeBackupPrefix(backupPrefix)}/${normalizeSnapshotId(snapshotId)}/objects/${key}`;
}

export function snapshotManifestKey(backupPrefix, snapshotId) {
  return `${normalizeBackupPrefix(backupPrefix)}/${normalizeSnapshotId(snapshotId)}/manifest.json`;
}

export function latestSnapshotKey(backupPrefix) {
  return `${normalizeBackupPrefix(backupPrefix)}/latest.json`;
}

export function restoreDrillKey({ drillPrefix, drillId, sourceKey }) {
  const fingerprint = createHash("sha256").update(String(sourceKey || "")).digest("hex").slice(0, 24);
  return `${normalizeBackupPrefix(drillPrefix, DEFAULT_DRILL_PREFIX)}/${normalizeSnapshotId(drillId)}/${fingerprint}`;
}

export function normalizeEtag(value) {
  return clean(value, 160).replace(/^"|"$/g, "");
}

export function buildBackupMetadata({ snapshotId, sourceKey, sourceSize, sourceEtag, sha256, existing = {} }) {
  const metadata = {};
  for (const [key, value] of Object.entries(existing || {})) {
    const safeKey = clean(key, 120).toLowerCase().replace(/[^a-z0-9._-]/g, "-");
    const safeValue = clean(value, 1_000);
    if (safeKey && safeValue) metadata[safeKey] = safeValue;
  }
  return {
    ...metadata,
    "ruvanas-backup-version": String(PROTECTED_MEDIA_BACKUP_VERSION),
    "ruvanas-snapshot-id": normalizeSnapshotId(snapshotId),
    "ruvanas-source-key-hash": createHash("sha256").update(String(sourceKey || "")).digest("hex"),
    "ruvanas-source-size": String(normalizedSize(sourceSize)),
    "ruvanas-source-etag": normalizeEtag(sourceEtag) || "unavailable",
    "ruvanas-source-sha256": normalizedSha256(sha256)
  };
}

export function createSnapshotManifest({ snapshotId, createdAt = new Date(), objects = [] }) {
  const normalizedId = normalizeSnapshotId(snapshotId, createdAt);
  const sourceKeys = new Set();
  const backupKeys = new Set();
  const entries = objects.map((item) => ({
    key: required(item.key, "Object key"),
    backupKey: required(item.backupKey, "Backup object key"),
    size: normalizedSize(item.size),
    etag: normalizeEtag(item.etag) || null,
    sha256: normalizedSha256(item.sha256),
    contentType: clean(item.contentType, 200) || null
  })).map((entry) => {
    if (sourceKeys.has(entry.key) || backupKeys.has(entry.backupKey)) {
      throw Object.assign(new Error("The protected-media manifest contains a duplicate object."), { code: "BACKUP_MANIFEST_DUPLICATE" });
    }
    sourceKeys.add(entry.key);
    backupKeys.add(entry.backupKey);
    return entry;
  }).sort((left, right) => left.key.localeCompare(right.key));
  const totalBytes = entries.reduce((sum, item) => sum + item.size, 0);
  return {
    version: PROTECTED_MEDIA_BACKUP_VERSION,
    snapshotId: normalizedId,
    createdAt: new Date(createdAt).toISOString(),
    objectCount: entries.length,
    totalBytes,
    objects: entries
  };
}

export function validateSnapshotManifest(value) {
  if (!value || value.version !== PROTECTED_MEDIA_BACKUP_VERSION || !Array.isArray(value.objects)) {
    throw Object.assign(new Error("The protected-media manifest is unsupported."), { code: "BACKUP_MANIFEST_INVALID" });
  }
  const manifest = createSnapshotManifest({ snapshotId: value.snapshotId, createdAt: value.createdAt, objects: value.objects });
  if (manifest.objectCount !== Number(value.objectCount) || manifest.totalBytes !== Number(value.totalBytes)) {
    throw Object.assign(new Error("The protected-media manifest summary is inconsistent."), { code: "BACKUP_MANIFEST_INCONSISTENT" });
  }
  return manifest;
}

export function assertBackupObject({ manifestEntry, contentLength, metadata = {}, sha256 = null }) {
  if (Number(contentLength) !== manifestEntry.size) {
    throw Object.assign(new Error("A protected-media backup object has the wrong size."), { code: "BACKUP_SIZE_MISMATCH" });
  }
  if (metadata["ruvanas-source-sha256"] && metadata["ruvanas-source-sha256"] !== manifestEntry.sha256) {
    throw Object.assign(new Error("A protected-media backup object has inconsistent metadata."), { code: "BACKUP_METADATA_MISMATCH" });
  }
  if (sha256 && sha256 !== manifestEntry.sha256) {
    throw Object.assign(new Error("A protected-media backup object failed its integrity check."), { code: "BACKUP_CHECKSUM_MISMATCH" });
  }
  return true;
}

export function safeEvidenceReference(kind, snapshotId) {
  const prefix = kind === "RESTORE_DRILL" ? "r2-restore" : "r2-backup";
  return `${prefix}-${normalizeSnapshotId(snapshotId)}`.slice(0, 160);
}

export function selectRestoreDrillObject(manifest) {
  const validated = validateSnapshotManifest(manifest);
  if (validated.objects.length === 0) {
    throw Object.assign(new Error("The snapshot contains no protected-media objects."), { code: "BACKUP_SNAPSHOT_EMPTY" });
  }
  return validated.objects[0];
}

export function safeRecoveryErrorCode(error, fallback = "PROTECTED_MEDIA_RECOVERY_FAILED") {
  const code = clean(error?.code || error?.name || fallback, 80).replace(/[^A-Z0-9_]/gi, "_").toUpperCase();
  return code || fallback;
}
