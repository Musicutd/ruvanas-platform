import assert from "node:assert/strict";
import test from "node:test";
import {
  clearCorrectionsEdgePending, correctionsEdgePendingKey, detachCorrectionsEdgeAudio,
  finishPendingCorrectionsTerminal, pinCorrectionsEdgeTerminal, pollCorrectionsEdgePlayback,
  readCorrectionsEdgePending, unloadCorrectionsEdgeAudio, writeCorrectionsEdgePending
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

test("detaching a React audio ref unloads bytes before recording its interruption", () => {
  const { state, element } = bufferedAudio();
  const item = { sessionId: "old" };
  const remembered = [];
  detachCorrectionsEdgeAudio(element, item, (stopped) => {
    assert.equal(state.playing, false);
    assert.equal(state.buffered, false);
    assert.equal(state.source, null);
    remembered.push(stopped);
  });
  assert.equal(item.stoppedAtSeconds, 19);
  assert.deepEqual(remembered, [item]);
});

test("a transient Edge failure resumes only after the old interruption is confirmed", async () => {
  const item = { sessionId: "old" };
  let proofAvailable = false;
  let playbackCalls = 0;
  const options = {
    report: async () => proofAvailable,
    playback: () => { playbackCalls++; return { state: "READY", sessionId: "new" }; }
  };
  assert.deepEqual(await finishPendingCorrectionsTerminal(item, options),
    { confirmed: false, result: null });
  assert.equal(playbackCalls, 0, "a stale media ticket must not be replayed while proof is unconfirmed");
  proofAvailable = true;
  assert.deepEqual(await finishPendingCorrectionsTerminal(item, options),
    { confirmed: true, result: { state: "READY", sessionId: "new" } });
  assert.equal(playbackCalls, 1);
});

test("a lost terminal response retries the exact event and position instead of conflicting with it", () => {
  const item = { sessionId: "old", durationSeconds: 20 };
  assert.deepEqual(pinCorrectionsEdgeTerminal(item, "COMPLETED", 20),
    { eventType: "COMPLETED", positionSeconds: 20 });
  assert.deepEqual(pinCorrectionsEdgeTerminal(item, "INTERRUPTED", 18),
    { eventType: "COMPLETED", positionSeconds: 20 });
});

test("a page remount restores an unconfirmed report without storing a media ticket", () => {
  const entries = new Map();
  const storage = { getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value), removeItem: (key) => entries.delete(key) };
  const connection = { nodeId: "edge-a", organisationId: "organisation-a", facilityId: "facility-a", zoneId: "zone-a",
    playerId: "player-a", endpointOrigin: "https://edge.test", manifestVersion: "manifest-a" };
  const key = correctionsEdgePendingKey(connection);
  const item = { sessionId: "session-a", durationSeconds: 20, reportEventType: "INTERRUPTED",
    reportPositionSeconds: 7, mediaUrl: "/private-ticket" };
  writeCorrectionsEdgePending(storage, key, item);
  assert.equal(entries.get(key).includes("private-ticket"), false);
  assert.deepEqual(readCorrectionsEdgePending(storage, key), { sessionId: "session-a",
    durationSeconds: 20, reportEventType: "INTERRUPTED", reportPositionSeconds: 7, ended: false });
  assert.equal(correctionsEdgePendingKey({ ...connection, manifestVersion: "manifest-b" }), key,
    "manifest rotation must not lose an unconfirmed terminal report");
  assert.notEqual(correctionsEdgePendingKey({ ...connection, organisationId: "organisation-b" }), key);
  clearCorrectionsEdgePending(storage, key, { ...item, sessionId: "later" });
  assert.equal(entries.has(key), true, "an older async report cannot remove a newer pending result");
  clearCorrectionsEdgePending(storage, key, item);
  assert.equal(entries.has(key), false);
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
    interrupt: (item) => { assert.equal(item, prior); steps.push("interrupt"); item.ended = true; return true; }
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
    interrupt: () => { steps.push("interrupt"); return true; },
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
    interrupt: () => { steps.push("interrupt"); return true; }
  });
  assert.deepEqual(result, { state: "READY", sessionId: "new" });
  assert.deepEqual(steps, ["renew", "halt", "clear-lease", "establish", "interrupt", "playback"]);
});

test("a rejected terminal report cannot advance to a new Edge playback session", async () => {
  let playbackCalls = 0;
  await assert.rejects(pollCorrectionsEdgePlayback({ needsRenewal: false,
    playback: () => { playbackCalls++; if (playbackCalls === 1) throw { status: 401 };
      return { state: "READY" }; },
    halt: () => ({ sessionId: "old" }), renew: () => {},
    interrupt: () => false, clearLease: () => { throw new Error("No cloud grant needed"); },
    establish: () => { throw new Error("No cloud grant needed"); }
  }), /unconfirmed/);
  assert.equal(playbackCalls, 1);
});
