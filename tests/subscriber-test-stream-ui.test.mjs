import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import vm from "node:vm";
import * as ui from "../lib/subscriber-test-stream-ui.mjs";
import * as queue from "../lib/playback-queue.mjs";
import * as drain from "../lib/playback-proof-drain.mjs";

const require = createRequire(import.meta.url), React = require("react");
const babel = require("next/dist/compiled/babel/core");
const NOW = new Date("2026-11-01T09:00:00Z");
const fixture = () => ({ player: { id: "c000000000000000000000001", name: "Shop tablet", location: "Main shop", zone: "Shop floor" },
  heartbeatIntervalSeconds: 30, subscriberTestStream: { kind: "RETAIL_SHARED_STREAM", stationId: "cmvmg7rp1000flf2kelb1kzax", channelId: "c000000000000000000000002",
    streamUrl: "https://ruvanastestretail-radio105network.radioca.st/stream", name: "Retail radio", expiresAt: "2099-11-23T00:00:00Z" } });
const audio = (overrides = {}) => ({ currentTime: 12, paused: false, ended: false, muted: false, volume: 1, readyState: 3, error: null, ...overrides });
const nodes = tree => !tree || typeof tree !== "object" ? [] : [tree, ...React.Children.toArray(tree.props?.children).flatMap(nodes)];
const text = tree => typeof tree === "string" || typeof tree === "number" ? String(tree) : React.Children.toArray(tree?.props?.children).map(text).join("");

test("dedicated Test Retail stream rejects other origins, channels, expired access and file media", () => {
  const state = fixture(); assert.equal(ui.subscriberTestStreamData(state, NOW.getTime()).streamUrl, state.subscriberTestStream.streamUrl);
  for (const change of [
    stream => { stream.streamUrl = "https://ruvanastestradio-radio105network.radioca.st/stream"; },
    stream => { stream.streamUrl += "?password=anything"; },
    stream => { stream.streamUrl = "http://ruvanastestretail-radio105network.radioca.st/stream"; },
    stream => { stream.streamUrl = "/api/player/media/private"; },
    stream => { stream.kind = "ARBITRARY_STREAM"; },
    stream => { stream.stationId = "cmvcnbwi20008hr23sd76psi8"; },
    stream => { stream.channelId = "not-a-channel"; },
    stream => { stream.expiresAt = NOW.toISOString(); }
  ]) { const wrong = fixture(); change(wrong.subscriberTestStream); assert.equal(ui.subscriberTestStreamData(wrong, NOW.getTime()), null); }
});

test("source diagnostics require real browser playback or progress, not network connectivity", () => {
  assert.equal(ui.subscriberStreamObservation(audio(), "playing", null, NOW).sourceStatus, "CONNECTED");
  assert.equal(ui.subscriberStreamObservation(audio(), "progress", 10, NOW).state, "PLAYING");
  assert.equal(ui.subscriberStreamObservation(audio(), "progress", 12, NOW).sourceStatus, "DEGRADED");
  for (const item of [audio({ muted: true }), audio({ volume: 0 }), audio({ paused: true }), audio({ ended: true }), audio({ readyState: 1 })]) {
    assert.notEqual(ui.subscriberStreamObservation(item, "playing", null, NOW).state, "PLAYING");
  }
  assert.equal(ui.subscriberStreamObservation(audio(), "volumechange", 10, NOW).state, "PAUSED");
  assert.equal(ui.subscriberStreamObservation(audio(), "pause", null, NOW).sourceStatus, "DISCONNECTED");
  assert.equal(ui.subscriberStreamObservation(audio(), "waiting", null, NOW).sourceStatus, "DEGRADED");
  assert.equal(ui.subscriberStreamObservation(audio({ error: {} }), "error", null, NOW).state, "FAILED");
  const evidence = ui.subscriberStreamEvidence(ui.subscriberStreamObservation(audio(), "playing", null, NOW));
  assert.deepEqual(evidence, { state: "PLAYING", positionSeconds: 12, observedAt: NOW.toISOString() });
  assert.doesNotMatch(JSON.stringify(evidence), /track|proofToken|schedule|mediaUrl|CONNECTED/);
});

