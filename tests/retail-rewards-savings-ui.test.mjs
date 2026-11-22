import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import * as contracts from "../lib/retail-rewards/shopper-savings-contracts.mjs";
import * as shopper from "../lib/retail-rewards/shopper-ui.mjs";
import * as checkout from "../lib/retail-rewards/checkout-ui.mjs";
import { createShopperMobilePreview } from "./fixtures/shopper-mobile-preview.mjs";

const require = createRequire(import.meta.url), React = require("react"), babel = require("next/dist/compiled/babel/core");
const css = { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) };
function compile(file) { return babel.transformSync(readFileSync(new URL(`../app/rewards/${file}`, import.meta.url), "utf8"), {
  filename: file, babelrc: false, configFile: false, envName: "test", presets: [require.resolve("next/babel")]
}).code; }
const chromeCode = compile("ShopperChrome.js"), componentCode = compile("ShopperSavingsClient.js");
function evaluate(code, mocks) {
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, Intl, AbortController, setTimeout, clearTimeout,
    require(name) { if (Object.hasOwn(mocks, name)) return mocks[name];
      if (name.startsWith("react/jsx-")) return require(name);
      if (name.startsWith("@babel/runtime/")) return require(`next/dist/compiled/${name}`);
      throw new Error(`Unexpected UI dependency ${name}`); },
    fetch() { throw new Error("No network allowed in UI tests"); }
  }); return module.exports;
}
const chrome = evaluate(chromeCode, { react: React, "./shopper-discovery.module.css": css });
const mocks = { "@/lib/retail-rewards/shopper-savings-contracts.mjs": contracts,
  "@/lib/retail-rewards/shopper-ui.mjs": shopper, "@/lib/retail-rewards/checkout-ui.mjs": checkout,
  "./ShopperChrome": chrome, "./shopper-discovery.module.css": css, "./shopper-savings.module.css": css };
const NOW = "2026-11-22T12:00:00.000Z";
function fixture(mode = "positive") {
  const preview = createShopperMobilePreview({ clock: () => new Date(NOW), delayMs: 0 });
  preview.state.savingsMode = mode; return preview.initialSavings();
}
function children(tree) { return tree && typeof tree.type === "function" ? tree.type(tree.props) : tree?.props?.children; }
function nodes(tree) { return Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === "object" && tree.props ? [tree, ...nodes(children(tree))] : []; }
function text(tree) { return Array.isArray(tree) ? tree.map(text).join("") : tree && typeof tree === "object" ? text(children(tree)) : typeof tree === "string" || typeof tree === "number" ? String(tree) : ""; }
function mount({ initialData = fixture(), handler, ...extra } = {}) {
  const cells = [], effects = [], requests = []; let cursor = 0, tree, unmounted = false, afterUnmount = 0;
  const hooks = { ...React,
    useState(initial) { const i = cursor++; if (!(i in cells)) cells[i] = typeof initial === "function" ? initial() : initial;
      return [cells[i], value => { if (unmounted) afterUnmount++; cells[i] = typeof value === "function" ? value(cells[i]) : value; }]; },
    useRef(value) { const i = cursor++; if (!(i in cells)) cells[i] = { current: value }; return cells[i]; },
    useEffect(fn, deps) { const i = cursor++, old = cells[i]; if (!old || deps.some((v, n) => !Object.is(v, old.deps[n]))) effects.push(() => { old?.cleanup?.(); cells[i] = { deps, cleanup: fn() }; }); }
  };
  const Component = evaluate(componentCode, { ...mocks, react: hooks }).default;
  const props = { initialData, ...extra, transport: async (path, options) => { requests.push({ path, ...options }); return handler ? handler(requests.at(-1), requests) : Response.json(fixture()); } };
  const render = () => { cursor = 0; tree = Component(props); while (effects.length) effects.shift()(); return tree; };
  const button = () => nodes(tree).find(n => n.type === "button" && /^(Refresh savings|Checking…)$/.test(text(n)));
  const refresh = async () => { const pending = button().props.onClick(); render(); await pending; render(); };
  const unmount = () => { unmounted = true; for (const cell of cells) cell?.cleanup?.(); };
  render(); render(); return { props, render, button, refresh, unmount, requests, get tree() { return tree; }, get afterUnmount() { return afterUnmount; } };
}

