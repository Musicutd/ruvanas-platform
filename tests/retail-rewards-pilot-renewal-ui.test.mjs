import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import * as pilotUi from "../lib/retail-rewards/pilot-admin-ui.mjs";
import * as checkoutUi from "../lib/retail-rewards/checkout-ui.mjs";
import { pilotPreviewRoute } from "../lib/retail-rewards/pilot-preview-routes.mjs";

const require = createRequire(import.meta.url), React = require("react");
const babel = require("next/dist/compiled/babel/core");
const file = "app/admin/retail-rewards/pilot/PilotAccessRenewal.js";
const code = babel.transformSync(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), {
  filename: file, babelrc: false, configFile: false, envName: "test", presets: [require.resolve("next/babel")]
}).code;
const NOW = "2026-11-19T12:00:00.000Z", EXPIRED = "2026-11-18T18:20:00.000Z", END = "2026-11-19T13:00:00.000Z";
const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
class TestDate extends Date { constructor(...args) { super(...(args.length ? args : [NOW])); } }
const limits = { activeOffers: 3, locations: 1, staffSeats: 1, monthlyRedemptions: 10, analyticsRetentionDays: 30, exportEnabled: false, brandingEnabled: false };
function review() { return { ok: true, organisationId: "org-one", shopperId: "shopper-one", email: "shopper@example.invalid", displayName: "Test shopper", programId: "program-one",
  grant: { id: "grant-one", tier: "REWARDS_STARTER", expiresAt: EXPIRED, limits: { ...limits } },
  membership: { id: "membership-one", expiresAt: EXPIRED, version: 4 }, invitation: { id: "invite-one", status: "REVOKED" }, expectedState: "a".repeat(64), checkedAt: NOW }; }
function result(body) { return { ok: true, shopperId: body.shopperId, programId: "program-one", grantId: "grant-one", membershipId: "membership-one", expiresAt: body.expiresAt, membershipVersion: 5, requestId: body.requestId }; }
function nodes(tree) { return Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === "object" && tree.props ? [tree, ...nodes(tree.props.children)] : []; }
function text(tree) { return Array.isArray(tree) ? tree.map(text).join("") : tree && typeof tree === "object" ? text(tree.props?.children) : typeof tree === "string" || typeof tree === "number" ? String(tree) : ""; }

function mount(handler) {
  const cells = [], effects = [], requests = []; let cursor = 0, tree, refreshed = 0, writesAfterUnmount = 0, unmounted = false, madeIds = 0;
  const hookReact = { ...React,
    useState(initial) { const slot = cursor++; if (!(slot in cells)) cells[slot] = typeof initial === "function" ? initial() : initial;
      return [cells[slot], value => { if (unmounted) writesAfterUnmount++; cells[slot] = typeof value === "function" ? value(cells[slot]) : value; }]; },
    useRef(initial) { const slot = cursor++; if (!(slot in cells)) cells[slot] = { current: initial }; return cells[slot]; },
    useEffect(fn, dependencies) { const slot = cursor++, old = cells[slot];
      if (!old || dependencies.some((value, i) => !Object.is(value, old.dependencies[i]))) effects.push(() => { old?.cleanup?.(); cells[slot] = { dependencies, cleanup: fn() }; }); }
  };
  const module = { exports: {} };
  const mocks = { react: hookReact, "@/lib/retail-rewards/pilot-admin-ui.mjs": { ...pilotUi,
    pilotRenewalExpiry: value => pilotUi.pilotRenewalExpiry(value, new Date(NOW)),
    pilotRenewalAttempt: (previous, data, expiresAt) => pilotUi.pilotRenewalAttempt(previous, data, expiresAt, () => { madeIds++; return REQUEST_ID; }) },
    "@/lib/retail-rewards/checkout-ui.mjs": checkoutUi,
    "./pilot-admin.module.css": { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) } };
  vm.runInNewContext(code, { module, exports: module.exports, Date: TestDate, Intl, AbortController, setTimeout, clearTimeout,
    require(name) { if (Object.hasOwn(mocks, name)) return mocks[name]; if (name.startsWith("react/jsx-")) return require(name);
      if (name.startsWith("@babel/runtime/")) return require(`next/dist/compiled/${name}`); throw new Error(`Unexpected UI dependency: ${name}`); },
    fetch() { throw new Error("Real network access is forbidden"); } });
  const transport = async (path, options) => {
    const request = { path, method: options.method, encoded: options.body, body: options.body ? JSON.parse(options.body) : null, signal: options.signal };
    requests.push(request);
    return handler ? handler(request, requests) : Response.json(options.method === "GET" ? review() : result(request.body));
  };
  const props = { organisationId: "org-one", shoppers: [{ shopperId: "shopper-one", displayName: "Test shopper", status: "DISABLED", invitationStatus: "REVOKED", membershipExpiresAt: EXPIRED },
    { shopperId: "active-shopper", displayName: "Active shopper", status: "ACTIVE", invitationStatus: "ACCEPTED", membershipExpiresAt: END }], transport, onRefresh: () => refreshed++ };
  const Component = module.exports.default;
  const render = () => { cursor = 0; tree = Component(props); while (effects.length) effects.shift()(); return tree; };
  const find = predicate => { const found = nodes(tree).find(predicate); assert.ok(found, "Expected UI control"); return found; };
  const label = value => find(n => n.props["aria-label"] === value);
  const button = value => find(n => n.type === "button" && text(n) === value);
  const change = (node, value) => { node.props.onChange({ target: { value, checked: value } }); render(); };
  async function open() { change(label("Existing test shopper"), "shopper-one"); await button("Review renewal").props.onClick(); render(); }
  function fill() { change(label("New access end (Malta time)"), "2026-11-19T14:00"); change(label("Confirm pilot renewal"), true); }
  async function submit() { await find(n => n.type === "form").props.onSubmit({ preventDefault() {} }); render(); }
  function unmount() { unmounted = true; for (const cell of cells) cell?.cleanup?.(); }
  render(); return { render, find, label, button, change, open, fill, submit, unmount, requests, get refreshed() { return refreshed; }, get madeIds() { return madeIds; }, get writesAfterUnmount() { return writesAfterUnmount; }, get tree() { return tree; } };
}

