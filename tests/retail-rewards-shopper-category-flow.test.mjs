import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import * as categories from "../lib/retail-rewards/offer-contracts.mjs";
import * as ui from "../lib/retail-rewards/shopper-ui.mjs";
import { shopperBrowseSchema } from "../lib/retail-rewards/shopper-contracts.mjs";
import { createShopperMobilePreview } from "./fixtures/shopper-mobile-preview.mjs";

const require = createRequire(import.meta.url), React = require("react"), babel = require("next/dist/compiled/babel/core");
const code = babel.transformSync(readFileSync(new URL("../app/rewards/ShopperDiscoveryClient.js", import.meta.url), "utf8"), {
  filename: "ShopperDiscoveryClient.js", babelrc: false, configFile: false, envName: "test", presets: [require.resolve("next/babel")]
}).code;
const css = { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) };
const child = tree => tree && typeof tree === "object" && typeof tree.type === "function" ? tree.type(tree.props) : tree?.props?.children;
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === "object" && tree.props ? [tree, ...nodes(child(tree))] : [];
const content = tree => Array.isArray(tree) ? tree.map(content).join("") : tree && typeof tree === "object" ? content(child(tree)) : typeof tree === "string" || typeof tree === "number" ? String(tree) : "";

function mount({ handler, onOpenSavings } = {}) {
  const fixture = createShopperMobilePreview({ clock: () => new Date("2026-11-22T12:00:00.000Z"), delayMs: 0 });
  const cells = [], effects = [], requests = []; let cursor = 0, tree;
  const hooks = { ...React,
    useState(initial) { const index = cursor++; if (!(index in cells)) cells[index] = typeof initial === "function" ? initial() : initial;
      return [cells[index], next => { cells[index] = typeof next === "function" ? next(cells[index]) : next; }]; },
    useRef(initial) { const index = cursor++; if (!(index in cells)) cells[index] = { current: initial }; return cells[index]; },
    useEffect(fn, dependencies) { const index = cursor++, old = cells[index];
      if (!old || dependencies.some((value, i) => !Object.is(value, old.dependencies[i]))) effects.push(() => { old?.cleanup?.(); cells[index] = { dependencies, cleanup: fn() }; }); }
  };
  const element = React.createElement;
  const mocks = { react: hooks, "@/lib/retail-rewards/offer-contracts.mjs": categories, "@/lib/retail-rewards/shopper-ui.mjs": ui,
    "./shopper-discovery.module.css": css, "./ShopperClaimsClient": { ClaimOfferAction: () => element("div", null, "Explicit claim action") },
    "./ShopperChrome": {
      ShopperHeader: () => element("header", null, "Rewards"), ShopperIcon: () => null,
      ShopperNav: props => element("nav", null,
        element("button", { onClick: props.onExplore }, "Explore"),
        element("button", { onClick: props.onAccount }, "Account"),
        element("button", { onClick: props.onSavings }, "My savings"))
    }
  };
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, Intl, AbortController, setTimeout, clearTimeout,
    requestAnimationFrame: fn => fn(), window: { location: { hash: "" } },
    require(name) { if (Object.hasOwn(mocks, name)) return mocks[name];
      if (name.startsWith("react/jsx-")) return require(name);
      if (name.startsWith("@babel/runtime/")) return require(`next/dist/compiled/${name}`);
      throw new Error(`Unexpected dependency: ${name}`); },
    fetch() { throw new Error("Real network is forbidden"); }
  });
  const props = { initialData: fixture.initialData, enableClaims: true, onOpenSavings, transport: async (path, options) => {
    requests.push({ path, options }); return handler ? handler(path, options, fixture) : fixture.transport(path, options);
  } };
  const render = () => { cursor = 0; tree = module.exports.default(props); while (effects.length) effects.shift()(); return tree; };
  const button = label => {
    const found = nodes(tree).filter(n => n.type === "button" && (n.props["aria-label"] || content(n)).trim() === label);
    assert.equal(found.length, 1, `Expected one ${label} button`); return found[0];
  };
  async function click(label) { const b = button(label); assert.notEqual(b.props.disabled, true); const pending = b.props.onClick(); render(); await pending; await new Promise(resolve => setImmediate(resolve)); render(); }
  function selectTown(name) { const label = nodes(tree).find(n => n.type === "label" && content(n).startsWith(name)); assert.ok(label);
    nodes(label).find(n => n.type === "input").props.onChange(); render(); }
  render(); render();
  return { fixture, requests, render, button, click, selectTown, get tree() { return tree; } };
}

test("a chosen location opens categories without fetching or showing shops", async () => {
  const h = mount(); assert.equal(h.button("Choose category").props.disabled, true);
  h.selectTown("Sliema"); await h.click("Choose category");
  assert.match(content(h.tree), /2 \/ 4 · CATEGORY/); assert.match(content(h.tree), /What are you looking for/);
  assert.equal(h.requests.length, 0); assert.doesNotMatch(content(h.tree), /Urban Edit|Choose a shop/);
  for (const category of ["Restaurants", "Household", "Electronics"]) h.button(`Choose ${category}`);
  await h.click("Account"); await h.click("Explore");
  assert.match(content(h.tree), /2 \/ 4 · CATEGORY/); assert.equal(h.requests.length, 0);
});

