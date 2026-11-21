import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import * as preparation from "../lib/retail-rewards/pilot-preparation-contracts.mjs";
import * as readiness from "../lib/retail-rewards/pilot-readiness-ui.mjs";
import * as checkout from "../lib/retail-rewards/checkout-ui.mjs";

const require = createRequire(import.meta.url), React = require("react");
const babel = require("next/dist/compiled/babel/core");
const folder = "app/admin/retail-rewards/preparation/";
function compile(file) {
  return babel.transformSync(readFileSync(new URL(`../${folder}${file}`, import.meta.url), "utf8"), {
    filename: file, babelrc: false, configFile: false, envName: "test", presets: [require.resolve("next/babel")]
  }).code;
}
const componentCode = compile("PilotPreparation.js"), pageCode = compile("page.js");
const NOW = "2026-11-19T12:00:00.000Z", EXPIRED = "2026-11-18T18:20:00.000Z";
const css = { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) };
function fixture(organisationId = "org-one") {
  const organisation = { id: organisationId, name: organisationId === "org-one" ? "Example Test Shop" : "Second Test Shop" };
  const rows = [
    ["environment", "BLOCKED", "FEATURES_DISABLED", 1, 0], ["owner", "READY", "OWNER_READY", 1, 1],
    ["entitlement", "BLOCKED", "ENTITLEMENT_INACTIVE", 1, 0], ["shops", "READY", "SHOPS_READY", 1, 1],
    ["coupons", "BLOCKED", "COUPONS_INACTIVE", 3, 0], ["cashiers", "BLOCKED", "CASHIERS_INACTIVE", 1, 0],
    ["shoppers", "MISSING", "SHOPPERS_MISSING", 0, 0]
  ];
  return { ok: true, mode: "READ_ONLY_PREPARATION", rewardsEnabled: false, organisation,
    readiness: { ok: true, organisation: { ...organisation }, configured: false, eligibleNow: false, endToEndTest: "NOT_VERIFIED",
      checks: rows.map(([key, status, code, configuredCount, eligibleCount]) => ({ key, status, code, configuredCount, eligibleCount })),
      pendingInvitations: 0, checkedAt: NOW },
    preparedShoppers: { total: 1, disabled: 1, active: 0, suspended: 0, enrolled: 1, expiredMemberships: 1, revokedInvitations: 1 },
    grantExpiresAt: EXPIRED, checkedAt: NOW, endToEndTest: "NOT_VERIFIED" };
}
function children(tree) { return tree && typeof tree === "object" && typeof tree.type === "function" ? tree.type(tree.props) : tree?.props?.children; }
function nodes(tree) { return Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === "object" && tree.props ? [tree, ...nodes(children(tree))] : []; }
function text(tree) { return Array.isArray(tree) ? tree.map(text).join("") : tree && typeof tree === "object" ? text(children(tree)) : typeof tree === "string" || typeof tree === "number" ? String(tree) : ""; }
function evaluate(code, mocks, extra = {}) {
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, Intl, AbortController, setTimeout, clearTimeout,
    require(name) {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (name.startsWith("react/jsx-")) return require(name);
      if (name.startsWith("@babel/runtime/")) return require(`next/dist/compiled/${name}`);
      throw new Error(`Unexpected UI dependency: ${name}`);
    }, fetch() { throw new Error("Real network access is forbidden"); }, ...extra });
  return module.exports;
}
const commonMocks = { "@/lib/retail-rewards/pilot-preparation-contracts.mjs": preparation,
  "@/lib/retail-rewards/pilot-readiness-ui.mjs": readiness,
  "@/lib/retail-rewards/checkout-ui.mjs": checkout,
  "../pilot/pilot-admin.module.css": css, "./preparation.module.css": css };

function mount({ initialSnapshot = fixture(), organisationId = "org-one", handler } = {}) {
  const cells = [], effects = [], requests = []; let cursor = 0, tree, unmounted = false, writesAfterUnmount = 0;
  const hooks = { ...React,
    useState(initial) { const index = cursor++; if (!(index in cells)) cells[index] = typeof initial === "function" ? initial() : initial;
      return [cells[index], next => { if (unmounted) writesAfterUnmount++; cells[index] = typeof next === "function" ? next(cells[index]) : next; }]; },
    useRef(initial) { const index = cursor++; if (!(index in cells)) cells[index] = { current: initial }; return cells[index]; },
    useEffect(fn, dependencies) { const index = cursor++, old = cells[index];
      if (!old || dependencies.some((value, i) => !Object.is(value, old.dependencies[i]))) effects.push(() => {
        old?.cleanup?.(); cells[index] = { dependencies, cleanup: fn() };
      }); }
  };
  const Component = evaluate(componentCode, { ...commonMocks, react: hooks }).default;
  const props = { organisationId, initialSnapshot, transport: async (path, options) => {
    requests.push({ path, ...options }); return handler ? handler(requests.at(-1), requests) : Response.json(fixture(props.organisationId));
  } };
  const render = () => { cursor = 0; tree = Component(props); while (effects.length) effects.shift()(); return tree; };
  const button = () => { const all = nodes(tree).filter(node => node.type === "button"); assert.equal(all.length, 1); return all[0]; };
  async function refresh() { const pending = button().props.onClick(); render(); await pending; render(); }
  function unmount() { unmounted = true; for (const cell of cells) cell?.cleanup?.(); }
  render(); render();
  return { props, render, button, refresh, unmount, requests, get tree() { return tree; }, get writesAfterUnmount() { return writesAfterUnmount; } };
}