test("renewal review rejects wrong tenant, stale eligibility and unreviewed fields", () => {
  assert.ok(pilotUi.pilotRenewalReview(review(), "org-one", "shopper-one"));
  assert.equal(pilotUi.pilotRenewalReview(review(), "other-org", "shopper-one"), null);
  assert.equal(pilotUi.pilotRenewalReview(review(), "org-one", "other-shopper"), null);
  for (const mutate of [v => v.secret = "private", v => v.grant.expiresAt = END, v => v.membership.expiresAt = END,
    v => v.membership.version = 0, v => v.membership.version = 2147483647, v => v.invitation.status = "PENDING",
    v => v.expectedState = "bad", v => v.grant.limits.monthlyRedemptions = -1, v => v.grant.limits.unlimited = true]) {
    const value = review(); mutate(value); assert.equal(pilotUi.pilotRenewalReview(value, "org-one", "shopper-one"), null, String(mutate));
  }
});

test("Malta renewal end is explicit, future and at most two hours away", () => {
  assert.equal(pilotUi.pilotRenewalExpiry("2026-11-19T14:00", new Date(NOW)), END);
  assert.equal(pilotUi.pilotRenewalExpiry("2026-11-19T15:00", new Date(NOW)), "2026-11-19T14:00:00.000Z");
  for (const value of ["", "2026-11-19T13:00", "2026-11-19T12:59", "2026-11-19T15:01"]) assert.throws(() => pilotUi.pilotRenewalExpiry(value, new Date(NOW)));
  assert.throws(() => pilotUi.pilotRenewalExpiry("2027-03-28T02:30", new Date("2027-03-28T00:30:00Z")), /does not exist|clock|time/i);
  assert.throws(() => pilotUi.pilotRenewalExpiry("2027-10-31T02:30", new Date("2027-10-31T00:00:00Z")), /ambiguous|clock|time/i);
});

test("retry identity and response stay bound to the exact reviewed renewal", () => {
  const data = review(), attempt = pilotUi.pilotRenewalAttempt(null, data, END, () => REQUEST_ID);
  assert.equal(pilotUi.pilotRenewalAttempt(attempt, data, END, () => assert.fail("Retry must retain request ID")), attempt);
  assert.equal(Object.isFrozen(attempt.body), true);
  const changed = pilotUi.pilotRenewalAttempt(attempt, data, "2026-11-19T13:01:00.000Z", () => "22222222-2222-4222-8222-222222222222");
  assert.notEqual(changed.body.requestId, attempt.body.requestId);
  assert.ok(pilotUi.pilotRenewalResult(result(attempt.body), attempt, data));
  for (const mutate of [v => v.shopperId = "other-shopper", v => v.programId = "other-program", v => v.grantId = "other-grant",
    v => v.membershipId = "other-membership", v => v.membershipVersion++, v => v.requestId = "other", v => v.expiresAt = NOW, v => v.token = "private"]) {
    const value = result(attempt.body); mutate(value); assert.equal(pilotUi.pilotRenewalResult(value, attempt, data), null, String(mutate));
  }
});

