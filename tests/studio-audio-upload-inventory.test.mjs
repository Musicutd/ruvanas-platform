import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { HeadObjectCommand, ListMultipartUploadsCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { inventoryStudioAudioUploads } from "../lib/studio-audio-upload-inventory.mjs";

const organisationId = "orgA";
const projectId = "projectA";
const key = `quarantine/${organisationId}/audio-lab/${projectId}/11111111-1111-4111-8111-111111111111.webm`;
const keyTwo = `quarantine/${organisationId}/audio-lab/${projectId}/22222222-2222-4222-8222-222222222222.webm`;
const observedAt = new Date("2026-10-05T12:00:00.000Z");
const old = new Date("2026-09-20T12:00:00.000Z");
const object = { Key: key, ETag: '"one"', Size: 128, LastModified: old };
const upload = { Key: keyTwo, UploadId: "r2-upload-one", Initiated: old };

function fixture({ objects = [object], uploads = [upload], sessions = [], projects = [{ id: projectId }],
  privateProjects = [], mediaRefs = [], heads = {}, truncatedObjects = false, objectCursor = "object-next",
  truncatedUploads = false, uploadMarkers = { key: keyTwo, id: "upload-next" } } = {}) {
  const commands = [];
  const storage = { bucketName: "fictional-bucket", client: { send: async (command) => {
    commands.push(command);
    if (command instanceof ListObjectsV2Command) return {
      Contents: objects, IsTruncated: truncatedObjects,
      ...(truncatedObjects && objectCursor ? { NextContinuationToken: objectCursor } : {})
    };
    if (command instanceof ListMultipartUploadsCommand) return {
      Uploads: uploads, IsTruncated: truncatedUploads,
      ...(truncatedUploads && uploadMarkers ? {
        NextKeyMarker: uploadMarkers.key, NextUploadIdMarker: uploadMarkers.id
      } : {})
    };
    if (command instanceof HeadObjectCommand) {
      const answer = heads[command.input.Key];
      if (answer instanceof Error) throw answer;
      if (answer) return answer;
      const listed = objects.find((row) => row.Key === command.input.Key);
      return { ETag: listed?.ETag, ContentLength: listed?.Size, LastModified: listed?.LastModified,
        Metadata: { quarantine: "true", project: projectId } };
    }
    throw new Error("An inventory issued a non-read storage command.");
  } } };
  const database = {
    audioProject: { findMany: async ({ where }) => projects.filter((row) =>
      where.id.in.includes(row.id) && (!where.NOT || !privateProjects.includes(row.id))) },
    mediaAsset: { findMany: async ({ where }) => mediaRefs.filter((row) =>
      where.storageKey.in.includes(row.storageKey)) },
    schoolAudioUploadSession: { findMany: async ({ where }) => sessions.filter((row) =>
      where.quarantineKey ? where.quarantineKey.in.includes(row.quarantineKey) :
        where.OR.some((clause) => clause.quarantineKey?.in.includes(row.quarantineKey) ||
          clause.multipartUploadId?.in.includes(row.multipartUploadId))) }
  };
  return { database, storage, commands };
}

function scan(source, options = {}) {
  return inventoryStudioAudioUploads({ database: source.database, storage: source.storage,
    organisationId, now: observedAt, limit: 100, ...options });
}

test("old direct quarantine objects and multipart uploads are bounded review evidence only", async () => {
  const source = fixture();
  const report = await scan(source);
  assert.equal(report.coverage, "BOUNDED_PAGE_ONLY");
  assert.equal(report.readOnly, true);
  assert.equal(report.pages.quarantine.items[0].classification, "OLD_QUARANTINE_OBJECT_REVIEW");
  assert.equal(report.pages.multipart.items[0].classification, "OLD_MULTIPART_UPLOAD_REVIEW");
  assert.equal(report.pages.quarantine.items[0].hasSession, false);
  assert.equal(report.pages.multipart.items[0].hasSession, false);
  assert.ok(!JSON.stringify(report).includes("r2-upload-one"));
  assert.ok(!JSON.stringify(report).includes(key));
  assert.ok(source.commands.every((command) => command instanceof ListObjectsV2Command ||
    command instanceof ListMultipartUploadsCommand || command instanceof HeadObjectCommand));
  const listing = source.commands.find((command) => command instanceof ListObjectsV2Command);
  const multipart = source.commands.find((command) => command instanceof ListMultipartUploadsCommand);
  assert.equal(listing.input.Prefix, `quarantine/${organisationId}/audio-lab/`);
  assert.equal(multipart.input.Prefix, listing.input.Prefix);
  assert.equal(listing.input.MaxKeys, 100);
  assert.equal(multipart.input.MaxUploads, 100);
});

test("current privacy, exact references and session state prevent an old-review label", async () => {
  const privateReport = await scan(fixture({ privateProjects: [projectId], sessions: [
    { id: "private-session", organisationId, projectId, quarantineKey: key,
      multipartUploadId: "private-multipart", status: "FAILED" },
    { id: "private-multipart-session", organisationId, projectId, quarantineKey: keyTwo,
      multipartUploadId: "r2-upload-one", status: "FAILED" }
  ] }));
  assert.equal(privateReport.pages.quarantine.items[0].classification, "PROTECTED_PROJECT_REVIEW");
  assert.equal(privateReport.pages.multipart.items[0].classification, "PROTECTED_PROJECT_REVIEW");
  for (const item of [privateReport.pages.quarantine.items[0], privateReport.pages.multipart.items[0]]) {
    assert.equal(item.hasSession, false);
    assert.equal(item.sessionStatus, null);
  }

  const referenced = await scan(fixture({ mediaRefs: [{ storageKey: key, organisationId: "other", status: "DELETED" }] }));
  assert.equal(referenced.pages.quarantine.items[0].classification, "REFERENCED_MEDIA_REVIEW");

  const active = { id: "session-active", organisationId, projectId, quarantineKey: key,
    multipartUploadId: "r2-upload-one", status: "COMPLETING" };
  const activeReport = await scan(fixture({ objects: [{ ...object, Key: keyTwo }], sessions: [{
    ...active, quarantineKey: keyTwo, multipartUploadId: "another-upload"
  }] }));
  assert.equal(activeReport.pages.multipart.items[0].classification, "KEY_RESERVED_BY_OTHER_SESSION_REVIEW");
  const sameKeySession = { ...active, quarantineKey: keyTwo };
  const unsettled = await scan(fixture({ objects: [{ ...object, Key: keyTwo }], sessions: [sameKeySession] }));
  assert.equal(unsettled.pages.quarantine.items[0].classification, "UNSETTLED_SESSION_REVIEW");
  assert.equal(unsettled.pages.multipart.items[0].classification, "UNSETTLED_SESSION_REVIEW");
  const crossTenant = await scan(fixture({ objects: [{ ...object, Key: keyTwo }],
    sessions: [{ ...sameKeySession, organisationId: "other" }] }));
  assert.equal(crossTenant.pages.quarantine.items[0].classification, "SESSION_SCOPE_MISMATCH_REVIEW");
  assert.equal(crossTenant.pages.multipart.items[0].classification, "SESSION_SCOPE_MISMATCH_REVIEW");
  for (const item of [crossTenant.pages.quarantine.items[0], crossTenant.pages.multipart.items[0]]) {
    assert.equal(item.hasSession, false);
    assert.equal(item.sessionStatus, null);
  }
});

test("recent, unknown, changed, and wrongly labelled objects stay unverified", async () => {
  const recent = await scan(fixture({ objects: [{ ...object, LastModified: new Date("2026-10-04T12:00:00Z") }],
    uploads: [{ ...upload, Initiated: new Date("2026-10-04T12:00:00Z") }] }));
  assert.equal(recent.pages.quarantine.items[0].classification, "TOO_RECENT");
  assert.equal(recent.pages.multipart.items[0].classification, "TOO_RECENT");
  const missingDate = await scan(fixture({ objects: [{ ...object, LastModified: null }],
    uploads: [{ ...upload, Initiated: null }] }));
  assert.equal(missingDate.pages.quarantine.items[0].classification, "TIMESTAMP_UNVERIFIED");
  assert.equal(missingDate.pages.multipart.items[0].classification, "TIMESTAMP_UNVERIFIED");
  const wrongMetadata = await scan(fixture({ heads: { [key]: { ETag: object.ETag,
    ContentLength: 128, LastModified: old, Metadata: { quarantine: "false", project: projectId } } } }));
  assert.equal(wrongMetadata.pages.quarantine.items[0].classification, "PROVENANCE_UNVERIFIED");
  const changed = await scan(fixture({ heads: { [key]: { ETag: '"changed"',
    ContentLength: 128, LastModified: old, Metadata: { quarantine: "true", project: projectId } } } }));
  assert.equal(changed.pages.quarantine.items[0].classification, "OBJECT_CHANGED_REVIEW");
  const failedHead = await scan(fixture({ heads: { [key]: new Error("R2 unavailable") } }));
  assert.equal(failedHead.pages.quarantine.items[0].classification, "HEAD_UNVERIFIED");
});

test("strict key matching and two-part pagination never imply full coverage", async () => {
  const wrongKey = `quarantine/${organisationId}/another-product/${projectId}/11111111-1111-4111-8111-111111111111.webm`;
  const skipped = await scan(fixture({ objects: [{ ...object, Key: wrongKey }], uploads: [{ ...upload, Key: wrongKey }] }));
  assert.deepEqual(skipped.pages.quarantine.items, []);
  assert.deepEqual(skipped.pages.multipart.items, []);
  assert.equal(skipped.pages.quarantine.counts.skippedOtherQuarantine, 1);
  const paged = await scan(fixture({ truncatedObjects: true, truncatedUploads: true }));
  assert.equal(paged.pages.quarantine.hasMore, true);
  assert.equal(paged.pages.multipart.hasMore, true);
  assert.ok(paged.pages.multipart.nextCursor);
  const marker = JSON.parse(Buffer.from(paged.pages.multipart.nextCursor, "base64url").toString("utf8"));
  assert.equal(marker.organisationId, organisationId);
  assert.equal(marker.uploadIdMarker, "upload-next");
  await assert.rejects(scan(fixture(), { multipartCursor: Buffer.from(JSON.stringify({
    ...marker, organisationId: "another-org"
  })).toString("base64url") }), /scope/);
  await assert.rejects(scan(fixture({ truncatedUploads: true, uploadMarkers: null })), /truncated/);
  await assert.rejects(scan(fixture({ truncatedObjects: true, objectCursor: null })), /truncated/);
});

test("operator command has no mutation mode and rejects missing scope before credentials", async () => {
  const script = await readFile(new URL("../scripts/studio-audio-upload-inventory.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(script, /DeleteObjectCommand|AbortMultipartUploadCommand|\.delete\(|\.update\(|\.create\(/);
  assert.match(script, /optionsFromArguments\(process\.argv\.slice\(2\)\)/);
});
