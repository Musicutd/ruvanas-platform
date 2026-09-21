import test from "node:test";
import assert from "node:assert/strict";
import { waveformPrimaryShortcut } from "../lib/waveform-shortcuts.mjs";

const options = { visible: true, canEdit: true, hasSelection: true };
const key = (keyName, extra = {}) => ({ key: keyName, code: keyName === " " ? "Space" : keyName, target: { tagName: "CANVAS" }, ...extra });

test("Space, Delete and Ctrl/Cmd+S map to waveform actions", () => {
  assert.equal(waveformPrimaryShortcut(key(" "), options), "PLAY_PAUSE");
  assert.equal(waveformPrimaryShortcut(key("Delete"), options), "DELETE_SELECTION");
  assert.equal(waveformPrimaryShortcut(key("Delete", { shiftKey: true }), options), "DELETE_KEEP_GAP");
  assert.equal(waveformPrimaryShortcut(key("s", { ctrlKey: true }), options), "SAVE");
  assert.equal(waveformPrimaryShortcut(key("s", { metaKey: true, target: { tagName: "INPUT" } }), options), "SAVE");
});

test("shortcuts do not affect hidden, typing or read-only waveform editors", () => {
  assert.equal(waveformPrimaryShortcut(key("Delete"), { ...options, visible: false }), null);
  assert.equal(waveformPrimaryShortcut(key("Delete", { target: { tagName: "INPUT" } }), options), null);
  assert.equal(waveformPrimaryShortcut(key(" ", { target: { tagName: "BUTTON" } }), options), null);
  assert.equal(waveformPrimaryShortcut(key(" ", { repeat: true }), options), null);
  assert.equal(waveformPrimaryShortcut(key("Delete"), { ...options, hasSelection: false }), null);
  assert.equal(waveformPrimaryShortcut(key("s", { ctrlKey: true }), { ...options, canEdit: false }), null);
});
