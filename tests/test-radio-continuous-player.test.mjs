import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import vm from "node:vm";
import { CONTINUOUS_TEST_RADIO_ID, continuousRadioPlayerView, continuousRadioStartBody, replaceContinuousRadioAudio } from "../lib/test-radio-continuous-player.mjs";
import { TEST_RADIO_LISTENER_URL } from "../lib/catalogue-test-player.mjs";

function fixture() {
  return { stationId: CONTINUOUS_TEST_RADIO_ID, enabled: true, sourceReady: true, startAllowed: true, status: "STREAMING",
    worker: { ready: true }, listening: { enabled: true, listenerUrl: TEST_RADIO_LISTENER_URL, expiresInMs: 15_000,
      track: { title: "A real catalogue song", artist: "A real artist", sourceStartedAt: "2026-10-23T12:00:00Z", expiresInMs: 120_000 } } };
}

test("continuous controls cannot mistake enabled authorization for confirmed streaming", () => {
  for (const status of ["WAITING_FOR_WORKER", "STARTING", "STOPPING", "NEEDS_ATTENTION", "UNKNOWN"]) {
    const view = continuousRadioPlayerView({ ...fixture(), status });
    assert.equal(view.enabled, false, status); assert.equal(view.track, null, status);
  }
  for (const change of [f => { f.enabled = false; }, f => { f.worker.ready = false; }, f => { f.attentionRequired = true; },
    f => { f.sourceReady = false; }, f => { f.listening.enabled = false; }, f => { f.stationId = "another-station"; }]) {
    const f = fixture(); change(f);
    const view = continuousRadioPlayerView(f);
    assert.equal(view.enabled, false); assert.equal(view.listenerUrl, null); assert.equal(view.track, null);
  }
  assert.match(continuousRadioPlayerView({ ...fixture(), status: "WAITING_FOR_WORKER" }).label, /enabled.*no fresh worker/);
  assert.match(continuousRadioPlayerView({ ...fixture(), status: "STOPPING", enabled: false }).label, /waiting.*shutdown/);
  assert.match(continuousRadioPlayerView(fixture(), 0, true).label, /may still be running/);
});

test("manual player uses only Test Radio's exact secure listener and expires independently of another poll", () => {
  const f = fixture();
  assert.equal(continuousRadioPlayerView(f, 14_999).enabled, true);
  for (const elapsed of [15_000, 60_000, NaN, Infinity, -1]) {
    const view = continuousRadioPlayerView(f, elapsed);
    assert.equal(view.enabled, false); assert.equal(view.track, null); assert.equal(view.listenerUrl, null);
  }
  f.listening.expiresInMs = 999_999;
  assert.equal(continuousRadioPlayerView(f, 15_000).enabled, false, "Backend cannot prolong a cached browser view beyond 15 seconds");
  assert.equal(continuousRadioPlayerView({ ...f, requestAgeMs: 15_000 }, 0).enabled, false, "A delayed response cannot revive an old player");
  assert.equal(continuousRadioPlayerView({ ...f, requestAgeMs: 5_000 }, 10_000).enabled, false);
  for (const requestAgeMs of [NaN, Infinity, -1]) assert.equal(continuousRadioPlayerView({ ...f, requestAgeMs }, 0).enabled, false);
  for (const url of ["http://pollux.shoutca.st:8282/stream", TEST_RADIO_LISTENER_URL + "?secret=value", TEST_RADIO_LISTENER_URL + "#fragment",
    TEST_RADIO_LISTENER_URL.replace("ruvanastestradio", "otherchannel"), "https://user:password@ruvanastestradio-radio105network.radioca.st/stream", null]) {
    f.listening.listenerUrl = url;
    assert.equal(continuousRadioPlayerView(f).enabled, false);
  }
});

test("titles require explicit observed source start and bounded freshness, never a playlist clock guess", () => {
  const f = fixture();
  assert.deepEqual(continuousRadioPlayerView(f).track, { title: "A real catalogue song", artist: "A real artist", sourceStartedAt: "2026-10-23T12:00:00Z" });
  for (const change of [f => { delete f.listening.track; }, f => { f.listening.track.sourceStartedAt = "invalid"; },
    f => { delete f.listening.track.sourceStartedAt; }, f => { f.listening.track.expiresInMs = 0; }, f => { f.listening.track.expiresInMs = NaN; }]) {
    const f = fixture(); change(f);
    assert.equal(continuousRadioPlayerView(f).track, null);
  }
  f.listening.track.expiresInMs = 500;
  assert.equal(continuousRadioPlayerView(f, 501).enabled, true);
  assert.equal(continuousRadioPlayerView(f, 501).track, null);
  f.listening.track.expiresInMs = 1_000;
  f.listening.track.title = "x".repeat(500); f.listening.track.artist = "A\u0000\nB";
  f.listening.track.storageKey = "secret-key"; f.listening.track.token = "secret-token";
  const view = continuousRadioPlayerView(f);
  assert.equal(view.track.title.length, 240); assert.equal(view.track.artist, "A  B");
  assert.doesNotMatch(JSON.stringify(view), /secret-key|secret-token/);
});

test("start requests require explicit public exposure acceptance and cannot widen the monthly budget", () => {
  for (const value of [false, undefined, null, 1, "true", {}]) assert.equal(continuousRadioStartBody(value), null);
  assert.deepEqual(continuousRadioStartBody(true), { action: "start", publicExposureAccepted: true, monthlyBudgetUsd: 15 });
});

test("audio removal releases the old stream without playing a new one", () => {
  const calls = [], old = { pause: () => calls.push("pause"), removeAttribute: key => calls.push(key), load: () => calls.push("load") };
  const ref = { current: old };
  replaceContinuousRadioAudio(ref, old); assert.deepEqual(calls, []);
  replaceContinuousRadioAudio(ref, null); assert.deepEqual(calls, ["pause", "src", "load"]); assert.equal(ref.current, null);
});

