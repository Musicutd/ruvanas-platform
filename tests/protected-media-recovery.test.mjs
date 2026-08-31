import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  assertBackupObject,
  backupObjectKey,
  buildBackupMetadata,
  createSnapshotManifest,
  encodeCopySource,
  normalizeBackupConfiguration,
  restoreDrillKey,
  safeEvidenceReference,
  selectRestoreDrillObject,
  validateSnapshotManifest
} from "../lib/protected-media-recovery.mjs";

const environment = {
  R2_ENDPOINT: "https://example.r2.invalid",
  R2_ACCESS_KEY_ID: "test-access",
  R2_SECRET_ACCESS_KEY: "test-secret",
  R2_BUCKET_NAME: "production-media",
  R2_BACKUP_BUCKET_NAME: "protected-backup"
};

test("backup configuration requires an isolated destination", () => {
  assert.throws(() => normalizeBackupConfiguration({ ...environment, R2_BACKUP_BUCKET_NAME: "production-media" }), /separate from production/);
  const configuration = normalizeBackupConfiguration(environment);
  assert.equal(configuration.sourceBucket, "production-media");
  assert.equal(configuration.backupBucket, "protected-backup");
  assert.equal(configuration.backupPrefix, "ruvanas-backups");
});

test("backup keys and copy sources preserve nested object paths safely", () => {
  assert.equal(backupObjectKey({ backupPrefix: "snapshots", snapshotId: "20260831T180000Z", sourceKey: "organisations/a/source file.mp3" }), "snapshots/20260831T180000Z/objects/organisations/a/source file.mp3");
  assert.equal(encodeCopySource("production-media", "organisations/a/source file.mp3"), "production-media/organisations/a/source%20file.mp3");
  assert.match(restoreDrillKey({ drillPrefix: "drills", drillId: "drill-20260831", sourceKey: "organisations/a/source file.mp3" }), /^drills\/drill-20260831\/[a-f0-9]{24}$/);
});

test("backup metadata contains bounded integrity evidence without raw source keys", () => {
  const metadata = buildBackupMetadata({ snapshotId: "20260831T180000Z", sourceKey: "private/customer/audio.mp3", sourceSize: 42, sourceEtag: '"etag-value"', sha256: "a".repeat(64), existing: { source: "catalogue" } });
  assert.equal(metadata["ruvanas-source-size"], "42");
  assert.equal(metadata["ruvanas-source-etag"], "etag-value");
  assert.equal(metadata["ruvanas-source-sha256"], "a".repeat(64));
  assert.equal(JSON.stringify(metadata).includes("private/customer/audio.mp3"), false);
});

test("snapshot manifests are deterministic and reject inconsistent summaries", () => {
  const manifest = createSnapshotManifest({
    snapshotId: "20260831T180000Z",
    createdAt: new Date("2026-08-31T18:00:00.000Z"),
    objects: [
      { key: "b.mp3", backupKey: "snapshots/b.mp3", size: 20, etag: "b", sha256: "b".repeat(64) },
      { key: "a.mp3", backupKey: "snapshots/a.mp3", size: 10, etag: "a", sha256: "a".repeat(64) }
    ]
  });
  assert.equal(manifest.objectCount, 2);
  assert.equal(manifest.totalBytes, 30);
  assert.equal(manifest.objects[0].key, "a.mp3");
  assert.equal(selectRestoreDrillObject(manifest).key, "a.mp3");
  assert.throws(() => validateSnapshotManifest({ ...manifest, totalBytes: 31 }), /summary is inconsistent/);
  assert.throws(() => createSnapshotManifest({ snapshotId: "20260831T180000Z", objects: [{ key: "a", backupKey: "b", size: -1, sha256: "a".repeat(64) }] }), /non-negative safe integers/);
  assert.throws(() => createSnapshotManifest({ snapshotId: "20260831T180000Z", objects: [{ key: "a", backupKey: "b", size: 1, sha256: "not-a-checksum" }] }), /SHA-256 values/);
  assert.throws(() => createSnapshotManifest({ snapshotId: "20260831T180000Z", objects: [
    { key: "a", backupKey: "b", size: 1, sha256: "a".repeat(64) },
    { key: "a", backupKey: "c", size: 1, sha256: "b".repeat(64) }
  ] }), /duplicate object/);
});

test("verification detects size, metadata, and checksum mismatches", () => {
  const entry = { key: "a.mp3", backupKey: "backup/a.mp3", size: 10, sha256: "a".repeat(64) };
  assert.equal(assertBackupObject({ manifestEntry: entry, contentLength: 10, metadata: { "ruvanas-source-sha256": "a".repeat(64) }, sha256: "a".repeat(64) }), true);
  assert.throws(() => assertBackupObject({ manifestEntry: entry, contentLength: 9 }), /wrong size/);
  assert.throws(() => assertBackupObject({ manifestEntry: entry, contentLength: 10, metadata: { "ruvanas-source-sha256": "b".repeat(64) } }), /inconsistent metadata/);
  assert.throws(() => assertBackupObject({ manifestEntry: entry, contentLength: 10, sha256: "b".repeat(64) }), /integrity check/);
});

test("safe evidence references are suitable for the recovery register", () => {
  assert.equal(safeEvidenceReference("BACKUP_VERIFICATION", "20260831T180000Z"), "r2-backup-20260831T180000Z");
  assert.equal(safeEvidenceReference("RESTORE_DRILL", "drill-20260831"), "r2-restore-drill-20260831");
});

test("the dormant command fails closed with a safe machine-readable error", () => {
  const result = spawnSync(process.execPath, ["scripts/protected-media-recovery.mjs", "verify"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      R2_ENDPOINT: "",
      R2_ACCESS_KEY_ID: "",
      R2_SECRET_ACCESS_KEY: "",
      R2_BUCKET_NAME: "",
      R2_BACKUP_BUCKET_NAME: ""
    }
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /"event":"protected_media_recovery_failed"/);
  assert.match(result.stdout, /"errorCode":"BACKUP_CONFIGURATION_INCOMPLETE"/);
  assert.equal(result.stderr, "");
});
