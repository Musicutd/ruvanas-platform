import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import vm from "node:vm";
import * as ui from "../lib/retail-stream-setup-ui.mjs";

const ORG = "org-retail-a", SECRET = "SYNTHETIC_SECRET_DO_NOT_DISPLAY  ";
const setup = (saved = false) => ({ organisation: { id: ORG, name: "Retail <pilot>" }, canSaveDraft: true, blockedReason: null,
  entitlements: { maxBitrateKbps: 128, listenerLimit: 20, storageLimitGb: 1, stationLimit: 1, streamLimit: 1, siteLimit: null, displayLimit: null, digitalSignageDisplayLimit: 1 },
  station: saved ? { id: "station-retail-a", status: "DRAFT" } : null,
  connection: saved ? { providerKey: "CENTOVA_CAST", outputCodec: "MP3", streamUrl: "https://retail.example.com/stream", serverHost: "source.example.com",
    serverPort: 8110, sourcePort: 8112, centovaUsername: "retail_a", sourceUsername: "", bitrateKbps: 128, credentialConfigured: true } : null,
  canStart: false, probeEnabled: false, outboundAutoDjEnabled: false, publicPlayerEnabled: false, stationWebsiteEnabled: false,
  listenerRequestsEnabled: false, audiencePolicy: "INTERNAL", requiresPlanLimitReview: true });
const form = () => ui.retailStreamConnectionForm(setup(true));

test("safe view removes credential, grant and diagnostic objects and rejects foreign or enabled responses", () => {
  const value = setup(true); value.connection.sourcePasswordEncrypted = SECRET; value.secret = SECRET; value.station.worker = SECRET;
  const safe = ui.safeRetailStreamSetupView(value, ORG);
  assert.doesNotMatch(JSON.stringify(safe), /SYNTHETIC_SECRET|worker|Encrypted/);
  for (const mutate of [v => { v.organisation.id = "foreign"; }, v => { v.canStart = true; }, v => { v.probeEnabled = true; },
    v => { v.outboundAutoDjEnabled = true; }, v => { v.publicPlayerEnabled = true; }, v => { v.station.status = "ACTIVE"; },
    v => { v.connection.credentialConfigured = "true"; }]) {
    const v = setup(true); mutate(v); assert.throws(() => ui.safeRetailStreamSetupView(v, ORG), /could not be verified/);
  }
});

test("flat draft request never adds tenant, station, entitlement, output or activation fields", () => {
  const request = ui.retailStreamDraftRequest(form(), SECRET, { maximumBitrateKbps: 128 });
  assert.deepEqual(Object.keys(request), ["providerKey", "outputCodec", "streamUrl", "serverHost", "serverPort", "sourcePort", "centovaUsername", "sourceUsername", "bitrateKbps", "sourcePassword"]);
  assert.equal(request.sourcePassword, SECRET, "Do not trim or rewrite an opaque source password");
  assert.equal(request.serverPort, 8110); assert.equal(request.sourcePort, 8112);
  const kept = ui.retailStreamDraftRequest(form(), "", { maximumBitrateKbps: 128, credentialConfigured: true });
  assert.equal(Object.hasOwn(kept, "sourcePassword"), false);
  assert.throws(() => ui.retailStreamDraftRequest(form(), SECRET, { maximumBitrateKbps: 128, credentialConfigured: true }), /separate administrator review/);
  assert.throws(() => ui.retailStreamDraftRequest(form(), "", { maximumBitrateKbps: 128 }), /Enter the Centova live-source password/);
});

test("explicit HTTPS, ports and current bitrate ceiling are validated without guessing limits", () => {
  for (const [key, value] of [["streamUrl", "http://retail.example.com/stream"], ["streamUrl", "https://retail.example.com/?token=secret"],
    ["streamUrl", "https://name:password@retail.example.com/"], ["sourcePort", ""], ["sourcePort", "8112.5"], ["sourcePort", "65536"], ["bitrateKbps", "129"]]) {
    assert.throws(() => ui.retailStreamDraftRequest({ ...form(), [key]: value }, SECRET, { maximumBitrateKbps: 128 }));
  }
  assert.equal(ui.retailStreamDraftRequest({ ...form(), serverPort: "" }, SECRET, { maximumBitrateKbps: 128 }).serverPort, null);
  assert.throws(() => ui.retailStreamDraftRequest(form(), SECRET, { maximumBitrateKbps: null }), /current plan limit/);
  assert.doesNotMatch(ui.retailStreamSetupNotice(`UNKNOWN_${SECRET}`), /SYNTHETIC_SECRET/);
});

