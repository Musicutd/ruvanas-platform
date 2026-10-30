import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import * as weekly from "../lib/retail-weekly-planner-ui.mjs";
import * as commercial from "../lib/retail-commercial-ui.mjs";
import { PREVIEW_TESTER_PLAN, previewTesterOverrides } from "../lib/private-preview-account-policy.mjs";
import { RETAIL_SUBSCRIBER_ORGANISATION_ID as ORG } from "../lib/retail-subscriber-access.mjs";
import { privatePreviewTesterRequestAllowed } from "../lib/private-preview-tester-policy.mjs";

const require = createRequire(import.meta.url), React = require("react"), babel = require("next/dist/compiled/babel/core");
const { renderToStaticMarkup } = require("react-dom/server");
const stationId = weekly.RETAIL_PLANNER_STATION_ID, endpoint = "/api/programming/test-retail/commercials";
const firstId = `retail-commercial-${"a".repeat(40)}`, nextId = `retail-commercial-${"b".repeat(40)}`;
const baseRule = () => ({ name: "Shop offers", mode: "EVERY_SONGS", spotIds: ["spot-a", "spot-b"], weekdays: [1, 2, 3, 4, 5], everySongs: 3, startsOn: null, endsOn: null });
const dto = () => ({ stationId, draftOnly: true, playbackConnected: false, adminApprovalRequired: false, subscriberApprovalRequired: true, scheduleApprovalRequired: "SUBSCRIBER",
  spots: [{ id: "spot-a", name: "Welcome", version: 1, durationSeconds: 20 }, { id: "spot-b", name: "Offer", version: 1, durationSeconds: 30 }], warnings: [],
  draft: { id: firstId, version: 1, name: "Shop messages", timezone: "Europe/Malta", rules: [baseRule()], savedAt: "2026-10-28T10:00:00Z", needsReview: false, unavailableSpotIds: [], expiredRuleNames: [] } });
const css = { __esModule: true, default: new Proxy({}, { get: (_target, key) => String(key) }) };
function harness() {
  const slots = []; let cursor = 0, effects = [];
  return { slots, hooks: { ...React,
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial; return [slots[i], value => { slots[i] = typeof value === "function" ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useEffect(fn) { effects.push(fn); } },
    render(Component, props = { stationId }) { cursor = 0; effects = []; return Component(props); },
    async load() { effects[0]?.(); await new Promise(setImmediate); }
  };
}
async function component(h, fetch) {
  const file = "app/dashboard/programming/RetailCommercialDesk.js", source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
  const code = babel.transformSync(source, { filename: file, babelrc: false, configFile: false, envName: "test", presets: [require.resolve("next/babel")] }).code;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, fetch, AbortController, setTimeout, clearTimeout, crypto: webcrypto,
    window: { addEventListener() {}, removeEventListener() {}, confirm: () => true }, require: name => {
      if (name === "react") return h.hooks;
      if (name === "@/lib/retail-weekly-planner-ui.mjs") return weekly;
      if (name === "@/lib/retail-commercial-ui.mjs") return commercial;
      if (name === "./RetailCommercialUpload") return { __esModule: true, default: props => React.createElement("section", { "data-retail-upload": props.stationId }, "Upload commercial for approval") };
      if (name === "./RetailCommercialScheduleApproval") return { __esModule: true, default: props => React.createElement("section", { "data-schedule-review": props.stationId }, "Review saved schedule") };
      if (name.endsWith(".module.css")) return css;
      return require(name.startsWith("@babel/runtime/") ? `next/dist/compiled/${name}` : name);
    } });
  return module.exports.default;
}
function nodes(tree) { if (!tree || typeof tree !== "object") return []; return [tree, ...React.Children.toArray(tree.props?.children).flatMap(nodes)]; }
function text(tree) { if (typeof tree === "string" || typeof tree === "number") return String(tree); return React.Children.toArray(tree?.props?.children).map(text).join(""); }
const button = (tree, label) => nodes(tree).find(n => n.type === "button" && text(n).includes(label));
const input = (tree, label, type = "input") => nodes(nodes(tree).find(n => n.type === "label" && text(n).startsWith(label))).find(n => n.type === type);
const submit = tree => nodes(tree).find(n => n.type === "form").props.onSubmit({ preventDefault() {} });
const changeName = tree => input(tree, "Commercial plan name").props.onChange({ target: { value: "Edited shop messages" } });
const reply = body => ({ ok: true, json: async () => structuredClone(body) });