test("savings renders the requested example and separate shopper navigation without a request", () => {
  const h = mount({ previewOnly: true }), content = text(h.tree);
  for (const expected of ["My savings", "Subscription paid€15.00", "Coupon savings€25.00", "+€10.00", "With Ruvanas, you have an extra €10.00 in your pocket so far.", "LOCAL PREVIEW"]) assert.ok(content.includes(expected), expected);
  assert.equal(h.requests.length, 0);
  assert.deepEqual(nodes(h.tree).filter(n => n.props["aria-current"] === "page").map(text), ["My savings"]);
  assert.equal(nodes(h.tree).filter(n => n.type === "form" || n.type === "input").length, 0);
});

test("zero and negative benefits use honest copy rather than a positive savings message", () => {
  const zero = text(mount({ initialData: fixture("zero") }).tree);
  assert.match(zero, /have covered your subscription/); assert.doesNotMatch(zero, /extra .*in your pocket/);
  const negative = text(mount({ initialData: fixture("negative") }).tree);
  assert.match(negative, /−€10\.00/); assert.match(negative, /€10\.00 away from covering/); assert.doesNotMatch(negative, /extra .*in your pocket/);
});

test("unavailable subscription evidence leaves paid and net unknown while displaying recorded coupon savings", () => {
  const h = mount({ initialData: fixture("unavailable") }), content = text(h.tree);
  assert.match(content, /Subscription paidNot available/); assert.match(content, /Coupon savings€25\.00/);
  assert.match(content, /Your net benefitNot available yet/); assert.doesNotMatch(content, /extra .*in your pocket|Subscription paid€0/);
});

test("unvalued discounts do not produce a claimed net benefit and currencies stay separate", () => {
  const unknown = text(mount({ initialData: fixture("unknown") }).tree);
  assert.match(unknown, /1 redeemed offer has no recorded money value/); assert.match(unknown, /cannot be calculated yet/);
  assert.doesNotMatch(unknown, /extra .*in your pocket/);
  const multi = mount({ initialData: fixture("multiple") });
  assert.equal(nodes(multi.tree).filter(n => n.props["aria-label"] === "EUR savings").length, 1);
  assert.equal(nodes(multi.tree).filter(n => n.props["aria-label"] === "USD savings").length, 1);
  assert.doesNotMatch(text(multi.tree), /converted|exchange rate/i);
});

test("no recorded activity does not invent zero subscription payments", () => {
  const h = mount({ initialData: fixture("empty") });
  assert.match(text(h.tree), /No coupon savings have been recorded/);
  assert.match(text(h.tree), /subscription payment total is not available/);
  assert.doesNotMatch(text(h.tree), /€0|extra .*in your pocket/);
  const verified = fixture("empty"); verified.paymentEvidence = "VERIFIED_COMPLETE";
  const checked = text(mount({ initialData: verified }).tree);
  assert.match(checked, /No settled subscription payments/i);
  assert.doesNotMatch(checked, /payment total is not available/);
});

test("refresh makes one private GET with no identity supplied and renders the validated new snapshot", async () => {
  const h = mount({ handler(request) { assert.equal(request.path, "/api/rewards/savings"); assert.equal(request.method, "GET");
    assert.equal(request.credentials, "same-origin"); assert.equal(request.cache, "no-store"); assert.equal(request.body, undefined);
    const result = fixture(); result.checkedAt = result.period.through = "2026-11-22T12:05:00.000Z"; return Response.json(result); } });
  await h.refresh(); assert.equal(h.requests.length, 1); assert.equal(h.button().props.disabled, false);
  assert.ok(nodes(h.tree).some(n => n.type === "time" && n.props.dateTime === "2026-11-22T12:05:00.000Z"));
});

