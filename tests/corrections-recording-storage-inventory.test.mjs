import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { HeadObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { inventoryCorrectionsRecordingStorage, parseCorrectionsRecordingInventoryOptions } from "../lib/corrections-recording-storage-inventory.mjs";

const organisationId = "fictional-org";
const projectId = "fictional-project";
const key = `organisations/${organisationId}/corrections-studio/${projectId}/11111111-1111-4111-8111-111111111111.webm`;
const now = new Date("2026-10-05T12:00:00.000Z");
const modified = new Date("2026-09-20T12:00:00.000Z");
const object = { Key: key, ETag: '"fictional-etag"', Size: 128, LastModified: modified };
const head = { ETag: object.ETag, ContentLength: 128, LastModified: modified,
  Metadata: { source: "corrections-supervised-studio", project: projectId, checksum: "a".repeat(64) } };

function fixture({ objects = [object], referenceOwner = null, existing = true, supervised = true,
  active = false, organisation = true, response = head, listing = {}, databaseFailure = false } = {}) {
  const commands = [];
  const queries = [];
  const database = {
    organisation: { findUnique: async (args) => { queries.push(args); return organisation ? { id: organisationId } : null; } },
    audioProject: { findMany: async (args) => {
      queries.push(args);
      assert.equal(args.where.organisationId, organisationId);
      assert.deepEqual(args.select, { id: true });
      assert.deepEqual(args.where.id.in, [projectId]);
      if (!existing) return [];
      const some = args.where.correctionsStudioSessions?.some;
      if (some?.status) { assert.equal(some.status, "ACTIVE"); return active ? [{ id: projectId }] : []; }
      if (some) {
        assert.deepEqual(some, { organisationId, facility: { organisationId }, programme: { organisationId }, contributor: { organisationId } });
        return supervised ? [{ id: projectId }] : [];
      }
      return [{ id: projectId }];
    } }
  };
  for (const owner of ["mediaAsset", "digitalSignageAsset", "productionOrderFile", "schoolAudioUploadSession"]) {
    database[owner] = { findMany: async (args) => {
      queries.push(args);
      if (databaseFailure) throw new Error("fictional private database detail");
      const field = owner === "schoolAudioUploadSession" ? "quarantineKey" : "storageKey";
      assert.deepEqual(args, { where: { [field]: { in: [key] } }, select: { [field]: true } });
      return owner === referenceOwner ? [{ [field]: key }] : [];
    } };
  }
  const storage = { bucketName: "fictional-private-bucket", client: { send: async (command) => {
    commands.push(command);
    assert.equal(command.input.Bucket, storage.bucketName);
    if (command instanceof ListObjectsV2Command) {
      assert.equal(command.input.Prefix, `organisations/${organisationId}/corrections-studio/`);
      return { Contents: objects, IsTruncated: false, ...listing };
    }
    assert.ok(command instanceof HeadObjectCommand, "Only LIST and HEAD storage reads are allowed");
    assert.equal(command.input.Key, key);
    if (response instanceof Error) throw response;
    return response;
  } } };
  return { database, storage, commands, queries };
}

const scan = (source, options = {}) => inventoryCorrectionsRecordingStorage({
  database: source.database, storage: source.storage, organisationId, now, ...options
});
const classification = async (options) => (await scan(fixture(options))).page.items[0].classification;

test("each global exact-key owner blocks an unreferenced observation, regardless tenant/status", async () => {
  for (const referenceOwner of ["mediaAsset", "digitalSignageAsset", "productionOrderFile", "schoolAudioUploadSession"]) {
    const source = fixture({ referenceOwner });
    assert.equal((await scan(source)).page.items[0].classification, "REFERENCED_DB");
    assert.equal(source.commands.length, 1);
  }
});

test("old closed supervised recordings produce restricted evidence, never disposal candidates", async () => {
  const source = fixture();
  const report = await scan(source);
  assert.equal(report.kind, "CORRECTIONS_RECORDING_STORAGE");
  assert.equal(report.readOnly, true);
  assert.equal(report.disposalCandidates, false);
  assert.equal(report.coverage, "BOUNDED_PAGE_ONLY");
  assert.equal(report.page.items[0].classification, "NO_DATABASE_REFERENCE_OBSERVED_REVIEW");
  assert.match(report.page.items[0].keyFingerprint, /^[0-9a-f]{64}$/);
  assert.match(report.page.items[0].projectFingerprint, /^[0-9a-f]{64}$/);
  assert.match(report.page.items[0].objectFingerprint, /^[0-9a-f]{64}$/);
  for (const privateValue of [key, projectId, "fictional-private-bucket", head.Metadata.checksum, object.ETag]) {
    assert.ok(!JSON.stringify(report).includes(privateValue));
  }
  assert.deepEqual(Object.keys(report.page.items[0]).sort(),
    ["classification", "keyFingerprint", "objectFingerprint", "projectFingerprint"].sort());
});

test("missing/scoped-out projects and missing or active sessions remain review-only without HEAD", async () => {
  for (const [options, expected] of [
    [{ existing: false }, "MISSING_OR_OUT_OF_SCOPE_PROJECT_REVIEW"],
    [{ supervised: false }, "PROJECT_CONTEXT_UNVERIFIED"],
    [{ active: true }, "SESSION_IN_PROGRESS_REVIEW"],
    [{ active: true, supervised: false }, "SESSION_IN_PROGRESS_REVIEW"]
  ]) {
    const source = fixture(options);
    assert.equal((await scan(source)).page.items[0].classification, expected);
    assert.equal(source.commands.length, 1);
  }
});

test("uncertain timestamps, sizes, provenance, missing objects and changed HEAD fail conservatively", async () => {
  for (const LastModified of [null, "invalid", new Date(now.getTime() + 1)]) {
    assert.equal(await classification({ objects: [{ ...object, LastModified }] }), "TIMESTAMP_UNVERIFIED");
  }
  assert.equal(await classification({ objects: [{ ...object, LastModified: now }] }), "TOO_RECENT_REVIEW");
  for (const changed of [{ ETag: "changed" }, { ContentLength: 129 }, { LastModified: now }, { ContentLength: undefined }]) {
    assert.equal(await classification({ response: { ...head, ...changed } }), "OBJECT_CHANGED_REVIEW");
  }
  for (const changed of [{ Size: undefined }, { Size: "128" }, { ETag: undefined }]) {
    assert.equal(await classification({ objects: [{ ...object, ...changed }] }), "OBJECT_CHANGED_REVIEW");
  }
  for (const metadata of [{ ...head.Metadata, source: "other" }, { ...head.Metadata, project: "foreign" },
    { ...head.Metadata, checksum: "invalid" }]) {
    assert.equal(await classification({ response: { ...head, Metadata: metadata } }), "PROVENANCE_UNVERIFIED");
  }
  for (const name of ["NoSuchKey", "NotFound", "ServiceUnavailable"]) {
    assert.equal(await classification({ response: Object.assign(new Error("private detail"), { name }) }), "HEAD_UNVERIFIED");
  }
  await assert.rejects(scan(fixture({ databaseFailure: true })), /fictional private database detail/);
});

test("wrong scope and overlarge/incomplete listings reject; non-recording paths are excluded", async () => {
  const source = fixture({ organisation: false });
  await assert.rejects(scan(source), /does not exist/);
  assert.equal(source.commands.length, 0);
  await assert.rejects(scan(fixture({ objects: [{ ...object, Key: key.replace(organisationId, "foreign") }] })), /out-of-scope/);
  await assert.rejects(scan(fixture({ objects: [object, object] }), { limit: 1 }), /page bound/);
  await assert.rejects(scan(fixture({ listing: { IsTruncated: true } })), /continuation/);
  await assert.rejects(scan(fixture({ listing: { IsTruncated: true, NextContinuationToken: "same" } }), { cursor: "same" }), /continuation/);
  const skipped = fixture({ objects: [
    { ...object, Key: key.replace(projectId, `renders/${projectId}`) },
    { ...object, Key: key.replace(".webm", ".txt") },
    { ...object, Key: key.replace("11111111-1111-4111-8111-111111111111", "arbitrary-name") }
  ] });
  const report = await scan(skipped);
  assert.deepEqual(report.page.items, []);
  assert.equal(report.page.counts.skippedOtherCorrectionsStudio, 3);
  assert.equal(skipped.commands.length, 1);
});

test("continuation is bounded and explicitly never claims full tenant coverage", async () => {
  const source = fixture({ listing: { IsTruncated: true, NextContinuationToken: "opaque-next" } });
  const report = await scan(source, { cursor: "opaque-current", limit: 1 });
  assert.equal(report.page.hasMore, true);
  assert.equal(report.page.nextCursor, "opaque-next");
  assert.equal(source.commands[0].input.ContinuationToken, "opaque-current");
  assert.equal(source.commands[0].input.MaxKeys, 1);
  assert.equal(report.coverage, "BOUNDED_PAGE_ONLY");
});

test("operator opt-in, scope and mode validation precede any credential initialization", async () => {
  const environment = { CORRECTIONS_RECORDING_INVENTORY_READ_ONLY: "1" };
  assert.deepEqual(parseCorrectionsRecordingInventoryOptions([`--organisation-id=${organisationId}`], environment),
    { organisationId, limit: 100, cursor: null });
  assert.throws(() => parseCorrectionsRecordingInventoryOptions([], {}), /opt-in/);
  for (const args of [[], ["--organisation-id=../foreign"], [`--organisation-id=${organisationId}`, "--delete=true"],
    [`--organisation-id=${organisationId}`, "--limit=201"], [`--organisation-id=${organisationId}`, "--limit=0"],
    [`--organisation-id=${organisationId}`, "--cursor=" + "x".repeat(4097)],
    [`--organisation-id=${organisationId}`, `--organisation-id=${organisationId}`]]) {
    assert.throws(() => parseCorrectionsRecordingInventoryOptions(args, environment));
  }
  let output;
  try {
    execFileSync(process.execPath, ["scripts/corrections-recording-storage-inventory.mjs", "--organisation-id=private-invalid/"],
      { cwd: new URL("..", import.meta.url), env: { ...process.env, ...environment }, encoding: "utf8", stdio: "pipe" });
    assert.fail("invalid scope must reject");
  } catch (error) { output = error.stderr; }
  assert.match(output, /A single valid organisation ID is required/);
  assert.doesNotMatch(output, /private-invalid|DATABASE_URL|Prisma|R2_/);
  const script = await readFile(new URL("../scripts/corrections-recording-storage-inventory.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(script, /DeleteObjectCommand|GetObjectCommand|\.delete\(|\.update\(|\.create\(/);
});

test("operator dependency failures do not escape through the application's Prisma logger", () => {
  let output;
  let standardOutput;
  try {
    execFileSync(process.execPath, ["scripts/corrections-recording-storage-inventory.mjs", `--organisation-id=${organisationId}`], {
      cwd: new URL("..", import.meta.url), encoding: "utf8", stdio: "pipe",
      env: { ...process.env, CORRECTIONS_RECORDING_INVENTORY_READ_ONLY: "1",
        DATABASE_URL: "fictional-private-invalid-datasource", R2_ACCOUNT_ID: "fictional",
        R2_ACCESS_KEY_ID: "fictional", R2_SECRET_ACCESS_KEY: "fictional", R2_BUCKET_NAME: "fictional",
        R2_ENDPOINT: "http://127.0.0.1:1" }
    });
    assert.fail("invalid datasource must reject without contacting a database");
  } catch (error) { output = error.stderr; standardOutput = error.stdout; }
  assert.equal(standardOutput, "");
  assert.match(output, /A read-only inventory dependency failed/);
  assert.doesNotMatch(output, /fictional-private-invalid-datasource|prisma:error|datasource|DATABASE_URL/);
});
