import assert from "node:assert/strict";
import test from "node:test";
import { runCatalogueTest, CatalogueTestRunnerError } from "../lib/catalogue-test-runner.mjs";

const START = Date.UTC(2030, 0, 1);
const fingerprint = "a".repeat(64);
const flush = async () => { for (let index = 0; index < 80; index += 1) await Promise.resolve(); };
function fakeClock({ newestFirst = false } = {}) {
  let milliseconds = 0, nextId = 0;
  const timers = new Map();
  return {
    now: () => START + milliseconds, monotonicNow: () => milliseconds,
    setTimeout(fn, delay) { const id = ++nextId; timers.set(id, { at: milliseconds + delay, fn }); return id; },
    clearTimeout(id) { timers.delete(id); },
    async advance(amount) {
      const target = milliseconds + amount;
      while (true) {
        const next = [...timers].filter(([, timer]) => timer.at <= target).sort((left, right) => left[1].at - right[1].at ||
          (newestFirst ? right[0] - left[0] : left[0] - right[0]))[0];
        if (!next) break;
        milliseconds = next[1].at; timers.delete(next[0]); next[1].fn(); await flush();
      }
      milliseconds = target; await flush();
    }
  };
}
async function drive(promise, clock, maximumMs = 8_000) {
  let ended = false, value, error;
  promise.then(result => { ended = true; value = result; }, failure => { ended = true; error = failure; });
  for (let time = 0; !ended && time <= maximumMs; time += 100) { await flush(); if (!ended) await clock.advance(100); }
  assert.equal(ended, true, "The injected runner must settle within its bounded fake-clock deadline.");
  if (error) throw error;
  return value;
}
function setup(overrides = {}, clockOptions = {}) {
  const clock = fakeClock(clockOptions);
  const calls = { load: 0, claim: 0, prepare: 0, connect: 0, play: 0, dispose: 0, forced: [], events: [], finish: [] };
  const resource = name => ({
    forceClose() { calls.forced.push({ name, at: clock.monotonicNow() }); },
    async close() { return { closed: true }; }
  });
  const session = { authorized: true, id: "session1", organisationId: "org1", stationId: "station1", channelId: null,
    durationSeconds: 2, deadlineAt: new Date(START + 2_000), authorizationExpiresAt: new Date(START + 2_000), fingerprint,
    tracks: [{ id: "track1", mediaAssetId: "asset1", durationSeconds: 120 }, { id: "track2", mediaAssetId: "asset2", durationSeconds: 180 }] };
  const options = {
    sessionId: "session1", clock,
    async loadAuthorizedSession() { calls.load += 1; return session; },
    async claim() { calls.claim += 1; return { claimed: true, leaseId: "lease1" }; },
    async heartbeat() { return { authorized: true, leaseHeld: true, fingerprint }; },
    async appendEvent({ event }) { calls.events.push(event); return true; },
    async finish(request) { calls.finish.push(request); return true; },
    async prepareAudio() { calls.prepare += 1; return { dispose() { calls.dispose += 1; } }; },
    async connectSource() { calls.connect += 1; return { ...resource("source"), authenticated: true }; },
    async playTrack({ track, emit }) {
      calls.play += 1;
      assert.equal(await emit({ type: "AUDIO_SENT", trackId: track.id, audioBytesSent: 100 }), true);
      assert.equal(await emit({ type: "AUDIO_SENT", trackId: track.id, audioBytesSent: 200 }), true);
      return { audioBytesSent: 200, completed: true };
    }, ...overrides
  };
  return { options, clock, calls, session, resource };
}

test("runner refuses missing adapters and requires an explicit clock without side effects", async () => {
  await assert.rejects(runCatalogueTest(), { code: "CATALOGUE_TEST_ADAPTERS_REQUIRED" });
  const fixture = setup(); delete fixture.options.clock;
  await assert.rejects(runCatalogueTest(fixture.options), { code: "CATALOGUE_TEST_OPTIONS_INVALID" });
  assert.equal(fixture.calls.load, 0);
});

