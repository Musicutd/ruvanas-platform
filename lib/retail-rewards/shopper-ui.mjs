import { offerBenefit, offerDateLabel } from "./offer-ui.mjs";

// Presentation only. Eligibility, shopper authority and publication consent are
// checked on the server for each read; these helpers confer no access.
export function shopperMoney(minor, currency) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(minor / 100);
}

export function shopperCouponSummary(terms) {
  return {
    benefit: offerBenefit(terms),
    spend: terms.minimumSpendMinor > 0 ? `When you spend ${shopperMoney(terms.minimumSpendMinor, terms.currency)} or more` : "No minimum spend",
    usage: terms.usage === "SINGLE_USE" ? "Once per shopper" : `Up to ${terms.perShopperLimit} uses per shopper`,
    daily: terms.usage === "SINGLE_USE" ? "No repeat use by the same shopper" : `No more than ${terms.perShopperDailyLimit} ${terms.perShopperDailyLimit === 1 ? "use" : "uses"} per day`,
    starts: offerDateLabel(terms.startsAt, terms.timezone),
    ends: offerDateLabel(terms.endsAt, terms.timezone),
    combinable: terms.combinable ? "Can be combined with other offers" : "Cannot be combined with other offers",
    pause: terms.pausedClaimsPolicy === "HONOUR_ISSUED" ? "If the shop pauses this offer, already-issued claims keep their published terms." : "If the shop pauses this offer, already-issued claims cannot be used while it is paused."
  };
}

export function shopperInitials(name) {
  return String(name).trim().split(/\s+/).filter(Boolean).slice(0, 2).map(word => [...word][0]).join("").toLocaleUpperCase("en");
}

export function shopperReadPath(apiBase, { shopSlug, offerSlug, category = "", search = "", locality = "", countryCode = "", locations = false, page = 1 } = {}) {
  let path = `${apiBase}/${locations ? "locations" : "shops"}`;
  if (shopSlug) path += `/${encodeURIComponent(shopSlug)}`;
  if (offerSlug) {
    if (!shopSlug) throw new Error("An offer must belong to a selected public shop.");
    return `${path}/offers/${encodeURIComponent(offerSlug)}`;
  }
  const query = new URLSearchParams({ page: String(page) });
  if (category) query.set("category", category);
  if (search.trim()) query.set("search", search.trim());
  if (locality) query.set("locality", locality);
  if (countryCode) query.set("countryCode", countryCode);
  return `${path}?${query}`;
}

export function shopperLocationKey(location) {
  return `${String(location.countryCode || "").toUpperCase()}:${String(location.locality || "").trim().normalize("NFKC").toLocaleLowerCase("en")}`;
}

// Location results are bounded candidate windows, not a complete directory.
// The same town may occur again on another page; never infer a shop count.
export function mergeShopperLocations(previous, next) {
  const found = new Map();
  for (const location of [...previous, ...next]) found.set(shopperLocationKey(location), location);
  return [...found.values()];
}

export function shopperVoucherUsage(offer) {
  const usage = offer?.usage, limit = offer?.terms?.perShopperLimit;
  if (!usage || !Number.isSafeInteger(limit) || limit < 1 || usage.limit !== limit ||
      !Number.isSafeInteger(usage.used) || usage.used < 0 ||
      usage.remaining !== Math.max(0, limit - usage.used) || !Number.isFinite(Date.parse(usage.asOf))) {
    return { known: false, exhausted: false, label: `Up to ${limit || "the allowed"} ${limit === 1 ? "use" : "uses"} per shopper` };
  }
  return { known: true, exhausted: usage.remaining === 0,
    label: `${usage.remaining} of ${limit} ${limit === 1 ? "use" : "uses"} left`,
    remaining: usage.remaining, limit, asOf: usage.asOf };
}

export function shopperShortExpiry(terms) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: terms.timezone }).format(new Date(terms.endsAt));
}
