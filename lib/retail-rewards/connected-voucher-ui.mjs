import { publicSlugSchema } from "./shopper-contracts.mjs";
import { REWARD_CATEGORIES } from "./offer-contracts.mjs";
import { shopperCouponSummary, shopperVoucherUsage } from "./shopper-ui.mjs";
import { safeShopperSavingsSnapshot } from "./shopper-savings-contracts.mjs";

export const connectedCategoryLabels = Object.freeze(Object.fromEntries(REWARD_CATEGORIES.map(row => [row.value, row.label])));
const spokenText = value => String(value || "").replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/gu, " ").replace(/\s+/gu, " ").trim();
export function connectedVoucherKey(shopSlug, offerSlug) {
  if (!publicSlugSchema.safeParse(shopSlug).success || !publicSlugSchema.safeParse(offerSlug).success) return null;
  return `${shopSlug}/${offerSlug}`;
}

// This is a view projection of an already-authorised public discovery DTO. It
// never copies credentials, private merchant fields or client-supplied savings.
export function connectedVoucherCard(shop, offer) {
  const id = connectedVoucherKey(shop?.slug, offer?.slug), terms = offer?.terms;
  if (!id || typeof shop?.name !== "string" || !shop.name.trim() || !terms ||
      !Number.isSafeInteger(offer.revision) || offer.revision < 1 ||
      !connectedCategoryLabels[terms.category] || typeof terms.title !== "string" ||
      typeof terms.legalTerms !== "string" || !Number.isFinite(Date.parse(terms.endsAt))) return null;
  try {
    const summary = shopperCouponSummary(terms), usage = shopperVoucherUsage(offer);
    const expires = new Intl.DateTimeFormat("en-GB", { month: "2-digit", year: "2-digit", timeZone: terms.timezone }).format(new Date(terms.endsAt));
    // Stable printed reference, not a checkout token and never accepted by the
    // redemption service. The real credential is issued only in the claim flow.
    let reference = 2166136261;
    for (const char of id) reference = Math.imul(reference ^ char.charCodeAt(0), 16777619) >>> 0;
    return { id, shopSlug: shop.slug, offerSlug: offer.slug, revision: offer.revision,
      shopName: shop.name, subtitle: terms.title, accessibleName: `${spokenText(shop.name)} — ${spokenText(terms.title)}`, category: connectedCategoryLabels[terms.category],
      benefit: summary.benefit, number: `RUV${String(reference).padStart(10, "0")}`, expires,
      location: [shop.locality, shop.countryCode].filter(Boolean).join(" · "),
      usesLeft: usage.known ? usage.remaining : undefined, usesLabel: usage.label,
      terms: `${summary.spend}. ${summary.usage}. ${summary.daily}. ${terms.legalTerms}`,
      disabled: usage.exhausted };
  } catch { return null; }
}

// Same-shop offers can share a title. Give each rendered card an unambiguous
// spoken name without adding technical identifiers to the visible design.
// Number duplicates by stable card identity, not the server's display order.
function distinctAccessibleNames(cards) {
  const key = value => value.normalize("NFKC").toLocaleLowerCase("en");
  const groups = new Map();
  for (const card of cards) { const name = key(card.accessibleName); const group = groups.get(name) || []; group.push(card); groups.set(name, group); }
  const reserved = new Set(groups.keys()), assigned = new Set(), names = new Map();
  for (const group of groups.values()) {
    let number = 1;
    for (const card of [...group].sort((a, b) => a.id.localeCompare(b.id, "en"))) {
      let name = card.accessibleName;
      if (group.length > 1 || assigned.has(key(name))) {
        do { name = `${card.accessibleName} — voucher ${number++}`; } while (reserved.has(key(name)) || assigned.has(key(name)));
      }
      names.set(card.id, name); assigned.add(key(name));
    }
  }
  return cards.map(card => ({ ...card, accessibleName: names.get(card.id) }));
}

export function connectedVoucherCards(shop, offers) {
  if (!Array.isArray(offers)) return [];
  return distinctAccessibleNames(offers.map(offer => connectedVoucherCard(shop, offer)).filter(Boolean));
}

export function connectedSavingsPill(value) {
  const data = safeShopperSavingsSnapshot(value);
  if (!data) return { totalSavedMinor: null, savingsLabel: "Not available" };
  if (data.currencies.length === 0) return { totalSavedMinor: null, savingsLabel: "No savings yet" };
  if (data.currencies.length !== 1) return { totalSavedMinor: null, savingsLabel: "View currencies" };
  const row = data.currencies[0];
  if (row.unvaluedRedemptions > 0) return { totalSavedMinor: null, savingsLabel: "View savings" };
  return { totalSavedMinor: row.couponSavingsMinor, currency: row.currency };
}

export function connectedWalletCards(items) {
  if (!Array.isArray(items)) return [];
  return distinctAccessibleNames(items.filter(item => item.status === "AVAILABLE").map(item => {
    const card = connectedVoucherCard(item.shop, item.offer);
    return card ? { ...card, savedId: item.id } : null;
  }).filter(Boolean));
}

export async function connectedRequest(transport, path, { method = "GET", body, signal } = {}) {
  const response = await transport(path, { method, credentials: "same-origin", cache: "no-store", signal,
    ...(body !== undefined ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
  const result = typeof response?.json === "function" ? await response.json() : response;
  if (response?.ok === false || result?.ok !== true) {
    const problem = new Error("We couldn’t load this right now. Please try again.");
    problem.code = result?.code;
    throw problem;
  }
  return result;
}
