import assert from "node:assert/strict";
import test from "node:test";
import { drainProofBatch } from "../lib/playback-proof-drain.mjs";

test("one invalid proof cannot strand later valid proof", async () => {
  const accepted = [], rejected = [];
  const events = [{ id: "old" }, { id: "start" }, { id: "complete" }];
  const done = await drainProofBatch(events, {
    send: async (items) => items.some((item) => item.id === "old") ? 400 : 200,
    accepted: async (items) => accepted.push(...items.map((item) => item.id)),
    rejected: async (item) => rejected.push(item.id)
  });
  assert.equal(done, true);
  assert.deepEqual(rejected, ["old"]);
  assert.deepEqual(accepted, ["start", "complete"]);
});

test("transient proof failure keeps all unacknowledged events queued", async () => {
  const accepted = [], rejected = [];
  const done = await drainProofBatch([{ id: "old" }, { id: "new" }], {
    send: async (items) => items.length === 2 ? 400 : items[0].id === "old" ? 400 : 503,
    accepted: async (items) => accepted.push(...items),
    rejected: async (item) => rejected.push(item.id)
  });
  assert.equal(done, false);
  assert.deepEqual(accepted, []);
  assert.deepEqual(rejected, ["old"]);
});
