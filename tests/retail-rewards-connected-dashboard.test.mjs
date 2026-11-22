import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import * as adapter from "../lib/retail-rewards/connected-voucher-ui.mjs";
import * as shopper from "../lib/retail-rewards/shopper-ui.mjs";
import * as offers from "../lib/retail-rewards/offer-contracts.mjs";
import { createShopperMobilePreview } from "./fixtures/shopper-mobile-preview.mjs";

const require = createRequire(import.meta.url), React = require("react"), babel = require("next/dist/compiled/babel/core");
const code = babel.transformSync(readFileSync(new URL("../app/rewards/ConnectedShopperDashboard.js", import.meta.url), "utf8"), { filename: "ConnectedShopperDashboard.js", babelrc: false, configFile: false, envName: "test", presets: [require.resolve("next/babel")] }).code;
const NOW = "2026-11-22T12:00:00.000Z";
function mount({ handler, initialWallet, failWallet = false } = {}) {
  const preview = createShopperMobilePreview({ clock: () => new Date(NOW), delayMs: 0 }); preview.state.savingsMode = "unavailable";
  const cells = [], effects = [], requests = [], bookmarks = new Map(); let cursor = 0, tree, unmounted = false, afterUnmount = 0, failedWallet = failWallet;
  const hooks = { ...React,
    useState(initial) { const i = cursor++; if (!(i in cells)) cells[i] = typeof initial === "function" ? initial() : initial; return [cells[i], value => { if (unmounted) afterUnmount++; cells[i] = typeof value === "function" ? value(cells[i]) : value; }]; },
    useRef(value) { const i = cursor++; if (!(i in cells)) cells[i] = { current: value }; return cells[i]; },
    useEffect(fn, deps) { const i = cursor++, old = cells[i]; if (!old || deps.some((value, index) => !Object.is(value, old.deps[index]))) effects.push(() => { old?.cleanup?.(); cells[i] = { deps, cleanup: fn() }; }); }
  };
  async function transport(path, options) {
    const request = { path, ...options }; requests.push(request);
    const result = handler ? await handler(request, requests) : undefined; if (result !== undefined) return result;
    if (path === "/api/rewards/saved-wallet/status") return { ok: true, items: JSON.parse(options.body).offers.map(ref => ({ ...ref, savedId: bookmarks.get(`${ref.shopSlug}/${ref.offerSlug}`)?.id || null })) };
    if (path.startsWith("/api/rewards/saved-wallet?page=")) {
      if (failedWallet) return { ok: false, code: "UNAUTHENTICATED" };
      return { ok: true, items: [...bookmarks.values()], savedCount: bookmarks.size, page: Number(path.split("=")[1]), hasMore: false };
    }
    if (path === "/api/rewards/saved-wallet" && options.method === "POST") {
      const ref = JSON.parse(options.body), existing = await preview.transport(`/api/rewards/discovery/shops/${ref.shopSlug}/offers/${ref.offerSlug}`, {});
      const item = { id: `saved-${ref.offerSlug}`, status: "AVAILABLE", savedAt: NOW, shop: existing.shop, offer: existing.offer };
      bookmarks.set(`${ref.shopSlug}/${ref.offerSlug}`, item); return { ok: true, item };
    }
    if (path.startsWith("/api/rewards/saved-wallet/") && options.method === "DELETE") { for (const [key, item] of bookmarks) if (item.id === path.split("/").at(-1)) bookmarks.delete(key); return { ok: true, removed: true }; }
    if (path === "/api/rewards/auth/logout") return { ok: true };
    return preview.transport(path, options);
  }
  const mocks = { react: hooks, "./ShopperVoucherDashboard": { __esModule: true, default: () => null }, "./ConnectedShopBrowsePane": { __esModule: true, default: () => null, ConnectedPagination: () => null }, "./ShopperClaimsClient": { ClaimOfferAction: () => null },
    "@/lib/retail-rewards/connected-voucher-ui.mjs": adapter, "@/lib/retail-rewards/shopper-ui.mjs": shopper, "@/lib/retail-rewards/offer-contracts.mjs": offers,
    "./connected-shopper.module.css": { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) } };
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, Intl, AbortController, setTimeout, clearTimeout,
    document: { hidden: false, addEventListener() {}, removeEventListener() {} }, window: { location: { assign() {}, replace() {} }, addEventListener() {}, removeEventListener() {} },
    require(name) { if (Object.hasOwn(mocks, name)) return mocks[name]; if (name.startsWith("react/jsx-")) return require(name); if (name.startsWith("@babel/runtime/")) return require(`next/dist/compiled/${name}`); throw new Error(`Unexpected dependency ${name}`); } });
  const Component = module.exports.default, props = { initialData: preview.initialData, initialWallet: initialWallet || { ok: true, items: [], page: 1, hasMore: false, savedCount: 0 }, initialSavings: preview.initialSavings(), transport, enableClaims: true, enableSignOut: true, onSignOut() {} };
  const render = () => { cursor = 0; tree = Component(props); while (effects.length) effects.shift()(); return tree; };
  const flush = async () => { await new Promise(resolve => setTimeout(resolve, 5)); render(); };
  const pane = () => { const fragment = tree.props.renderExplore(() => null); return fragment.props.children[0].props; };
  const openShop = async () => { pane().actions.chooseLocation({ locality: "Sliema", countryCode: "MT" }); render(); await pane().actions.chooseCategory("FASHION"); render(); await pane().actions.shop("urban-edit"); render(); await flush(); };
  const unmount = () => { unmounted = true; for (const cell of cells) cell?.cleanup?.(); };
  render(); render(); return { render, flush, pane, openShop, requests, bookmarks, unmount, setFailWallet(value) { failedWallet = value; }, get tree() { return tree; }, get afterUnmount() { return afterUnmount; } };
}

