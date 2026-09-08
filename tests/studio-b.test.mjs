import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { recordedClipData, studioMeterState, timelineEndMs } from "../lib/studio-recording.mjs";

test("Studio B reports safe levels and a clear clipping warning", () => {
  assert.deepEqual(studioMeterState(-1), { value: 0, percent: 0, clipping: false, tone: "SAFE" });
  assert.equal(studioMeterState(0.7).tone, "STRONG");
  assert.equal(studioMeterState(0.9).clipping, true);
  assert.equal(studioMeterState(2).percent, 100);
});

test("Studio B appends a protected recording after the existing track timeline", () => {
  const clips = [{ timelineStartMs: 2_000, sourceStartMs: 1_000, sourceEndMs: 5_000 }];
  assert.equal(timelineEndMs(clips), 6_000);
  assert.deepEqual(recordedClipData({ mediaAssetId: "media-1", durationMs: 2_500, clips }), {
    kind: "SOURCE", mediaAssetId: "media-1", sourceStartMs: 0, sourceEndMs: 2_500,
    timelineStartMs: 6_000, gainDb: 0, fadeInMs: 0, fadeOutMs: 0,
    fadeInCurve: "linear", fadeOutCurve: "linear", locked: false
  });
});

test("Studio B connects recording and precision editing to protected existing systems", async () => {
  const [recorder, waveform, completeRoute, multitrackRoute] = await Promise.all([
    readFile(new URL("../app/dashboard/school-radio/AudioLabClient.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/school-radio/WaveformEditorClient.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/school-radio/audio-lab/uploads/[uploadId]/complete/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/school-radio/multitrack/projects/[projectId]/route.js", import.meta.url), "utf8")
  ]);
  assert.match(recorder, /Start live input check/);
  assert.match(recorder, /3-second count-in/);
  assert.match(recorder, /Headphone monitoring/);
  assert.match(recorder, />Retake</);
  assert.match(recorder, /targetTrackId/);
  assert.match(waveform, />Copy</);
  assert.match(waveform, />Cut</);
  assert.match(waveform, /Paste at cursor/);
  assert.match(waveform, /Add named region/);
  assert.match(waveform, /Edit history:/);
  assert.match(completeRoute, /requireActiveSchoolRadio/);
  assert.match(completeRoute, /invalidateApprovedAudioOutputs/);
  assert.match(completeRoute, /STUDIO_RECORDING_PLACED_ON_TRACK/);
  assert.match(multitrackRoute, /invalidateApprovedAudioOutputs/);
});
