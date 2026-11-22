// Presentation-only grouping for already-authorized offer data. These helpers
// do not replace server-side shopper, merchant, territory or checkout guards.
const text = value => typeof value === "string" && value.length > 0 && value.length <= 256 &&
  value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value);
const validCard = card => Boolean(card && typeof card === "object" && !Array.isArray(card) &&
  [card.id, card.shopSlug, card.shopName, card.location, card.category].every(text));
const keyFor = card => JSON.stringify([card.shopSlug, card.location]);
const alphabetical = (a, b) => a.localeCompare(b, "en");
const copyShop = shop => ({ ...shop, categories: [...shop.categories] });
const validShop = shop => Boolean(shop && typeof shop === "object" && !Array.isArray(shop) &&
  [shop.slug, shop.name, shop.location, shop.category].every(text) &&
  shop.key === JSON.stringify([shop.slug, shop.location]) && Array.isArray(shop.categories) &&
  shop.categories.length > 0 && shop.categories.every(text) && shop.categories.includes(shop.category) &&
  Number.isSafeInteger(shop.voucherCount) && shop.voucherCount > 0);

export function buildShopDirectory(cards) {
  if (!Array.isArray(cards)) return [];
  const grouped = new Map();
  for (const card of cards) {
    if (!validCard(card)) continue;
    const key = keyFor(card);
    if (!grouped.has(key)) grouped.set(key, {
      key, slug: card.shopSlug, name: card.shopName, location: card.location,
      category: card.category, categories: new Set(), subtitle: text(card.subtitle) ? card.subtitle : "",
      ids: new Set()
    });
    const shop = grouped.get(key);
    if (shop.ids.has(card.id)) continue;
    shop.ids.add(card.id); shop.categories.add(card.category);
  }
  return [...grouped.values()].map(({ ids, categories, ...shop }) => ({ ...shop,
    categories: [...categories].sort(alphabetical), voucherCount: ids.size }));
}

export function browseShops(shops, { location, category, search = "" } = {}) {
  // Nothing is browsable until the shopper explicitly chooses both steps.
  if (!Array.isArray(shops) || !text(location) || !text(category) || typeof search !== "string" || search.length > 256) return [];
  const query = search.trim().toLocaleLowerCase("en");
  return shops.filter(shop => validShop(shop) && shop.location === location &&
    (category === "All" || shop.categories.includes(category)) &&
    (!query || [shop.name, shop.subtitle, ...shop.categories].join(" ").toLocaleLowerCase("en").includes(query)))
    .sort((a, b) => alphabetical(a.name, b.name) || alphabetical(a.key, b.key)).map(copyShop);
}

export function vouchersForShop(cards, shopKey) {
  if (!Array.isArray(cards) || typeof shopKey !== "string") return [];
  const seen = new Set();
  return cards.filter(card => {
    if (!validCard(card) || keyFor(card) !== shopKey || seen.has(card.id)) return false;
    seen.add(card.id); return true;
  }).map(card => ({ ...card }));
}

export function shopBrowseLocations(shops) {
  if (!Array.isArray(shops)) return [];
  return [...new Set(shops.filter(validShop).map(shop => shop.location))].sort(alphabetical);
}

export function shopBrowseCategories(shops, location) {
  if (!Array.isArray(shops) || !text(location)) return [];
  return [...new Set(shops.filter(shop => validShop(shop) && shop.location === location)
    .flatMap(shop => shop.categories))].sort(alphabetical);
}