test("connected discovery follows location then category then paged shops and existing shop offers", async () => {
  const h = mount(); assert.equal(h.pane().state.step, "locations"); assert.equal(h.tree.props.cards.length, 0);
  await h.openShop();
  assert.ok(h.requests.some(row => row.path === "/api/rewards/discovery/shops?page=1&category=FASHION&locality=Sliema&countryCode=MT"));
  assert.ok(h.requests.some(row => row.path === "/api/rewards/discovery/shops/urban-edit?page=1"));
  assert.equal(h.tree.props.cards.length, 2); assert.equal(h.tree.props.cards[0].shopName, "Urban Edit");
  assert.equal(h.tree.props.canSaveCard(h.tree.props.cards[0]), true);
  await h.pane().actions.shop("urban-edit", 2, "fifteen"); h.render();
  assert.equal(h.requests.at(-1).path, "/api/rewards/discovery/shops/urban-edit?page=2&search=fifteen"); h.unmount();
});

test("save and remove use persistent owned wallet endpoints without claims or changing savings", async () => {
  const h = mount(); await h.openShop(); const card = h.tree.props.cards[0], savings = h.tree.props.totalSavedMinor;
  await h.tree.props.onToggleSave(card.id); h.render();
  assert.equal(h.bookmarks.size, 1); assert.equal(h.tree.props.walletCards.length, 1); assert.equal(h.tree.props.savedCount, 1); assert.equal(h.tree.props.totalSavedMinor, savings);
  const save = h.requests.find(row => row.path === "/api/rewards/saved-wallet" && row.method === "POST");
  assert.deepEqual(JSON.parse(save.body), { shopSlug: "urban-edit", offerSlug: "urban-edit-ten" });
  assert.ok(!h.requests.some(row => row.path.includes("/claims") || row.path.includes("/redeem")));
  await h.tree.props.onToggleSave(card.id); h.render(); assert.equal(h.bookmarks.size, 0); assert.equal(h.tree.props.walletCards.length, 0); assert.ok(!h.tree.props.savedIds.includes(card.id)); h.unmount();
});