test("real continuous player escapes titles, has no autoplay and disappears on status failure or worker pause", async () => {
  const require = createRequire(import.meta.url), React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server"), babel = require("next/dist/compiled/babel/core");
  const filename = "app/admin/stations/[stationId]/setup/ContinuousAutoDj.js";
  const source = await readFile(new URL(`../${filename}`, import.meta.url), "utf8");
  const code = babel.transformSync(source, { filename, babelrc: false, configFile: false, envName: "test", presets: [require.resolve("next/babel")] }).code;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports,
    require: name => name === "@/lib/test-radio-continuous-player.mjs" ? { continuousRadioPlayerView, continuousRadioStartBody, replaceContinuousRadioAudio } : require(name.startsWith("@babel/runtime/") ? `next/dist/compiled/${name}` : name) });
  const Player = module.exports.ContinuousRadioListening, f = fixture();
  f.listening.track.title = '<img src=x onerror="alert(1)">';
  const html = renderToStaticMarkup(React.createElement(Player, { snapshot: f }));
  assert.match(html, /<audio[^>]+controls=""[^>]+preload="none"[^>]+src="https:\/\/ruvanastestradio-radio105network\.radioca\.st\/stream"/);
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.doesNotMatch(html, /<img|autoplay|http:\/\/|download=/i);
  for (const props of [{ snapshot: f, refreshError: "failed" }, { snapshot: { ...f, worker: { ready: false } } }, { snapshot: null }]) {
    const stopped = renderToStaticMarkup(React.createElement(Player, props));
    assert.doesNotMatch(stopped, /<audio|href="https:/);
    assert.match(stopped, /No current source-track title is confirmed/);
  }
  assert.match(source, /performance\.now\(\)/); assert.match(source, /visibilitychange/);
  assert.match(source, /commandInFlight\.current/); assert.match(source, /refreshSequence\.current/);
  assert.match(source, /Current service permission expires:/);
  assert.match(source, /AutoDJ will stop if this permission is not renewed/);
  assert.doesNotMatch(source, /autoPlay|\.play\(|http:\/\/|navigator\.mediaDevices|mediaSession|sendEvent/);
  const shell = renderToStaticMarkup(React.createElement(module.exports.default, { stationId: CONTINUOUS_TEST_RADIO_ID }));
  assert.match(shell, /Approved allowance: US\$15 per month/);
  assert.match(shell, /Stop AutoDJ<\/button>/);
  assert.match(shell, /monthly allowance is not a Render billing cap/);
});

test("setup exposes continuous controls only for Test Radio and labels bounded diagnostics separately", async () => {
  const page = await readFile(new URL("../app/admin/stations/[stationId]/setup/page.js", import.meta.url), "utf8");
  assert.match(page, /station\.id === "cmvcnbwi20008hr23sd76psi8"[\s\S]*<ContinuousAutoDj stationId=\{station\.id\}/);
  assert.ok(page.indexOf("<ContinuousAutoDj") < page.indexOf("<AdminStationSetupForm"), "Manual Stop remains above connection settings");
  assert.match(page, /Advanced diagnostics — timed tests, not continuous AutoDJ/);
});

test("real setup page renders the Stop panel before connection settings and leaves other station pages unchanged", async () => {
  const require = createRequire(import.meta.url), React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server"), babel = require("next/dist/compiled/babel/core");
  const filename = "app/admin/stations/[stationId]/setup/page.js";
  const source = await readFile(new URL(`../${filename}`, import.meta.url), "utf8");
  const code = babel.transformSync(source, { filename, babelrc: false, configFile: false, envName: "test", presets: [require.resolve("next/babel")] }).code;
  let stationId = CONTINUOUS_TEST_RADIO_ID;
  const prisma = { station: { findUnique: async () => ({ id: stationId, name: "Station", status: "PENDING_SETUP", productFamily: "ONLINE", organisationId: "organisation" }) },
    channel: { findMany: async () => [] }, studioBroadcastDestination: { findMany: async () => [] }, externalLiveSource: { findMany: async () => [] } };
  const components = { "./AdminStationSetupForm": () => React.createElement("div", null, "Existing connection settings"),
    "./AdminStreamingProfiles": () => React.createElement("div", null, "Existing destination settings"),
    "./CatalogueStreamTest": () => React.createElement("div", null, "Bounded diagnostic controls"),
    "./ContinuousAutoDj": () => React.createElement("div", null, "Continuous Start and Stop controls") };
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require: name => {
    if (name === "@/lib/prisma") return { prisma };
    if (name === "@/lib/requireAdmin") return { getAdminUser: async () => ({ role: "SUPER_ADMIN" }) };
    if (name === "next/navigation") return { redirect: () => { throw new Error("UNEXPECTED_REDIRECT"); }, notFound: () => { throw new Error("UNEXPECTED_NOT_FOUND"); } };
    if (components[name]) return components[name];
    return require(name.startsWith("@babel/runtime/") ? `next/dist/compiled/${name}` : name);
  } });
  const render = async () => renderToStaticMarkup(await module.exports.default({ params: Promise.resolve({ stationId }) }));
  const testRadio = await render();
  assert.ok(testRadio.indexOf("Continuous Start and Stop controls") < testRadio.indexOf("Existing connection settings"));
  assert.match(testRadio, /Bounded diagnostic controls/);
  stationId = "another-existing-station";
  const other = await render();
  assert.match(other, /Existing connection settings/); assert.match(other, /Existing destination settings/);
  assert.doesNotMatch(other, /Continuous Start|Bounded diagnostic|Advanced diagnostics/);
});