async function harness(fetch, onAccessBlocked = () => {}) {
  const slots = [], scheduled = new Map(); let cursor = 0, effects = [], timer = 0;
  const hooks = { ...React, useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial; return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }]; },
    useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; }, useCallback: fn => fn, useEffect: fn => { effects.push(fn); } };
  const source = await readFile(new URL("../app/player/SubscriberTestStreamPlayer.js", import.meta.url), "utf8");
  const code = babel.transformSync(source, { filename: "SubscriberTestStreamPlayer.js", babelrc: false, configFile: false, envName: "test", presets: [require.resolve("next/babel")] }).code;
  const module = { exports: {} }, setTimer = (fn, ms) => { const id = ++timer; scheduled.set(id, { fn, ms }); return id; }, clearTimer = id => scheduled.delete(id);
  vm.runInNewContext(code, { module, exports: module.exports, fetch, AbortController, Date,
    setTimeout: setTimer, clearTimeout: clearTimer, setInterval: setTimer, clearInterval: clearTimer,
    window: { addEventListener() {}, removeEventListener() {} }, require: name => {
      if (name === "react") return hooks;
      if (name === "@/lib/subscriber-test-stream-ui.mjs") return ui;
      return require(name.startsWith("@babel/runtime/") ? `next/dist/compiled/${name}` : name);
    } });
  const props = { initialState: fixture(), requestHeaders: headers => ({ ...headers, "X-Ruvanas-Player-Instance": "device-instance" }), onAccessBlocked };
  let cleanup;
  return { scheduled, render() { cursor = 0; effects = []; return module.exports.default(props); }, async mount(element) {
    const tree = this.render(); nodes(tree).find(node => node.type === "audio").ref.current = element;
    cleanup = effects[0](); await new Promise(setImmediate); return this.render();
  }, async run(ms) { const entry = [...scheduled].find(([, entry]) => entry.ms === ms); assert.ok(entry, `timer ${ms} exists`); await entry[1].fn(); await new Promise(setImmediate); }, unmount() { cleanup?.(); } };
}