test("pending and failed refreshes hide previous totals and raw server details", async () => {
  let release;
  const h = mount({ handler: () => new Promise(resolve => { release = resolve; }) });
  const pending = h.button().props.onClick(); h.render();
  assert.equal(h.button().props.disabled, true); assert.doesNotMatch(text(h.tree), /€25|€15|extra .*in your pocket/);
  release(Response.json({ ok: false, code: "UNAVAILABLE", error: "PRIVATE_DATABASE_DETAIL" }, { status: 503 }));
  await pending; h.render(); assert.match(text(h.tree), /couldn’t verify your savings/);
  assert.doesNotMatch(text(h.tree), /PRIVATE_DATABASE_DETAIL|€25|€15/);
  assert.ok(nodes(h.tree).some(n => n.props.role === "alert" && n.props.tabIndex === -1));
});

test("malformed or inconsistent snapshots and extra private fields fail closed", async () => {
  for (const alter of [v => { v.secret = "DO_NOT_DISPLAY"; }, v => { v.currencies[0].netBenefitMinor = 99999; },
    v => { v.currencies[0].currency = "BAD"; }, v => { v.checkedAt = "invalid"; },
    v => { v.paymentEvidence = "UNAVAILABLE"; }, v => { v.currencies[0].shopperEmail = "private@example.invalid"; }]) {
    const invalid = fixture(); alter(invalid);
    const h = mount({ handler: () => Response.json(invalid) }); await h.refresh();
    assert.match(text(h.tree), /couldn’t verify your savings/); assert.doesNotMatch(text(h.tree), /DO_NOT_DISPLAY|private@example|€25|€15/);
    const initial = mount({ initialData: invalid }); assert.doesNotMatch(text(initial.tree), /DO_NOT_DISPLAY|private@example|€25|€15/);
  }
});

test("late refresh results cannot overwrite a newer snapshot", async () => {
  const pending = [];
  const h = mount({ handler: () => new Promise(resolve => pending.push(resolve)) });
  const first = h.button().props.onClick(); h.render(); const second = h.button().props.onClick(); h.render();
  assert.equal(h.requests[0].signal.aborted, true);
  pending[1](Response.json(fixture("negative"))); await second; h.render();
  pending[0](Response.json(fixture())); await first; h.render();
  assert.match(text(h.tree), /−€10\.00/); assert.doesNotMatch(text(h.tree), /extra .*in your pocket/);
});

test("unmount aborts in-flight reads and prevents retired component writes", async () => {
  let release;
  const h = mount({ handler: () => new Promise(resolve => { release = resolve; }) });
  const pending = h.button().props.onClick(); h.unmount(); assert.equal(h.requests[0].signal.aborted, true);
  release(Response.json(fixture())); await pending; assert.equal(h.afterUnmount, 0);
});

test("a changed server snapshot cancels old refresh and never accepts its late result", async () => {
  let release;
  const h = mount({ handler: () => new Promise(resolve => { release = resolve; }) });
  const pending = h.button().props.onClick(); h.render();
  h.props.initialData = fixture("unavailable"); h.render(); h.render();
  assert.equal(h.requests[0].signal.aborted, true);
  release(Response.json(fixture())); await pending; h.render();
  assert.match(text(h.tree), /Subscription paidNot available/); assert.doesNotMatch(text(h.tree), /extra .*in your pocket/);
});

test("auth and closed-feature errors expose only safe shopper guidance", async () => {
  for (const [code, expected] of [["UNAUTHENTICATED", /Sign in with your shopper account/], ["FEATURE_DISABLED", /not available right now/], ["RATE_LIMITED", /wait a moment/]]) {
    const h = mount({ handler: () => Response.json({ ok: false, code, error: "PRIVATE_DETAIL" }, { status: 403 }) });
    await h.refresh(); assert.match(text(h.tree), expected); assert.doesNotMatch(text(h.tree), /PRIVATE_DETAIL|€25|€15/);
  }
});

test("all synthetic savings scenarios satisfy the same strict production DTO", async () => {
  const preview = createShopperMobilePreview({ clock: () => new Date(NOW), delayMs: 0 });
  for (const mode of ["positive", "unavailable", "negative", "zero", "unknown", "multiple", "empty"]) {
    preview.state.savingsMode = mode;
    assert.ok(contracts.safeShopperSavingsSnapshot(preview.initialSavings()), mode);
    assert.ok(contracts.safeShopperSavingsSnapshot(await preview.transport("/api/rewards/savings")), mode);
  }
  assert.equal(preview.requests.every(row => row.method === "GET" && row.path === "/api/rewards/savings"), true);
});
