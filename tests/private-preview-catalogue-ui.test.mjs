import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import * as accountPolicy from "../lib/private-preview-account-policy.mjs";
import * as productAccess from "../lib/product-access.mjs";
import * as entitlementPolicy from "../lib/entitlements.mjs";
import * as radioWorkspace from "../lib/online-radio-workspace.mjs";

const require = createRequire(import.meta.url);
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const babel = require("next/dist/compiled/babel/core");
const compiled = new Map();
const h = React.createElement;

function fixture(plan) {
  const subscription = { organisationId: "synthetic-org", status: "TRIAL", currentPeriodEnd: new Date("2099-01-01T00:00:00Z"),
    plan, onlineRadioEnabled: true, complimentaryAccessActive: false };
  const user = { role: "OWNER", name: "Synthetic tester", email: "tester@example.invalid",
    privatePreviewAccess: { pillars: ["ONLINE"], expiresAt: new Date("2099-01-01T00:00:00Z") } };
  return { user, session: { user }, membership: { role: "OWNER", organisation: {
    id: "synthetic-org", name: "Synthetic Radio", subscription, stations: [], betaParticipations: []
  } } };
}

function loadUI(file, context = fixture(accountPolicy.PREVIEW_ONLINE_DRAFT_CATALOGUE_PLAN), mounts = { uploadedLibrary: 0 }) {
  if (!compiled.has(file)) compiled.set(file, babel.transformSync(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), {
    filename: file, babelrc: false, configFile: false, envName: "test", presets: [require.resolve("next/babel")]
  }).code);
  const module = { exports: {} };
  const unavailable = () => { throw new Error("UNEXPECTED_TEST_SIDE_EFFECT"); };
  const mocked = {
    "@/lib/private-preview-account-policy.mjs": accountPolicy,
    "@/lib/test-radio-subscriber-access.mjs": { resolveTestRadioSubscriberWorkspace: async () => null },
    "@/lib/product-access.mjs": productAccess,
    "@/lib/entitlements.mjs": entitlementPolicy,
    "@/lib/online-radio-workspace.mjs": radioWorkspace,
    "./online-radio-library.module.css": { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) },
    "../media/MusicLibraryPro": () => { mounts.uploadedLibrary += 1; return h("form", { "data-upload-form": true }, "UPLOAD_FORM_MARKER"); },
    "@/lib/auth": { getActiveOrganisationContext: async () => context },
    "@/lib/private-preview-policy.mjs": { readPrivatePreviewPolicy: () => ({}), isPrivatePreviewTester: () => true },
    "@/lib/user-experience-navigation.mjs": { buildSubscriberNavigation: () => [] },
    "@/lib/online-radio-listen.mjs": { firstListenableOnlineStation: () => null, onlineRadioListenHref: () => "/synthetic-listen" },
    "@/lib/pillar-audio.mjs": { pillarListenHref: () => "/synthetic-listen" },
    "@/lib/subscriber-product-access": { requireSubscriberProduct: async () => ({ context, entitlements: entitlementPolicy.resolveEntitlements(context.membership.organisation.subscription) }) },
    "@/lib/prisma": { prisma: new Proxy({}, { get: unavailable }) },
    "@/lib/product-onboarding.mjs": { buildOnlineRadioProductOnboarding: unavailable },
    "next/navigation": { redirect: unavailable, notFound: unavailable, useRouter: () => ({ push: unavailable, refresh: unavailable }) },
    "next/link": ({ children, ...props }) => h("a", props, children),
    "./SubscriberPortalShell": ({ children }) => h("div", null, children),
    "../ProductDashboard": (props) => h("main", null, h("h1", null, props.title), props.description, props.status,
      props.quickTasks.map((task) => h("p", { key: task.label }, task.label, task.description))),
    "@/app/components/WorkflowProgress": () => h("div", null, "STREAM_SETUP_HELP"),
    "@/app/components/ContextHelp": () => h("div", null, "STREAM_CONNECTION_HELP"),
    "@/app/components/SkipLink": () => null,
    "@/lib/guided-workflows.mjs": { safeWorkflowMessage: (_, fallback) => fallback, stationWorkflowSteps: () => [] }
  };
  vm.runInNewContext(compiled.get(file), { module, exports: module.exports,
    require: (name) => Object.hasOwn(mocked, name) ? mocked[name] : require(name.startsWith("@babel/runtime/") ? `next/dist/compiled/${name}` : name),
    process: { env: { NODE_ENV: "test" } }, fetch: unavailable, console });
  return module.exports.default;
}