test("preparation presents saved setup while Rewards is off, with both sign-ins explicitly unverified", () => {
  const h = mount(), content = text(h.tree);
  for (const label of ["1 · Test shop setup", "2 · Saved access window", "3 · Shopper setup and invitations", "4 · Before a rehearsal",
    "Rewards off", "End-to-end test not verified", "Client Admin sign-in: not verified.", "Shopper sign-in: not verified.",
    "Prepared shopper accounts1", "Disabled accounts1", "Revoked invitations1", "Expired memberships1", "Window at the last checkExpired"]) assert.ok(content.includes(label), label);
  assert.equal(h.requests.length, 0);
  assert.equal(text(h.button()), "Refresh snapshot");
  assert.equal(nodes(h.tree).some(node => ["form", "input", "textarea", "select"].includes(node.type)), false);
  assert.deepEqual(nodes(h.tree).filter(node => node.type === "a").map(node => node.props.href), ["/admin/organisations"]);
});

test("the refresh handler uses one scoped no-store GET and renders a newly validated snapshot", async () => {
  const h = mount({ handler(request) {
    assert.equal(request.method, "GET"); assert.equal(request.credentials, "same-origin"); assert.equal(request.cache, "no-store");
    assert.equal(request.body, undefined); assert.ok(request.signal);
    const value = fixture(); value.checkedAt = value.readiness.checkedAt = "2026-11-19T12:05:00.000Z"; return Response.json(value);
  } });
  await h.refresh(); assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].path, "/api/admin/retail-rewards/preparation?organisationId=org-one");
  assert.ok(nodes(h.tree).some(node => node.type === "time" && node.props.dateTime === "2026-11-19T12:05:00.000Z"));
  assert.equal(h.button().props.disabled, false);
});

test("refresh hides old results while pending and after failure without exposing server details", async () => {
  let release;
  const h = mount({ handler: () => new Promise(resolve => { release = resolve; }) });
  const pending = h.button().props.onClick(); h.render();
  assert.equal(h.button().props.disabled, true); assert.doesNotMatch(text(h.tree), /Example Test Shop|Disabled accounts/);
  release(Response.json({ ok: false, code: "UNAVAILABLE", error: "INTERNAL_PRIVATE_DETAIL" }, { status: 503 }));
  await pending; h.render();
  assert.match(text(h.tree), /could not be verified/); assert.doesNotMatch(text(h.tree), /INTERNAL_PRIVATE_DETAIL|Example Test Shop|Disabled accounts/);
  assert.ok(nodes(h.tree).some(node => node.props.role === "alert" && node.props.tabIndex === -1));
});

test("wrong tenant, secrets, invalid counts and false completion responses never become visible", async () => {
  for (const mutate of [value => value.organisation.id = "other-org", value => value.readiness.organisation.id = "other-org",
    value => value.invitationToken = "DO_NOT_DISPLAY", value => value.preparedShoppers.email = "hidden@example.invalid",
    value => value.preparedShoppers.disabled = 2, value => value.rewardsEnabled = true,
    value => value.endToEndTest = "VERIFIED", value => value.readiness.eligibleNow = true]) {
    const value = fixture(); mutate(value);
    const h = mount({ handler: () => Response.json(value) }); await h.refresh();
    assert.match(text(h.tree), /could not be verified/); assert.doesNotMatch(text(h.tree), /DO_NOT_DISPLAY|hidden@|Example Test Shop|Disabled accounts/);
    assert.equal(h.requests.length, 1); assert.equal(h.requests[0].method, "GET");
  }
});

test("an invalid initial snapshot renders no saved state or automatic request", () => {
  const value = fixture(); value.passwordHash = "DO_NOT_DISPLAY";
  const h = mount({ initialSnapshot: value });
  assert.match(text(h.tree), /No verified snapshot/); assert.doesNotMatch(text(h.tree), /DO_NOT_DISPLAY|Example Test Shop/);
  assert.equal(h.requests.length, 0);
});

test("a malformed component target cannot start even a read request", async () => {
  for (const organisationId of [null, ["org-one"], "../other", ""]) {
    const h = mount({ organisationId });
    assert.equal(h.button().props.disabled, true);
    await h.refresh(); assert.equal(h.requests.length, 0);
  }
});

