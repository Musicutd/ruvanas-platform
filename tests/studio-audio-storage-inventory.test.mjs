import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { HeadObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { inventoryStudioAudioStorage } from "../lib/studio-audio-storage-inventory.mjs";

const organisationId = "orgA";
const projectId = "projectA";
const key = `organisations/${organisationId}/school-audio/${projectId}/11111111-1111-4111-8111-111111111111.webm`;
const legacyKey = `organisations/${organisationId}/school-audio/${projectId}/22222222-2222-4222-8222-222222222222.webm`;
const observedAt = new Date("2026-10-04T12:00:00.000Z");
const modified = new Date("2026-09-20T12:00:00.000Z");

function fixture({
  objects = [{ Key: key, ETag: '"etag-one"', Size: 128, LastModified: modified }],
  referenced = [], projects = [{ id: projectId }], privateProjects = [],
  activeProjects = [], legacy = [], privateMediaIds = [], heads = {}, listTruncated = false,
  nextCursor = "next-page"
} = {}) {
  const commands = [];
  const storage = { bucketName: "fictional-bucket", client: { send: async (command) => {
    commands.push(command);
    if (command instanceof ListObjectsV2Command) return {
      Contents: objects, IsTruncated: listTruncated,
      ...(listTruncated && nextCursor ? { NextContinuationToken: nextCursor } : {})
    };
    if (command instanceof HeadObjectCommand) {
      const response = heads[command.input.Key];
      if (response instanceof Error) throw response;
      if (response) return response;
      const listed = objects.find((item) => item.Key === command.input.Key);
      if (!listed) throw Object.assign(new Error("not found"), { name: "NoSuchKey", $metadata: { httpStatusCode: 404 } });
      return { ETag: listed.ETag, ContentLength: listed.Size, LastModified: listed.LastModified,
        Metadata: { source: "audiolab", project: projectId } };
    }
    throw new Error("The inventory issued an unexpected storage command.");
  } } };
  const database = {
    mediaAsset: { findMany: async ({ where }) => where.storageKey
      ? referenced.filter((item) => where.storageKey.in.includes(item.storageKey))
      : legacy.filter((item) => where.id.in.includes(item.mediaAssetId) &&
        !privateMediaIds.includes(item.mediaAssetId)).map((item) => ({ id: item.mediaAssetId })) },
    audioProject: { findMany: async ({ where }) => projects.filter((item) =>
      where.id.in.includes(item.id) && (!where.NOT || !privateProjects.includes(item.id))) },
    schoolAudioUploadSession: { findMany: async ({ where }) => activeProjects
      .filter((id) => where.projectId.in.includes(id)).map((id) => ({ projectId: id })) },
    audioTake: { findMany: async ({ where, take }) => legacy.filter((item) =>
      !where.id?.gt || item.id > where.id.gt).slice(0, take) }
  };
  return { storage, database, commands };
}

function scan(fixtureValue, options = {}) {
  return inventoryStudioAudioStorage({
    database: fixtureValue.database, storage: fixtureValue.storage,
    organisationId, now: observedAt, limit: 100, ...options
  });
}

test("a cross-tenant or deleted media reference prevents an orphan claim", async () => {
  const source = fixture({ referenced: [{ storageKey: key, organisationId: "another-org", status: "DELETED" }] });
  const report = await scan(source);
  assert.equal(report.pages.final.items[0].classification, "REFERENCED_DB");
  assert.ok(!report.pages.final.items[0].key);
  assert.equal(source.commands.filter((command) => command instanceof HeadObjectCommand).length, 0);
  assert.equal(report.readOnly, true);
});

test("continuation pages never claim to be a complete organisation inventory", async () => {
  const legacy = ["take-one", "take-two"].map((id) => ({ id, projectId, mediaAssetId: `media-${id}`,
    mediaAsset: { storageKey: legacyKey, status: "DELETED" } }));
  const report = await scan(fixture({ listTruncated: true, legacy }), { limit: 1 });
  assert.equal(report.coverage, "BOUNDED_PAGE_ONLY");
  assert.equal(report.pages.final.hasMore, true);
  assert.equal(report.pages.final.nextCursor, "next-page");
  assert.equal(report.pages.legacy.hasMore, true);
  assert.equal(report.pages.legacy.nextAfterId, "take-one");
});

test("an old exact AudioLab object needs two unchanged observations and remains review-only", async () => {
  const first = await scan(fixture());
  assert.equal(first.pages.final.items[0].classification, "UNREFERENCED_REVIEW");
  assert.ok(first.pages.final.items[0].objectFingerprint);
  const second = await scan(fixture(), { now: new Date(observedAt.getTime() + 25 * 60 * 60 * 1000), previous: first });
  assert.equal(second.pages.final.items[0].classification, "STABLE_UNREFERENCED_REVIEW");
  assert.equal(second.pages.final.items[0].keyFingerprint, first.pages.final.items[0].keyFingerprint);
  const changed = await scan(fixture({ objects: [{ Key: key, ETag: '"etag-two"', Size: 128, LastModified: modified }] }),
    { now: new Date(observedAt.getTime() + 25 * 60 * 60 * 1000), previous: first });
  assert.equal(changed.pages.final.items[0].classification, "UNREFERENCED_REVIEW");
});

test("private, active, missing, recent and non-AudioLab paths never become candidates", async () => {
  assert.equal((await scan(fixture({ privateProjects: [projectId] }))).pages.final.items[0].classification,
    "PROTECTED_PROJECT_REVIEW");
  assert.equal((await scan(fixture({ activeProjects: [projectId] }))).pages.final.items[0].classification,
    "ACTIVE_UPLOAD_REVIEW");
  assert.equal((await scan(fixture({ projects: [] }))).pages.final.items[0].classification,
    "MISSING_PROJECT_REVIEW");
  assert.equal((await scan(fixture({ objects: [{ Key: key, ETag: '"recent"', Size: 128,
    LastModified: new Date("2026-10-03T12:00:00.000Z") }] }))).pages.final.items[0].classification,
    "TOO_RECENT");
  const render = `organisations/${organisationId}/school-audio/renders/${projectId}/33333333-3333-4333-8333-333333333333.mp3`;
  const report = await scan(fixture({ objects: [{ Key: render, ETag: '"render"', Size: 128, LastModified: modified }] }));
  assert.deepEqual(report.pages.final.items, []);
  assert.equal(report.pages.final.counts.skippedOtherSchoolAudio, 1);
});

test("uncertain listing, HEAD, provenance, and previous scope fail closed", async () => {
  await assert.rejects(scan(fixture({ listTruncated: true, nextCursor: null })), /truncated/);
  const badHead = fixture({ heads: { [key]: Object.assign(new Error("storage unavailable"), { name: "ServiceUnavailable" }) } });
  assert.equal((await scan(badHead)).pages.final.items[0].classification, "HEAD_UNVERIFIED");
  const wrongProvenance = fixture({ heads: { [key]: { ETag: '"etag-one"', ContentLength: 128,
    LastModified: modified, Metadata: { source: "another-source", project: projectId } } } });
  assert.equal((await scan(wrongProvenance)).pages.final.items[0].classification, "PROVENANCE_UNVERIFIED");
  await assert.rejects(scan(fixture(), { previous: { schemaVersion: 1, organisationId: "other" } }), /scope/);
  const noModified = await scan(fixture({ objects: [{ Key: key, ETag: '"etag-one"', Size: 128, LastModified: null }] }));
  assert.equal(noModified.pages.final.items[0].classification, "TIMESTAMP_UNVERIFIED");
  const noSize = await scan(fixture({ objects: [{ Key: key, ETag: '"etag-one"', LastModified: modified }] }));
  assert.equal(noSize.pages.final.items[0].classification, "OBJECT_CHANGED_REVIEW");
});

test("old tombstones with surviving bytes are reported, never erased", async () => {
  const row = { id: "take-one", projectId, mediaAssetId: "media-one",
    mediaAsset: { storageKey: legacyKey, status: "DELETED" } };
  const source = fixture({ objects: [], legacy: [row], heads: {
    [legacyKey]: { ETag: '"legacy"', ContentLength: 128, LastModified: modified,
      Metadata: { source: "audiolab", project: projectId } }
  } });
  const first = await scan(source);
  assert.equal(first.pages.legacy.items[0].classification, "LEGACY_TOMBSTONE_OBJECT_REVIEW");
  const second = await scan(fixture({ objects: [], legacy: [row], heads: {
    [legacyKey]: { ETag: '"legacy"', ContentLength: 128, LastModified: modified,
      Metadata: { source: "audiolab", project: projectId } }
  } }), { now: new Date(observedAt.getTime() + 25 * 60 * 60 * 1000), previous: first });
  assert.equal(second.pages.legacy.items[0].classification, "STABLE_LEGACY_TOMBSTONE_REVIEW");
  const differentTake = await scan(fixture({ objects: [], legacy: [{ ...row, id: "take-two" }], heads: {
    [legacyKey]: { ETag: '"legacy"', ContentLength: 128, LastModified: modified,
      Metadata: { source: "audiolab", project: projectId } }
  } }), { now: new Date(observedAt.getTime() + 25 * 60 * 60 * 1000), previous: first });
  assert.equal(differentTake.pages.legacy.items[0].classification, "LEGACY_TOMBSTONE_OBJECT_REVIEW");
  assert.ok(source.commands.every((command) =>
    command instanceof ListObjectsV2Command || command instanceof HeadObjectCommand));
  const protectedReport = await scan(fixture({ objects: [], legacy: [row], privateMediaIds: [row.mediaAssetId] }));
  assert.equal(protectedReport.pages.legacy.items[0].classification, "PROTECTED_LEGACY_OBJECT_REVIEW");
  const mismatched = { ...row, mediaAsset: { ...row.mediaAsset,
    storageKey: `organisations/${organisationId}/school-audio/otherProject/22222222-2222-4222-8222-222222222222.webm` } };
  const mismatchedReport = await scan(fixture({ objects: [], legacy: [mismatched] }));
  assert.equal(mismatchedReport.pages.legacy.items[0].classification, "KEY_PROJECT_MISMATCH_REVIEW");
  const replaced = await scan(fixture({ objects: [], legacy: [row], heads: {
    [legacyKey]: { ETag: '"replacement"', ContentLength: 128, LastModified: modified,
      Metadata: { source: "other", project: projectId } }
  } }));
  assert.equal(replaced.pages.legacy.items[0].classification, "PROVENANCE_UNVERIFIED");
  const recent = await scan(fixture({ objects: [], legacy: [row], heads: {
    [legacyKey]: { ETag: '"new"', ContentLength: 128, LastModified: new Date("2026-10-03T12:00:00Z"),
      Metadata: { source: "audiolab", project: projectId } }
  } }));
  assert.equal(recent.pages.legacy.items[0].classification, "TOO_RECENT");
});

test("a missing legacy object is merely observed as absent, not treated as deleted evidence", async () => {
  const row = { id: "take-one", projectId, mediaAssetId: "media-one",
    mediaAsset: { storageKey: legacyKey, status: "DELETED" } };
  const report = await scan(fixture({ objects: [], legacy: [row] }));
  assert.equal(report.pages.legacy.items[0].classification, "OBJECT_NOT_FOUND_OBSERVED");
  const generic404 = Object.assign(new Error("not found"), { name: "NotFound", $metadata: { httpStatusCode: 404 } });
  const uncertain = await scan(fixture({ objects: [], legacy: [row], heads: { [legacyKey]: generic404 } }));
  assert.equal(uncertain.pages.legacy.items[0].classification, "HEAD_UNVERIFIED");
});

test("the operator script has no delete, abort or database write mode", async () => {
  const script = await readFile(new URL("../scripts/studio-audio-storage-inventory.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(script, /DeleteObjectCommand|AbortMultipartUploadCommand|\.delete\(|\.update\(|\.create\(/);
  assert.match(script, /inventoryStudioAudioStorage/);
});