test("UI reviews without writes and requires an explicit end and confirmation", async () => {
  const h = mount(); assert.equal(nodes(h.tree).some(n => n.type === "option" && n.props.value === "active-shopper"), false);
  await h.open(); assert.equal(h.requests.length, 1); assert.equal(h.requests[0].method, "GET");
  assert.match(h.requests[0].path, /renewalReview\?organisationId=org-one&shopperId=shopper-one$/);
  assert.match(text(h.tree), /Used capacity is not reset/); assert.match(text(h.tree), /Monthly redemptions — unchanged10/);
  assert.equal(h.button("Renew reviewed access").props.disabled, true);
  await h.submit(); assert.equal(h.requests.length, 1);
  h.fill(); await h.submit();
  assert.equal(h.requests.length, 2); assert.deepEqual(h.requests[1].body, { organisationId: "org-one", shopperId: "shopper-one", expectedState: "a".repeat(64), expiresAt: END, confirm: true, requestId: REQUEST_ID });
  assert.equal(h.requests[1].path, "/api/admin/retail-rewards/pilot/renew");
  assert.match(text(h.tree), /shopper is still disabled and the invitation is still revoked/);
  assert.equal(h.refreshed, 0, "No automatic invitation or follow-up mutation");
  h.button("Refresh pilot and review invitations").props.onClick(); assert.equal(h.refreshed, 1);
});

test("ambiguous POST locks review and retries the identical payload after a lost response", async () => {
  let effects = 0; const committed = new Map();
  const h = mount(async request => {
    if (request.method === "GET") return Response.json(review());
    if (!committed.has(request.body.requestId)) { effects++; committed.set(request.body.requestId, result(request.body)); throw new Error("Response lost"); }
    return Response.json(committed.get(request.body.requestId));
  });
  await h.open(); h.fill(); await h.submit();
  assert.equal(h.label("Existing test shopper").props.disabled, true);
  assert.equal(h.label("New access end (Malta time)").props.disabled, true);
  assert.equal(h.label("Confirm pilot renewal").props.disabled, true);
  assert.equal(nodes(h.tree).some(n => n.type === "button" && text(n) === "Review renewal"), false);
  await h.button("Retry same renewal").props.onClick({ preventDefault() {} }); h.render();
  assert.equal(h.requests[1].encoded, h.requests[2].encoded); assert.equal(h.madeIds, 1); assert.equal(effects, 1);
  assert.match(text(h.tree), /Access renewed until/);
});

test("selection invalidates a review and changed expiry clears confirmation", async () => {
  const h = mount(); await h.open(); h.fill();
  h.change(h.label("New access end (Malta time)"), "2026-11-19T14:30"); assert.equal(h.label("Confirm pilot renewal").props.checked, false);
  await h.submit(); assert.equal(h.requests.length, 1);
  h.change(h.label("Confirm pilot renewal"), true);
  h.change(h.label("Existing test shopper"), "");
  assert.equal(nodes(h.tree).some(n => n.type === "form"), false); assert.equal(h.requests.length, 1);
});

test("wrong-tenant review and invalid expiry cannot reach POST", async () => {
  const h = mount(() => Response.json({ ...review(), organisationId: "other-org" })); await h.open();
  assert.equal(nodes(h.tree).some(n => n.type === "form"), false); assert.equal(h.requests.length, 1);
  const valid = mount(); await valid.open(); valid.fill();
  valid.change(valid.label("New access end (Malta time)"), "2026-11-19T16:00"); valid.change(valid.label("Confirm pilot renewal"), true); await valid.submit();
  assert.equal(valid.requests.length, 1); assert.match(text(valid.tree), /within the next two hours/);
});

test("unmount on tenant change aborts and ignores a late review response", async () => {
  let release;
  const h = mount(() => new Promise(resolve => { release = resolve; }));
  h.change(h.label("Existing test shopper"), "shopper-one");
  const pending = h.button("Review renewal").props.onClick(); h.unmount();
  assert.equal(h.requests[0].signal.aborted, true); release(Response.json(review())); await pending;
  assert.equal(h.writesAfterUnmount, 0);
});

test("renewal routes admit only exact reviewed admin methods", () => {
  const read = "/api/admin/retail-rewards/pilot/renewalReview", write = "/api/admin/retail-rewards/pilot/renew";
  for (const [path, allowed] of [[read, ["GET", "HEAD"]], [write, ["POST"]]]) {
    for (const method of ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
      assert.equal(pilotPreviewRoute(path, method), allowed.includes(method) ? "ADMIN" : null, `${method} ${path}`);
      assert.equal(pilotPreviewRoute(path, method, true), null);
    }
    for (const sibling of [path + "/", path + "/other", path + "-all", path + "%2fother", path.replace("/pilot/", "/pilot\\")]) {
      for (const method of ["GET", "POST"]) assert.equal(pilotPreviewRoute(sibling, method), null);
    }
  }
});
