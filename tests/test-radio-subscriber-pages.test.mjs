import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import * as accountPolicy from "../lib/private-preview-account-policy.mjs";

const require = createRequire(import.meta.url), React = require("react"), h = React.createElement;
const { renderToStaticMarkup } = require("react-dom/server"), babel = require("next/dist/compiled/babel/core");
const stationId = "cmvcnbwi20008hr23sd76psi8";
const workspace = { stationId, stationName: "Test Radio", channelId: "test-channel" };
const compiled = new Map();
const css = { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) };
function setup(file, { resolved = workspace, requestedStationId = stationId } = {}) {
  const calls = [], entitlements = { sandboxDraftOnly: true, sandboxCatalogueMetadata: true, onlineRadioEnabled: true };
  const subscription = { plan: accountPolicy.PREVIEW_ONLINE_DRAFT_CATALOGUE_PLAN };
  const context = { user: { id: "radio-user", name: "Radio", role: "OWNER" },
    session: { user: { name: "Radio", privatePreviewAccess: { pillars: ["ONLINE"], expiresAt: new Date("2099-01-01") } } },
    membership: { organisationId: "radio-org", role: "OWNER", organisation: { id: "radio-org", name: "Radio", subscription,
      stations: [{ id: stationId, status: "ACTIVE" }], betaParticipations: [] } } };
  const station = { id: requestedStationId, name: "Test Radio", productFamily: "ONLINE", organisationId: "radio-org", channels: [],
    description: "OLD MISLEADING DRAFT DESCRIPTION", status: "ACTIVE", streamConfig: { streamUrl: "SECRET_STREAM_SENTINEL", sourcePassword: "SECRET_PASSWORD_SENTINEL" } };
  const db = { station: { findFirst: async query => { calls.push(query); return station; } } };
  const product = props => h("main", null, h("h1", null, props.title), h("p", null, props.description), h("p", null, props.status),
    h("a", { href: props.primaryAction.href }, props.primaryAction.label),
    ...props.quickTasks.map(task => h("a", { key: task.label, href: task.href }, task.label, task.description)),
    JSON.stringify(props.metrics), JSON.stringify(props.sections));
  const mock = {
    "@/lib/auth": { getActiveOrganisationContext: async include => { assert.equal(include.enterpriseSecurityPolicy, true); return context; } },
    "@/lib/prisma": { prisma: db },
    "@/lib/test-radio-subscriber-access.mjs": { resolveTestRadioSubscriberWorkspace: async (database, ctx) => { assert.equal(database, db); assert.equal(ctx, context); return resolved; } },
    "@/lib/retail-subscriber-access.mjs": { resolveRetailSubscriberWorkspace: async (database, ctx) => {
      assert.equal(database, db); assert.equal(ctx, context);
      assert.deepEqual(ctx.session.user.privatePreviewAccess.pillars, ["ONLINE"]);
      return null;
    } },
    "@/lib/retail-stream-draft-boundary.mjs": { isManagedRetailStreamDraftStation: current => {
      assert.equal(current.productFamily, "ONLINE"); return false;
    } },
    "@/lib/entitlements.mjs": { resolveEntitlements: () => entitlements },
    "@/lib/subscriber-product-access": { requireSubscriberProduct: async (product, include) => {
      assert.equal(product, "ONLINE"); if (include) assert.equal(include.enterpriseSecurityPolicy, true); return { context, entitlements }; } },
    "@/lib/private-preview-account-policy.mjs": accountPolicy,
    "@/lib/private-preview-online-draft.mjs": { onlineDraftSubscription: () => true, onlineDraftChannelWhere: () => ({ status: "DRAFT" }) },
    "@/lib/private-preview-policy.mjs": { isPrivatePreviewTester: () => true, readPrivatePreviewPolicy: () => ({}) },
    "@/lib/product-access.mjs": { subscriberProductForStationFamily: () => "ONLINE", enabledSubscriberProducts: () => [], SUBSCRIBER_PRODUCT_LIST: [{ key: "ONLINE", label: "Online Radio", href: "/dashboard/radio" }] },
    "@/lib/product-onboarding.mjs": {},
    "@/lib/online-radio-listen.mjs": { firstListenableOnlineStation: () => null, onlineRadioListenHref: () => "/listen" },
    "@/lib/pillar-audio.mjs": { pillarListenHref: () => "/listen" },
    "@/lib/user-experience-navigation.mjs": { buildSubscriberNavigation: () => [] },
    "next/navigation": { redirect: href => { throw Object.assign(new Error("REDIRECT"), { href }); }, notFound: () => { throw new Error("NOT_FOUND"); } },
    "next/link": ({ children, ...props }) => h("a", props, children),
    "../ProductDashboard": product,
    "@/app/components/SkipLink": () => null,
    "./TestRadioSubscriberWorkspace": ({ stationId: id }) => h("section", { "data-subscriber-station": id }, "Catalogue and new playlist desk"),
    "./SubscriberPortalShell": ({ children }) => h("div", null, children)
  };
  if (!compiled.has(file)) compiled.set(file, babel.transformSync(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), {
    filename: file, babelrc: false, configFile: false, envName: "test", presets: [require.resolve("next/babel")] }).code);
  const module = { exports: {} };
  vm.runInNewContext(compiled.get(file), { module, exports: module.exports, require: name => {
    if (Object.hasOwn(mock, name)) return mock[name];
    if (name.endsWith(".module.css")) return css;
    if (name.startsWith("./") || name.startsWith("../") || name.startsWith("@/app/")) return () => h("div", null, "Legacy component");
    return require(name.startsWith("@babel/runtime/") ? `next/dist/compiled/${name}` : name);
  } });
  return { Page: module.exports.default, calls };
}

