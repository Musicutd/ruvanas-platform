import assert from "node:assert/strict";
import test from "node:test";
import {
  appendPlaybackEvent,
  removePlaybackEvents
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
