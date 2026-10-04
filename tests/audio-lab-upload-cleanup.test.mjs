import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { canDeleteUncommittedAudioUploadObject } from "../lib/audio-lab-upload-cleanup.mjs";

const input = { sessionId: "session-test", organisationId: "organisation-test", projectId: "project-test", finalKey: "organisations/test/school-audio/test/final.webm" };

function database({ projects = [{ id: input.projectId }], rows = [{ id: input.sessionId }], status = "COMPLETING", media = null } = {}) {
  const calls = [];
  return {
    calls,
    $transaction: async (work, options) => {
      calls.push(["transaction", options.isolationLevel]);
      return work({
        $queryRaw: async (strings) => {
          const isProjectLock = strings[0].includes('"AudioProject"');
          calls.push([isProjectLock ? "lock-project" : "lock-session"]);
          return isProjectLock ? projects : rows;
        },
        schoolAudioUploadSession: { findFirst: async () => { calls.push(["read-session"]); return status ? { status } : null; } },
        mediaAsset: { findFirst: async (query) => { calls.push(["read-media", query.where.storageKey]); return media; } }
      });
    }
  };
}

test("a completed upload never deletes its exact final storage object", async () => {
  const db = database({ status: "COMPLETED" });
  assert.equal(await canDeleteUncommittedAudioUploadObject(db, input), false);
  assert.deepEqual(db.calls, [["transaction", "ReadCommitted"], ["lock-project"], ["lock-session"], ["read-session"]]);
});

test("a committed media reference wins over a stale non-completed upload status", async () => {
  const db = database({ media: { id: "committed-media" } });
  assert.equal(await canDeleteUncommittedAudioUploadObject(db, input), false);
  assert.deepEqual(db.calls.at(-1), ["read-media", input.finalKey]);
});

test("cleanup is permitted only for an existing, locked session with no media reference", async () => {
  assert.equal(await canDeleteUncommittedAudioUploadObject(database(), input), true);
  assert.equal(await canDeleteUncommittedAudioUploadObject(database({ projects: [] }), input), false);
  assert.equal(await canDeleteUncommittedAudioUploadObject(database({ rows: [] }), input), false);
  assert.equal(await canDeleteUncommittedAudioUploadObject(database({ status: null }), input), false);
});

test("a database error cannot be interpreted as permission to delete an object", async () => {
  const db = { $transaction: async () => { throw new Error("database unavailable"); } };
  await assert.rejects(canDeleteUncommittedAudioUploadObject(db, input), /database unavailable/);
});

test("AudioLab error cleanup checks persisted references before deleting the final key", async () => {
  const route = await readFile(new URL("../app/api/school-radio/audio-lab/uploads/[uploadId]/complete/route.js", import.meta.url), "utf8");
  const catchBranch = route.slice(route.indexOf("} catch (error) {", route.indexOf("export async function POST")));
  assert.match(catchBranch, /canDeleteUncommittedAudioUploadObject\(prisma, \{/);
  assert.ok(catchBranch.indexOf("canDeleteUncommittedAudioUploadObject") < catchBranch.indexOf("Key: finalKey"));
  assert.match(catchBranch, /AUDIO_LAB_FINAL_OBJECT_CLEANUP_UNVERIFIED/);
});