const require = createRequire(import.meta.url), React = require("react"), babel = require("next/dist/compiled/babel/core");
const { renderToStaticMarkup } = require("react-dom/server"), h = React.createElement;
const root = "app/admin/organisations/[organisationId]/retail-stream/";
const css = { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) };
const compiled = new Map();
async function load(file, { hooks = React, mock = {}, fetch = () => { throw new Error("Unexpected network action"); }, reload = () => {} } = {}) {
  if (!compiled.has(file)) compiled.set(file, babel.transformSync(await readFile(new URL(`../${file}`, import.meta.url), "utf8"), {
    filename: file, babelrc: false, configFile: false, envName: "test", presets: [require.resolve("next/babel")]
  }).code);
  const module = { exports: {} };
  vm.runInNewContext(compiled.get(file), { module, exports: module.exports, fetch, AbortController, setTimeout, clearTimeout,
    window: { location: { reload } }, require: name => {
      if (Object.hasOwn(mock, name)) return mock[name];
      if (name === "react") return hooks;
      if (name === "@/lib/retail-stream-setup-ui.mjs") return ui;
      if (name === "./RetailStreamPlayoutPanel") return () => null;
      if (name === "next/link") return ({ children, ...props }) => h("a", props, children);
      if (name.endsWith(".module.css")) return css;
      return require(name.startsWith("@babel/runtime/") ? `next/dist/compiled/${name}` : name);
    }
  });
  return module.exports;
}
const navigation = { redirect: href => { throw Object.assign(new Error("REDIRECT"), { href }); }, notFound: () => { throw new Error("NOT_FOUND"); } };

test("the actual form renders private draft controls, escaped metadata and an empty source password only", async () => {
  const Form = (await load(`${root}RetailStreamConnectionForm.js`)).default;
  const html = renderToStaticMarkup(h(Form, { initialSetup: setup() }));
  assert.match(html, /Retail &lt;pilot&gt;/); assert.match(html, /type="password"/); assert.match(html, /autoComplete="new-password"/);
  assert.match(html, /Live-source port/); assert.match(html, /Server port \(optional\)/); assert.match(html, /audio stays off/);
  assert.doesNotMatch(html, /<audio|autoplay|SYNTHETIC_SECRET|value="[^"]*password|Activate station|Prepare channel|Test connection/);
  const saved = renderToStaticMarkup(h(Form, { initialSetup: setup(true) }));
  assert.doesNotMatch(saved, /type="password"/);
  assert.match(saved, /name="serverHost"[^>]*readonly=""/);
  assert.match(saved, /separate administrator review/);
});

test("credential-bearing listener URLs never enter a browser view and protected profiles expose no connection", async () => {
  for (const streamUrl of ["https://user:password@retail.example.com/stream", "https://retail.example.com/stream?token=SECRET", "https://retail.example.com/stream#SECRET"]) {
    const value = setup(true); value.connection.streamUrl = streamUrl;
    assert.throws(() => ui.safeRetailStreamSetupView(value, ORG), /could not be verified/);
  }
  const blocked = setup(true); blocked.canSaveDraft = false; blocked.station.status = "ACTIVE";
  blocked.blockedReason = SECRET; blocked.connection.streamUrl = `https://name:${SECRET.trim()}@retail.example.com/stream`;
  const safe = ui.safeRetailStreamSetupView(blocked, ORG);
  assert.equal(safe.connection, null); assert.equal(safe.blockedReason, null); assert.doesNotMatch(JSON.stringify(safe), /SYNTHETIC_SECRET/);
  const Form = (await load(`${root}RetailStreamConnectionForm.js`)).default;
  const html = renderToStaticMarkup(h(Form, { initialSetup: safe }));
  assert.match(html, /Observed station status: ACTIVE/); assert.match(html, /current audio state has not been verified/);
  assert.doesNotMatch(html, /<form|type="password"|Not configured|audio stays off|source.example/);
});

test("source password and full UTF-8 request retain server size bounds", () => {
  assert.throws(() => ui.retailStreamDraftRequest(form(), "a".repeat(1025), { maximumBitrateKbps: 128 }), /valid source password/);
  assert.throws(() => ui.retailStreamDraftRequest({ ...form(), streamUrl: `https://retail.example.com/${"a".repeat(1900)}` }, "é".repeat(1024), { maximumBitrateKbps: 128 }), /4 KB request limit/);
  assert.equal(ui.RETAIL_STREAM_DRAFT_REQUEST_BYTES, 4096);
});

