import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import path from "node:path";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { parseStudioQueuePushReply, sendStudioQueuePush, studioQueuePushCommand } from "../lib/studio-encoder-transport.mjs";

const cache = path.resolve(process.cwd(), "private-encoder-cache");

test("Studio queue transport accepts only private local audio files", () => {
  assert.equal(studioQueuePushCommand(path.join(cache, "approved.mp3"), cache), `studio_manual.push ${path.join(cache, "approved.mp3")}\n`);
  for (const file of [path.resolve(cache, "../other.mp3"), cache, path.join(cache, "note.txt"), `${path.join(cache, "approved.mp3")}\nhelp`]) {
    assert.throws(() => studioQueuePushCommand(file, cache));
  }
  assert.throws(() => studioQueuePushCommand("https://example.com/audio.mp3", cache));
});

test("Liquidsoap request acknowledgement is never represented as listener proof", () => {
  assert.deepEqual(parseStudioQueuePushReply("17\nEND\n"), { requestId: "17", listenerVerified: false });
  for (const response of ["", "OK\nEND\n", "17\n", "17\nERROR\nEND\n", "17\nEND\nextra"]) {
    assert.throws(() => parseStudioQueuePushReply(response));
  }
});

test("Studio socket transport accepts an ACK but rejects malformed and timed-out responses", async () => {
  const socket = path.join(cache, "encoder.sock");
  const command = studioQueuePushCommand(path.join(cache, "approved.mp3"), cache);
  function connectionFor(reply) {
    const connection = new EventEmitter();
    connection.destroy = () => undefined;
    connection.setTimeout = (_ms, callback) => { connection.expire = callback; };
    connection.write = (written) => {
      assert.equal(written, command);
      if (reply === "TIMEOUT") queueMicrotask(() => connection.expire());
      else queueMicrotask(() => connection.emit("data", Buffer.from(reply)));
    };
    queueMicrotask(() => connection.emit("connect"));
    return connection;
  }
  assert.deepEqual(await sendStudioQueuePush(socket, command, { connect: () => connectionFor("23\nEND\n") }), { requestId: "23", listenerVerified: false });
  await assert.rejects(sendStudioQueuePush(socket, command, { connect: () => connectionFor("bad\nEND\n") }), /did not acknowledge/);
  await assert.rejects(sendStudioQueuePush(socket, command, { connect: () => connectionFor("TIMEOUT") }), /did not respond/);
  assert.throws(() => sendStudioQueuePush(socket, "help\n", { connect: () => connectionFor("23\nEND\n") }));
});

test("unverified transport cannot unlock Studio live controls or alter the existing Centova worker", async () => {
  const [playout, broadcast, worker] = await Promise.all([
    readFile(new URL("../lib/studio-playout.mjs", import.meta.url), "utf8"),
    readFile(new URL("../app/api/studio/broadcast/route.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/online-radio-encoder-worker.mjs", import.meta.url), "utf8")
  ]);
  assert.match(playout, /connected: false/);
  assert.match(broadcast, /assertStudioManualOutputBridge\(\)/);
  assert.doesNotMatch(worker, /pushPreparedStudioAudio/);
});
