import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import vm from "node:vm";
import { catalogueTestListeningSnapshot, catalogueTestPlayerView, safeTestRadioListenerUrl, replaceCatalogueTestAudio, TEST_RADIO_LISTENER_URL } from "../lib/catalogue-test-player.mjs";
import { catalogueTestMode, HANDOVER_TEST_MODE } from "../lib/catalogue-test-modes.mjs";

const now = new Date("2026-10-23T12:00:20Z"), ms = now.getTime();
const date = offset => new Date(ms + offset);
function fixture() {
  return { stationId: "cmvcnbwi20008hr23sd76psi8", streamConfig: { streamUrl: TEST_RADIO_LISTENER_URL, encoderLeaseUntil: date(30_000) },
    sourceReady: true, workerReady: true, now,
    latest: { id: "test-session", status: "RUNNING", deadlineAt: date(300_000), expiresAt: date(400_000),
      plan: { items: [{ trackId: "track-1", title: "Real catalogue song", artist: "Catalogue artist", playDurationSeconds: 180 }] },
      events: [{ id: "event-1", kind: "SOURCE_AUTHENTICATED", occurredAt: date(-12_000) },
        { id: "event-2", kind: "TRACK_AUDIO_SENT", trackId: "track-1", occurredAt: date(-10_000), details: { audioBytesSent: 4096 } }] } };
}

test("listener URL is the exact saved Test Radio HTTPS endpoint, never another station or an unsafe fallback", () => {
  assert.equal(safeTestRadioListenerUrl(TEST_RADIO_LISTENER_URL), TEST_RADIO_LISTENER_URL);
  for (const value of [null, undefined, "", TEST_RADIO_LISTENER_URL.replace("https:", "http:"),
    "http://pollux.shoutca.st:8282/stream", TEST_RADIO_LISTENER_URL + "?token=secret", TEST_RADIO_LISTENER_URL + "#fragment",
    TEST_RADIO_LISTENER_URL.replace("ruvanastestradio", "otherstation"), "https://user:secret@ruvanastestradio-radio105network.radioca.st/stream",
    " " + TEST_RADIO_LISTENER_URL, "javascript:alert(1)"]) assert.equal(safeTestRadioListenerUrl(value), null);
  const f = fixture();
  assert.equal(catalogueTestListeningSnapshot({ ...f, stationId: "other-station" }).listenerUrl, null);
  assert.equal(catalogueTestListeningSnapshot({ ...f, sourceReady: false }).listenerUrl, null);
});

test("actual source event maps to a safe catalogue title, never to an elapsed playlist guess", () => {
  const f = fixture(), snapshot = catalogueTestListeningSnapshot(f);
  assert.equal(snapshot.enabled, true);
  assert.equal(snapshot.expiresInMs, 15_000);
  assert.deepEqual(snapshot.track, { title: "Real catalogue song", artist: "Catalogue artist", sourceStartedAt: date(-10_000).toISOString(), expiresInMs: 170_000 });
  const view = catalogueTestPlayerView(snapshot, 500);
  assert.equal(view.enabled, true); assert.equal(view.track.title, "Real catalogue song");
  f.latest.events = f.latest.events.slice(0, 1);
  assert.equal(catalogueTestListeningSnapshot(f).track, null, "Authentication alone is not a song observation");
});

test("stopped, stop requested, stale worker and expired deadline never display old music as current", () => {
  for (const status of ["PREPARED", "STOPPED", "FAILED", "COMPLETED", "EXPIRED"]) {
    const f = fixture(); f.latest.status = status;
    const snapshot = catalogueTestListeningSnapshot(f);
    assert.equal(snapshot.enabled, false, status); assert.equal(snapshot.track, null, status);
  }
  for (const change of [f => { f.latest.stopRequestedAt = date(-1); }, f => { f.latest.deadlineAt = now; },
    f => { f.latest.expiresAt = now; }, f => { f.latest.deadlineAt = "invalid"; }, f => { f.workerReady = false; },
    f => { f.streamConfig.encoderLeaseUntil = date(-1); }, f => { f.attentionRequired = true; },
    f => { f.latest.endedReason = "CATALOGUE_TEST_STOP_UNCONFIRMED"; },
    f => { f.latest.events.push({ kind: "TEST_ENDED", occurredAt: now, details: { stopConfirmed: false } }); }]) {
    const f = fixture(); change(f); const snapshot = catalogueTestListeningSnapshot(f);
    assert.equal(snapshot.enabled, false); assert.equal(snapshot.track, null);
  }
});