test("a null first-use connection remains editable, but blank or partially populated legacy data does not", () => {
  const initialConnection = { providerKey: "CENTOVA_CAST", outputCodec: "MP3", streamUrl: "", serverHost: "", serverPort: null,
    sourcePort: null, centovaUsername: "", sourceUsername: null, bitrateKbps: null, credentialConfigured: false };
  for (const station of [null, { id: "station-retail-a", status: "DRAFT" }]) {
    const value = { ...setup(), station, connection: null };
    const safe = ui.safeRetailStreamSetupView(value, ORG);
    assert.equal(safe.connection, null); assert.equal(safe.canSaveDraft, true);
    for (const connection of [initialConnection, { ...initialConnection, sourcePort: 8112 }])
      assert.throws(() => ui.safeRetailStreamSetupView({ ...value, connection }, ORG), /could not be verified/);
  }
});

function hookHarness() {
  const slots = []; let cursor = 0;
  return { slots, reset: () => { cursor = 0; }, hooks: { ...React,
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], next => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }]; },
    useRef(initial) { const index = cursor++; return slots[index] ||= { current: initial }; }, useEffect() {}
  } };
}
const nodes = tree => !tree || typeof tree !== "object" ? [] : [tree, ...React.Children.toArray(tree.props?.children).flatMap(nodes)];
async function interactive(fetch) {
  const state = hookHarness(), Form = (await load(`${root}RetailStreamConnectionForm.js`, { hooks: state.hooks, fetch })).default;
  const render = () => { state.reset(); return Form({ initialSetup: setup() }); };
  render(); state.slots[1] = form(); state.slots[5] = true; state.slots[6].current = { value: SECRET };
  return { ...state, render, submit: () => nodes(render()).find(node => node.type === "form").props.onSubmit({ preventDefault() {} }) };
}

test("successful save uses only the organisation-scoped draft POST and clears source password", async () => {
  const calls = [];
  const state = await interactive(async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => ({ saved: true, setup: { ...setup(true), maliciousSecret: SECRET } }) }; });
  await state.submit();
  assert.equal(calls.length, 1); assert.equal(calls[0].url, `/api/admin/organisations/${ORG}/retail-stream`);
  assert.equal(calls[0].options.method, "POST"); assert.equal(calls[0].options.credentials, "same-origin");
  assert.equal(JSON.parse(calls[0].options.body).sourcePassword, SECRET);
  assert.equal(state.slots[6].current.value, ""); assert.equal(state.slots[0].station.status, "DRAFT");
  assert.doesNotMatch(JSON.stringify(state.slots.slice(0, 6)), /SYNTHETIC_SECRET/);
  assert.match(state.slots[3].text, /No provider connection was tested/);
});

test("uncertain or malformed save clears secrets, never retries and blocks another submit until reload", async () => {
  for (const fetch of [async () => { throw new Error(SECRET); }, async () => ({ ok: true, json: async () => ({ saved: true, setup: { ...setup(true), organisation: { id: "foreign", name: SECRET } } }) })]) {
    let calls = 0;
    const state = await interactive(async (...args) => { calls += 1; return fetch(...args); });
    await state.submit(); await state.submit();
    assert.equal(calls, 1); assert.equal(state.slots[6].current.value, ""); assert.equal(state.slots[4], true);
    assert.match(state.slots[3].text, /Reload saved status/); assert.doesNotMatch(state.slots[3].text, /SYNTHETIC_SECRET/);
  }
});

test("server diagnostics are never rendered from a rejected response", async () => {
  const state = await interactive(async () => ({ ok: false, json: async () => ({ error: SECRET, code: "UNKNOWN_DIAGNOSTIC" }) }));
  await state.submit();
  assert.doesNotMatch(state.slots[3].text, /SYNTHETIC_SECRET/); assert.equal(state.slots[6].current.value, "");
});

test("Strict Mode setup-cleanup-setup retains mounted state and save feedback", async () => {
  const state = hookHarness(), effects = [];
  state.hooks.useEffect = effect => { effects.push(effect); };
  const Form = (await load(`${root}RetailStreamConnectionForm.js`, { hooks: state.hooks,
    fetch: async () => ({ ok: true, json: async () => ({ saved: true, setup: setup(true) }) }) })).default;
  const render = () => { state.reset(); return Form({ initialSetup: setup() }); };
  render(); const effect = effects[0], cleanup = effect(); cleanup(); effect();
  assert.equal(state.slots[9].current, true);
  state.slots[1] = form(); state.slots[5] = true; state.slots[6].current = { value: SECRET };
  await nodes(render()).find(node => node.type === "form").props.onSubmit({ preventDefault() {} });
  assert.equal(state.slots[0].station.status, "DRAFT"); assert.equal(state.slots[3].type, "success");
});

