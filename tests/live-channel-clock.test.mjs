import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLiveChannelClock,
  liveCapableEntries,
  LIVE_CHANNEL_EPOCH_MS
} from "../lib/live-channel-clock.mjs";

const item = (id, durationSeconds) => ({
  track: { id, mediaAsset: { durationSeconds } }
});

test("a shared stream clock resolves every listener to the same live position", () => {
  const playlist = [item("a", 10), item("b", 10)];
  const instant = new Date(LIVE_CHANNEL_EPOCH_MS + 9000);
  const first = buildLiveChannelClock({ playlist, streamId: "channel:one", instant });
  const second = buildLiveChannelClock({ playlist, streamId: "channel:one", instant });

  assert.deepEqual(first, second);
  assert.equal(first.crossfadeSeconds, 2);
  assert.equal(first.cycleDurationSeconds, 16);
  assert.equal(first.current.index, 1);
  assert.equal(first.current.offsetSeconds, 1);
  assert.equal(first.previous.index, 0);
  assert.equal(first.previous.offsetSeconds, 9);
  assert.equal(first.previous.gain, 0.5);
  assert.equal(first.currentGain, 0.5);
  assert.equal(first.next.startsInSeconds, 7);
});

test("refreshing advances the live offset instead of restarting a track", () => {
  const playlist = [item("a", 30), item("b", 30)];
  const before = buildLiveChannelClock({
    playlist,
    streamId: "channel:one",
    instant: new Date(LIVE_CHANNEL_EPOCH_MS + 5000)
  });
  const after = buildLiveChannelClock({
    playlist,
    streamId: "channel:one",
    instant: new Date(LIVE_CHANNEL_EPOCH_MS + 12000)
  });

  assert.equal(before.current.index, after.current.index);
  assert.equal(after.current.offsetSeconds - before.current.offsetSeconds, 7);
});

test("separate premium channels have independent stream identities", () => {
  const playlist = [item("a", 30), item("b", 40)];
  const instant = new Date(LIVE_CHANNEL_EPOCH_MS + 5000);
  const first = buildLiveChannelClock({ playlist, streamId: "channel:one", instant });
  const second = buildLiveChannelClock({ playlist, streamId: "channel:two", instant });

  assert.equal(first.streamId, "channel:one");
  assert.equal(second.streamId, "channel:two");
});

test("tracks without a safe duration are excluded from live mixing", () => {
  assert.deepEqual(
    liveCapableEntries([item("missing", null), item("short", 2), item("ready", 180)]).map((entry) => entry.track.id),
    ["ready"]
  );
});