test("opening Commercials only reads its exact Retail draft endpoint and never starts playback", async () => {
  const h = harness(), calls = [], Component = await component(h, async (url, options) => { calls.push({ url, options }); return reply(dto()); });
  h.render(Component); await h.load();
  assert.equal(calls.length, 1); assert.equal(calls[0].url, endpoint); assert.equal(calls[0].options.body, undefined);
  assert.equal(calls[0].options.cache, "no-store");
  const tree = h.render(Component); assert.match(text(tree), /Your commercials · your approval/); assert.match(text(tree), /Music keeps playing/);
  assert.equal(button(tree, "Save commercial draft").props.disabled, true);
  assert.equal(nodes(tree).some(n => n.type === "audio" || n.props?.autoPlay), false);
  assert.equal(h.render(Component, { stationId: "other" }), null);
});

test("DTO copies only safe fields and rejects foreign scope or runtime capability claims", () => {
  const body = dto(); body.sourcePassword = "secret"; body.spots[0].storageKey = "private/audio"; body.spots[0].playbackUrl = "https://private.invalid";
  body.draft.workerLease = "secret-lease";
  const safe = commercial.retailCommercialView(body);
  assert.doesNotMatch(JSON.stringify(safe), /secret|private\/audio|private.invalid/);
  for (const patch of [{ stationId: "other" }, { draftOnly: false }, { playbackConnected: true }, { adminApprovalRequired: true }, { subscriberApprovalRequired: false }, { spots: [...body.spots, body.spots[0]] }])
    assert.throws(() => commercial.retailCommercialView({ ...body, ...patch }));
  assert.equal(commercial.retailCommercialSaveBody(commercial.retailCommercialForm(safe), { requestId: "request", baseVersionId: firstId }).baseVersionId, firstId);
});

test("every-three-song, ten-minute, scheduled and top-hour controls send the correct draft rules", async () => {
  for (const mode of ["EVERY_SONGS", "EVERY_MINUTES", "SCHEDULED", "TOP_OF_HOUR"]) {
    const h = harness(), calls = [], current = dto();
    const Component = await component(h, async (url, options = {}) => {
      const body = options.body && JSON.parse(options.body); calls.push({ url, body });
      return reply(body ? { ...current, savedDraftId: nextId, draft: { ...current.draft, ...body, id: nextId, version: 2 } } : current);
    });
    h.render(Component); await h.load(); changeName(h.render(Component));
    const title = { EVERY_SONGS: "Every few songs", EVERY_MINUTES: "Every few minutes", SCHEDULED: "At selected times", TOP_OF_HOUR: "Top of the hour" }[mode];
    button(h.render(Component), title).props.onClick();
    if (mode === "SCHEDULED") {
      input(h.render(Component), "Add a start time", "select").props.onChange({ target: { value: "09:30" } });
      button(h.render(Component), "Add time").props.onClick();
    }
    if (mode === "TOP_OF_HOUR") {
      button(h.render(Component), "Clear hours").props.onClick();
      nodes(h.render(Component)).find(n => n.type === "button" && text(n) === "09:00").props.onClick();
      nodes(h.render(Component)).find(n => n.type === "button" && text(n) === "12:00").props.onClick();
    }
    await submit(h.render(Component));
    const sent = calls.find(call => call.body)?.body; assert.ok(sent, mode); assert.equal(sent.action, "save"); assert.equal(sent.baseVersionId, firstId);
    assert.deepEqual(sent.rules[0].spotIds, ["spot-a", "spot-b"]); assert.deepEqual(sent.rules[0].weekdays, [1, 2, 3, 4, 5]); assert.equal(sent.rules[0].mode, mode);
    if (mode === "EVERY_SONGS") assert.equal(sent.rules[0].everySongs, 3);
    if (mode === "EVERY_MINUTES") assert.equal(sent.rules[0].everyMinutes, 10);
    if (mode === "SCHEDULED") assert.deepEqual(sent.rules[0].times, ["09:00", "09:30"]);
    if (mode === "TOP_OF_HOUR") assert.deepEqual(sent.rules[0].hours, [9, 12]);
    assert.ok(calls.every(call => call.url === endpoint)); assert.doesNotMatch(JSON.stringify(calls), /\/admin|sourcePassword|START|action":"approve|action":"publish/);
    assert.match(text(h.render(Component)), /Commercial draft saved/);
  }
});

