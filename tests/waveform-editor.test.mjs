import test from "node:test";
import assert from "node:assert/strict";
import { adjustSelection, changeSelectionGain, copySelection, deleteSelection, duplicateSelection, normalizeEditorState, pasteSelection, silenceSelection, splitAt, timelineDuration, trimToSelection } from "../lib/waveform-editor.mjs";

const source = { clientId: "source", kind: "SOURCE", mediaAssetId: "media-1", sourceStartMs: 0, sourceEndMs: 10_000, timelineStartMs: 0, gainDb: 0, fadeInMs: 0, fadeOutMs: 0, fadeInCurve: "linear", fadeOutCurve: "linear", locked: false };
let nextId = 0;
const id = () => `id-${++nextId}`;

test("waveform edits split and ripple without changing source media", () => {
  const split = splitAt([source], 4_000, id);
  assert.equal(split.length, 2);
  assert.equal(split[0].mediaAssetId, source.mediaAssetId);
  assert.equal(split[1].sourceStartMs, 4_000);
  const deleted = deleteSelection(split, 2_000, 6_000, true, id);
  assert.equal(timelineDuration(deleted), 6_000);
  assert.ok(deleted.every((clip) => clip.mediaAssetId === source.mediaAssetId));
});

test("waveform selection operations create non-destructive edit decisions", () => {
  const silenced = silenceSelection([source], 2_000, 4_000, id);
  assert.equal(silenced.find((clip) => clip.kind === "SILENCE").sourceEndMs, 2_000);
  const trimmed = trimToSelection([source], 2_000, 7_000, id);
  assert.equal(timelineDuration(trimmed), 5_000);
  const duplicated = duplicateSelection([source], 0, 3_000, id);
  assert.equal(timelineDuration(duplicated), 13_000);
  const adjusted = adjustSelection([source], 0, 2_000, { gainDb: 30, fadeInMs: 999_999 });
  assert.equal(adjusted[0].gainDb, 18);
  assert.equal(adjusted[0].fadeInMs, 10_000);
});

test("gain adjustment splits a partial selection and leaves surrounding audio unchanged", () => {
  const raised = changeSelectionGain([source], 2_000, 4_000, 6, id);
  assert.deepEqual(raised.map((clip) => [clip.timelineStartMs, clip.sourceStartMs, clip.sourceEndMs, clip.gainDb]), [
    [0, 0, 2_000, 0], [2_000, 2_000, 4_000, 6], [4_000, 4_000, 10_000, 0]
  ]);
  const lowered = changeSelectionGain(raised, 4_000, 2_000, -9, id);
  assert.deepEqual(lowered.map((clip) => clip.gainDb), [0, -3, 0]);
  assert.equal(timelineDuration(lowered), 10_000);
});

test("gain adjustment respects locked clips, silence, limits and invalid selection", () => {
  const clips = [{ ...source, locked: true }, { ...source, clientId: "other", timelineStartMs: 10_000, gainDb: 17 }];
  const adjusted = changeSelectionGain(clips, 0, 20_000, 6, id);
  assert.deepEqual(adjusted.map((clip) => clip.gainDb), [0, 18]);
  assert.equal(changeSelectionGain(clips, 0, 0, 6, id), clips);
  assert.equal(changeSelectionGain(clips, 0, 20_000, Number.NaN, id), clips);
});

test("waveform state normalises untrusted clips and markers", () => {
  const state = normalizeEditorState({ clips: [{ ...source, gainDb: -99 }], markers: [{ positionMs: 500, type: "NOPE", label: " note " }], targetLufs: -23 });
  assert.equal(state.clips[0].gainDb, -36);
  assert.equal(state.markers[0].type, "EDIT_NOTE");
  assert.equal(state.markers[0].label, "note");
  assert.equal(state.targetLufs, -23);
});

test("waveform clipboard crops source safely and ripples pasted audio", () => {
  const copied = copySelection([source], 2_000, 5_000);
  assert.equal(copied.durationMs, 3_000);
  assert.equal(copied.clips[0].sourceStartMs, 2_000);
  assert.equal(copied.clips[0].sourceEndMs, 5_000);
  const pasted = pasteSelection([source], copied, 5_000, id);
  assert.equal(timelineDuration(pasted), 13_000);
  assert.equal(pasted.filter((clip) => clip.mediaAssetId === source.mediaAssetId).length, 3);
});