test("source event ending, future timestamps, invalid and ambiguous tracks cannot invent now playing", () => {
  for (const change of [f => { f.latest.events.push({ kind: "TRACK_ENDED", trackId: "track-1", occurredAt: now }); },
    f => { f.latest.events[1].occurredAt = date(1); }, f => { f.latest.events[1].trackId = "unknown"; },
    f => { f.latest.plan.items.push({ ...f.latest.plan.items[0] }); }, f => { f.latest.plan.items[0].playDurationSeconds = 0; },
    f => { f.latest.plan.items[0].playDurationSeconds = 5; }, f => { f.latest.events[1].occurredAt = "invalid"; },
    f => { f.latest.events[1].details.audioBytesSent = 0; }, f => { delete f.latest.events[1].details; },
    f => { f.latest.events.push({ kind: "TEST_ENDED", occurredAt: now, details: { stopConfirmed: true } }); }]) {
    const f = fixture(); change(f); assert.equal(catalogueTestListeningSnapshot(f).track, null);
  }
  const f = fixture(); f.latest.events.reverse();
  assert.equal(catalogueTestListeningSnapshot(f).track.title, "Real catalogue song", "Database newest-first order does not change the observation");
});

test("title display remains bounded and excludes internal plan, source and media secrets", () => {
  const f = fixture(); f.streamConfig.sourcePasswordEncrypted = "secret-ciphertext";
  f.latest.authorization = { token: "secret-authorization" };
  f.latest.plan.items[0] = { ...f.latest.plan.items[0], title: "x".repeat(500), artist: "Artist\u0000\nname", fingerprint: "private-fingerprint", storageKey: "catalogue/music/private.mp3" };
  const snapshot = catalogueTestListeningSnapshot(f);
  assert.equal(snapshot.track.title.length, 240); assert.equal(snapshot.track.artist, "Artist  name");
  assert.doesNotMatch(JSON.stringify(snapshot), /secret-ciphertext|secret-authorization|private-fingerprint|catalogue\/music/);
});

test("a cached browser snapshot and track expire without another network response", () => {
  const snapshot = catalogueTestListeningSnapshot(fixture());
  assert.equal(catalogueTestPlayerView(snapshot, 14_999).enabled, true);
  for (const age of [15_000, 30_000, Infinity, NaN, -1]) {
    const view = catalogueTestPlayerView(snapshot, age);
    assert.equal(view.enabled, false); assert.equal(view.track, null); assert.equal(view.listenerUrl, null);
  }
  assert.equal(catalogueTestPlayerView(snapshot, 0, true).enabled, false);
  const f = fixture(); f.latest.deadlineAt = date(2_000); f.streamConfig.encoderLeaseUntil = date(1_000);
  assert.equal(catalogueTestListeningSnapshot(f).expiresInMs, 1_000);
  assert.equal(catalogueTestPlayerView({ ...snapshot, track: { ...snapshot.track, expiresInMs: 500 } }, 501).track, null);
  assert.equal(catalogueTestPlayerView({ ...snapshot, listenerUrl: "https://other.example/stream" }, 0).enabled, false);
});