test("uncertain saves retry the same request and base version; successful save becomes the reload baseline", async () => {
  const h = harness(), calls = []; let posts = 0, saved = dto();
  const Component = await component(h, async (url, options = {}) => {
    const body = options.body && JSON.parse(options.body); calls.push({ url, body });
    if (body) {
      if (++posts === 1) throw Object.assign(new Error("Synthetic timeout"), { name: "AbortError" });
      saved = { ...dto(), savedDraftId: nextId, draft: { ...dto().draft, name: body.name, rules: body.rules, id: nextId, version: 2 } };
    }
    return reply(saved);
  });
  h.render(Component); await h.load(); changeName(h.render(Component));
  await submit(h.render(Component)); assert.match(text(h.render(Component)), /Retry without edits/);
  await submit(h.render(Component));
  assert.deepEqual(calls[1].body, calls[2].body); assert.match(calls[1].body.requestId, /^[a-f0-9-]{36}$/);
  assert.equal(button(h.render(Component), "Save commercial draft").props.disabled, true);
  button(h.render(Component), "Refresh saved draft").props.onClick(); await new Promise(setImmediate);
  assert.equal(calls.at(-1).body, undefined); assert.match(text(h.render(Component)), /Saved draft 2/);
  assert.equal(input(h.render(Component), "Commercial plan name").props.value, "Edited shop messages");
});

test("an in-flight save ignores duplicate clicks", async () => {
  const h = harness(), calls = []; let finish;
  const Component = await component(h, async (_url, options = {}) => {
    if (!options.body) return reply(dto());
    calls.push(JSON.parse(options.body)); await new Promise(resolve => { finish = resolve; });
    return reply({ ...dto(), savedDraftId: nextId, draft: { ...dto().draft, id: nextId, version: 2, name: "Edited shop messages" } });
  });
  h.render(Component); await h.load(); changeName(h.render(Component));
  const first = submit(h.render(Component)); await submit(h.render(Component)); assert.equal(calls.length, 1);
  finish(); await first;
});

test("approving a recording refreshes selectable spots without discarding unsaved commercial timing", async () => {
  const h = harness(); let reads = 0;
  const Component = await component(h, async (_url, options = {}) => {
    assert.equal(options.body, undefined); const body = dto();
    if (++reads > 1) { body.spots.push({ id: "spot-new", name: "New approved offer", version: 1, durationSeconds: 25 }); body.draft = { ...body.draft, id: nextId, version: 2, name: "Other tab draft" }; }
    return reply(body);
  });
  h.render(Component); await h.load(); changeName(h.render(Component));
  nodes(h.render(Component)).find(node => typeof node.props?.onApproved === "function").props.onApproved(); await new Promise(setImmediate);
  const tree = h.render(Component); assert.equal(input(tree, "Commercial plan name").props.value, "Edited shop messages");
  assert.match(text(tree), /New approved offer/); assert.equal(button(tree, "Save commercial draft").props.disabled, false);
  const approvalPanel = nodes(tree).find(node => node.props?.savedDraftId);
  assert.equal(approvalPanel.props.savedDraftId, firstId); assert.equal(approvalPanel.props.hasUnsavedChanges, true);
});

