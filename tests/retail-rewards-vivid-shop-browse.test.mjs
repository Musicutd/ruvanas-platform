import test from "node:test";
import assert from "node:assert/strict";
import { buildShopDirectory, browseShops, vouchersForShop, shopBrowseLocations, shopBrowseCategories } from "../lib/retail-rewards/vivid-shop-browse.mjs";
import { VIVID_PREVIEW_CARDS } from "./fixtures/shopper-vivid-preview.mjs";

const card = (overrides = {}) => ({ id: "one", shopSlug: "shop-one", shopName: "Shared Name",
  location: "Sliema", category: "Dining", subtitle: "Fresh local food", benefit: "10% OFF", ...overrides });

test("a location and category must both be chosen before any shop is shown", () => {
  const shops = buildShopDirectory(VIVID_PREVIEW_CARDS);
  assert.equal(shops.length, 6);
  assert.deepEqual(browseShops(shops), []);
  assert.deepEqual(browseShops(shops, { location: "Sliema" }), []);
  assert.deepEqual(browseShops(shops, { category: "All" }), []);
  assert.deepEqual(browseShops(shops, { location: "", category: "All" }), []);
  assert.deepEqual(browseShops(shops, { location: "Sliema", category: "All" }).map(row => row.name), ["Fuego Kitchen", "Kova Apparel", "Volt Store"]);
  assert.deepEqual(browseShops(shops, { location: "Sliema", category: "Dining" }).map(row => row.name), ["Fuego Kitchen"]);
});

test("multiple vouchers aggregate under a stable shop/location identity, not its name", () => {
  const cards = [card(), card({ id: "two", category: "Coffee" }), card(),
    card({ id: "foreign", shopSlug: "other-shop" }), card({ id: "branch", location: "Valletta" })];
  const shops = buildShopDirectory(cards);
  assert.equal(shops.length, 3);
  const first = shops.find(row => row.key === JSON.stringify(["shop-one", "Sliema"]));
  assert.equal(first.voucherCount, 2); assert.deepEqual(first.categories, ["Coffee", "Dining"]);
  assert.equal(first.name, "Shared Name");
  assert.deepEqual(vouchersForShop(cards, first.key).map(row => row.id), ["one", "two"]);
  const other = shops.find(row => row.slug === "other-shop");
  assert.deepEqual(vouchersForShop(cards, other.key).map(row => row.id), ["foreign"]);
  const branch = shops.find(row => row.location === "Valletta");
  assert.deepEqual(vouchersForShop(cards, branch.key).map(row => row.id), ["branch"]);
});

test("exact location and category constraints stay in force during case-insensitive search", () => {
  const shops = buildShopDirectory([card(), card({ id: "other", shopSlug: "other-shop", category: "Tech" }),
    card({ id: "branch", location: "Valletta" })]);
  const found = browseShops(shops, { location: "Sliema", category: "Dining", search: "SHARED NAME" });
  assert.equal(found.length, 1); assert.equal(found[0].key, JSON.stringify(["shop-one", "Sliema"]));
  assert.equal(browseShops(shops, { location: "Sliema", category: "Dining", search: "local food" }).length, 1);
  assert.deepEqual(browseShops(shops, { location: "sliema", category: "Dining" }), []);
  assert.deepEqual(browseShops(shops, { location: "Sliema", category: "dining" }), []);
  assert.deepEqual(browseShops(shops, { location: "Sliema", category: "Dining", search: "unmatched" }), []);
});

test("location and category choices come only from valid shops in the exact chosen location", () => {
  const shops = buildShopDirectory(VIVID_PREVIEW_CARDS);
  assert.deepEqual(shopBrowseLocations(shops), ["Sliema", "St Julian’s", "Valletta"]);
  assert.deepEqual(shopBrowseCategories(shops, "Sliema"), ["Dining", "Fashion", "Tech"]);
  assert.deepEqual(shopBrowseCategories(shops, "Valletta"), ["Coffee", "Entertainment"]);
  assert.deepEqual(shopBrowseCategories(shops, "Unknown"), []);
  assert.deepEqual(shopBrowseCategories(shops), []);
});

test("malformed cards, keys and directory rows cannot broaden a selected shop", () => {
  const valid = card(), cards = [valid, null, {}, card({ id: "" }), card({ id: "bad", location: " Sliema" }), card({ id: "bad-two", shopSlug: undefined })];
  const shops = buildShopDirectory(cards);
  assert.equal(shops.length, 1); assert.equal(shops[0].voucherCount, 1);
  for (const key of [null, "Shared Name", "shop-one", '["shop-one", "Sliema"]', '["shop-one","Sliema","extra"]']) assert.deepEqual(vouchersForShop(cards, key), []);
  const badRows = [null, {}, { ...shops[0], key: "wrong" }, { ...shops[0], categories: [null] }];
  assert.deepEqual(browseShops(badRows, { location: "Sliema", category: "All" }), []);
  assert.deepEqual(shopBrowseLocations(badRows), []);
  assert.deepEqual(buildShopDirectory({}), []);
});

test("JSON pair keys avoid delimiter collisions and browse operations leave input unchanged", () => {
  const cards = [card({ shopSlug: "a:b", location: "c" }), card({ id: "two", shopSlug: "a", location: "b:c" })];
  const before = JSON.stringify(cards), shops = buildShopDirectory(cards), directoryBefore = JSON.stringify(shops);
  assert.equal(shops.length, 2); assert.notEqual(shops[0].key, shops[1].key);
  const result = browseShops(shops, { location: "c", category: "All" });
  result[0].categories.push("Other"); result[0].name = "Changed";
  const vouchers = vouchersForShop(cards, shops[0].key); vouchers[0].shopName = "Changed";
  assert.equal(JSON.stringify(cards), before); assert.equal(JSON.stringify(shops), directoryBefore);
});
