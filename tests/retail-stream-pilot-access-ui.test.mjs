import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import vm from "node:vm";
import * as ui from "../lib/retail-stream-pilot-access-ui.mjs";

const ORG = ui.RETAIL_PILOT_ACCESS_ORGANISATION, SECRET = "PRIVATE_PROVIDER_SECRET";
const proposal = (approved = false) => ({ eligible: true, approved, canApprove: !approved, canRevoke: approved,
  territory: "MT", catalogueLevel: "FOCUSED", sourceScopes: ["RUVANAS_CORE", "LICENSED_CATALOGUE"],
  eligibleTrackCount: 24, expiresAt: "2026-11-23T12:00:00.000Z", blocker: null });

test("pilot projection binds the exact organisation, approved scope and expiry while excluding secrets", () => {
  const value = { ...proposal(), grant: { signature: SECRET }, sourcePassword: SECRET, worker: SECRET };
  assert.deepEqual(ui.safeRetailPilotAccessView(value, ORG), proposal());
  assert.doesNotMatch(JSON.stringify(ui.safeRetailPilotAccessView(value, ORG)), /PRIVATE_PROVIDER|signature|sourcePassword|worker/);
  for (const update of [{ territory: "GB" }, { catalogueLevel: "PREMIUM" }, { sourceScopes: ["SUBSCRIBER_LIBRARY"] },
    { eligibleTrackCount: -1 }, { eligibleTrackCount: 5000 }, { expiresAt: "invalid" }, { approved: true }, { blocker: SECRET }]) {
    assert.throws(() => ui.safeRetailPilotAccessView({ ...proposal(), ...update }, ORG));
  }
  assert.throws(() => ui.safeRetailPilotAccessView(proposal(), "another-org"));
});
test("an expired account can still offer an explicit revoke without offering approval", () => {
  const expired = { ...proposal(), eligible: false, canApprove: false, canRevoke: true, eligibleTrackCount: 0,
    expiresAt: null, blocker: "RETAIL_PILOT_ACCESS_TESTER_UNAVAILABLE" };
  assert.deepEqual(ui.retailPilotAccessRequest("revoke", true, expired, ORG), { action: "revoke", confirmed: true });
  assert.throws(() => ui.retailPilotAccessRequest("approve", true, expired, ORG));
  assert.throws(() => ui.retailPilotAccessRequest("revoke", false, expired, ORG));
  assert.throws(() => ui.retailPilotAccessRequest("start", true, expired, ORG));
});

const require = createRequire(import.meta.url), React = require("react"), babel = require("next/dist/compiled/babel/core");
const { renderToStaticMarkup } = require("react-dom/server");
const file = "app/admin/organisations/[organisationId]/retail-stream/RetailPilotAccessPanel.js";
const compiled = babel.transformSync(await readFile(new URL(`../${file}`, import.meta.url), "utf8"), {
  filename: file, babelrc: false, configFile: false, envName: "test", presets: [require.resolve("next/babel")]
}).code;
function load(hooks, fetch) {
  const module = { exports: {} };
  vm.runInNewContext(compiled, { module, exports: module.exports, fetch, AbortController, setTimeout, clearTimeout, Date,
    require: name => {
      if (name === "react") return hooks;
      if (name === "@/lib/retail-stream-pilot-access-ui.mjs") return ui;
      if (name.endsWith(".module.css")) return { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) };
      return require(name.startsWith("@babel/runtime/") ? `next/dist/compiled/${name}` : name);
    }
  });
  return module.exports.default;
}
const nodes = tree => !tree || typeof tree !== "object" ? [] : [tree, ...React.Children.toArray(tree.props?.children).flatMap(nodes)];
function fixture(value = proposal(), fetch = () => { throw new Error("Unexpected request"); }, organisationId = ORG) {
  let cursor = 0, changed = 0;
  const slots = [value, false, null, false, false, false], effects = [];
  const hooks = { ...React, useEffect(fn) { effects.push(fn); }, useState(initial) {
    const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
    return [slots[index], next => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }];
  }, useRef(initial) { const index = cursor++; return slots[index] ||= { current: initial }; } };
  const Panel = load(hooks, fetch);
  const render = () => { cursor = 0; effects.length = 0; return Panel({ organisationId, onAccessChanged: () => { changed++; } }); };
  return { slots, effects, render, changed: () => changed, html: () => renderToStaticMarkup(render()),
    button: text => nodes(render()).find(node => node.type === "button" && node.props.children === text) };
}
const approve = "Grant Retail music access — audio stays off", revoke = "Revoke Test Retail music access";

