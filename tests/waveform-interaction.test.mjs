import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { gainDbFromVerticalDrag, waveformDragSelection, waveformTimeAtPointer } from "../lib/waveform-interaction.mjs";

test("waveform pointer maps into timeline time and clamps outside the wave", () => {
  assert.equal(waveformTimeAtPointer(350, 100, 500, 10000), 5000);
  assert.equal(waveformTimeAtPointer(0, 100, 500, 10000), 0);
  assert.equal(waveformTimeAtPointer(700, 100, 500, 10000), 10000);
  assert.equal(waveformTimeAtPointer(350, 100, 0, 10000), 0);
});

test("drag selection works in either direction", () => {
  assert.deepEqual(waveformDragSelection(8000, 2000), { startMs: 2000, endMs: 8000 });
  assert.deepEqual(waveformDragSelection(2000, 8000), { startMs: 2000, endMs: 8000 });
});

test("in-wave gain handle drags upward to boost and downward to reduce in half-dB steps", () => {
  assert.equal(gainDbFromVerticalDrag(0, 100, 84), 2);
  assert.equal(gainDbFromVerticalDrag(0, 100, 116), -2);
  assert.equal(gainDbFromVerticalDrag(1, 100, 96), 1.5);
  assert.equal(gainDbFromVerticalDrag(0, 100, -1000), 18);
  assert.equal(gainDbFromVerticalDrag(0, 100, 1000), -36);
});

test("waveform offers pointer selection and direct cut, delete, silence actions", async () => {
  const source = await readFile(new URL("../app/dashboard/school-radio/WaveformEditorClient.js", import.meta.url), "utf8");
  assert.match(source, /onPointerDown=\{onWavePointerDown\}/);
  assert.match(source, /onPointerMove=\{onWavePointerMove\}/);
  assert.match(source, /onPointerUp=\{onWavePointerUp\}/);
  assert.match(source, /Cut selection/);
  assert.match(source, /Delete selection/);
  assert.match(source, /Silence selection/);
  assert.match(source, /onDoubleClick=\{selectWholeWave\}/);
  assert.match(source, /setSelection\(\{ startMs: 0, endMs: durationMs \}\)/);
  assert.match(source, /Gain change in decibels/);
  assert.match(source, /Apply dB change/);
  assert.match(source, /onPointerDown=\{onGainPointerDown\}/);
  assert.match(source, /role="slider"/);
});