test("shop audio reports playing, pause and error without generating song proof", async () => {
  const calls = [], element = audio({ paused: true, pause() { this.paused = true; }, removeAttribute() {}, load() {} });
  const h = await harness(async (url, options = {}) => { calls.push({ url, options, body: options.body && JSON.parse(options.body) }); return { ok: true, status: 200, json: async () => url === "/api/player/state" ? fixture() : { ok: true } }; });
  let tree = await h.mount(element);
  assert.equal(nodes(tree).find(node => node.type === "audio").props.autoPlay, undefined);
  assert.equal(calls[0].body.sourceStatus, "DISCONNECTED");
  element.paused = false; nodes(tree).find(node => node.type === "audio").props.onPlaying({ currentTarget: element }); await h.run(250);
  tree = h.render(); assert.match(text(tree), /Audio is playing in this browser/);
  assert.ok(calls.some(call => call.url === "/api/player/stream-evidence" && call.body?.state === "PLAYING"));
  assert.ok(calls.some(call => call.url === "/api/player/heartbeat" && call.body?.sourceStatus === "CONNECTED"));
  element.paused = true; nodes(tree).find(node => node.type === "audio").props.onPause({ currentTarget: element }); await h.run(250);
  assert.equal(calls.at(-1).body.state, "PAUSED");
  nodes(h.render()).find(node => node.type === "audio").props.onError({ currentTarget: element }); await h.run(250);
  assert.equal(calls.at(-1).body.state, "FAILED");
  assert.ok(calls.every(call => ["/api/player/heartbeat", "/api/player/stream-evidence"].includes(call.url)));
  assert.doesNotMatch(JSON.stringify(calls), /proof-of-play|trackId|mediaAssetId|manifestVersion":"[^"]/);
  h.unmount(); assert.equal(calls.at(-1).options.method, "DELETE"); assert.equal(element.paused, true);
});

test("lease denial stops this browser, removes stream source and reports no successful audio", async () => {
  let denied = false, removed = false, notice;
  const element = audio({ pause() { this.paused = true; }, removeAttribute(name) { removed = name === "src"; }, load() {} });
  const h = await harness(async url => ({ ok: !(denied && url === "/api/player/state"), status: denied && url === "/api/player/state" ? 409 : 200,
    json: async () => denied && url === "/api/player/state" ? { error: "Device in use", code: "PLAYER_DEVICE_IN_USE" } : { ok: true } }), data => { notice = data; });
  await h.mount(element); denied = true; await h.run(30_000);
  assert.equal(element.paused, true); assert.equal(removed, true); assert.equal(notice.code, "PLAYER_DEVICE_IN_USE");
  assert.equal(nodes(h.render()).find(node => node.type === "audio"), undefined);
  assert.match(text(h.render()), /Playback on this device is stopped/);
  h.unmount();
});

test("player page chooses the isolated stream branch without manifest or proof writes; ordinary players retain their manifest", async () => {
  const source = await readFile(new URL("../app/player/page.js", import.meta.url), "utf8");
  const code = babel.transformSync(source, { filename: "player-page.js", babelrc: false, configFile: false, envName: "test", presets: [require.resolve("next/babel")] }).code;
  for (const retail of [true, false]) {
    const slots = [], calls = []; let cursor = 0, effects = [];
    const hooks = { ...React,
      useState(initial) { const at = cursor++; if (!(at in slots)) slots[at] = typeof initial === "function" ? initial() : initial; return [slots[at], value => { slots[at] = typeof value === "function" ? value(slots[at]) : value; }]; },
      useRef(initial) { const at = cursor++; if (!(at in slots)) slots[at] = { current: initial }; return slots[at]; },
      useCallback(fn, deps) { const at = cursor++, old = slots[at]; if (!old || deps.some((v, i) => v !== old.deps[i])) slots[at] = { fn, deps }; return slots[at].fn; },
      useEffect(fn, deps) { const at = cursor++, old = slots[at]; if (!old || deps.some((v, i) => v !== old[i])) effects.push(fn); slots[at] = deps; }
    };
    const module = { exports: {} }, state = fixture(); if (!retail) { delete state.subscriberTestStream; state.channel = { name: "Existing ordinary channel", streamUrl: "https://ordinary.example/stream" }; }
    function RetailBranch() {} function LiveBranch() {}
    vm.runInNewContext(code, { module, exports: module.exports,
      fetch: async (url, options = {}) => { calls.push({ url, options }); return { status: 200, ok: true, json: async () => url === "/api/player/state" ? state : url === "/api/player/manifest" ? { playlist: [], insertions: [], refreshAfterSeconds: 30, version: "ordinary-manifest" } : {} }; },
      crypto: { randomUUID: () => "instance-id" }, navigator: { onLine: true },
      window: { sessionStorage: { getItem: () => null, setItem() {} }, localStorage: { getItem: () => "[]", setItem() {} }, addEventListener() {}, removeEventListener() {}, setInterval() { return 1; }, clearInterval() {}, setTimeout() { return 2; }, clearTimeout() {} },
      require: name => {
        if (name === "react") return hooks;
        if (name === "@/lib/playback-queue.mjs") return queue;
        if (name === "@/lib/playback-proof-drain.mjs") return drain;
        if (name === "./SubscriberTestStreamPlayer") return { __esModule: true, default: RetailBranch };
        if (name === "./LiveChannelPlayer") return { __esModule: true, default: LiveBranch };
        return require(name.startsWith("@babel/runtime/") ? `next/dist/compiled/${name}` : name);
      } });
    const render = () => { cursor = 0; effects = []; return module.exports.default(); };
    render(); for (const effect of effects) effect(); await new Promise(setImmediate);
    const tree = render(); for (const effect of effects) effect(); await new Promise(setImmediate);
    if (retail) {
      assert.equal(tree.type, RetailBranch); assert.deepEqual(calls.map(call => call.url), ["/api/player/state"]);
      assert.equal(tree.props.initialState.player.id, state.player.id);
    } else {
      assert.ok(calls.some(call => call.url === "/api/player/manifest"));
      assert.ok(calls.some(call => call.url === "/api/player/heartbeat"));
      assert.equal(nodes(tree).find(node => node.type === "audio").props.src, "https://ordinary.example/stream");
    }
  }
});