test("owner card distinguishes preview count from an actual approval and offers no broadcast control", () => {
  const state = fixture(), html = state.html();
  assert.match(html, /Recordings eligible with this approval/); assert.match(html, /FOCUSED/); assert.match(html, /Malta \(MT\)/);
  assert.match(html, /23 Nov 2026/); assert.match(html, /Pilot music access not approved/);
  assert.equal(state.button(approve).props.disabled, true);
  assert.doesNotMatch(html, /<audio|autoplay|type="password"|Start this Retail stream|PRIVATE_PROVIDER/);
});
test("initial loading performs one read and never grants access or starts audio", async () => {
  const calls = [], state = fixture(null, async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => ({ access: proposal() }) }; });
  state.render(); const cleanup = state.effects[0]();
  await new Promise(resolve => setTimeout(resolve, 10)); cleanup();
  assert.equal(calls.length, 1); assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].url, `/api/admin/organisations/${ORG}/retail-access`);
  assert.equal(calls[0].options.body, undefined); assert.equal(state.changed(), 0);
});
test("other organisations get no pilot UI or initial network request", async () => {
  let calls = 0; const state = fixture(null, async () => { calls++; throw new Error("Unexpected request"); }, "other-org");
  assert.equal(state.render(), null); const cleanup = state.effects[0]();
  await new Promise(resolve => setTimeout(resolve, 10)); cleanup(); assert.equal(calls, 0);
});
test("only explicit approval sends the minimal access action and triggers a separate read refresh", async () => {
  const calls = [], state = fixture(proposal(), async (url, options) => { calls.push({ url, options });
    return { ok: true, json: async () => ({ accepted: true, action: "approve", access: proposal(true), grant: SECRET }) }; });
  await state.button(approve).props.onClick(); assert.equal(calls.length, 0);
  state.slots[3] = true; await state.button(approve).props.onClick();
  assert.equal(calls.length, 1); assert.deepEqual(JSON.parse(calls[0].options.body), { action: "approve", confirmed: true });
  assert.equal(calls[0].options.credentials, "same-origin"); assert.equal(calls[0].options.cache, "no-store");
  assert.equal(state.changed(), 1); assert.equal(state.slots[0].approved, true); assert.equal(state.slots[3], false);
  assert.match(state.slots[2].text, /did not start audio/); assert.doesNotMatch(state.html(), /PRIVATE_PROVIDER/);
});
test("uncertain or malformed mutations are never retried or treated as successful", async () => {
  for (const respond of [async () => { throw new Error(SECRET); }, async () => ({ ok: true,
    json: async () => ({ accepted: true, action: "start", access: proposal(true) }) }), async () => ({ ok: true,
    json: async () => ({ accepted: true, action: "approve", access: proposal(false) }) })]) {
    let calls = 0; const state = fixture(proposal(), async () => { calls++; return respond(); });
    state.slots[3] = true; await state.button(approve).props.onClick();
    assert.equal(state.slots[5], true); assert.equal(state.changed(), 0); assert.equal(state.slots[0].approved, false);
    assert.match(state.slots[2].text, /may already have completed/); assert.doesNotMatch(state.html(), /PRIVATE_PROVIDER/);
    state.slots[3] = true; await state.button(approve).props.onClick(); assert.equal(calls, 1);
  }
});
test("an error cannot inject its private message; successful GET refresh unlocks a reviewed retry", async () => {
  let calls = 0; const state = fixture(proposal(), async () => ++calls === 1
    ? { ok: false, json: async () => ({ code: "UNKNOWN", error: SECRET }) }
    : { ok: true, json: async () => ({ access: proposal() }) });
  state.slots[3] = true; await state.button(approve).props.onClick();
  assert.equal(state.slots[5], true); assert.doesNotMatch(state.html(), /PRIVATE_PROVIDER/);
  await state.button("Refresh music access").props.onClick(); assert.equal(state.slots[5], false);
  assert.equal(state.button(approve).props.disabled, true); assert.equal(state.changed(), 0);
});
test("revoking access requires its own confirmation and never calls Start or Stop endpoints", async () => {
  const calls = [], state = fixture(proposal(true), async (url, options) => { calls.push({ url, options });
    return { ok: true, json: async () => ({ accepted: true, action: "revoke", access: proposal() }) }; });
  assert.equal(state.button(revoke).props.disabled, true); state.slots[4] = true;
  await state.button(revoke).props.onClick();
  assert.equal(calls.length, 1); assert.deepEqual(JSON.parse(calls[0].options.body), { action: "revoke", confirmed: true });
  assert.match(calls[0].url, /\/retail-access$/); assert.equal(state.changed(), 1); assert.equal(state.slots[0].approved, false);
});