test("changed approved audio can be revalidated without altering the saved rule", async () => {
  const current = dto(); current.draft.needsReview = true; current.draft.unavailableSpotIds = ["spot-a"];
  current.warnings = ["Some saved spots have changed. Save a new draft."];
  const safe = commercial.retailCommercialView(current); assert.equal(safe.draft.needsReview, true);
  const h = harness(), calls = [], Component = await component(h, async (_url, options = {}) => {
    if (options.body) calls.push(JSON.parse(options.body));
    return reply(options.body ? { ...dto(), savedDraftId: nextId, draft: { ...dto().draft, id: nextId, version: 2 } } : current);
  });
  h.render(Component); await h.load();
  const save = nodes(h.render(Component)).find(n => n.type === "button" && n.props.type === "submit"); assert.equal(save.props.disabled, false);
  await submit(h.render(Component)); assert.equal(calls.length, 1); assert.deepEqual(calls[0].rules, [baseRule()]);
});

test("preview preserves dates and spot order, validates unavailable spots, and strips inactive mode fields", () => {
  const rule = { ...commercial.emptyRetailCommercialRule(), spotIds: ["spot-b", "spot-a"], startsOn: "2027-01-01", endsOn: "2027-01-31" };
  const form = { name: "January", timezone: "Europe/Malta", rules: [rule] };
  const body = commercial.retailCommercialSaveBody(form, { requestId: "request", baseVersionId: null });
  assert.equal(body.rules[0].startsOn, "2027-01-01"); assert.equal(body.rules[0].endsOn, "2027-01-31");
  assert.deepEqual(body.rules[0].spotIds, ["spot-b", "spot-a"]); assert.equal(body.rules[0].everyMinutes, undefined); assert.equal(body.rules[0].hours, undefined);
  const preview = commercial.retailCommercialPattern(rule, dto().spots); assert.equal(preview.illustrationOnly, true); assert.equal(preview.playbackConnected, false);
  assert.deepEqual(preview.events[0].spotIds, ["spot-b", "spot-a"]);
  assert.match(commercial.retailCommercialIssues(form, []).join(" "), /no longer available/);
});

function retailSession() {
  const expiresAt = new Date("2026-11-23T13:00:00Z"), organisation = { id: ORG, enterpriseSecurityPolicy: null, subscription: {
    organisationId: ORG, plan: structuredClone(PREVIEW_TESTER_PLAN), status: "TRIAL", billingContract: null, currentPeriodEnd: expiresAt,
    complimentaryAccessActive: false, schoolPublicPublishingEnabled: false, retailMediaEnabled: false, digitalSignageEnabled: false, ...previewTesterOverrides(["RETAIL"]) } };
  const user = { id: "retail-user", email: "retail@manuelchircop.com", role: "OWNER", memberships: [{ role: "OWNER", organisationId: ORG, organisation }],
    privatePreviewAccess: { userId: "retail-user", organisationId: ORG, pillars: ["RETAIL"], enabled: true, passwordEnabled: true, expiresAt } };
  return { id: "session", userId: user.id, user, authMethod: "PREVIEW_PASSWORD", activeOrganisationId: ORG, expiresAt, revokedAt: null };
}
test("new commercial endpoint is allowed only for the exact Retail pilot and never approves generic promotions", () => {
  const session = retailSession(), now = new Date("2026-10-28T10:00:00Z"), allowed = (pathname, method, active = session) => privatePreviewTesterRequestAllowed({ session: active, pathname, method, now });
  for (const method of ["GET", "HEAD", "POST"]) assert.equal(allowed(endpoint, method), true);
  for (const method of ["PUT", "PATCH", "DELETE"]) assert.equal(allowed(endpoint, method), false);
  for (const email of ["radio@manuelchircop.com", "another@manuelchircop.com"]) { const foreign = structuredClone(session); foreign.user.email = email; assert.equal(allowed(endpoint, "POST", foreign), false); }
  assert.equal(allowed(`${endpoint}/approve`, "POST"), true);
  for (const pathname of [`${endpoint}/publish`, "/api/promotions", "/api/programming/test-radio/schedule"]) assert.equal(allowed(pathname, "POST"), false);
});
