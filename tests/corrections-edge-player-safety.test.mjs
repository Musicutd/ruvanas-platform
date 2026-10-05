import assert from "node:assert/strict";
import test from "node:test";
import {
  pollCorrectionsEdgePlayback, unloadCorrectionsEdgeAudio
} from "../lib/corrections-edge-player-safety.mjs";

function bufferedAudio() {
  const state = { playing: true, source: "/v1/media/private", buffered: true,
    currentTime: 19.8, unloads: 0 };
  return { state, element: {
    get currentTime() { return state.currentTime; },
    pause() { state.playing = false; },
    removeAttribute(name) { assert.equal(name, "src"); state.source = null; },
    load() { state.buffered = false; state.unloads += 1; }
  } };
}

test("Edge playback loss pauses and discards already-buffered private audio", () => {
  const { state, element } = bufferedAudio();
  assert.equal(unloadCorrectionsEdgeAudio(element), 19);
  assert.deepEqual({ playing: state.playing, source: state.source, buffered: state.buffered,
    unloads: state.unloads }, { playing: false, source: null, buffered: false, unloads: 1 });
});

test("Edge 401 unloads audio before waiting for a fresh cloud grant", async () => {
  const { state, element } = bufferedAudio();
  let finishEstablish;
  const pendingGrant = new Promise((resolve) => { finishEstablish = resolve; });
  const steps = [];
  const prior = { sessionId: "old", ended: false };
  const recovery = pollCorrectionsEdgePlayback({
    needsRenewal: false,
    renew: () => { steps.push("renew"); throw { status: 401 }; },
    playback: () => { steps.push("playback");
      return steps.filter((step) => step === "playback").length === 1 ?
        Promise.reject({ status: 401 }) : { state: "READY", sessionId: "new" }; },
    halt: () => { steps.push("halt"); unloadCorrectionsEdgeAudio(element); return prior; },
    clearLease: () => steps.push("clear-lease"),
    establish: () => { steps.push("establish"); return pendingGrant; },
    interrupt: (item) => { assert.equal(item, prior); steps.push("interrupt"); item.ended = true; }
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(steps, ["playback", "halt", "renew", "clear-lease", "establish"]);
  assert.equal(state.playing, false);
  assert.equal(state.buffered, false);
  assert.equal(state.source, null);
  finishEstablish();
  assert.deepEqual(await recovery, { state: "READY", sessionId: "new" });
  assert.deepEqual(steps, ["playback", "halt", "renew", "clear-lease", "establish", "interrupt", "playback"]);
});

test("local Edge transport failure unloads audio without requesting a cloud grant", async () => {
  const { state, element } = bufferedAudio();
  const failure = new Error("Local Edge unreachable");
  let cloudCalls = 0;
  await assert.rejects(pollCorrectionsEdgePlayback({
    needsRenewal: false,
    playback: () => { throw failure; },
    renew: () => { cloudCalls++; },
    halt: () => unloadCorrectionsEdgeAudio(element),
    clearLease: () => { cloudCalls++; },
    establish: () => { cloudCalls++; },
    interrupt: () => { cloudCalls++; }
  }), (error) => error === failure);
  assert.equal(state.playing, false);
  assert.equal(state.buffered, false);
  assert.equal(cloudCalls, 0);
});

test("expired access lease renews locally without a cloud grant during an outage", async () => {
  const { state, element } = bufferedAudio();
  const steps = [];
  const result = await pollCorrectionsEdgePlayback({
    needsRenewal: false,
    playback: () => { steps.push("playback");
      return steps.filter((step) => step === "playback").length === 1 ?
        Promise.reject({ status: 401 }) : { state: "READY", sessionId: "new" }; },
    halt: () => { steps.push("halt"); unloadCorrectionsEdgeAudio(element); return { sessionId: "old" }; },
    renew: () => { steps.push("renew"); },
    interrupt: () => { steps.push("interrupt"); },
    clearLease: () => { throw new Error("Cloud grant must not be requested"); },
    establish: () => { throw new Error("Cloud grant must not be requested"); }
  });
  assert.deepEqual(result, { state: "READY", sessionId: "new" });
  assert.equal(state.buffered, false);
  assert.deepEqual(steps, ["playback", "halt", "renew", "interrupt", "playback"]);
});

test("rejected local renewal can recover with a fresh attested cloud grant", async () => {
  const steps = [];
  const result = await pollCorrectionsEdgePlayback({
    needsRenewal: true,
    renew: () => { steps.push("renew"); throw { status: 401 }; },
    playback: () => { steps.push("playback"); return { state: "READY", sessionId: "new" }; },
    halt: () => { steps.push("halt"); return { sessionId: "old" }; },
    clearLease: () => steps.push("clear-lease"),
    establish: () => steps.push("establish"),
    interrupt: () => steps.push("interrupt")
  });
  assert.deepEqual(result, { state: "READY", sessionId: "new" });
  assert.deepEqual(steps, ["renew", "halt", "clear-lease", "establish", "interrupt", "playback"]);
});