test("verified Test Radio subscriber programming uses the new desk before legacy draft-channel queries", async () => {
  const { Page, calls } = setup("app/dashboard/programming/page.js");
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ product: "ONLINE" }) }));
  assert.match(html, new RegExp(`data-subscriber-station="${stationId}"`));
  assert.equal(calls.length, 0); assert.doesNotMatch(html, /Legacy component|SECRET_|admin\/stations/);
});

test("Test Radio dashboard links catalogue, playlist desk and weekly planner without claiming off-air", async () => {
  const { Page } = setup("app/dashboard/radio/page.js");
  const html = renderToStaticMarkup(await Page());
  for (const term of ["workspace-library", "workspace-simple", "workspace-planner", "Template Builder", "Load Playlist", "Admin-only"]) assert.ok(html.includes(term), term);
  assert.doesNotMatch(html, /audio and broadcasting off|No stream connection|SECRET_/);
});

test("station workspace separates permissions from stream status and does not serialize streaming details", async () => {
  const { Page, calls } = setup("app/stations/[stationId]/page.js");
  const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ stationId }) }));
  assert.match(html, /Plan here · admin approves on air/);
  assert.match(html, /Music library/); assert.match(html, /Weekly planner/);
  assert.doesNotMatch(html, /NOT ON AIR|OLD MISLEADING|SECRET_|Save configuration|Start AutoDJ/);
  assert.equal(calls[0].where.organisationId, "radio-org");
});

test("only the resolved exact station's old schedule link redirects into the connected planner", async () => {
  const { Page, calls } = setup("app/dashboard/radio/schedule/[stationId]/page.js");
  await assert.rejects(() => Page({ params: Promise.resolve({ stationId }) }), error => error.href === "/dashboard/programming?product=ONLINE#workspace-planner");
  assert.equal(calls.length, 0);
  const other = setup("app/dashboard/radio/schedule/[stationId]/page.js", { requestedStationId: "other-station" });
  const html = renderToStaticMarkup(await other.Page({ params: Promise.resolve({ stationId: "other-station" }) }));
  assert.match(html, /Channel setup is needed/); assert.equal(other.calls[0].where.id, "other-station");
});

test("shell and access page describe Test Radio draft permissions without claiming its broadcast is stopped", async () => {
  for (const file of ["app/dashboard/layout.js", "app/preview-dashboard/page.js"]) {
    const { Page } = setup(file), html = renderToStaticMarkup(await Page({ children: "Contents" }));
    assert.match(html, /Test Radio/); assert.match(html, /administrator|admin-only/);
    assert.doesNotMatch(html, /broadcasting off|No audio storage or streaming service is provisioned|SECRET_/);
  }
});