test("changing the workspace aborts an in-flight check and ignores its late response", async () => {
  let release;
  const h = mount({ handler: () => new Promise(resolve => { release = resolve; }) });
  const pending = h.button().props.onClick(); h.render();
  h.props.organisationId = "org-two"; h.props.initialSnapshot = fixture("org-two"); h.render(); h.render();
  assert.equal(h.requests[0].signal.aborted, true);
  release(Response.json(fixture())); await pending; h.render();
  assert.match(text(h.tree), /Second Test Shop/); assert.doesNotMatch(text(h.tree), /Example Test Shop/);
});

test("unmount cancels a refresh and never updates the retired component", async () => {
  let release;
  const h = mount({ handler: () => new Promise(resolve => { release = resolve; }) });
  const pending = h.button().props.onClick(); h.unmount();
  assert.equal(h.requests[0].signal.aborted, true);
  release(Response.json(fixture())); await pending;
  assert.equal(h.writesAfterUnmount, 0);
});

test("an auth or closed-preparation denial replaces the snapshot with safe guidance", async () => {
  for (const [code, expected] of [["AUTH_REQUIRED", /session could not be confirmed/], ["PREPARATION_UNAVAILABLE", /unavailable for the current workspace/], ["REVIEW_TOO_LARGE", /No partial snapshot/]]) {
    const h = mount({ handler: () => Response.json({ ok: false, code, error: "PRIVATE_DETAIL" }, { status: 403 }) });
    await h.refresh(); assert.match(text(h.tree), expected); assert.doesNotMatch(text(h.tree), /PRIVATE_DETAIL|Example Test Shop/);
    assert.equal(nodes(h.tree).some(node => node.type === "a" && node.props.href.includes("logout")), false);
  }
});

test("future expiry and accepted account data never imply a verified session or an open pilot", () => {
  const value = fixture(); value.grantExpiresAt = "2026-11-20T12:00:00.000Z";
  value.preparedShoppers.disabled = 0; value.preparedShoppers.active = 1;
  value.readiness.checks[6] = { key: "shoppers", status: "READY", code: "SHOPPERS_READY", configuredCount: 1, eligibleCount: 1 };
  value.readiness.configured = true;
  const h = mount({ initialSnapshot: value }), content = text(h.tree);
  assert.match(content, /End time is still in the future/); assert.match(content, /Rewards off/);
  assert.match(content, /Shopper sign-in: not verified/); assert.match(content, /End-to-end test not verified/);
  assert.doesNotMatch(content, /Pilot ready|Signed in successfully/);
});

test("organisation names render as escaped text and the UI has no injected HTML sink", () => {
  const value = fixture(); value.organisation.name = value.readiness.organisation.name = "<img src=x onerror=alert(1)>";
  const Component = evaluate(componentCode, { ...commonMocks, react: React }).default;
  const html = require("react-dom/server").renderToStaticMarkup(React.createElement(Component, { organisationId: "org-one", initialSnapshot: value }));
  assert.match(html, /&lt;img/); assert.doesNotMatch(html, /<img|onerror="/);
});

function page(loader) {
  return evaluate(pageCode, { ...commonMocks, react: React,
    "@/lib/retail-rewards/pilot-preparation-server": { loadPilotPreparationPage: loader },
    "./PilotPreparation": { __esModule: true, default: props => React.createElement("div", { "data-test-snapshot": props.organisationId }, props.initialSnapshot.organisation.name) }
  });
}
test("page requires one valid explicit workspace and never loads a broad organisation list", async () => {
  let calls = 0; const mod = page(async () => { calls++; return fixture(); });
  for (const query of [{}, { organisationId: ["org-one", "org-two"] }, { organisationId: "../other" }, { organisationId: "" }]) {
    const tree = await mod.default({ searchParams: Promise.resolve(query) });
    assert.match(text(tree), /Choose the prepared test workspace/);
    assert.equal(nodes(tree).filter(node => node.type === "a")[0].props.href, "/admin/organisations");
  }
  assert.equal(calls, 0);
  assert.equal(mod.dynamic, "force-dynamic"); assert.equal(mod.metadata.robots.index, false); assert.equal(mod.metadata.referrer, "no-referrer");
});

test("page loads the exact target and passes only a strictly bound snapshot to the component", async () => {
  const calls = []; const mod = page(async id => { calls.push(id); return fixture(); });
  const tree = await mod.default({ searchParams: Promise.resolve({ organisationId: "org-one" }) });
  assert.deepEqual(calls, ["org-one"]); assert.equal(tree.props.organisationId, "org-one");
  assert.equal(tree.props.initialSnapshot.endToEndTest, "NOT_VERIFIED");
});

test("page fails closed for a foreign snapshot or denied session without leaking the raw error", async () => {
  for (const response of [fixture("org-two"), { ok: false, code: "AUTH_REQUIRED", error: "PRIVATE_DETAIL" }]) {
    const tree = await page(async () => response).default({ searchParams: { organisationId: "org-one" } });
    assert.match(text(tree), /Pilot preparation unavailable/); assert.doesNotMatch(text(tree), /PRIVATE_DETAIL|Second Test Shop/);
    assert.ok(nodes(tree).some(node => node.props.role === "alert"));
  }
});
