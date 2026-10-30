import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { webcrypto } from "node:crypto";
import vm from "node:vm";
import * as weekly from "../lib/retail-weekly-planner-ui.mjs";
import * as policy from "../lib/retail-commercial-policy.mjs";
import * as ui from "../lib/retail-commercial-subscriber-review-ui.mjs";

const require = createRequire(import.meta.url), React = require("react"), babel = require("next/dist/compiled/babel/core");
const stationId = weekly.RETAIL_PLANNER_STATION_ID, endpoint = ui.RETAIL_COMMERCIAL_SCHEDULE_APPROVAL_ENDPOINT;
const firstId = `retail-commercial-${"a".repeat(40)}`, secondId = `retail-commercial-${"b".repeat(40)}`, approvalId = `retail-commercial-approval-${"c".repeat(40)}`;
const rule = { name: "Shop offers", mode: "EVERY_SONGS", spotIds: ["spot-1"], weekdays: [1], everySongs: 3, startsOn: null, endsOn: null };
const dto = () => ({ stationId, organisationId: "cmvmeq5880005lf2knwtw1b93", timezone: "Europe/Malta", reviewOnly: true,
  adminApprovalRequired: false, subscriberApprovalRequired: true, scheduleApprovalRequired: "SUBSCRIBER", canApprove: true,
  baseApprovalId: null, reviewHash: "d".repeat(64), approval: null, warnings: [],
  spots: [{ id: "spot-1", name: "Weekend offer", version: 1, durationSeconds: 31 }],
  draft: { id: firstId, version: 1, name: "Shop messages", timezone: "Europe/Malta", savedAt: "2026-10-30T10:00:00Z", rules: [rule] } });
const approved = () => ({ ...dto(), accepted: true, approvedDraftId: firstId, activeApprovalId: approvalId, canApprove: false, baseApprovalId: approvalId,
  approval: { id: approvalId, sequence: 1, draftId: firstId, draftVersion: 1, approvedAt: "2026-10-30T10:05:00Z" } });
const props = { stationId, savedDraftId: firstId, hasUnsavedChanges: false };
const reply = (body, ok = true) => ({ ok, json: async () => structuredClone(body) });
const css = { __esModule: true, default: new Proxy({}, { get: (_target, key) => String(key) }) };
function harness() {
  const slots = []; let cursor = 0, effects = [];
  return { hooks: { ...React,
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial; return [slots[i], value => { slots[i] = typeof value === "function" ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; }, useEffect(fn) { effects.push(fn); } },
    render(Component, next = props) { cursor = 0; effects = []; return Component(next); },
    async load() { effects[0]?.(); await new Promise(setImmediate); },
    effect() { return effects[0]?.(); }
  };
}
async function component(h, fetch) {
  const file = "app/dashboard/programming/RetailCommercialScheduleApproval.js", source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
  const code = babel.transformSync(source, { filename: file, babelrc: false, configFile: false, envName: "test", presets: [require.resolve("next/babel")] }).code;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, fetch, AbortController, setTimeout, clearTimeout, crypto: webcrypto,
    require: name => {
      if (name === "react") return h.hooks;
      if (name === "@/lib/retail-weekly-planner-ui.mjs") return weekly;
      if (name === "@/lib/retail-commercial-policy.mjs") return policy;
      if (name === "@/lib/retail-commercial-subscriber-review-ui.mjs") return ui;
      if (name.endsWith(".module.css")) return css;
      return require(name.startsWith("@babel/runtime/") ? `next/dist/compiled/${name}` : name);
    } });
  return module.exports.default;
}
function nodes(tree) { if (!tree || typeof tree !== "object") return []; return [tree, ...React.Children.toArray(tree.props?.children).flatMap(nodes)]; }
function text(tree) { if (typeof tree === "string" || typeof tree === "number") return String(tree); return React.Children.toArray(tree?.props?.children).map(text).join(""); }
const button = (tree, label) => nodes(tree).find(node => node.type === "button" && text(node).includes(label));
const confirm = tree => nodes(tree).find(node => node.type === "input" && node.props.type === "checkbox");
const tick = tree => confirm(tree).props.onChange({ target: { checked: true } });
const clickApprove = async tree => { button(tree, "Approve this saved").props.onClick(); await new Promise(setImmediate); };

test("opening the saved commercial review only reads and never approves or plays audio", async () => {
  const h = harness(), calls = [], Component = await component(h, async (url, options) => { calls.push({ url, options }); return reply(dto()); });
  h.render(Component); await h.load(); const tree = h.render(Component);
  assert.equal(calls.length, 1); assert.equal(calls[0].url, endpoint); assert.equal(calls[0].options.method, "GET"); assert.equal(calls[0].options.body, undefined);
  assert.match(text(tree), /Saved version 1/); assert.match(text(tree), /Weekend offer/); assert.match(text(tree), /after every 3/i);
  assert.equal(button(tree, "Approve this saved").props.disabled, true); assert.equal(confirm(tree).props.checked, false);
  assert.equal(nodes(tree).some(node => node.type === "audio" || node.props?.autoPlay), false);
  assert.equal(h.render(Component, { ...props, stationId: "other" }), null);
});

