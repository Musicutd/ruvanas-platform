import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { canDeleteUncommittedCorrectionsRecording } from "../lib/corrections-recording-cleanup.mjs";

const organisationId = "organisationA";
const projectId = "projectA";
const storageKey = `organisations/${organisationId}/corrections-studio/${projectId}/11111111-1111-4111-8111-111111111111.wav`;

function fixture({ projectExists = true, reference = null, fail = false } = {}) {
  const calls = [];
  const database = { $transaction: async (operation, options) => {
    calls.push({ operation: "transaction", options });
    if (fail) throw new Error("Synthetic database unavailable");
    return operation({
      $queryRaw: async (strings, ...values) => {
        calls.push({ operation: "project-lock", query: strings.join("?"), values });
        return projectExists ? [{ id: projectId }] : [];
      },
      mediaAsset: { findUnique: async (query) => {
        calls.push({ operation: "exact-reference", query });
        return reference;
      } }
    });
  } };
  return { database, calls };
}

test("a committed private recording is never deleted after an ambiguous acknowledgement", async () => {
  const source = fixture({ reference: { id: "committed-ready-media", status: "READY" } });
  assert.equal(await canDeleteUncommittedCorrectionsRecording(source.database, {
    organisationId, projectId, storageKey
  }), false);
  assert.equal(source.calls[0].options.isolationLevel, "ReadCommitted");
  assert.match(source.calls[1].query, /FROM "AudioProject"[\s\S]*FOR UPDATE/);
  assert.deepEqual(source.calls[1].values, [projectId, organisationId]);
  assert.deepEqual(source.calls[2].query, { where: { storageKey }, select: { id: true } });
});

test("only an exact, locked, unreferenced new recording can be cleaned up", async () => {
  const uncommitted = fixture();
  assert.equal(await canDeleteUncommittedCorrectionsRecording(uncommitted.database, {
    organisationId, projectId, storageKey
  }), true);
  const missingProject = fixture({ projectExists: false });
  assert.equal(await canDeleteUncommittedCorrectionsRecording(missingProject.database, {
    organisationId, projectId, storageKey
  }), false);
  assert.equal(missingProject.calls.some((call) => call.operation === "exact-reference"), false);
});

test("cross-tenant and deleted media references still preserve the object", async () => {
  for (const reference of [
    { id: "other-tenant-media", organisationId: "other" },
    { id: "deleted-status-media", status: "DELETED" }
  ]) {
    const source = fixture({ reference });
    assert.equal(await canDeleteUncommittedCorrectionsRecording(source.database, {
      organisationId, projectId, storageKey
    }), false);
    assert.deepEqual(source.calls[2].query.where, { storageKey });
  }
});

test("invalid scope and database uncertainty cannot authorize deletion", async () => {
  const source = fixture();
  for (const invalid of [
    { organisationId: "another", projectId, storageKey },
    { organisationId, projectId: "another", storageKey },
    { organisationId, projectId, storageKey: storageKey.replace(".wav", ".txt") },
    { organisationId, projectId, storageKey: `${storageKey}/extra` }
  ]) assert.equal(await canDeleteUncommittedCorrectionsRecording(source.database, invalid), false);
  assert.equal(source.calls.length, 0);
  await assert.rejects(canDeleteUncommittedCorrectionsRecording(fixture({ fail: true }).database, {
    organisationId, projectId, storageKey
  }), /unavailable/);
});

test("the contributor route deletes only after the guarded decision", async () => {
  const route = await readFile(new URL("../app/api/corrections/contributor/recordings/route.js", import.meta.url), "utf8");
  assert.match(route, /safeToDelete = await canDeleteUncommittedCorrectionsRecording\(prisma,/);
  assert.match(route, /if \(safeToDelete\) \{[\s\S]*?new DeleteObjectCommand/);
  assert.match(route, /recording outcome could not be confirmed/);
});