test("category selection filters the exact town and carries its choice through vouchers and back", async () => {
  const h = mount(); h.selectTown("Sliema"); await h.click("Choose category"); await h.click("Choose Restaurants");
  const request = h.requests[0]; const url = new URL(request.path, "http://local.invalid");
  assert.equal(url.searchParams.get("category"), "RESTAURANTS"); assert.equal(url.searchParams.get("locality"), "Sliema");
  assert.equal(url.searchParams.get("countryCode"), "MT"); assert.equal(request.options.method, "GET"); assert.equal(request.options.cache, "no-store");
  assert.match(content(h.tree), /3 \/ 4 · SHOPS/); assert.doesNotMatch(content(h.tree), /Urban Edit|Home Corner/);
  await h.click("View vouchers from Table & Co"); assert.match(content(h.tree), /4 \/ 4 · VOUCHERS/);
  assert.match(content(h.tree), /10 of 10 uses left/); await h.click("Use voucher: 10% off your meal");
  assert.match(content(h.tree), /Full voucher terms/); assert.match(content(h.tree), /Explicit claim action/);
  await h.click("Vouchers"); await h.click("Shops"); await h.click("Categories");
  assert.equal(h.button("Choose Restaurants").props["aria-pressed"], true); assert.match(content(h.tree), /Sliema/);
  assert.ok(h.requests.every(row => row.options.method === "GET"));
});

test("Household retains the persisted HOME key and Electronics is valid for offers and discovery", async () => {
  const h = mount(); h.selectTown("Sliema"); await h.click("Choose category"); await h.click("Choose Household");
  assert.match(h.requests[0].path, /category=HOME/); assert.match(content(h.tree), /Home Corner/);
  assert.equal(categories.REWARD_CATEGORIES.find(row => row.value === "HOME").label, "Household");
  assert.equal(shopperBrowseSchema.safeParse({ category: "ELECTRONICS" }).success, true);
  const offer = await h.fixture.transport("/api/rewards/discovery/shops/urban-edit/offers/urban-edit-ten");
  assert.equal(categories.validateOfferTerms({ ...offer.offer.terms, category: "ELECTRONICS", locationIds: ["location-one"] }).ok, true);
  await h.click("Categories"); await h.click("Choose Electronics");
  assert.match(h.requests.at(-1).path, /category=ELECTRONICS/); assert.match(content(h.tree), /No matching shops yet/);
  await h.click("Choose another category"); assert.match(content(h.tree), /2 \/ 4 · CATEGORY/);
});

test("changing town clears the previous category and requires a fresh choice", async () => {
  const h = mount(); h.selectTown("Sliema"); await h.click("Choose category"); await h.click("Choose Fashion");
  await h.click("Change location: Sliema"); h.selectTown("Valletta"); await h.click("Choose category");
  assert.equal(h.button("Choose Fashion").props["aria-pressed"], false);
  assert.doesNotMatch(content(h.tree), /Urban Edit|City Style/); await h.click("Choose Fashion");
  assert.match(content(h.tree), /City Style/); assert.doesNotMatch(content(h.tree), /Urban Edit/);
  assert.equal(new URL(h.requests.at(-1).path, "http://local.invalid").searchParams.get("locality"), "Valletta");
});

test("returning to categories cancels a pending shop read and ignores its late result", async () => {
  let release;
  const h = mount({ handler: () => new Promise(resolve => { release = resolve; }) });
  h.selectTown("Sliema"); await h.click("Choose category");
  const pending = h.button("Choose Fashion").props.onClick(); h.render();
  await h.click("Categories"); assert.equal(h.requests[0].options.signal.aborted, true);
  release({ ok: true, shops: [{ slug: "stale", name: "Stale shop", categories: ["FASHION"] }], page: 1, hasMore: false });
  await pending; h.render(); assert.match(content(h.tree), /2 \/ 4 · CATEGORY/); assert.doesNotMatch(content(h.tree), /Stale shop/);
});

test("shop search and pagination preserve selected category and location", async () => {
  const h = mount({ handler: async (path, options, fixture) => {
    const result = await fixture.transport(path, options); return { ...result, hasMore: true };
  } });
  h.selectTown("Sliema"); await h.click("Choose category"); await h.click("Choose Household");
  const search = nodes(h.tree).find(n => n.type === "input" && n.props.id === "shopper-search");
  search.props.onChange({ target: { value: "Corner" } }); h.render();
  const request = nodes(h.tree).find(n => n.type === "form").props.onSubmit({ preventDefault() {} }); h.render(); await request;
  // The submit callback starts the async read; wait for that transport to settle.
  await new Promise(resolve => setImmediate(resolve)); h.render(); await h.click("Next");
  const url = new URL(h.requests.at(-1).path, "http://local.invalid");
  assert.equal(url.searchParams.get("category"), "HOME"); assert.equal(url.searchParams.get("locality"), "Sliema");
  assert.equal(url.searchParams.get("search"), "Corner"); assert.equal(url.searchParams.get("page"), "2");
});

test("all categories is a deliberate choice and savings callback is forwarded separately", async () => {
  let savings = 0; const h = mount({ onOpenSavings: () => { savings++; } });
  h.selectTown("Sliema"); await h.click("Choose category"); assert.equal(h.requests.length, 0);
  await h.click("All categories"); assert.equal(new URL(h.requests[0].path, "http://local.invalid").searchParams.has("category"), false);
  assert.match(content(h.tree), /Urban Edit/); assert.match(content(h.tree), /Table & Co/); assert.match(content(h.tree), /Home Corner/);
  await h.click("My savings"); assert.equal(savings, 1); assert.equal(h.requests.length, 1);
});
