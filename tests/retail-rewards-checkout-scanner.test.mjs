import test from "node:test";
import assert from "node:assert/strict";
import { checkoutQrPayload } from "../lib/retail-rewards/checkout-qr.mjs";
import { createCheckoutScanner, scannerStatusMessage, SCANNER_INTERVAL_MS, SCANNER_TIMEOUT_MS } from "../lib/retail-rewards/checkout-scanner.mjs";

const TOKEN = "ab".repeat(32);
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function events() {
  const listeners = new Map(); return { hidden: false, listeners,
    addEventListener(name, fn) { listeners.set(name, fn); }, removeEventListener(name, fn) { if (listeners.get(name) === fn) listeners.delete(name); },
    fire(name) { listeners.get(name)?.(); } };
}
function fixture(patch = {}) {
  let timerId = 0;
  const f = { requests: [], states: [], tokens: [], stopped: 0, paused: 0, frames: [], timers: new Map(), decoded: [], document: events(), window: events(), result: null };
  f.track = { stop: () => { f.stopped++; } }; f.stream = { getTracks: () => [f.track] };
  f.video = { videoWidth: 1920, videoHeight: 1080, readyState: 2, srcObject: null, play: async () => {}, pause: () => { f.paused++; } };
  f.context = { drawImage: (...args) => f.frames.push(args.slice(1)), getImageData: (_x, _y, width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }) };
  f.canvas = { width: 0, height: 0, getContext: () => f.context };
  f.controller = createCheckoutScanner({ video: f.video, canvas: f.canvas, mediaDevices: { getUserMedia: async constraints => { f.requests.push(constraints); return f.stream; } },
    decode: (...args) => { f.decoded.push(args.slice(1)); return f.result; }, documentTarget: f.document, windowTarget: f.window,
    setTimeoutFn: (fn, ms) => { const id = ++timerId; f.timers.set(id, { fn, ms }); return id; }, clearTimeoutFn: id => f.timers.delete(id),
    onState: state => f.states.push(state), onToken: token => { assert.equal(f.video.srcObject, null); assert.ok(f.stopped > 0); f.tokens.push(token); }, ...patch });
  f.tick = async ms => { const entry = [...f.timers].find(([, timer]) => timer.ms === ms); assert.ok(entry, `Missing ${ms}ms timer`);
    f.timers.delete(entry[0]); return entry[1].fn(); };
  return f;
}

