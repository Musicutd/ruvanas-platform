import test from "node:test";
import assert from "node:assert/strict";
import { adjustSelection, deleteSelection, duplicateSelection, normalizeEditorState, silenceSelection, splitAt, timelineDuration, trimToSelection } from "../lib/waveform-editor.mjs";

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

test("waveform state normalises untrusted clips and markers", () => {
  const state = normalizeEditorState({ clips: [{ ...source, gainDb: -99 }], markers: [{ positionMs: 500, type: "NOPE", label: " note " }], targetLufs: -23 });
  assert.equal(state.clips[0].gainDb, -36);
  assert.equal(state.markers[0].type, "EDIT_NOTE");
  assert.equal(state.markers[0].label, "note");
  assert.equal(state.targetLufs, -23);
});