test("authorized sender diagnostics record first observed audio once, actual ends and confirmed stop", async () => {
  const fixture = setup();
  const result = await drive(runCatalogueTest(fixture.options), fixture.clock);
  assert.equal(result.status, "COMPLETED");
  assert.equal(result.audioBytesSent, 400);
  assert.equal(result.tracksEnded, 2);
  assert.equal(result.stopConfirmed, true);
  assert.equal(result.finishRecorded, true);
  assert.equal(fixture.calls.connect, 1);
  assert.equal(fixture.calls.dispose, 1);
  assert.deepEqual(fixture.calls.events.map(event => event.type), ["TEST_CLAIMED", "SOURCE_AUTHENTICATED", "TRACK_AUDIO_SENT", "TRACK_ENDED", "TRACK_AUDIO_SENT", "TRACK_ENDED", "TEST_ENDED"]);
  assert.deepEqual(fixture.calls.events.map(event => event.sequence), [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(fixture.calls.finish[0].releaseAllowed, true);
  assert.equal(fixture.calls.events.some(event => /PROOF|ROYALTY|LISTENER/.test(event.type)), false);
});

test("expired, denied, malformed or cross-session authorizations never claim or connect", async () => {
  for (const changes of [{ authorized: false }, { id: "another-session" }, { durationSeconds: 301 }, { fingerprint: "invalid" },
    { authorizationExpiresAt: new Date(START) }, { authorizationExpiresAt: new Date(START + 3000) }, { tracks: [] },
    { tracks: [{ id: "x", mediaAssetId: "a", durationSeconds: 1 }, { id: "x", mediaAssetId: "b", durationSeconds: 1 }] }]) {
    const fixture = setup(); Object.assign(fixture.session, changes);
    const result = await drive(runCatalogueTest(fixture.options), fixture.clock);
    assert.equal(result.status, "REFUSED");
    assert.equal(fixture.calls.claim, 0);
    assert.equal(fixture.calls.connect, 0);
    assert.equal(fixture.calls.finish.length, 0);
  }
});

test("initial authorization load is bounded and cannot trigger a source attempt", async () => {
  const fixture = setup({ loadAuthorizedSession: () => new Promise(() => {}) });
  const result = await drive(runCatalogueTest(fixture.options), fixture.clock);
  assert.equal(result.status, "REFUSED");
  assert.equal(result.code, "CATALOGUE_TEST_ADAPTER_TIMEOUT");
  assert.equal(fixture.calls.connect, 0);
});

test("hard deadline is armed before preparation and independently closes a hidden registered child", async () => {
  const fixture = setup();
  fixture.options.prepareAudio = ({ registerResource }) => { registerResource(fixture.resource("preparing-child")); return new Promise(() => {}); };
  const result = await drive(runCatalogueTest(fixture.options), fixture.clock);
  assert.equal(result.status, "STOPPED");
  assert.equal(result.code, "CATALOGUE_TEST_DEADLINE");
  assert.equal(fixture.calls.connect, 0);
  assert.ok(fixture.calls.forced.some(item => item.name === "preparing-child" && item.at === 2000));
  assert.equal(fixture.calls.finish[0].releaseAllowed, true);
});

test("a hung source authentication is stopped through its early resource registration", async () => {
  const fixture = setup();
  fixture.options.connectSource = ({ registerResource }) => { registerResource(fixture.resource("authenticating-socket")); return new Promise(() => {}); };
  const result = await drive(runCatalogueTest(fixture.options), fixture.clock);
  assert.equal(result.status, "STOPPED");
  assert.ok(fixture.calls.forced.some(item => item.name === "authenticating-socket" && item.at === 2000));
  assert.equal(fixture.calls.play, 0);
  assert.equal(fixture.calls.events.some(event => event.type === "SOURCE_AUTHENTICATED"), false);
});

test("deadline-budgeted preparation, connection and playback report the same stop in either equal-timer order", async () => {
  for (const newestFirst of [false, true]) for (const stage of ["prepare", "connect", "play"]) {
    const fixture = setup({}, { newestFirst });
    fixture.session.deadlineAt = fixture.session.authorizationExpiresAt = new Date(START + 1500);
    if (stage === "prepare") fixture.options.prepareAudio = ({ registerResource }) => {
      fixture.calls.prepare += 1; registerResource(fixture.resource("preparing-child")); return new Promise(() => {});
    };
    if (stage === "connect") fixture.options.connectSource = ({ registerResource }) => {
      fixture.calls.connect += 1; registerResource(fixture.resource("authenticating-socket")); return new Promise(() => {});
    };
    if (stage === "play") fixture.options.playTrack = async ({ track, emit, registerResource }) => {
      fixture.calls.play += 1;
      const bytes = track.id === "track1" ? 300 : 123;
      await emit({ type: "AUDIO_SENT", trackId: track.id, audioBytesSent: bytes });
      if (track.id === "track1") return { audioBytesSent: bytes, completed: true };
      registerResource(fixture.resource("encoding-child")); return new Promise(() => {});
    };
    const result = await drive(runCatalogueTest(fixture.options), fixture.clock);
    assert.equal(result.status, "STOPPED"); assert.equal(result.code, "CATALOGUE_TEST_DEADLINE"); assert.equal(result.stopConfirmed, true);
    assert.equal(Math.min(...fixture.calls.forced.map(item => item.at)), 1500);
    assert.equal(fixture.calls.connect, stage === "prepare" ? 0 : 1);
    assert.equal(fixture.calls.play, stage === "play" ? 2 : 0);
    assert.equal(result.audioBytesSent, stage === "play" ? 423 : 0);
    assert.equal(result.tracksEnded, stage === "play" ? 1 : 0);
    const terminal = fixture.calls.events.find(event => event.type === "TEST_ENDED");
    assert.equal(terminal.status, "STOPPED"); assert.equal(terminal.code, "CATALOGUE_TEST_DEADLINE"); assert.equal(terminal.stopConfirmed, true);
    assert.equal(fixture.calls.finish[0].releaseAllowed, true);
    if (stage === "play") {
      const ends = fixture.calls.events.filter(event => event.type === "TRACK_ENDED");
      assert.deepEqual(ends.map(event => [event.trackId, event.audioBytesSent, event.completed]), [["track1", 300, true], ["track2", 123, false]]);
      assert.equal(ends[1].endedReason, "TEST_STOPPED"); assert.equal(ends[1].stopConfirmed, true);
    }
  }
});

test("genuine adapter timeouts before the deadline remain failures, not normal deadline stops", async () => {
  for (const stage of ["heartbeat", "event", "play"]) {
    const fixture = setup({}, { newestFirst: true });
    fixture.session.deadlineAt = fixture.session.authorizationExpiresAt = new Date(START + 1500);
    if (stage === "heartbeat") fixture.options.heartbeat = () => new Promise(() => {});
    if (stage === "event") fixture.options.appendEvent = async ({ event }) => {
      fixture.calls.events.push(event);
      if (event.type === "TEST_CLAIMED") return new Promise(() => {});
      return true;
    };
    if (stage === "play") fixture.options.playTrack = async () => { throw new CatalogueTestRunnerError("CATALOGUE_TEST_ADAPTER_TIMEOUT"); };
    const result = await drive(runCatalogueTest(fixture.options), fixture.clock);
    assert.equal(result.status, "FAILED"); assert.equal(result.code, "CATALOGUE_TEST_ADAPTER_TIMEOUT");
    assert.equal(result.stopConfirmed, true); assert.equal(result.audioBytesSent, 0);
    assert.equal(fixture.calls.connect, stage === "play" ? 1 : 0);
  }
});

test("a deadline-classified stop still quarantines an unconfirmed source closure", async () => {
  const fixture = setup({}, { newestFirst: true });
  fixture.session.deadlineAt = fixture.session.authorizationExpiresAt = new Date(START + 1500);
  fixture.options.connectSource = async () => ({ authenticated: true, forceClose() {}, close: () => new Promise(() => {}) });
  fixture.options.playTrack = () => new Promise(() => {});
  const result = await drive(runCatalogueTest(fixture.options), fixture.clock);
  assert.equal(result.status, "FAILED"); assert.equal(result.code, "CATALOGUE_TEST_STOP_UNCONFIRMED");
  assert.equal(result.stopConfirmed, false); assert.equal(result.preparedPreserved, true);
  assert.equal(fixture.calls.dispose, 0); assert.equal(fixture.calls.finish[0].releaseAllowed, false);
});

test("parent cancellation interrupts observed partial audio and never retries the source", async () => {
  const fixture = setup(); const controller = new AbortController(); fixture.options.signal = controller.signal;
  fixture.options.playTrack = async ({ track, emit, registerResource }) => {
    registerResource(fixture.resource("encoding-child"));
    await emit({ type: "AUDIO_SENT", trackId: track.id, audioBytesSent: 123 });
    return new Promise(() => {});
  };
  const promise = runCatalogueTest(fixture.options); await flush();
  await fixture.clock.advance(500); controller.abort();
  const result = await drive(promise, fixture.clock);
  assert.equal(result.status, "STOPPED");
  assert.equal(result.code, "CATALOGUE_TEST_ABORTED");
  assert.equal(result.audioBytesSent, 123);
  assert.equal(fixture.calls.connect, 1);
  const end = fixture.calls.events.find(event => event.type === "TRACK_ENDED");
  assert.equal(end.completed, false);
  assert.equal(end.audioBytesSent, 123);
  assert.ok(fixture.calls.forced.some(item => item.name === "encoding-child" && item.at === 500));
});

test("heartbeat revocation or fingerprint changes force closure despite a hung playback adapter", async () => {
  for (const status of [{ authorized: false, leaseHeld: true, fingerprint }, { authorized: true, leaseHeld: false, fingerprint },
    { authorized: true, leaseHeld: true, fingerprint: "b".repeat(64) }]) {
    const fixture = setup(); let checks = 0;
    fixture.options.heartbeat = async () => ++checks > 3 ? status : { authorized: true, leaseHeld: true, fingerprint };
    fixture.options.playTrack = () => new Promise(() => {});
    const result = await drive(runCatalogueTest(fixture.options), fixture.clock);
    assert.equal(result.status, "FAILED");
    assert.ok(["CATALOGUE_TEST_AUTHORIZATION_REVOKED", "CATALOGUE_TEST_CONFIGURATION_CHANGED"].includes(result.code));
    assert.ok(fixture.calls.forced.some(item => item.at === 1000));
    assert.equal(fixture.calls.connect, 1);
  }
});

test("authentication must be observed and its connection must be closeable before audio", async () => {
  for (const connection of [{ authenticated: true }, { authenticated: false, close() {}, forceClose() {} }]) {
    const fixture = setup({ connectSource: async () => connection });
    const result = await drive(runCatalogueTest(fixture.options), fixture.clock);
    assert.equal(result.status, "FAILED");
    assert.equal(fixture.calls.play, 0);
    assert.equal(fixture.calls.events.some(event => event.type === "SOURCE_AUTHENTICATED"), false);
  }
});

test("wrong-track callbacks and missing actual-audio observations cannot fabricate track starts", async () => {
  for (const mode of ["wrong-track", "no-observation"]) {
    const fixture = setup();
    fixture.options.playTrack = async ({ emit }) => {
      if (mode === "wrong-track") await emit({ type: "AUDIO_SENT", trackId: "foreign-track", audioBytesSent: 10 });
      return { completed: true, audioBytesSent: 10 };
    };
    const result = await drive(runCatalogueTest(fixture.options), fixture.clock);
    assert.equal(result.status, "FAILED");
    assert.equal(fixture.calls.events.some(event => event.type === "TRACK_AUDIO_SENT"), false);
  }
});

test("failed durable event writes stop before sending audio and do not expose adapter error messages", async () => {
  const fixture = setup();
  fixture.options.appendEvent = async ({ event }) => { if (event.type === "SOURCE_AUTHENTICATED") throw new Error("secret-password=must-not-appear"); };
  const result = await drive(runCatalogueTest(fixture.options), fixture.clock);
  assert.equal(result.status, "FAILED");
  assert.equal(fixture.calls.play, 0);
  assert.doesNotMatch(JSON.stringify(result), /secret-password|must-not-appear/);
  assert.ok(fixture.calls.forced.length > 0);
});

test("unconfirmed closure preserves prepared files and prohibits lease release", async () => {
  const fixture = setup();
  fixture.options.connectSource = async () => ({ authenticated: true, forceClose() {}, close: () => new Promise(() => {}) });
  const result = await drive(runCatalogueTest(fixture.options), fixture.clock);
  assert.equal(result.status, "FAILED");
  assert.equal(result.code, "CATALOGUE_TEST_STOP_UNCONFIRMED");
  assert.equal(result.preparedPreserved, true);
  assert.equal(fixture.calls.dispose, 0);
  assert.equal(fixture.calls.finish[0].releaseAllowed, false);
});

test("a source that resolves after the hard deadline is forcibly closed, never used", async () => {
  const fixture = setup(); let resolveSource;
  fixture.options.connectSource = () => new Promise(resolve => { resolveSource = resolve; });
  const promise = runCatalogueTest(fixture.options); await flush();
  const result = await drive(promise, fixture.clock);
  assert.equal(result.status, "STOPPED");
  resolveSource({ authenticated: true, ...fixture.resource("late-source") }); await flush();
  assert.ok(fixture.calls.forced.some(item => item.name === "late-source"));
  assert.equal(fixture.calls.play, 0);
});

test("an earlier owner authorization expiry is the actual hard stop, not the requested duration", async () => {
  const fixture = setup();
  fixture.session.authorizationExpiresAt = new Date(START + 750);
  fixture.options.playTrack = () => new Promise(() => {});
  const result = await drive(runCatalogueTest(fixture.options), fixture.clock);
  assert.equal(result.code, "CATALOGUE_TEST_DEADLINE");
  assert.ok(fixture.calls.forced.some(item => item.name === "source" && item.at === 750));
  assert.equal(fixture.calls.connect, 1);
});

test("a wall-clock rollback never extends the independent monotonic hard stop", async () => {
  const fixture = setup();
  const ordinaryNow = fixture.clock.now;
  fixture.clock.now = () => ordinaryNow() - (fixture.clock.monotonicNow() >= 500 ? 60_000 : 0);
  fixture.options.playTrack = () => new Promise(() => {});
  const result = await drive(runCatalogueTest(fixture.options), fixture.clock);
  assert.equal(result.code, "CATALOGUE_TEST_DEADLINE");
  assert.ok(fixture.calls.forced.some(item => item.name === "source" && item.at === 2000));
  assert.equal(fixture.calls.connect, 1);
});

test("hung terminal events and finish cannot keep resources open or prevent bounded return", async () => {
  const fixture = setup();
  fixture.options.appendEvent = async ({ event }) => {
    fixture.calls.events.push(event);
    if (event.type === "TEST_ENDED") return new Promise(() => {});
    return true;
  };
  fixture.options.finish = async request => {
    fixture.calls.finish.push(request);
    return new Promise(() => {});
  };
  const result = await drive(runCatalogueTest(fixture.options), fixture.clock);
  assert.equal(result.stopConfirmed, true);
  assert.equal(result.finishRecorded, false);
  assert.equal(fixture.calls.dispose, 1);
  const terminalAt = fixture.calls.events.find(event => event.type === "TEST_ENDED").occurredAt.getTime() - START;
  assert.ok(fixture.calls.forced.some(item => item.name === "source" && item.at <= terminalAt));
  assert.equal(fixture.calls.finish[0].releaseAllowed, true);
  assert.equal(fixture.calls.connect, 1);
});

test("a claim completing after its timeout is terminally cleaned without starting a source", async () => {
  const fixture = setup(); let resolveClaim;
  fixture.options.claim = () => new Promise(resolve => { resolveClaim = resolve; });
  const result = await drive(runCatalogueTest(fixture.options), fixture.clock);
  assert.equal(result.status, "REFUSED");
  assert.equal(result.code, "CATALOGUE_TEST_ADAPTER_TIMEOUT");
  assert.equal(fixture.calls.prepare, 0);
  assert.equal(fixture.calls.connect, 0);
  resolveClaim({ claimed: true, leaseId: "late-claim" }); await flush();
  assert.equal(fixture.calls.finish.length, 1);
  assert.equal(fixture.calls.finish[0].claim.leaseId, "late-claim");
  assert.equal(fixture.calls.finish[0].result.status, "STOPPED");
  assert.equal(fixture.calls.finish[0].releaseAllowed, true);
});