test("redeem opens freshly checked published terms; browsing cannot confirm merchant redemption", async () => {
  const h = mount(); await h.openShop(); const card = h.tree.props.cards[0];
  await h.tree.props.onRedeem(card); h.render();
  assert.equal(h.tree.props.modalOpen, true); assert.equal(h.tree.props.children.props.checkout.offer.slug, card.offerSlug);
  assert.equal(h.requests.at(-1).method, "GET"); assert.match(h.requests.at(-1).path, /\/offers\/urban-edit-ten$/);
  assert.ok(!h.requests.some(row => row.path.includes("/claims") || row.path.includes("/redemption"))); h.unmount();
});

test("failed wallet refresh clears prior private saved cards and disables unknown saves", async () => {
  const h = mount(); await h.openShop(); const card = h.tree.props.cards[0]; await h.tree.props.onToggleSave(card.id); h.render(); assert.equal(h.tree.props.walletCards.length, 1);
  h.setFailWallet(true); h.tree.props.onViewChange("wallet"); await h.flush();
  assert.equal(h.tree.props.walletCards.length, 0); assert.equal(h.tree.props.savedIds.length, 0); assert.equal(h.tree.props.canSaveCard(card), false); assert.equal(h.tree.props.cards.length, 0); h.unmount();
});

test("switching views refreshes saved status after another device removes a bookmark", async () => {
  const h = mount(); await h.openShop(); const card = h.tree.props.cards[0]; await h.tree.props.onToggleSave(card.id); h.render();
  assert.ok(h.tree.props.savedIds.includes(card.id)); h.bookmarks.clear(); h.tree.props.onViewChange("explore"); await h.flush(); await h.flush();
  assert.ok(!h.tree.props.savedIds.includes(card.id)); assert.equal(h.tree.props.walletCards.length, 0); h.unmount();
});

test("a stale shop response cannot overwrite a new location selection", async () => {
  let release;
  const h = mount({ handler: request => request.path === "/api/rewards/discovery/shops/urban-edit?page=1" ? new Promise(resolve => { release = resolve; }) : undefined });
  const pending = h.pane().actions.shop("urban-edit"); h.render(); h.pane().actions.chooseLocation({ locality: "Valletta", countryCode: "MT" }); h.render();
  release({ ok: true, shop: { slug: "urban-edit", name: "Old shop" }, offers: [], page: 1, hasMore: false }); await pending; h.render();
  assert.equal(h.pane().state.step, "categories"); assert.equal(h.pane().state.location.locality, "Valletta"); assert.equal(h.pane().shopData, null); h.unmount();
});

test("late reads after component unmount do not update shopper state", async () => {
  let release; const h = mount({ handler: request => request.path.startsWith("/api/rewards/discovery/locations") ? new Promise(resolve => { release = resolve; }) : undefined });
  const pending = h.pane().actions.locations(); h.unmount(); release({ ok: true, locations: [], page: 1, hasMore: false }); await pending;
  assert.equal(h.afterUnmount, 0);
});

test("revoked shopper membership clears checkout, uses and wallet and rejects late successful reads", async () => {
  let forbidden = false, releaseSavings;
  const h = mount({ handler: request => {
    if (!forbidden) return undefined;
    if (request.path.startsWith("/api/rewards/saved-wallet?page=")) return { ok: false, code: "FORBIDDEN" };
    if (request.path === "/api/rewards/savings") return new Promise(resolve => { releaseSavings = resolve; });
    return undefined;
  } });
  await h.openShop(); const card = h.tree.props.cards[0]; await h.tree.props.onToggleSave(card.id); h.render();
  await h.tree.props.onRedeem(card); h.render(); assert.equal(h.tree.props.modalOpen, true);
  forbidden = true; h.tree.props.onViewChange("wallet"); await h.flush();
  assert.equal(h.tree.props.modalOpen, false); assert.equal(h.tree.props.cards.length, 0); assert.equal(h.tree.props.walletCards.length, 0);
  assert.equal(h.tree.props.savedIds.length, 0); assert.equal(h.tree.props.totalSavedMinor, null);
  const after = h.requests.length;
  releaseSavings({ ok: true, checkedAt: NOW, period: { kind: "ALL_TIME", through: NOW }, paymentEvidence: "UNAVAILABLE", currencies: [] });
  await h.flush(); h.tree.props.onViewChange("wallet"); await h.flush();
  assert.equal(h.tree.props.totalSavedMinor, null); assert.equal(h.requests.length, after); h.unmount();
});

