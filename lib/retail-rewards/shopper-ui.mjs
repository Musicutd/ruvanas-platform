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

export function shopperReadPath(apiBase, { shopSlug, offerSlug, category = "", search = "", page = 1 } = {}) {
  let path = `${apiBase}/shops`;
  if (shopSlug) path += `/${encodeURIComponent(shopSlug)}`;
  if (offerSlug) {
    if (!shopSlug) throw new Error("An offer must belong to a selected public shop.");
    return `${path}/offers/${encodeURIComponent(offerSlug)}`;
  }
  const query = new URLSearchParams({ page: String(page) });
  if (category) query.set("category", category);
  if (search.trim()) query.set("search", search.trim());
  return `${path}?${query}`;
}