test("construction never requests a camera; explicit start is video-only and duplicate start is ignored", async () => {
  const f = fixture(); assert.equal(f.requests.length, 0);
  assert.equal(await f.controller.start(), true); assert.equal(await f.controller.start(), false); assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].audio, false); assert.equal(f.requests[0].video.facingMode.ideal, "environment");
  assert.deepEqual(f.states, ["STARTING", "SCANNING"]); f.controller.dispose();
});
test("frames are bounded to 640px and spaced at least 250ms; arbitrary QR content never reaches a token callback", async () => {
  const f = fixture(); await f.controller.start(); f.result = { data: `https://example.invalid/${TOKEN}` };
  await f.tick(SCANNER_INTERVAL_MS);
  assert.deepEqual(f.frames[0], [0, 0, 640, 360]); assert.equal(f.canvas.width * f.canvas.height, 230400);
  assert.equal(f.decoded[0][0], 640); assert.equal(f.decoded[0][1], 360);
  assert.equal(f.tokens.length, 0); assert.equal(f.states.at(-1), "INVALID_CODE");
  assert.equal([...f.timers.values()].filter(t => t.ms === 250).length, 1); f.controller.dispose();
});
test("success stops camera and wipes frame before returning exactly one parsed token", async () => {
  const f = fixture(); await f.controller.start(); f.result = { data: checkoutQrPayload(TOKEN) };
  await f.tick(250); assert.deepEqual(f.tokens, [TOKEN]); assert.equal(f.states.at(-1), "SUCCESS");
  assert.equal(f.stopped, 1); assert.equal(f.canvas.width, 0); assert.equal(f.canvas.height, 0); assert.equal(f.timers.size, 0);
  f.controller.dispose(); assert.equal(f.stopped, 1);
});
test("cancel, hidden, pagehide and dispose release tracks, pixels and all pending timers", async () => {
  for (const action of ["cancel", "hidden", "pagehide", "dispose"]) {
    const f = fixture(); await f.controller.start();
    if (action === "cancel") f.controller.stop();
    if (action === "hidden") { f.document.hidden = true; f.document.fire("visibilitychange"); }
    if (action === "pagehide") f.window.fire("pagehide");
    if (action === "dispose") f.controller.dispose();
    assert.equal(f.stopped, 1); assert.equal(f.video.srcObject, null); assert.equal(f.canvas.width, 0); assert.equal(f.timers.size, 0); assert.equal(f.tokens.length, 0);
    f.controller.dispose(); assert.equal(f.document.listeners.size, 0); assert.equal(f.window.listeners.size, 0); assert.equal(await f.controller.start(), false);
  }
});
test("a late camera permission resolution after cancellation or timeout cannot reactivate the camera", async () => {
  for (const action of ["cancel", "timeout", "dispose"]) {
    const pending = deferred(); const f = fixture({ mediaDevices: { getUserMedia: () => pending.promise } });
    const started = f.controller.start();
    if (action === "cancel") f.controller.stop();
    if (action === "timeout") await f.tick(SCANNER_TIMEOUT_MS);
    if (action === "dispose") f.controller.dispose();
    pending.resolve(f.stream); assert.equal(await started, false); assert.equal(f.stopped, 1); assert.equal(f.video.srcObject, null);
    assert.equal(f.timers.size, 0); assert.equal(f.tokens.length, 0);
    if (action === "timeout") assert.equal(f.states.at(-1), "TIMEOUT"); f.controller.dispose();
  }
});
test("late decode and play completions after stop cannot publish a code or restart frame work", async () => {
  const decode = deferred(), f = fixture({ decode: () => decode.promise }); await f.controller.start();
  const frame = f.tick(250); f.controller.stop(); decode.resolve({ data: checkoutQrPayload(TOKEN) }); await frame;
  assert.equal(f.tokens.length, 0); assert.equal(f.timers.size, 0); f.controller.dispose();
  const play = deferred(), g = fixture(); g.video.play = () => play.promise;
  const started = g.controller.start(); await Promise.resolve(); g.controller.stop(); play.resolve();
  assert.equal(await started, false); assert.equal(g.timers.size, 0); assert.equal(g.stopped, 1); g.controller.dispose();
});
test("an old permission result cannot stop or replace a newer active camera", async () => {
  const old = deferred(), fresh = deferred(); let calls = 0;
  const f = fixture({ mediaDevices: { getUserMedia: () => (++calls === 1 ? old.promise : fresh.promise) } });
  const first = f.controller.start(); f.controller.stop(); const second = f.controller.start(); fresh.resolve(f.stream); await second;
  let oldStops = 0; old.resolve({ getTracks: () => [{ stop: () => { oldStops++; } }] });
  assert.equal(await first, false); assert.equal(oldStops, 1); assert.equal(f.stopped, 0); assert.equal(f.video.srcObject, f.stream); f.controller.dispose();
});
test("camera errors are safe fixed statuses and all failures retain manual fallback", async () => {
  for (const [name, code] of [["NotAllowedError", "DENIED"], ["NotFoundError", "NO_CAMERA"], ["Unexpected private diagnostic", "ERROR"]]) {
    const f = fixture({ mediaDevices: { getUserMedia: async () => { throw { name, message: TOKEN }; } } });
    assert.equal(await f.controller.start(), false); assert.equal(f.states.at(-1), code); assert.equal(f.timers.size, 0);
    assert.ok(!scannerStatusMessage(code).includes(TOKEN)); f.controller.dispose();
  }
  const f = fixture({ mediaDevices: null }); assert.equal(await f.controller.start(), false); assert.equal(f.states.at(-1), "UNSUPPORTED"); f.controller.dispose();
});
test("decode errors stop the camera and no hidden-page start requests permission", async () => {
  const f = fixture({ decode: () => { throw new Error(TOKEN); } }); await f.controller.start(); await f.tick(250);
  assert.equal(f.states.at(-1), "ERROR"); assert.equal(f.stopped, 1); assert.equal(f.tokens.length, 0); f.controller.dispose();
  const g = fixture(); g.document.hidden = true; assert.equal(await g.controller.start(), false); assert.equal(g.requests.length, 0); g.controller.dispose();
});