test("temporary wallet outages do not invalidate the shopper or an open checkout", async () => {
  let unavailable = false;
  const h = mount({ handler: request => unavailable && request.path.startsWith("/api/rewards/saved-wallet?page=") ? { ok: false, code: "UNAVAILABLE" } : undefined });
  await h.openShop(); await h.tree.props.onRedeem(h.tree.props.cards[0]); h.render();
  unavailable = true; h.tree.props.onViewChange("wallet"); await h.flush();
  assert.equal(h.tree.props.modalOpen, true); assert.equal(h.tree.props.cards.length, 2);
  unavailable = false; const before = h.requests.length; h.tree.props.onViewChange("wallet"); await h.flush();
  assert.ok(h.requests.length > before); assert.equal(h.tree.props.modalOpen, true); h.unmount();
});

test("a checkout credential access denial removes the modal and aborts its child flow", async () => {
  const h = mount({ handler: request => request.path === "/api/rewards/claims/issued-fixture/credential" ? { ok: false, code: "FORBIDDEN" } : undefined });
  await h.openShop(); await h.tree.props.onRedeem(h.tree.props.cards[0]); h.render();
  assert.equal(h.tree.props.modalOpen, true);
  const response = await h.tree.props.children.props.transport("/api/rewards/claims/issued-fixture/credential", { method: "POST", body: "{}" });
  assert.equal(response.code, "FORBIDDEN"); h.render();
  assert.equal(h.tree.props.modalOpen, false); assert.equal(h.tree.props.cards.length, 0); assert.equal(h.tree.props.savedIds.length, 0); h.unmount();
});

test("checkout denial inspection preserves the native response body for the existing claim flow", async () => {
  const h = mount({ handler: request => request.path === "/api/rewards/claims/issued-fixture/credential"
    ? Response.json({ ok: false, code: "FORBIDDEN" }, { status: 403 }) : undefined });
  await h.openShop(); await h.tree.props.onRedeem(h.tree.props.cards[0]); h.render();
  const response = await h.tree.props.children.props.transport("/api/rewards/claims/issued-fixture/credential", { method: "POST", body: "{}" });
  assert.equal(response.bodyUsed, false); assert.deepEqual(await response.json(), { ok: false, code: "FORBIDDEN" });
  h.render(); assert.equal(h.tree.props.modalOpen, false); assert.equal(h.tree.props.onRedeem, undefined); h.unmount();
});

test("a terminal savings denial also clears private wallet and current offers", async () => {
  let denied = false;
  const h = mount({ handler: request => denied && request.path === "/api/rewards/savings" ? { ok: false, code: "FORBIDDEN" } : undefined });
  await h.openShop(); await h.tree.props.onToggleSave(h.tree.props.cards[0].id); h.render();
  denied = true; h.tree.props.onViewChange("wallet"); await h.flush(); await h.flush();
  assert.equal(h.tree.props.cards.length, 0); assert.equal(h.tree.props.walletCards.length, 0); assert.equal(h.tree.props.savedIds.length, 0);
  assert.equal(h.tree.props.totalSavedMinor, null); assert.equal(h.tree.props.onRedeem, undefined); h.unmount();
});

test("existing account navigation has a focusable account destination with sign-out", () => {
  const h = mount(), account = h.tree.props.accountActions;
  assert.equal(account.type, "section"); assert.equal(account.props.id, "account"); assert.equal(account.props.tabIndex, -1);
  assert.equal(account.props["aria-label"], "Your Rewards account");
  assert.ok(account.props.children.some(child => child?.type === "button" && child.props.children === "Sign out of Rewards"));
  h.unmount();
});
