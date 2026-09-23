import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  AUDIO_TAKE_TRASH_DAYS,
  assertRecordingCanBeTrashed,
  audioTakePurgeAfter,
  canRestoreAudioTake,
  recordingTrashBlockers,
  trashDaysRemaining
} from "../lib/audio-take-trash.mjs";

test("recording Trash keeps audio recoverable for exactly 30 days", () => {
  const now = new Date("2026-09-22T10:00:00.000Z");
  const purgeAfter = audioTakePurgeAfter(now);

  assert.equal(AUDIO_TAKE_TRASH_DAYS, 30);
  assert.equal(purgeAfter.toISOString(), "2026-10-22T10:00:00.000Z");
  assert.equal(trashDaysRemaining(purgeAfter, now), 30);
  assert.equal(canRestoreAudioTake({ trashedAt: now, purgeAfter, permanentlyDeletedAt: null }, now), true);
  assert.equal(canRestoreAudioTake({ trashedAt: now, purgeAfter, permanentlyDeletedAt: null }, purgeAfter), false);
});

test("a recording used by a production cannot be trashed or permanently removed", () => {
  assert.deepEqual(recordingTrashBlockers({ clipCount: 2, rundownCount: 1 }), [
    "2 multitrack clips",
    "1 published or draft programme item"
  ]);
  assert.throws(
    () => assertRecordingCanBeTrashed({ clipCount: 1, rundownCount: 0 }),
    /Remove this recording from 1 multitrack clip/
  );
  assert.doesNotThrow(() => assertRecordingCanBeTrashed({ clipCount: 0, rundownCount: 0 }));
  assert.deepEqual(recordingTrashBlockers({ publicationCount: 1, processingCount: 1 }), [
    "1 published or submitted use",
    "1 active audio processing job"
  ]);
});

test("Studio exposes a visual multitrack console and an explicit recording Trash workflow", async () => {
  const [multitrack, audioLab, workspace, trashRoute, worker, schema] = await Promise.all([
    readFile(new URL("../app/dashboard/school-radio/MultitrackStudioClient.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/school-radio/AudioLabClient.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/school-radio/StudioWorkspaceClient.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/school-radio/audio-lab/takes/[takeId]/route.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/operations-worker.mjs", import.meta.url), "utf8"),
    readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8")
  ]);

  assert.match(multitrack, /TRACK \{String\(trackIndex \+ 1\)/);
  assert.match(multitrack, /Preview clip/);
  assert.match(multitrack, /Clip controls/);
  assert.match(multitrack, /trackConsole/);
  assert.match(audioLab, /RECORDINGS &amp; TRASH/);
  assert.match(audioLab, /Move to Trash/);
  assert.match(audioLab, /Delete permanently/);
  assert.ok(audioLab.indexOf("{recordingLibrary}") < audioLab.indexOf("<form style={s.card} onSubmit={createProject}"));
  assert.match(workspace, /Recordings &amp; Trash/);
  assert.match(workspace, /Manage recordings/);
  assert.match(trashRoute, /DELETE_PERMANENTLY/);
  assert.match(trashRoute, /RESTORE/);
  assert.match(worker, /purgeExpiredAudioTakes/);
  assert.match(schema, /purgeAfter\s+DateTime\?/);
});

