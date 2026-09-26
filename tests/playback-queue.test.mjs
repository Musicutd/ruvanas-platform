import assert from "node:assert/strict";
import test from "node:test";
import {
  appendPlaybackEvent,
  removePlaybackEvents,
  stableInsertionMediaSource,
  updatePlayedInsertionIds
} from "../lib/playback-queue.mjs";

test("offline playback queue remains bounded and deduplicated", () => {
  let queue = [];
  queue = appendPlaybackEvent(queue, { eventId: "a", eventType: "STARTED" }, 2);
  queue = appendPlaybackEvent(queue, { eventId: "b", eventType: "COMPLETED" }, 2);
  queue = appendPlaybackEvent(queue, { eventId: "a", eventType: "FAILED" }, 2);
  assert.deepEqual(queue, [
    { eventId: "b", eventType: "COMPLETED" },
    { eventId: "a", eventType: "FAILED" }
  ]);

  queue = appendPlaybackEvent(queue, { eventId: "c", eventType: "STARTED" }, 2);
  assert.deepEqual(queue.map((event) => event.eventId), ["a", "c"]);
});

test("acknowledged events are removed without discarding later events", () => {
  const queue = [{ eventId: "a" }, { eventId: "b" }, { eventId: "c" }];
  assert.deepEqual(removePlaybackEvents(queue, ["a", "b"]), [{ eventId: "c" }]);
});

test("manifest token renewal does not restart an unchanged playing insertion", () => {
  const first = stableInsertionMediaSource(null, "version:normal", "/media?listener=first");
  assert.equal(stableInsertionMediaSource(first, "version:normal", "/media?listener=renewed"), first);
  assert.deepEqual(stableInsertionMediaSource(first, "version:priority", "/priority?listener=renewed"), {
    playbackKey: "version:priority", mediaUrl: "/priority?listener=renewed"
  });
  assert.equal(stableInsertionMediaSource(first, null, null), null);
});

test("an interrupted private programme can resume after an override without replaying completed override audio", () => {
  let played = updatePlayedInsertionIds([], "normal-programme", "STARTED", true);
  assert.deepEqual(played, []);
  played = updatePlayedInsertionIds(played, "normal-programme", "INTERRUPTED", true);
  assert.deepEqual(played, []);
  played = updatePlayedInsertionIds(played, "priority-audio", "STARTED", true);
  assert.deepEqual(played, []);
  played = updatePlayedInsertionIds(played, "priority-audio", "COMPLETED", true);
  assert.deepEqual(played, ["priority-audio"]);
  played = updatePlayedInsertionIds(played, "normal-programme", "STARTED", true);
  assert.deepEqual(played, ["priority-audio"]);
  played = updatePlayedInsertionIds(played, "normal-programme", "INTERRUPTED", true);
  assert.deepEqual(played, ["priority-audio"]);
});

test("existing non-Corrections insertion completion semantics remain unchanged", () => {
  const started = updatePlayedInsertionIds([], "campaign", "STARTED");
  assert.deepEqual(started, ["campaign"]);
  assert.deepEqual(updatePlayedInsertionIds(started, "campaign", "INTERRUPTED"), ["campaign"]);
});
