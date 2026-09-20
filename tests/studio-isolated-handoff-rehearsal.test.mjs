import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { matchesIsolatedStudioHandoff, matchesIsolatedStudioPriorityHandoff, renderIsolatedStudioHandoffRehearsal } from "../lib/studio-isolated-handoff-rehearsal.mjs";

const directory = "/tmp/ruvanas-studio-handoff-012345abcdef";
const fixture = {
  privateDirectory: directory,
  autodjPath: `${directory}/autodj.mp3`,
  manualPath: `${directory}/manual.mp3`,
  playlistPath: `${directory}/autodj.m3u`,
  outputPath: `${directory}/file-sample.mp3`,
  socketPath: `${directory}/control.sock`
};

test("isolated graph gives Manual priority, returns to AutoDJ and writes only a file", () => {
  const bundle = renderIsolatedStudioHandoffRehearsal(fixture);
  assert.equal(bundle.playlistText, `${fixture.autodjPath}\n`);
  assert.match(bundle.liquidsoapText, /settings\.server\.telnet\.set\(false\)/);
  assert.match(bundle.liquidsoapText, /settings\.server\.socket\.set\(true\)/);
  assert.match(bundle.liquidsoapText, /settings\.server\.socket\.permissions\.set\(0o600\)/);
  assert.match(bundle.liquidsoapText, /studio_manual = request\.queue\(id="studio_manual"\)/);
  assert.match(bundle.liquidsoapText, /fallback\(track_sensitive=false, \[studio_manual, autodj\]\)/);
  assert.match(bundle.liquidsoapText, /output\.file\(/);
  assert.doesNotMatch(bundle.liquidsoapText, /output\.(?:shoutcast|icecast|harbor)|https?:\/\//i);
  assert.equal(bundle.sourceCommandAllowed, false);
  assert.equal(bundle.listenerVerified, false);
});

test("test-only protected programming takes priority over Manual in a file-output graph", () => {
  const bundle = renderIsolatedStudioHandoffRehearsal({
    ...fixture, protectedPath: `${directory}/protected.mp3`
  });
  assert.match(bundle.liquidsoapText, /studio_protected = request\.queue\(id="studio_protected"\)/);
  assert.match(bundle.liquidsoapText, /fallback\(track_sensitive=false, \[studio_protected, studio_manual, autodj\]\)/);
  assert.match(bundle.liquidsoapText, /output\.file\(/);
  assert.doesNotMatch(bundle.liquidsoapText, /output\.(?:shoutcast|icecast|harbor)|https?:\/\//i);
  assert.equal(bundle.sourceCommandAllowed, false);
  assert.equal(bundle.listenerVerified, false);
});

test("isolated graph rejects paths outside the synthetic private cache", () => {
  for (const change of [
    { privateDirectory: "/tmp/another" },
    { privateDirectory: `${directory}/../other` },
    { manualPath: "/tmp/production.mp3" },
    { outputPath: fixture.autodjPath },
    { socketPath: `${directory}/../control.sock` },
    { autodjPath: "https://example.invalid/audio.mp3" },
    { protectedPath: "/tmp/outside.mp3" },
    { protectedPath: fixture.manualPath },
    { playlistPath: `${directory}/a.m3u\noutput.shoutcast` }
  ]) {
    assert.throws(() => renderIsolatedStudioHandoffRehearsal({ ...fixture, ...change }));
  }
});

test("priority rehearsal needs audible AutoDJ, Manual, protected and resumed AutoDJ", () => {
  assert.equal(matchesIsolatedStudioPriorityHandoff([
    "AUTODJ", "AUTODJ", "UNKNOWN", "MANUAL", "MANUAL", "UNKNOWN",
    "PROTECTED", "PROTECTED", "UNKNOWN", "AUTODJ", "AUTODJ"
  ]), true);
  for (const labels of [
    ["AUTODJ", "AUTODJ", "MANUAL", "MANUAL", "AUTODJ", "AUTODJ", "PROTECTED", "PROTECTED"],
    ["AUTODJ", "AUTODJ", "PROTECTED", "PROTECTED", "MANUAL", "MANUAL", "AUTODJ", "AUTODJ"],
    ["AUTODJ", "AUTODJ", "MANUAL", "MANUAL", "MANUAL", "MANUAL", "MANUAL", "MANUAL", "MANUAL", "MANUAL", "PROTECTED", "PROTECTED", "AUTODJ", "AUTODJ"],
    ["AUTODJ", "AUTODJ", "MANUAL", "MANUAL", "PROTECTED", "PROTECTED", "SILENCE", "SILENCE", "AUTODJ", "AUTODJ"],
    ["AUTODJ", "AUTODJ", "MANUAL", "MANUAL", "UNKNOWN", "UNKNOWN", "AUTODJ", "AUTODJ"]
  ]) assert.equal(matchesIsolatedStudioPriorityHandoff(labels), false);
});

test("audio classification needs two audible seconds at each stage and no sustained silence", () => {
  assert.equal(matchesIsolatedStudioHandoff([
    "AUTODJ", "AUTODJ", "UNKNOWN", "MANUAL", "MANUAL", "UNKNOWN", "AUTODJ", "AUTODJ"
  ]), true);
  assert.equal(matchesIsolatedStudioHandoff(["AUTODJ", "MANUAL", "AUTODJ", "AUTODJ", "AUTODJ", "AUTODJ"]), false);
  assert.equal(matchesIsolatedStudioHandoff(["AUTODJ", "AUTODJ", "MANUAL", "MANUAL", "SILENCE", "SILENCE", "AUTODJ", "AUTODJ"]), false);
  assert.equal(matchesIsolatedStudioHandoff(["AUTODJ", "AUTODJ", "PROTECTED", "MANUAL", "MANUAL", "AUTODJ", "AUTODJ"]), false);
});

test("the file-only handoff graph cannot be reached by the live worker", async () => {
  const worker = await readFile(new URL("../scripts/online-radio-encoder-worker.mjs", import.meta.url), "utf8");
  const testImage = await readFile(new URL("../Dockerfile.studio-timed-mp3-test", import.meta.url), "utf8");
  const productionImage = await readFile(new URL("../Dockerfile.online-radio-worker", import.meta.url), "utf8");
  assert.doesNotMatch(worker, /studio-isolated-handoff-rehearsal|run-studio-isolated-handoff-linux/);
  assert.match(testImage, /RUN node scripts\/run-studio-isolated-handoff-linux\.mjs/);
  assert.doesNotMatch(productionImage, /run-studio-isolated-handoff-linux/);
  const runner = await readFile(new URL("../scripts/run-studio-isolated-handoff-linux.mjs", import.meta.url), "utf8");
  assert.match(runner, /matchesIsolatedStudioPriorityHandoff/);
  assert.match(runner, /studio_protected\.push/);
  assert.doesNotMatch(runner, /output\.(?:shoutcast|icecast|harbor)|STUDIO_TEST_SOURCE_PASSWORD|RUVANAS_AUTODJ_STATION_ID/i);
});
