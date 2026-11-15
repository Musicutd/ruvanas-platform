import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import { pilotPreviewEnvironment } from "./fixtures/rewards-pilot-preview.mjs";
import * as pilotPreviewPolicy from "../lib/retail-rewards/pilot-preview-policy.mjs";
import * as featurePolicy from "../lib/retail-rewards/feature-policy.mjs";
import * as offerContracts from "../lib/retail-rewards/offer-contracts.mjs";
import * as offerUi from "../lib/retail-rewards/offer-ui.mjs";

const require = createRequire(import.meta.url);
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const babel = require("next/dist/compiled/babel/core");
const h = React.createElement;
const styles = { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) };
const compiled = new Map();

function loadUi(file, { env = pilotPreviewEnvironment(), checkout = false } = {}) {
  if (!compiled.has(file)) {
    // Resolve the page's lazy server modules through this harness's strict
    // dependency map; never import a real database or authorization service.
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8")
      .replace(/await import\(("[^"\n]+")\)/g, "require($1)");
    compiled.set(file, babel.transformSync(source, {
      filename: file, babelrc: false, configFile: false, envName: "test",
      presets: [require.resolve("next/babel")]
    }).code);
  }
  const module = { exports: {} };
  const forbidden = () => { throw new Error("UNEXPECTED_UI_SIDE_EFFECT"); };
  const mocks = {
    "next/navigation": { notFound: forbidden },
    "@/lib/retail-rewards/feature-policy.mjs": featurePolicy,
    "@/lib/retail-rewards/pilot-preview-policy.mjs": pilotPreviewPolicy,
    "@/lib/retail-rewards/checkout-contracts.mjs": { readCheckoutPolicy: () => ({ enabled: checkout }) },
    "@/lib/retail-rewards/checkout-server": { loadStaffCheckoutPage: async () => ({ ok: true, locations: [{ id: "shop-one" }] }) },
    "@/lib/retail-rewards/reversal-contracts.mjs": { readReversalPolicy: () => ({ enabled: false }) },
    "@/lib/retail-rewards/reports-contracts.mjs": { readReportsPolicy: () => ({ enabled: false }) },
    "@/lib/retail-rewards/campaign-review-contracts.mjs": { readCampaignReviewPolicy: () => ({ enabled: false }) },
    "@/lib/retail-rewards/campaign-link-contracts.mjs": { readCampaignLinkPolicy: () => ({ enabled: false }) },
    "@/lib/retail-rewards/staff-admin-contracts.mjs": { readStaffAdminPolicy: () => ({ enabled: false }) },
    "@/lib/retail-rewards/offer-server": { loadRewardOfferService: async () => ({ list: async () => ({ ok: false, error: "Offer management is not available for this account." }) }) },
    "@/lib/retail-rewards/offer-contracts.mjs": offerContracts,
    "@/lib/retail-rewards/offer-ui.mjs": offerUi,
    "./RewardOffersClient": () => h("main", null, "Offers"),
    "./PilotSignOutButton": () => h("button", { type: "button", disabled: true }, "Sign out"),
    "./reward-offers.module.css": styles,
    "./pilot-business-shell.module.css": styles
  };
  vm.runInNewContext(compiled.get(file), {
    module, exports: module.exports, process: { env: { NODE_ENV: "test", ...env } },
    fetch: forbidden, console,
    require(name) {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (name === "react" || name === "react/jsx-runtime" || name === "react/jsx-dev-runtime") return require(name);
      if (name.startsWith("@babel/runtime/")) return require(`next/dist/compiled/${name}`);
      throw new Error(`UNEXPECTED_UI_DEPENDENCY:${name}`);
    }
  });
  return module.exports.default;
}

test("pilot denied offer management keeps cashier and fallback navigation within Rewards", async () => {
  for (const checkout of [false, true]) {
    const Page = loadUi("app/dashboard/retail/rewards/page.js", { checkout });
    const html = renderToStaticMarkup(await Page());
    assert.match(html, /href="\/rewards\/pilot-sign-in"/);
    assert.doesNotMatch(html, /href="\/dashboard\/retail"/);
    assert.equal(html.includes('href="/dashboard/retail/rewards/redeem"'), checkout);
    assert.equal(html.includes("Open checkout to validate coupons at your assigned shops."), checkout);
  }
});

test("ordinary offer-management denial retains the existing Retail fallback", async () => {
  const Page = loadUi("app/dashboard/retail/rewards/page.js", {
    env: { RUVANAS_RETAIL_REWARDS_ENABLED: "true" }, checkout: true
  });
  const html = renderToStaticMarkup(await Page());
  assert.match(html, /href="\/dashboard\/retail">Back to Retail/);
  assert.doesNotMatch(html, /pilot-sign-in/);
  assert.match(html, /href="\/dashboard\/retail\/rewards\/redeem"/);
});

test("pilot shell preserves one child main landmark and only its fixed workspace links", () => {
  const Shell = loadUi("app/rewards/PilotBusinessShell.js");
  for (const [role, pilotLanding] of [["SUPER_ADMIN", "/admin/retail-rewards/pilot"],
    ["OWNER", "/dashboard/retail/rewards"], ["VIEWER", "/dashboard/retail/rewards/redeem"]]) {
    const html = renderToStaticMarkup(h(Shell, { session: { user: { role, name: "Synthetic account" }, pilotLanding } },
      h("main", { "aria-label": "Rewards content" }, h("h1", null, "Local pilot"))));
    assert.equal((html.match(/<main(?:\s|>)/g) || []).length, 1);
    assert.deepEqual([...html.matchAll(/href="([^"]+)"/g)].map(match => match[1]), [pilotLanding, pilotLanding]);
    assert.match(html, /<button type="button" disabled="">Sign out<\/button>/);
    assert.doesNotMatch(html, /<form/);
    assert.match(html, /Public registration remains closed/);
  }
});

test("merchant guidance distinguishes offer publication from shopper discovery approval", () => {
  const Offers = loadUi("app/dashboard/retail/rewards/RewardOffersClient.js");
  const html = renderToStaticMarkup(h(Offers, { initialData: {
    offers: [], locations: [], capabilities: { manage: true, publish: true }, limits: {}, page: 1, hasMore: false
  } }));
  assert.match(html, /Published revisions need separate approval for shopper discovery/);
  assert.match(html, /Shoppers use their own accounts/);
  assert.match(html, /authorised shop staff confirm redemptions/);
  assert.doesNotMatch(html, /not available yet|remain unavailable in this stage/);
});