test("owner form retains read-only default and preserves the existing metadata-mode selection", () => {
  const Admin = loadUI("app/admin/private-preview/TesterControls.js");
  const empty = renderToStaticMarkup(h(Admin));
  assert.match(empty, /id="preview-new-tester-mode"[^>]*><option value="READ_ONLY" selected=""/);
  assert.match(empty, /Online Radio drafts \+ Malta catalogue \(no audio\)/);
  const html = renderToStaticMarkup(h(Admin, { initialTesters: [{ id: "synthetic-user", name: "Synthetic tester", email: "tester@example.invalid",
    accessMode: "ONLINE_DRAFT_CATALOGUE", pillars: ["ONLINE"], enabled: true, passwordEnabled: true, expiresAt: "2099-01-01T00:00:00Z" }] }));
  assert.match(html, /<option value="ONLINE_DRAFT_CATALOGUE" selected="">/);
  assert.match(html, /rights-filtered FOCUSED catalogue metadata for Malta/);
  assert.match(html, /No streaming service or audio storage is provisioned/);
  assert.doesNotMatch(html, /<audio|<video|src="https:/);
});

test("tester landing and shell distinguish metadata, drafts and read-only without audio promises", async () => {
  for (const file of ["app/dashboard/layout.js", "app/preview-dashboard/page.js"]) {
    for (const [plan, expected] of [[accountPolicy.PREVIEW_TESTER_PLAN, /read-only/i],
      [accountPolicy.PREVIEW_ONLINE_DRAFT_PLAN, /editable Online Radio/i],
      [accountPolicy.PREVIEW_ONLINE_DRAFT_CATALOGUE_PLAN, /FOCUSED/]]) {
      const context = fixture(plan);
      const Page = loadUI(file, context);
      const html = renderToStaticMarkup(await Page({ children: h("div", null, "Synthetic content") }));
      assert.match(html, expected);
      if (plan === accountPolicy.PREVIEW_ONLINE_DRAFT_CATALOGUE_PLAN) {
        assert.match(html, /Malta/); assert.match(html, /audio playback/); assert.match(html, /paid actions/);
      }
      assert.doesNotMatch(html, /<audio|<video/);
    }
  }
});

test("Radio metadata quick task is entitlement gated and never reaches live dashboard queries", async () => {
  for (const [plan, metadata] of [[accountPolicy.PREVIEW_ONLINE_DRAFT_PLAN, false], [accountPolicy.PREVIEW_ONLINE_DRAFT_CATALOGUE_PLAN, true]]) {
    const Page = loadUI("app/dashboard/radio/page.js", fixture(plan));
    const html = renderToStaticMarkup(await Page());
    assert.equal(/Browse approved catalogue metadata for Malta/.test(html), metadata);
    assert.match(html, /broadcast|broadcasting/i);
    assert.doesNotMatch(html, /<audio|<video/);
  }
});

test("both editable tester modes hide streaming setup and keep read-only station creation blocked", () => {
  const NewStation = loadUI("app/stations/new/NewStationClient.js");
  for (const mode of ["ONLINE_DRAFT", "ONLINE_DRAFT_CATALOGUE"]) {
    const html = renderToStaticMarkup(h(NewStation, { previewAccessMode: mode }));
    assert.match(html, /Save private test station/);
    assert.match(html, /This creates no streaming infrastructure or live broadcast/);
    assert.doesNotMatch(html, /STREAM_SETUP_HELP|STREAM_CONNECTION_HELP/);
  }
  const readOnly = renderToStaticMarkup(h(NewStation, { previewAccessMode: "READ_ONLY" }));
  assert.doesNotMatch(readOnly, /<form/);
  assert.match(readOnly, /read-only/);
});

test("ordinary draft library stays blocked with missing or false metadata permission", () => {
  const mounts = { uploadedLibrary: 0 };
  const Library = loadUI("app/dashboard/programming/OnlineRadioLibraryWorkspace.js", undefined, mounts);
  for (const props of [{ sandboxDraftOnly: true }, { sandboxDraftOnly: true, catalogueMetadataOnly: false }]) {
    const html = renderToStaticMarkup(h(Library, props));
    assert.match(html, /Audio access is not enabled for this draft-only workspace/);
    assert.match(html, /actual music catalogue, uploads, downloads and playback stay unavailable/);
    assert.doesNotMatch(html, /Your uploaded music|UPLOAD_FORM_MARKER|<form|<audio|<video|type="file"/);
  }
  assert.equal(mounts.uploadedLibrary, 0);
});

test("explicit Malta metadata library renders approved details copy without mounting upload or audio controls", () => {
  const mounts = { uploadedLibrary: 0 };
  const Library = loadUI("app/dashboard/programming/OnlineRadioLibraryWorkspace.js", undefined, mounts);
  const html = renderToStaticMarkup(h(Library, { sandboxDraftOnly: true, catalogueMetadataOnly: true }));
  assert.match(html, /Browse approved catalogue details for your private Malta test/);
  assert.match(html, /Private catalogue browsing · Malta · no audio/);
  assert.match(html, /Online Radio, Malta, licence-window, provider and catalogue-tier checks/);
  assert.match(html, /grants no playback or new music rights/);
  assert.doesNotMatch(html, /Your uploaded music|UPLOAD_FORM_MARKER|<audio|<video|type="file"|data-upload-form/);
  assert.equal(mounts.uploadedLibrary, 0);
});

test("ordinary subscribed library retains the uploaded-music view choice", () => {
  const mounts = { uploadedLibrary: 0 };
  const Library = loadUI("app/dashboard/programming/OnlineRadioLibraryWorkspace.js", undefined, mounts);
  const html = renderToStaticMarkup(h(Library, { sandboxDraftOnly: false, catalogueMetadataOnly: false }));
  assert.match(html, /Approved catalogue/);
  assert.match(html, /Your uploaded music<\/button>/);
  assert.doesNotMatch(html, /Audio access is not enabled for this draft-only workspace/);
  assert.equal(mounts.uploadedLibrary, 0);
});
