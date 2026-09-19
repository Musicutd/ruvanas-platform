import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { renderTimedRehearsalBundle } from "../lib/studio-timed-rehearsal.mjs";

const directory = "/private/ruvanas-rehearsal";
const options = () => ({
  privateDirectory: directory,
  playlistPath: `${directory}/frozen.m3u`,
  outputPath: `${directory}/listener-sample.mp3`,
  mediaByAssetId: new Map([["asset-a", `${directory}/000.mp3`], ["asset-b", `${directory}/001.mp3`]])
});
const plan = () => ({
  ready: true, reason: "FROZEN_SEQUENCE_PLANNED_NOT_ON_AIR", commandIssued: false, listenerVerified: false,
  items: [
    { position: 0, trackId: "a", mediaAssetId: "asset-a", startOffsetSeconds: 0, endOffsetSeconds: 240 },
    { position: 1, trackId: "b", mediaAssetId: "asset-b", startOffsetSeconds: 238, endOffsetSeconds: 493 },
    { position: 2, trackId: "a", mediaAssetId: "asset-a", startOffsetSeconds: 491, endOffsetSeconds: 731 }
  ]
});

test("file-only rehearsal text preserves A-B-A and declares a two-second crossfade", () => {
  const bundle = renderTimedRehearsalBundle(plan(), options());
  assert.deepEqual(bundle.playlistText.trimEnd().split("\n"), [
    `${directory}/000.mp3`, `${directory}/001.mp3`, `${directory}/000.mp3`
  ]);
  assert.deepEqual(bundle.expectedOrder.map((item) => item.trackId), ["a", "b", "a"]);
  assert.deepEqual(bundle.expectedOrder.map((item) => item.endOffsetSeconds), [240, 493, 731]);
  assert.match(bundle.liquidsoapText, /playlist\(mode="normal", loop=false, reload_mode="never"/);
  assert.match(bundle.liquidsoapText, /crossfade\(duration=2\., fade_in=2\., fade_out=2\., smart=false/);
  assert.match(bundle.liquidsoapText, /output\.file\(fallible=true, %mp3\(bitrate=128\)/);
  assert.doesNotMatch(bundle.liquidsoapText, /output\.shoutcast|output\.icecast|https?:|password|server\.host/);
  assert.equal(bundle.commandIssued, false);
  assert.equal(bundle.listenerVerified, false);
});

test("rehearsal text refuses unapproved plans and paths outside the private cache", () => {
  assert.throws(() => renderTimedRehearsalBundle({ ...plan(), ready: false }, options()));
  assert.throws(() => renderTimedRehearsalBundle({ ...plan(), commandIssued: true }, options()));
  assert.throws(() => renderTimedRehearsalBundle(plan(), { ...options(), privateDirectory: "/" }));
  assert.throws(() => renderTimedRehearsalBundle(plan(), { ...options(), outputPath: "/tmp/exposed.mp3" }));
  assert.throws(() => renderTimedRehearsalBundle(plan(), { ...options(), playlistPath: `${directory}/../outside.m3u` }));
  assert.throws(() => renderTimedRehearsalBundle(plan(), { ...options(), mediaByAssetId: new Map([["asset-a", `${directory}/000.mp3`], ["asset-b", "/tmp/other.mp3"]]) }));
  assert.throws(() => renderTimedRehearsalBundle(plan(), { ...options(), mediaByAssetId: new Map([["asset-a", `${directory}/000.mp3`]]) }));
  assert.throws(() => renderTimedRehearsalBundle(plan(), { ...options(), mediaByAssetId: new Map([["asset-a", `${directory}/listener-sample.mp3`], ["asset-b", `${directory}/001.mp3`]]) }));
  assert.throws(() => renderTimedRehearsalBundle(plan(), { ...options(), bitrateKbps: 400 }));
  assert.throws(() => renderTimedRehearsalBundle({ ...plan(), items: [{ ...plan().items[0], position: 1 }] }, options()));
  assert.throws(() => renderTimedRehearsalBundle({ ...plan(), items: plan().items.map((item, index) => index === 1 ? { ...item, startOffsetSeconds: 239 } : item) }, options()));
});

test("the rehearsal renderer cannot invoke the Online Radio worker or a remote output", async () => {
  const [renderer, worker] = await Promise.all([
    readFile(new URL("../lib/studio-timed-rehearsal.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/online-radio-encoder-worker.mjs", import.meta.url), "utf8")
  ]);
  assert.doesNotMatch(renderer, /spawn\(|fetch\(|S3Client|PrismaClient|output\.shoutcast/);
  assert.doesNotMatch(worker, /renderTimedRehearsalBundle|studio-timed-rehearsal/);
});
