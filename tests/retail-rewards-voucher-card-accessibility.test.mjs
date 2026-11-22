import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import * as voucherUi from "../lib/retail-rewards/vivid-voucher-ui.mjs";
import { connectedVoucherCards, connectedWalletCards } from "../lib/retail-rewards/connected-voucher-ui.mjs";
import { createShopperMobilePreview } from "./fixtures/shopper-mobile-preview.mjs";

const require = createRequire(import.meta.url), React = require("react"), { renderToStaticMarkup } = require("react-dom/server");
const babel = require("next/dist/compiled/babel/core");
const styles = { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) };
function component(name, mocks, react = React) {
  const code = babel.transformSync(readFileSync(new URL(`../app/rewards/${name}.js`, import.meta.url), "utf8"), {
    filename: `${name}.js`, babelrc: false, configFile: false, envName: "test", presets: [require.resolve("next/babel")]
  }).code;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, setTimeout, clearTimeout,
    require(value) {
      if (value === "react") return react;
      if (value.startsWith("react/jsx-")) return require(value);
      if (value.startsWith("@babel/runtime/")) return require(value.replace("@babel/runtime/", "next/dist/compiled/@babel/runtime/"));
      if (value.endsWith(".module.css")) return styles;
      if (Object.hasOwn(mocks, value)) return mocks[value];
      throw new Error(`Unexpected component dependency: ${value}`);
    }
  });
  return module.exports;
}
const cardModule = component("VividVoucherCard", { "@/lib/retail-rewards/vivid-voucher-ui.mjs": voucherUi });
const Card = cardModule.default;
const preview = createShopperMobilePreview({ delayMs: 0, clock: () => new Date("2026-11-22T12:00:00.000Z") });
const data = await preview.transport("/api/rewards/discovery/shops/urban-edit?page=1", {});
const controls = html => [...html.matchAll(/<button\b[^>]*aria-label="([^"]+)"/g)].map(match => match[1]);
const render = (cards, saved = false) => renderToStaticMarkup(React.createElement(React.Fragment, null, ...cards.map(card =>
  React.createElement(Card, { key: card.id, card: { ...card, code: "ab".repeat(32), qrPayload: `RUVANAS-REWARDS:1:${"ab".repeat(32)}`, credentialExpiresAt: "2099-01-01T00:00:00.000Z" }, saved, onSave() {}, onRedeem() {} }))));

test("same-shop offers have distinct flip, copy, save, remove and redeem button names", () => {
  const cards = connectedVoucherCards(data.shop, data.offers);
  assert.equal(cards.length, 2); assert.equal(cards[0].shopName, cards[1].shopName);
  assert.notEqual(cards[0].accessibleName, cards[1].accessibleName);
  const names = controls(render(cards));
  for (const card of cards) {
    for (const name of [`Flip ${card.accessibleName} voucher`, `Back to ${card.accessibleName} voucher`, `Copy ${card.accessibleName} code`, `Save ${card.accessibleName} to wallet`, `Redeem ${card.accessibleName} voucher`]) {
      assert.equal(names.filter(value => value === name).length, 1, name);
    }
  }
  assert.equal(new Set(names).size, names.length);
  const saved = controls(render(cards, true));
  for (const card of cards) assert.equal(saved.filter(value => value === `Remove ${card.accessibleName} from wallet`).length, 1);
});

test("identical titles use distinct stable spoken numbers in browse and saved wallet", () => {
  const offers = data.offers.map(offer => ({ ...offer, terms: { ...offer.terms, title: "Weekend offer" } }));
  const forward = connectedVoucherCards(data.shop, offers), reverse = connectedVoucherCards(data.shop, [...offers].reverse());
  assert.deepEqual(new Set(forward.map(card => card.accessibleName)), new Set(["Urban Edit — Weekend offer — voucher 1", "Urban Edit — Weekend offer — voucher 2"]));
  for (const card of forward) assert.equal(reverse.find(value => value.id === card.id).accessibleName, card.accessibleName);
  const wallet = connectedWalletCards(offers.map((offer, index) => ({ id: `saved-${index}`, status: "AVAILABLE", shop: data.shop, offer })));
  assert.deepEqual(wallet.map(card => card.accessibleName), forward.map(card => card.accessibleName));
  assert.equal(new Set(controls(render(forward))).size, controls(render(forward)).length);
});

test("stack controls distinguish each saved offer from the same shop", () => {
  const cards = connectedVoucherCards(data.shop, data.offers);
  const stackReact = { ...React, useState(initial) { return React.useState(initial === "explore" ? "stack" : initial); } };
  const Dashboard = component("ShopperVoucherDashboard", {
    "./VividVoucherCard": cardModule,
    "./ShopBrowsePane": { __esModule: true, default: () => null, initialShopBrowse: () => ({ location: "" }) }
  }, stackReact).default;
  const names = controls(renderToStaticMarkup(React.createElement(Dashboard, { cards, walletCards: cards, savedIds: cards.map(card => card.id) })));
  for (const card of cards) {
    assert.equal(names.filter(value => value === `Select ${card.accessibleName} card`).length, 1);
    assert.equal(names.filter(value => value === `Show ${card.accessibleName}`).length, 1);
  }
});

test("fictional cards keep previous labels and spoken names remain plain escaped text", () => {
  const card = { ...connectedVoucherCards(data.shop, [data.offers[0]])[0], accessibleName: undefined, shopName: "Fuego Kitchen" };
  assert.ok(controls(render([card])).includes("Flip Fuego Kitchen voucher"));
  const malicious = connectedVoucherCards({ ...data.shop, name: "Shop\n\u202eName" }, [{ ...data.offers[0], terms: { ...data.offers[0].terms, title: '<script>alert("bad")</script>' } }]);
  assert.equal(malicious[0].accessibleName.startsWith("Shop Name — "), true);
  assert.doesNotMatch(render(malicious), /<script>/);
});