test("organisation page checks current Super Admin before its freshly scoped read service", async () => {
  for (const actor of [null, { id: "support", role: "SUPPORT" }]) {
    let calls = 0;
    const Page = (await load(`${root}page.js`, { mock: {
      "next/navigation": navigation, "@/lib/requireAdmin": { getAdminUser: async () => actor }, "@/lib/prisma": { prisma: {} },
      "@/lib/retail-stream-setup-service.mjs": { loadRetailStreamSetup: async () => { calls += 1; return setup(); } },
      "./RetailStreamConnectionForm": () => null
    } })).default;
    await assert.rejects(() => Page({ params: Promise.resolve({ organisationId: ORG }) }), error => error.href === (actor ? "/admin/organisations" : "/login"));
    assert.equal(calls, 0);
  }
  const calls = [], db = {};
  const Page = (await load(`${root}page.js`, { mock: {
    "next/navigation": navigation, "@/lib/requireAdmin": { getAdminUser: async () => ({ id: "super-admin", role: "SUPER_ADMIN" }) }, "@/lib/prisma": { prisma: db },
    "@/lib/retail-stream-setup-service.mjs": { loadRetailStreamSetup: async (database, options) => {
      calls.push(options); assert.equal(database, db); return { ...setup(true), rawDiagnostic: SECRET, connection: { ...setup(true).connection, sourcePasswordEncrypted: SECRET } };
    } }, "./RetailStreamConnectionForm": ({ initialSetup }) => h("pre", null, JSON.stringify(initialSetup))
  } })).default;
  const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ organisationId: ORG }) }));
  assert.equal(calls.length, 1); assert.equal(calls[0].actorUserId, "super-admin"); assert.equal(calls[0].organisationId, ORG);
  assert.doesNotMatch(html, /SYNTHETIC_SECRET|Encrypted|rawDiagnostic/);
});

test("the real organisation page accepts the service first-use null connection without hiding setup", async () => {
  const value = setup();
  const Page = (await load(`${root}page.js`, { mock: {
    "next/navigation": navigation, "@/lib/requireAdmin": { getAdminUser: async () => ({ id: "super-admin", role: "SUPER_ADMIN" }) },
    "@/lib/prisma": { prisma: {} }, "@/lib/retail-stream-setup-service.mjs": { loadRetailStreamSetup: async () => value },
    "./RetailStreamConnectionForm": ({ initialSetup }) => h("div", { "data-can-save": String(initialSetup.canSaveDraft) }, "First-use Retail form")
  } })).default;
  const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ organisationId: ORG }) }));
  assert.match(html, /First-use Retail form/); assert.match(html, /data-can-save="true"/); assert.doesNotMatch(html, /Setup is unavailable/);
});

test("pilot entry resolves only an existing unique Retail membership and never creates or selects an active organisation", async () => {
  const active = id => ({ organisationId: id, organisation: { id, subscription: { serviceEnabled: true, retailRadioEnabled: true } } });
  for (const [users, expected] of [[[], null], [[{ memberships: [active(ORG)] }], ORG],
    [[{ memberships: [active(ORG), active("org-other")] }], null], [[{ memberships: [active(ORG)] }, { memberships: [] }], null]]) {
    const calls = [];
    const Page = (await load("app/admin/retail-stream/page.js", { mock: {
      "next/navigation": navigation, "@/lib/requireAdmin": { getAdminUser: async () => ({ id: "super-admin", role: "SUPER_ADMIN" }) },
      "@/lib/entitlements.mjs": { resolveEntitlements: value => value },
      "@/lib/prisma": { prisma: { user: { findMany: async query => { calls.push(query); return users; } } } }
    } })).default;
    if (expected) await assert.rejects(() => Page(), error => error.href === `/admin/organisations/${expected}/retail-stream`);
    else { const html = renderToStaticMarkup(await Page()); assert.match(html, /No account, plan, channel or streaming connection has been created/); }
    assert.equal(calls.length, 1); assert.equal(calls[0].where.email.equals, "retail@manuelchircop.com");
    assert.equal(calls[0].take, 2); assert.equal(calls[0].select.memberships.take, 21);
  }
});

test("pilot entry denies non-Super-Admin sessions before searching accounts", async () => {
  for (const actor of [null, { id: "support", role: "SUPPORT" }, { id: "retail-user", role: "OWNER" }]) {
    let calls = 0;
    const Page = (await load("app/admin/retail-stream/page.js", { mock: {
      "next/navigation": navigation, "@/lib/requireAdmin": { getAdminUser: async () => actor },
      "@/lib/entitlements.mjs": { resolveEntitlements: value => value },
      "@/lib/prisma": { prisma: { user: { findMany: async () => { calls += 1; throw new Error("Unexpected read"); } } } }
    } })).default;
    await assert.rejects(() => Page(), error => error.href === (actor ? "/admin/organisations" : "/login"));
    assert.equal(calls, 0);
  }
});
