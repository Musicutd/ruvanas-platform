import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import * as pilotUi from "../lib/retail-rewards/pilot-admin-ui.mjs";
import * as readinessUi from "../lib/retail-rewards/pilot-readiness-ui.mjs";
import * as checkoutUi from "../lib/retail-rewards/checkout-ui.mjs";

const require = createRequire(import.meta.url), React = require("react");
const babel = require("next/dist/compiled/babel/core");
const file = "app/admin/retail-rewards/pilot/RewardsPilotAdmin.js";
const code = babel.transformSync(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), {
  filename: file, babelrc: false, configFile: false, envName: "test", presets: [require.resolve("next/babel")]
}).code;
const NOW = "2026-11-18T12:00:00.000Z", END = "2026-11-25T12:00:00.000Z";
class TestDate extends Date { constructor(...args) { super(...(args.length ? args : [NOW])); } }
const limits = { activeOffers: 3, locations: 2, staffSeats: 1, monthlyRedemptions: 10, analyticsRetentionDays: 30, exportEnabled: false, brandingEnabled: false };
function fixture() { return { ok: true, organisation: { id: "org-one", name: "Synthetic test shop" },
  program: { id: "program-one", status: "ACTIVE", timezone: "Europe/Malta", networkOptIn: true },
  grant: { id: "grant-one", tier: "REWARDS_STARTER", status: "TRIAL", expiresAt: END, limits },
  locations: [{ id: "draft-shop", name: "Draft shop", status: "DRAFT", profile: null }, { id: "active-shop", name: "Active shop", status: "ACTIVE", profile: null }],
  preparedShoppers: [{ shopperId: "prepared-one", email: "prepared@example.invalid", displayName: "Prepared shopper", authVersion: 1, preparedAt: "2026-11-17T10:00:00.000Z" }],
  shoppers: [], offers: [], audit: [], checkedAt: NOW }; }
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return tree && typeof tree === "object" && tree.props ? [tree, ...nodes(tree.props.children)] : [];
}
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join("");
  if (tree && typeof tree === "object") return text(tree.props?.children);
  return typeof tree === "string" || typeof tree === "number" ? String(tree) : "";
}
const settle = () => new Promise(resolve => setImmediate(resolve));
function mount() {
  const cells = []; let cursor = 0;
  const hookReact = { ...React,
    useState(initial) { const slot = cursor++; if (!(slot in cells)) cells[slot] = typeof initial === "function" ? initial() : initial;
      return [cells[slot], value => { cells[slot] = typeof value === "function" ? value(cells[slot]) : value; }]; },
    useRef(initial) { const slot = cursor++; if (!(slot in cells)) cells[slot] = { current: initial }; return cells[slot]; }, useEffect() {}
  };
  const module = { exports: {} }, data = fixture(), requests = [];
  const transport = async (path, options) => {
    requests.push({ path, method: options.method, body: options.body ? JSON.parse(options.body) : null });
    if (path.includes("/readiness?")) return Response.json({ ok: false, code: "FEATURE_DISABLED" }, { status: 403 });
    if (path.includes("/overview?")) return Response.json(data);
    if (path.endsWith("/activateLocation")) {
      const body = JSON.parse(options.body); data.locations.find(l => l.id === body.locationId).status = "ACTIVE";
      return Response.json({ ok: true, locationId: body.locationId, status: "ACTIVE" });
    }
    if (path.endsWith("/invitePrepared")) {
      const shopper = data.preparedShoppers.pop();
      data.shoppers.push({ shopperId: shopper.shopperId, displayName: shopper.displayName, status: "DISABLED", invitationStatus: "PENDING", invitationExpiresAt: "2026-11-19T12:00:00.000Z", membershipExpiresAt: END });
      return Response.json({ ok: true, shopperId: shopper.shopperId, invitationToken: "a".repeat(64), invitationExpiresAt: "2026-11-19T12:00:00.000Z", membershipExpiresAt: END });
    }
    throw new Error(`Unexpected fixture request: ${path}`);
  };
  const mocks = { "react": hookReact, "@/lib/retail-rewards/pilot-admin-ui.mjs": pilotUi,
    "@/lib/retail-rewards/pilot-readiness-ui.mjs": readinessUi, "@/lib/retail-rewards/checkout-ui.mjs": checkoutUi,
    "./pilot-admin.module.css": { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) } };
  vm.runInNewContext(code, { module, exports: module.exports, Date: TestDate, Intl, AbortController, setTimeout, clearTimeout,
    require(name) { if (Object.hasOwn(mocks, name)) return mocks[name];
      if (name.startsWith("react/jsx-")) return require(name);
      if (name.startsWith("@babel/runtime/")) return require(`next/dist/compiled/${name}`);
      throw new Error(`Unexpected UI dependency: ${name}`); },
    fetch() { throw new Error("Real network access is forbidden"); } });
  const Component = module.exports.default;
  let tree;
  const render = () => { cursor = 0; tree = Component({ initialOrganisations: [{ id: "org-one", name: "Synthetic test shop" }], transport, previewOnly: true }); return tree; };
  const find = predicate => { const found = nodes(tree).find(predicate); assert.ok(found, "Expected UI control"); return found; };
  const label = value => find(n => n.props["aria-label"] === value);
  const button = value => find(n => n.type === "button" && text(n) === value);
  const form = buttonText => find(n => n.type === "form" && nodes(n).some(c => c.type === "button" && text(c) === buttonText));
  const change = (node, value) => { node.props.onChange({ target: { value, checked: value } }); render(); };
  async function open() { render(); change(label("Test organisation"), "org-one"); await button("Review pilot").props.onClick(); render(); }
  return { open, render, find, label, button, form, change, requests, get tree() { return tree; } };
}