test("manual owner player does not start, publish, autoplay, collect proof of play or fall back to HTTP", async () => {
  const ui = await readFile(new URL("../app/admin/stations/[stationId]/setup/CatalogueTestPlayer.js", import.meta.url), "utf8");
  const parent = await readFile(new URL("../app/admin/stations/[stationId]/setup/CatalogueStreamTest.js", import.meta.url), "utf8");
  assert.match(ui, /controls preload="none" src=\{view\.listenerUrl\}/);
  assert.match(ui, /view\.enabled &&/);
  assert.match(ui, /performance\.now\(\)/);
  assert.match(ui, /visibilitychange/);
  assert.match(ui, /Music sent to Streamerr/);
  assert.match(ui, /press Play to check the sound/);
  assert.match(parent, /not proof that a listener heard/);
  assert.match(ui, /rel="noopener noreferrer"/);
  assert.doesNotMatch(ui, /autoPlay|\.play\(|\bfetch\(|http:\/\/|sendEvent|mediaSession|navigator\.mediaDevices/);
  assert.match(parent, /<CatalogueTestPlayer snapshot=\{state\.listening\} refreshError=\{error\}/);
});

test("real owner component renders only the secure manual player and hides it for inactive or failed status", async () => {
  const require = createRequire(import.meta.url), React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const babel = require("next/dist/compiled/babel/core");
  const filename = "app/admin/stations/[stationId]/setup/CatalogueTestPlayer.js";
  const source = await readFile(new URL(`../${filename}`, import.meta.url), "utf8");
  const code = babel.transformSync(source, { filename, babelrc: false, configFile: false, envName: "test", presets: [require.resolve("next/babel")] }).code;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, fetch: () => { throw new Error("PLAYER_MUST_NOT_FETCH"); },
    require: name => name === "@/lib/catalogue-test-player.mjs" ? { catalogueTestPlayerView, replaceCatalogueTestAudio } : require(name.startsWith("@babel/runtime/") ? `next/dist/compiled/${name}` : name) });
  const Player = module.exports.default, f = fixture();
  f.latest.plan.items[0].title = '<img src=x onerror="alert(1)">';
  const snapshot = catalogueTestListeningSnapshot(f);
  const html = renderToStaticMarkup(React.createElement(Player, { snapshot }));
  assert.match(html, /<audio[^>]+controls=""[^>]+preload="none"[^>]+src="https:\/\/ruvanastestradio-radio105network\.radioca\.st\/stream"/);
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.doesNotMatch(html, /<img|autoplay|http:\/\/|download=/i);
  for (const props of [{ snapshot, refreshError: "status failed" }, { snapshot: { ...snapshot, enabled: false } }, { snapshot: null }]) {
    const stopped = renderToStaticMarkup(React.createElement(Player, props));
    assert.doesNotMatch(stopped, /<audio|href="https:/);
    assert.match(stopped, /No current source-track title is confirmed/);
  }
});

test("audio ref detach and replacement stop the previous media before clearing it, without auto-playing a new node", () => {
  const calls = [];
  const element = name => ({ pause() { calls.push([name, "pause"]); }, removeAttribute(key) { calls.push([name, "removeAttribute", key]); },
    load() { calls.push([name, "load"]); }, play() { throw new Error("UNEXPECTED_AUTOPLAY"); } });
  const first = element("first"), second = element("second"), ref = { current: null };
  replaceCatalogueTestAudio(ref, first); assert.equal(ref.current, first); assert.deepEqual(calls, []);
  replaceCatalogueTestAudio(ref, first); assert.deepEqual(calls, [], "Normal re-render never interrupts existing audio");
  replaceCatalogueTestAudio(ref, second);
  assert.deepEqual(calls, [["first", "pause"], ["first", "removeAttribute", "src"], ["first", "load"]]);
  assert.equal(ref.current, second);
  replaceCatalogueTestAudio(ref, null);
  assert.equal(ref.current, null);
  assert.deepEqual(calls.slice(3), [["second", "pause"], ["second", "removeAttribute", "src"], ["second", "load"]]);
  replaceCatalogueTestAudio(ref, null); assert.equal(calls.length, 6);
  ref.current = { pause() { throw new Error("already gone"); }, removeAttribute() { calls.push("released"); }, load() { calls.push("reset"); } };
  replaceCatalogueTestAudio(ref, null);
  assert.deepEqual(calls.slice(-2), ["released", "reset"], "A failed pause does not retain the stream URL");
});

test("phase titles require a matching actual send event in the authorized diagnostic, never an elapsed clock guess", () => {
  const f = fixture();
  f.latest.authorization = { testMode: HANDOVER_TEST_MODE };
  f.latest.plan.testMode = HANDOVER_TEST_MODE;
  f.latest.events[1].details.phase = "AUTODJ";
  assert.equal(catalogueTestListeningSnapshot(f).track.phase, "Random AutoDJ sample");
  for (const phase of [undefined, "SCHEDULED", "UNKNOWN"]) {
    f.latest.events[1].details.phase = phase;
    assert.equal(catalogueTestListeningSnapshot(f).track.phase, undefined);
  }
  f.latest.events[1].details.phase = "AUTODJ"; delete f.latest.authorization.testMode;
  assert.equal(catalogueTestListeningSnapshot(f).track.phase, undefined);
  assert.equal(catalogueTestMode(HANDOVER_TEST_MODE, "FIVE_MINUTES").audioDurationSeconds, 90);
  assert.equal(catalogueTestMode(HANDOVER_TEST_MODE, "ONE_HOUR"), null);
  assert.equal(catalogueTestMode(undefined, "ONE_HOUR").id, "STANDARD");
});
