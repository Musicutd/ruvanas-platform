import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import vm from "node:vm";
import * as ui from "../lib/retail-test-tier-ui.mjs";

const require = createRequire(import.meta.url), React = require("react");
const babel = require("next/dist/compiled/babel/core");
const tiers = ["START", "BUSINESS", "PROFESSIONAL", "ADVANCED", "ENTERPRISE"];
const response = (current = null) => {
  const plans = tiers.map((tier, index) => ({ code: `RETAIL_${tier}`, name: `Retail ${tier[0]}${tier.slice(1).toLowerCase()}`, tierNumber: index + 1,
    limits: { locations: [1, 3, 10, 30, 100][index], players: [1, 3, 10, 30, 100][index], storageGb: [5, 15, 100, 200, 2000][index], bitrateKbps: [128, 256, 320, 320, 320][index] },
    catalogueLevel: index > 2 ? "PROFESSIONAL" : "FOCUSED", promoUploadEnabled: true, digitalDisplaysEnabled: false, monthlyPriceCents: 0 }));
  return { ok: true, freeTest: true, revision: current ? "a".repeat(64) : null, currentPlan: plans.find(plan => plan.code === current) || null, plans, usage: { locations: 2, players: 2, storageBytes: 7_000_000_000 }, warnings: [] };
};
const ok = body => ({ ok: true, json: async () => body });
const nodes = tree => !tree || typeof tree !== "object" ? [] : [tree, ...React.Children.toArray(tree.props?.children).flatMap(nodes)];
const text = tree => typeof tree === "string" || typeof tree === "number" ? String(tree) : React.Children.toArray(tree?.props?.children).map(text).join("");
const button = (tree, name) => nodes(tree).find(node => node.type === "button" && text(node).includes(name));
const select = tree => nodes(tree).find(node => node.type === "select");
const form = tree => nodes(tree).find(node => node.type === "form");
const submit = tree => form(tree).props.onSubmit({ preventDefault() {} });

async function harness(fetch) {
  const slots = []; let cursor = 0, effects = [];
  const hooks = { ...React,
    useReducer(reducer, initial) { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], event => { slots[index] = reducer(slots[index], event); }]; },
    useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useCallback: fn => fn, useEffect: fn => { effects.push(fn); }
  };
  const file = "app/dashboard/retail/RetailTestTierSelector.js";
  const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
  const code = babel.transformSync(source, { filename: file, babelrc: false, configFile: false, envName: "test", presets: [require.resolve("next/babel")] }).code;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, fetch, AbortController, setTimeout, clearTimeout, require: name => {
    if (name === "react") return hooks;
    if (name === "@/lib/retail-test-tier-ui.mjs") return ui;
    if (name.endsWith(".module.css")) return { __esModule: true, default: new Proxy({}, { get: (_target, key) => String(key) }) };
    return require(name.startsWith("@babel/runtime/") ? `next/dist/compiled/${name}` : name);
  } });
  return { render() { cursor = 0; effects = []; return module.exports.default(); }, async mount() { this.render(); effects[0]?.(); await new Promise(setImmediate); }, state: () => slots[0] };
}

test("test-tier data rejects paid, signage, incomplete or mismatched responses", () => {
  const good = response(); assert.equal(ui.retailTestTierResponse(good), good);
  const changed = change => { const body = response(); change(body); return body; };
  for (const body of [
    changed(body => { body.freeTest = false; }),
    changed(body => { body.plans[0].monthlyPriceCents = 1; }),
    changed(body => { body.plans[0].digitalDisplaysEnabled = true; }),
    changed(body => { body.plans[0].limits.players = null; }),
    changed(body => { body.plans.pop(); }),
    changed(body => { body.currentPlan = { code: "SCHOOL_START" }; })
  ]) assert.throws(() => ui.retailTestTierResponse(body), /could not be confirmed/);
});