test("pilot UI activates only the selected draft and exposes no audio fields", async () => {
  const h = mount(); await h.open(); h.button("2 · Shops").props.onClick(); h.render();
  assert.equal(nodes(h.label("Existing shop")).some(n => n.type === "option" && n.props.value === "draft-shop"), false);
  h.change(h.label("Draft shop"), "draft-shop");
  let form = h.form("Activate shop for Rewards");
  h.change(nodes(form).find(n => n.type === "input" && n.props.type === "checkbox"), true);
  h.form("Activate shop for Rewards").props.onSubmit({ preventDefault() {} }); await settle(); h.render();
  const writes = h.requests.filter(r => r.method === "POST");
  assert.deepEqual(writes, [{ path: "/api/admin/retail-rewards/pilot/activateLocation", method: "POST", body: { organisationId: "org-one", locationId: "draft-shop", confirm: true } }]);
  assert.ok(nodes(h.label("Existing shop")).some(n => n.type === "option" && n.props.value === "draft-shop"));
});

test("pilot UI submits pinned prepared identity and clears one-time code on workspace change", async () => {
  const h = mount(); await h.open(); h.button("4 · Shoppers").props.onClick(); h.render();
  h.change(h.label("Prepared shopper"), "prepared-one");
  let form = h.form("Invite prepared shopper");
  h.change(nodes(form).find(n => n.type === "input" && n.props.type === "datetime-local"), "2026-11-25T13:00");
  form = h.form("Invite prepared shopper"); h.change(nodes(form).find(n => n.type === "input" && n.props.type === "checkbox"), true);
  h.form("Invite prepared shopper").props.onSubmit({ preventDefault() {} }); await settle(); h.render();
  const writes = h.requests.filter(r => r.method === "POST"); assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].body, { organisationId: "org-one", shopperId: "prepared-one", email: "prepared@example.invalid", authVersion: 1, preparedAt: "2026-11-17T10:00:00.000Z", expiresAt: END, confirm: true });
  assert.equal(writes[0].path, "/api/admin/retail-rewards/pilot/invitePrepared");
  assert.equal(h.label("One-time invitation code").props.value, "a".repeat(64));
  assert.ok(text(h.tree).includes("account stays disabled"));
  h.change(h.label("Test organisation"), "");
  assert.equal(nodes(h.tree).some(n => n.props["aria-label"] === "One-time invitation code"), false);
});
