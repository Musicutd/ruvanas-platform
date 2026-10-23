import assert from "node:assert/strict";
import test from "node:test";
import { catalogueTestTrackMetadata, createOffAirCatalogueTestMetadata, createCatalogueTestMetadata } from "../lib/catalogue-test-metadata.mjs";

const START = Date.UTC(2030, 0, 1);
const flush = async () => { for (let index = 0; index < 30; index++) await Promise.resolve(); };
function fakeClock() {
  let now = START, nextId = 0;
  const timers = new Map();
  return {
    now: () => now,
    setTimeout(callback, delay) { const id = ++nextId; timers.set(id, { callback, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    async advance(amount) {
      const target = now + amount;
      while (true) {
        const next = [...timers].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!next) break;
        now = next[1].at; timers.delete(next[0]); next[1].callback(); await flush();
      }
      now = target; await flush();
    },
    count: () => timers.size,
  };
}
const item = (id, title = `Title ${id}`, artist = "Artist") => ({ id, track: { id, title, artist } });
function fixture(overrides = {}) {
  const clock = fakeClock(), controller = new AbortController(), calls = [];
  const options = {
    mode: "OFF_AIR", clock, signal: controller.signal,
    session: { id: "test-session", stationId: "cmvcnbwi20008hr23sd76psi8", authorized: true,
      deadlineAt: new Date(START + 10_000), authorizationExpiresAt: new Date(START + 10_000),
      tracks: [item("track-a"), item("track-b"), item("track-c")] },
    source: { providerKey: "CENTOVA_CAST", serverHost: "pollux.shoutca.st", sourcePort: 8282,
      bitrateKbps: 128, centovaUsername: "ruvanastestradio", sourceUsername: null,
      outboundAutoDjEnabled: false, sourcePasswordEncrypted: "synthetic-encrypted-do-not-forward" },
    connection: { authenticated: true },
    async update(request) { calls.push(request); return true; },
    ...overrides,
  };
  return { options, clock, controller, calls, make: () => createOffAirCatalogueTestMetadata(options) };
}
const start = (metadata, id = "track-a") => metadata.audioStarted({ trackId: id, audioBytesSent: 417 });

test("artist/title formatter normalizes controls and Unicode without exposing other track data", () => {
  const value = catalogueTestTrackMetadata(item("track-a", "Cafe\u0301\n\0\u202eSong", "  A\tB  "));
  assert.deepEqual(value, { trackId: "track-a", title: "Café Song", artist: "A B", displayTitle: "A B — Café Song" });
  assert.ok(Object.isFrozen(value));
  const bounded = catalogueTestTrackMetadata(item("track-a", "🎵".repeat(1000), "à".repeat(1000)));
  assert.equal(Buffer.byteLength(bounded.title), 256);
  assert.equal(Buffer.byteLength(bounded.artist), 192);
  assert.ok(!/[\uD800-\uDFFF]/u.test(bounded.title));
  assert.equal(catalogueTestTrackMetadata(item("track-a", "Song", "")).displayTitle, "Song");
  for (const invalid of [null, {}, { id: "track-a", track: { id: "track-b", title: "Wrong" } }, item("bad\nid"), item("track-a", " \0\n "), item("track-a", null)]) {
    assert.equal(catalogueTestTrackMetadata(invalid), null);
  }
});

test("metadata is opt-in, off-air and fixed to the authenticated isolated Test Radio target", () => {
  for (const change of [{ mode: undefined }, { mode: "LIVE" }, { update: null }, { timeoutMs: 1001 }, { timeoutMs: 0 }, { signal: null }, { clock: {} }]) {
    assert.throws(() => fixture(change).make(), { code: "TEST_METADATA_OPTIONS_INVALID" });
  }
  for (const change of [{ authorized: false }, { stationId: "another-station" }, { deadlineAt: new Date(START) }, { tracks: [] },
    { authorizationExpiresAt: new Date(NaN) }, { tracks: [item("track-a"), item("track-a")] }, { tracks: [item("track-a", "")] }]) {
    const f = fixture(); Object.assign(f.options.session, change);
    assert.throws(() => f.make()); assert.equal(f.calls.length, 0);
  }
  for (const change of [{ sourcePort: 8393 }, { centovaUsername: "radio105" }, { serverHost: "elsewhere.example" }, { outboundAutoDjEnabled: true }]) {
    const f = fixture(); Object.assign(f.options.source, change);
    assert.throws(() => f.make(), { code: "TEST_SOURCE_NOT_READY" });
  }
  assert.throws(() => fixture({ connection: { authenticated: false } }).make(), { code: "TEST_METADATA_SESSION_INVALID" });
});

test("only a positive, confirmed source write emits mock metadata, once per track", async () => {
  const f = fixture(), metadata = f.make();
  for (const event of [{}, { trackId: "unknown", audioBytesSent: 100 }, { trackId: "track-a", audioBytesSent: 0 }, { trackId: "track-a", audioBytesSent: 1.5 }]) {
    assert.equal((await metadata.audioStarted(event)).code, "TEST_METADATA_AUDIO_UNCONFIRMED");
  }
  assert.equal(f.calls.length, 0);
  assert.equal((await start(metadata)).code, "TEST_METADATA_MOCK_UPDATED");
  assert.equal(f.calls.length, 1);
  assert.deepEqual(Object.keys(f.calls[0]).sort(), ["metadata", "signal"]);
  assert.deepEqual(f.calls[0].metadata, { trackId: "track-a", title: "Title track-a", artist: "Artist", displayTitle: "Artist — Title track-a",
    stationId: "cmvcnbwi20008hr23sd76psi8", sessionId: "test-session", sequence: 1 });
  assert.ok(!JSON.stringify(f.calls).includes("synthetic-encrypted"));
  assert.equal((await start(metadata)).code, "TEST_METADATA_DUPLICATE_OR_STALE");
  assert.equal((await start(metadata, "track-b")).code, "TEST_METADATA_MOCK_UPDATED");
  assert.equal((await start(metadata)).code, "TEST_METADATA_DUPLICATE_OR_STALE");
  assert.equal(f.calls.length, 2);
  metadata.close(); assert.equal(f.clock.count(), 0);
});

test("metadata failures are contained and expose only a fixed safe code", async () => {
  const f = fixture({ update: async () => { throw new Error("https://secret.example/?pass=do-not-expose"); } }), metadata = f.make();
  assert.deepEqual(await start(metadata), { code: "TEST_METADATA_UPDATE_FAILED" });
  f.options.update = async () => true;
  assert.deepEqual(await start(metadata, "track-b"), { code: "TEST_METADATA_UPDATE_FAILED" });
  metadata.close();
});

test("mutating source session and track objects cannot retarget an existing dispatcher", async () => {
  const f = fixture(), metadata = f.make();
  f.options.session.id = "other-session";
  f.options.session.stationId = "other-station";
  f.options.session.tracks[0].track.title = "Other title";
  f.options.source.sourcePort = 8393;
  assert.equal((await start(metadata)).code, "TEST_METADATA_MOCK_UPDATED");
  assert.equal(f.calls[0].metadata.sessionId, "test-session");
  assert.equal(f.calls[0].metadata.stationId, "cmvcnbwi20008hr23sd76psi8");
  assert.equal(f.calls[0].metadata.title, "Title track-a");
  metadata.close();
});

test("a failed or ambiguous provider result is never labelled as a successful update", async () => {
  for (const result of [false, undefined, null, { ok: true }, "OK"]) {
    const f = fixture({ update: async () => result }), metadata = f.make();
    assert.equal((await start(metadata)).code, "TEST_METADATA_NOT_UPDATED"); metadata.close();
  }
});

test("new track cancels stale metadata and waits for its adapter to settle", async () => {
  let releaseA;
  const f = fixture({ update: request => {
    f.calls.push(request);
    return request.metadata.trackId === "track-a" ? new Promise(resolve => { releaseA = resolve; }) : true;
  } }), metadata = f.make();
  const a = start(metadata); await flush();
  const b = start(metadata, "track-b"); await flush();
  assert.equal((await a).code, "TEST_METADATA_CANCELLED");
  assert.equal(f.calls[0].signal.aborted, true); assert.equal(f.calls.length, 1);
  releaseA(true); await flush();
  assert.equal((await b).code, "TEST_METADATA_MOCK_UPDATED");
  assert.equal(f.calls.length, 2); assert.equal(f.calls[1].metadata.trackId, "track-b");
  metadata.close();
});

test("an adapter ignoring cancellation cannot race a newer title; callers still time out", async () => {
  const f = fixture({ update: request => { f.calls.push(request); return new Promise(() => {}); } }), metadata = f.make();
  const a = start(metadata); await flush();
  const b = start(metadata, "track-b"); await flush();
  assert.equal((await a).code, "TEST_METADATA_CANCELLED");
  await f.clock.advance(750);
  assert.equal((await b).code, "TEST_METADATA_TIMEOUT");
  assert.equal(f.calls.length, 1);
  const c = start(metadata, "track-c"); await f.clock.advance(750);
  assert.equal((await c).code, "TEST_METADATA_TIMEOUT"); assert.equal(f.calls.length, 1);
  metadata.close(); assert.equal(f.clock.count(), 0);
});

test("late completion cannot claim success after the request timed out", async () => {
  let release;
  const f = fixture({ update: () => new Promise(resolve => { release = resolve; }) }), metadata = f.make();
  const pending = start(metadata); await flush(); await f.clock.advance(750);
  assert.equal((await pending).code, "TEST_METADATA_TIMEOUT");
  release(true); await flush();
  assert.equal((await pending).code, "TEST_METADATA_TIMEOUT"); metadata.close();
});

test("parent cancellation, close and deadline prevent all later updates", async () => {
  for (const stop of [f => f.controller.abort(), (_f, metadata) => metadata.close(), async f => f.clock.advance(10_000)]) {
    const f = fixture(), metadata = f.make();
    await stop(f, metadata);
    assert.equal((await start(metadata)).code, "TEST_METADATA_CLOSED");
    assert.equal(f.calls.length, 0); assert.equal(f.clock.count(), 0);
  }
});

test("already aborted and queued cancellation never call the mock adapter", async () => {
  const f = fixture(); f.controller.abort();
  const metadata = f.make();
  assert.equal((await start(metadata)).code, "TEST_METADATA_CLOSED"); assert.equal(f.calls.length, 0);
  const g = fixture(), queued = g.make(), request = start(queued);
  queued.close(); await flush();
  assert.equal((await request).code, "TEST_METADATA_CANCELLED"); assert.equal(g.calls.length, 0);
});

test("bounded owner-test dispatcher is explicit and reports only strict updater verification", async () => {
  const f = fixture();
  assert.throws(() => createCatalogueTestMetadata(f.options), { code: "TEST_METADATA_OPTIONS_INVALID" });
  assert.throws(() => createCatalogueTestMetadata({ ...f.options, mode: "BOUNDED_OWNER_TEST", timeoutMs: 3001 }), { code: "TEST_METADATA_OPTIONS_INVALID" });
  const metadata = createCatalogueTestMetadata({ ...f.options, mode: "BOUNDED_OWNER_TEST" });
  assert.equal((await start(metadata)).code, "TEST_METADATA_VERIFIED");
  metadata.close(); assert.equal(f.clock.count(), 0);
  const g = fixture({ update: async () => ({ status: 200 }) });
  const unverified = createCatalogueTestMetadata({ ...g.options, mode: "BOUNDED_OWNER_TEST" });
  assert.equal((await start(unverified)).code, "TEST_METADATA_NOT_UPDATED"); unverified.close();
});