test("mount and selecting a tier read only; explicit confirmation posts the reviewed code and revision", async () => {
  const calls = [];
  const h = await harness(async (url, options = {}) => {
    const body = options.body && JSON.parse(options.body); calls.push({ url, method: options.method || "GET", body });
    return ok({ ...response(body?.planCode || "RETAIL_START"), ...(body ? { changed: true } : {}) });
  });
  await h.mount(); let tree = h.render();
  assert.equal(calls.length, 1); assert.equal(calls[0].method, "GET");
  assert.equal(button(tree, "Use this tier").props.disabled, true);
  select(tree).props.onChange({ target: { value: "RETAIL_ENTERPRISE" } }); tree = h.render();
  assert.equal(calls.length, 1); assert.equal(select(tree).props.value, "RETAIL_ENTERPRISE");
  assert.match(text(tree), /100/); assert.match(text(tree), /320 kbps/); assert.match(text(tree), /current 128 kbps/);
  assert.match(text(tree), /Digital displays remain off/); assert.match(text(tree), /no subscription charge/);
  await submit(tree); tree = h.render();
  assert.deepEqual(calls[1], { url: "/api/account/test-tier", method: "POST", body: { planCode: "RETAIL_ENTERPRISE", confirmed: true, expectedRevision: "a".repeat(64) } });
  assert.equal(button(tree, "Use this tier").props.disabled, true);
  assert.match(text(nodes(tree).find(node => node.props?.role === "status")), /Retail Enterprise is now selected/);
  assert.ok(calls.every(call => call.url === "/api/account/test-tier"));
});

test("a failed save preserves selection and requires a read before retrying with a fresh revision", async () => {
  const calls = []; let attempts = 0, reads = 0;
  const h = await harness(async (_url, options = {}) => {
    const body = options.body && JSON.parse(options.body); calls.push(body || "GET");
    if (body && ++attempts === 1) return { ok: false, json: async () => ({ error: "This tier was changed in another tab.", code: "STALE_SELECTION" }) };
    if (!body) { reads++; return ok({ ...response("RETAIL_START"), revision: (reads === 1 ? "a" : "b").repeat(64) }); }
    return ok({ ...response(body.planCode), changed: true });
  });
  await h.mount(); select(h.render()).props.onChange({ target: { value: "RETAIL_BUSINESS" } });
  await submit(h.render()); let tree = h.render();
  assert.equal(select(tree).props.value, "RETAIL_BUSINESS");
  assert.equal(button(tree, "Use this tier").props.disabled, true);
  assert.match(text(nodes(tree).find(node => node.props?.role === "alert")), /selection is kept/);
  await submit(tree); assert.equal(calls.length, 2);
  await button(tree, "Reload current tier").props.onClick(); tree = h.render();
  assert.equal(select(tree).props.value, "RETAIL_BUSINESS"); assert.equal(button(tree, "Use this tier").props.disabled, false);
  await submit(tree); assert.equal(calls[3].expectedRevision, "b".repeat(64));
});

test("a timeout after a possible save keeps the selected tier and cannot double submit", async () => {
  let release, posts = 0;
  const h = await harness(async (_url, options = {}) => {
    if (!options.body) return ok(response("RETAIL_START"));
    posts++;
    await new Promise(resolve => { release = resolve; });
    throw Object.assign(new Error("Timed out"), { name: "AbortError" });
  });
  await h.mount(); select(h.render()).props.onChange({ target: { value: "RETAIL_ADVANCED" } });
  const tree = h.render(), pending = submit(tree);
  await submit(tree); assert.equal(posts, 1);
  release(); await pending;
  assert.equal(select(h.render()).props.value, "RETAIL_ADVANCED");
  assert.equal(button(h.render(), "Use this tier").props.disabled, true);
  assert.match(text(h.render()), /took too long to confirm/);
});

test("downgrade preview explains retained data and does not apply changes", async () => {
  const calls = [];
  const h = await harness(async (url, options = {}) => { calls.push({ url, options }); return ok(response("RETAIL_ENTERPRISE")); });
  await h.mount(); select(h.render()).props.onChange({ target: { value: "RETAIL_START" } });
  const tree = h.render(); assert.equal(calls.length, 1);
  assert.match(text(tree), /keeps your saved data/); assert.match(text(tree), /Existing shops stay saved/);
  assert.match(text(tree), /Existing devices stay saved/); assert.match(text(tree), /Files stay saved/);
  assert.equal(ui.retailTestTierSelection(h.state()).warnings.length, 3);
});

test("unavailable access leaves only a read retry and no selectable or writable tier", async () => {
  const calls = [];
  const h = await harness(async (_url, options = {}) => { calls.push(options.method || "GET"); return { ok: false, json: async () => ({ error: "Test-tier access is unavailable.", code: "UNAVAILABLE" }) }; });
  await h.mount(); const tree = h.render();
  assert.equal(form(tree), undefined); assert.equal(select(tree), undefined);
  assert.match(text(tree), /access is unavailable/); assert.equal(button(tree, "Reload current tier").props.disabled, false);
  assert.deepEqual(calls, ["GET"]);
});