test("schedule review validates scope, strips private fields and binds approval to exact saved evidence", () => {
  const body = dto(); body.credentials = "secret"; body.spots[0].storageKey = "private/audio"; const safe = ui.retailCommercialSubscriberReview(body);
  assert.doesNotMatch(JSON.stringify(safe), /secret|private\/audio/);
  for (const patch of [{ stationId: "other" }, { organisationId: "other" }, { adminApprovalRequired: true }, { subscriberApprovalRequired: false },
    { scheduleApprovalRequired: "ADMIN" }, { reviewHash: "bad" }, { spots: [] }, { baseApprovalId: approvalId }, { draft: { ...body.draft, id: "bad" } }])
    assert.throws(() => ui.retailCommercialSubscriberReview({ ...body, ...patch }));
  const options = { requestId: webcrypto.randomUUID(), responsibilityConfirmed: true, savedDraftId: firstId, hasUnsavedChanges: false };
  assert.equal(ui.retailCommercialSubscriberApprovalBody(safe, options).draftId, firstId);
  for (const patch of [{ responsibilityConfirmed: false }, { savedDraftId: secondId }, { hasUnsavedChanges: true }])
    assert.throws(() => ui.retailCommercialSubscriberApprovalBody(safe, { ...options, ...patch }));
});

test("approval requires explicit responsibility and only posts immutable saved-version evidence", async () => {
  const h = harness(), calls = [], Component = await component(h, async (url, options) => { calls.push({ url, options }); return reply(options.body ? approved() : dto()); });
  h.render(Component); await h.load(); await clickApprove(h.render(Component)); assert.equal(calls.length, 1);
  tick(h.render(Component)); await clickApprove(h.render(Component)); assert.equal(calls.length, 2);
  const sent = JSON.parse(calls[1].options.body); assert.equal(calls[1].url, endpoint); assert.equal(calls[1].options.method, "POST");
  assert.deepEqual(Object.keys(sent).sort(), ["baseApprovalId", "draftId", "requestId", "responsibilityConfirmed", "reviewHash"]);
  assert.equal(sent.draftId, firstId); assert.equal(sent.reviewHash, "d".repeat(64)); assert.equal(sent.baseApprovalId, null); assert.equal(sent.responsibilityConfirmed, true);
  assert.match(text(h.render(Component)), /Commercial schedule approved/); assert.match(text(h.render(Component)), /does not prove a spot has played/);
  assert.equal(button(h.render(Component), "Approve this saved").props.disabled, true);
});

test("dirty edits or a different saved draft cannot be approved even if confirmation was previously ticked", async () => {
  const h = harness(), calls = [], Component = await component(h, async (url, options) => { calls.push({ url, options }); return reply(dto()); });
  h.render(Component); await h.load(); tick(h.render(Component));
  for (const next of [{ ...props, hasUnsavedChanges: true }, { ...props, savedDraftId: secondId }]) {
    const tree = h.render(Component, next); assert.equal(button(tree, "Approve this saved").props.disabled, true); await clickApprove(tree);
  }
  assert.equal(calls.length, 1);
});

test("conflict or uncertain approval requires a fresh review and renewed confirmation", async () => {
  for (const result of [reply({ error: "A newer draft was saved. Refresh the saved review." }, false), reply({ ...approved(), approvedDraftId: secondId })]) {
    const h = harness(), calls = [], Component = await component(h, async (url, options) => { calls.push({ url, options }); return options.body ? result : reply(dto()); });
    h.render(Component); await h.load(); tick(h.render(Component)); await clickApprove(h.render(Component));
    assert.ok(nodes(h.render(Component)).some(node => node.props?.role === "alert")); assert.equal(button(h.render(Component), "Approve this saved").props.disabled, true);
    tick(h.render(Component)); await clickApprove(h.render(Component)); assert.equal(calls.length, 2);
    button(h.render(Component), "Refresh saved review").props.onClick(); await new Promise(setImmediate);
    assert.equal(confirm(h.render(Component)).props.checked, false); assert.equal(calls.length, 3);
  }
});

test("in-flight approval blocks duplicate clicks and refresh until its result settles", async () => {
  const h = harness(), calls = []; let finish;
  const Component = await component(h, async (url, options) => { calls.push({ url, options }); if (!options.body) return reply(dto()); await new Promise(resolve => { finish = resolve; }); return reply(approved()); });
  h.render(Component); await h.load(); tick(h.render(Component));
  button(h.render(Component), "Approve this saved").props.onClick(); button(h.render(Component), "Approve this saved").props.onClick(); button(h.render(Component), "Refresh saved review").props.onClick();
  assert.equal(calls.length, 2); finish(); await new Promise(setImmediate); assert.equal(confirm(h.render(Component)).props.checked, false);
});

test("a newer parent draft aborts stale review and cannot receive its approval result", async () => {
  const h = harness(); let resolveFirst, calls = 0;
  const Component = await component(h, async (_url, options) => { if (++calls === 1) return await new Promise(resolve => { resolveFirst = resolve; }); return reply({ ...dto(), draft: { ...dto().draft, id: secondId, version: 2 } }); });
  h.render(Component); const cleanup = h.effect(); cleanup();
  h.render(Component, { ...props, savedDraftId: secondId }); h.effect(); await new Promise(setImmediate);
  resolveFirst(reply(dto())); await new Promise(setImmediate); const tree = h.render(Component, { ...props, savedDraftId: secondId });
  assert.match(text(tree), /Saved version 2/); assert.doesNotMatch(text(tree), /Saved version 1/); assert.equal(confirm(tree).props.checked, false);
});

test("empty saved version is explicitly explained as disabling commercials while music continues", async () => {
  const h = harness(), Component = await component(h, async () => reply({ ...dto(), spots: [], draft: { ...dto().draft, rules: [] } }));
  h.render(Component); await h.load(); assert.match(text(h.render(Component)), /turns off commercial insertion while music continues/);
  assert.equal(button(h.render(Component), "Approve this saved").props.disabled, true);
});
