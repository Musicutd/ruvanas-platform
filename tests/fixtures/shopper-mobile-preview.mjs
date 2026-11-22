// Synthetic, memory-only fixtures for the standalone shopper UI preview.
// Nothing in this file is imported by a production route or connects to a DB.
const clone = value => JSON.parse(JSON.stringify(value));
const fail = (code, error) => ({ ok: false, code, error });
const pageSize = 3;

export function createShopperMobilePreview({ clock = () => new Date(), delayMs = 35 } = {}) {
  const now = () => clock().toISOString();
  const baseDate = clock();
  const start = new Date(baseDate.getTime() - 7 * 86_400_000).toISOString();
  const end = new Date(Date.UTC(baseDate.getUTCFullYear() + 1, 11, 31, 22, 59, 59)).toISOString();
  const shops = [
    { slug: "urban-edit", name: "Urban Edit", description: "Everyday style, with something special for you.", locality: "Sliema", countryCode: "MT", categories: ["FASHION"] },
    { slug: "table-and-co", name: "Table & Co", description: "Fresh flavours and your next favourite table.", locality: "Sliema", countryCode: "MT", categories: ["RESTAURANTS"] },
    { slug: "home-corner", name: "Home Corner", description: "Little touches that make a house a home.", locality: "Sliema", countryCode: "MT", categories: ["HOME"] },
    { slug: "city-style", name: "City Style", description: "Independent fashion in the city.", locality: "Valletta", countryCode: "MT", categories: ["FASHION"] },
    { slug: "daily-table", name: "Daily Table", description: "A welcoming place for lunch.", locality: "Hamrun", countryCode: "MT", categories: ["RESTAURANTS"] },
    { slug: "home-stories", name: "Home Stories", description: "Find a fresh look for your space.", locality: "Mosta", countryCode: "MT", categories: ["HOME"] }
  ];
  const terms = (overrides = {}) => ({ schemaVersion: 1, title: "10% off your next visit", description: "Enjoy a saving at this example shop.",
    category: "FASHION", type: "PERCENT_OFF", percentBps: 1000, amountMinor: null, buyQuantity: null, getQuantity: null,
    currency: "EUR", minimumSpendMinor: 5000, exclusions: "Gift cards and delivery charges excluded.",
    legalTerms: "Example offer for this local preview only. Applies to eligible items at the selected shop. Present the code before paying. No cash value.",
    combinable: false, startsAt: start, endsAt: end, timezone: "Europe/Malta", usage: "REUSABLE", totalLimit: 100,
    perShopperLimit: 10, perShopperDailyLimit: 1, pausedClaimsPolicy: "HONOUR_ISSUED", ...overrides });
  const offers = [
    { shopSlug: "urban-edit", slug: "urban-edit-ten", revision: 1, terms: terms() },
    { shopSlug: "urban-edit", slug: "urban-edit-fifteen", revision: 1, terms: terms({ title: "15% off your favourite finds", percentBps: 1500, minimumSpendMinor: 0, usage: "SINGLE_USE", perShopperLimit: 1, perShopperDailyLimit: 1 }) },
    { shopSlug: "table-and-co", slug: "table-and-co-ten", revision: 1, terms: terms({ title: "10% off your meal", category: "RESTAURANTS", minimumSpendMinor: 3000 }) },
    { shopSlug: "home-corner", slug: "home-corner-fifteen", revision: 1, terms: terms({ title: "15% off home favourites", category: "HOME", percentBps: 1500, minimumSpendMinor: 0, usage: "SINGLE_USE", perShopperLimit: 1, perShopperDailyLimit: 1 }) },
    { shopSlug: "city-style", slug: "city-style-ten", revision: 1, terms: terms({ title: "10% off city style" }) },
    { shopSlug: "daily-table", slug: "daily-table-ten", revision: 1, terms: terms({ title: "10% off lunch", category: "RESTAURANTS", minimumSpendMinor: 2000 }) },
    { shopSlug: "home-stories", slug: "home-stories-ten", revision: 1, terms: terms({ title: "10% off home details", category: "HOME" }) }
  ];
  const usage = new Map([["urban-edit-ten", 3]]), claims = [], claimRequests = new Map(), requests = [];
  let tokenSequence = 0;
  const state = { delayMs, failNext: false, emptyLocations: false, missingUsage: false, ignoreAbort: false, savingsMode: "positive" };
  function savings() {
    const at = now(), mode = state.savingsMode;
    const row = { currency: "EUR", couponSavingsMinor: 2500, valuedRedemptions: 4, unvaluedRedemptions: 0,
      subscriptionPaidMinor: 1500, netBenefitMinor: 1000 };
    if (mode === "unavailable") { row.subscriptionPaidMinor = null; row.netBenefitMinor = null; }
    if (mode === "negative") { row.couponSavingsMinor = 500; row.valuedRedemptions = 1; row.netBenefitMinor = -1000; }
    if (mode === "zero") { row.couponSavingsMinor = 1500; row.netBenefitMinor = 0; }
    if (mode === "unknown") { row.unvaluedRedemptions = 1; row.netBenefitMinor = null; }
    const currencies = mode === "empty" ? [] : [row];
    if (mode === "multiple") currencies.push({ currency: "USD", couponSavingsMinor: 800, valuedRedemptions: 2,
      unvaluedRedemptions: 0, subscriptionPaidMinor: 1200, netBenefitMinor: -400 });
    return clone({ ok: true, checkedAt: at, period: { kind: "ALL_TIME", through: at },
      paymentEvidence: ["unavailable", "empty"].includes(mode) ? "UNAVAILABLE" : "VERIFIED_COMPLETE", currencies });
  }
  const projectedOffer = offer => ({ slug: offer.slug, revision: offer.revision, terms: clone(offer.terms),
    ...(!state.missingUsage ? { usage: { limit: offer.terms.perShopperLimit, used: usage.get(offer.slug) || 0,
      remaining: Math.max(0, offer.terms.perShopperLimit - (usage.get(offer.slug) || 0)), asOf: now() } } : {}) });
  const pages = (rows, page = 1) => ({ page, hasMore: rows.length > page * pageSize });
  function locations(query = {}) {
    if (state.emptyLocations) return { ok: true, locations: [], page: 1, hasMore: false };
    const search = (query.search || "").toLocaleLowerCase("en");
    // A duplicate Sliema on page 2 exercises the service's bounded-window DTO.
    const all = ["Sliema", "Valletta", "Hamrun", "Sliema", "Mosta"].filter(locality => locality.toLocaleLowerCase("en").includes(search))
      .map(locality => ({ locality, countryCode: "MT" })).filter(row => !query.countryCode || row.countryCode === query.countryCode);
    const page = Number(query.page || 1);
    return { ok: true, locations: all.slice((page - 1) * pageSize, page * pageSize), ...pages(all, page) };
  }
  function discover(query) {
    const search = (query.search || "").toLocaleLowerCase("en"), page = Number(query.page || 1);
    const found = shops.filter(shop => (!query.locality || shop.locality === query.locality) && (!query.countryCode || shop.countryCode === query.countryCode)
      && (!query.category || shop.categories.includes(query.category)) && (!search || `${shop.name} ${shop.description}`.toLocaleLowerCase("en").includes(search)));
    return { ok: true, shops: clone(found.slice((page - 1) * pageSize, page * pageSize)), ...pages(found, page) };
  }
  function shopView(slug, query = {}) {
    const shop = shops.find(row => row.slug === slug);
    if (!shop) return fail("OFFER_UNAVAILABLE", "This shop is not available.");
    const page = Number(query.page || 1), search = (query.search || "").toLocaleLowerCase("en");
    const found = offers.filter(offer => offer.shopSlug === slug && (!query.category || offer.terms.category === query.category)
      && (!search || `${offer.terms.title} ${offer.terms.description}`.toLocaleLowerCase("en").includes(search)));
    return { ok: true, shop: clone(shop), offers: found.slice((page - 1) * pageSize, page * pageSize).map(projectedOffer), ...pages(found, page) };
  }
  function claimOffer(body) {
    const offer = offers.find(row => row.slug === body.offerSlug && row.shopSlug === body.shopSlug && row.revision === body.expectedRevision);
    if (!offer || !body.idempotencyKey) return fail("CLAIM_UNAVAILABLE", "This sample offer is unavailable.");
    if (claimRequests.has(body.idempotencyKey)) return { ok: true, claim: publicClaim(claimRequests.get(body.idempotencyKey)) };
    if ((usage.get(offer.slug) || 0) >= offer.terms.perShopperLimit) return fail("LIMIT_REACHED", "All sample uses have been used.");
    const existing = claims.find(row => row._offerSlug === offer.slug && row.status === "READY");
    if (existing) { claimRequests.set(body.idempotencyKey, existing); return { ok: true, claim: publicClaim(existing) }; }
    const shop = shops.find(row => row.slug === body.shopSlug);
    const claim = { id: `demo-claim-${String(claims.length + 1).padStart(3, "0")}`, status: "READY", shop: { slug: shop.slug, name: shop.name },
      revision: offer.revision, terms: clone(offer.terms), createdAt: now(), expiresAt: end, receipt: null, _offerSlug: offer.slug };
    claims.unshift(claim); claimRequests.set(body.idempotencyKey, claim);
    return { ok: true, claim: publicClaim(claim) };
  }
  function publicClaim(claim) {
    const { _offerSlug, ...result } = claim, used = usage.get(_offerSlug) || 0;
    return clone({ ...result, ...(!state.missingUsage ? { usage: {
      limit: claim.terms.perShopperLimit, used,
      remaining: Math.max(0, claim.terms.perShopperLimit - used), asOf: now()
    } } : {}) });
  }
  function redeemLatest() {
    const claim = claims.find(row => row.status === "READY");
    if (!claim) return false;
    usage.set(claim._offerSlug, (usage.get(claim._offerSlug) || 0) + 1);
    const amount = Math.max(6000, claim.terms.minimumSpendMinor);
    claim.status = "REDEEMED";
    claim.receipt = { id: `demo-receipt-${claim.id}`, redeemedAt: now(), shopName: claim.shop.name, offerTitle: claim.terms.title, revision: claim.revision,
      currency: claim.terms.currency, eligibleSpendMinor: amount, discountMinor: Math.floor(amount * claim.terms.percentBps / 10_000), reversal: null };
    return true;
  }
  function reverseLatest() {
    const claim = claims.find(row => row.status === "REDEEMED" && row.receipt && !row.receipt.reversal);
    if (!claim) return false;
    usage.set(claim._offerSlug, Math.max(0, (usage.get(claim._offerSlug) || 0) - 1));
    claim.status = "REVERSED";
    claim.receipt.reversal = { id: `demo-reversal-${claim.id}`, reversedAt: now(), reason: "WRONG_COUPON" };
    return true;
  }
  function loadSampleWallet() {
    // Explicit preview data only: these scenarios are not service/database tests.
    // Resetting this tab never creates, deletes or changes a real claim.
    usage.clear(); usage.set("urban-edit-ten", 3); usage.set("table-and-co-ten", 10);
    claims.length = 0; claimRequests.clear(); state.missingUsage = false;
    const at = clock().getTime();
    const scenarios = [
      ["urban-edit-ten", "READY"], ["urban-edit-fifteen", "READY"],
      ["table-and-co-ten", "REDEEMED"], ["city-style-ten", "EXPIRED"],
      ["home-corner-fifteen", "REVERSED"], ["home-stories-ten", "UNAVAILABLE"]
    ];
    for (const [slug, status] of scenarios) {
      const offer = offers.find(row => row.slug === slug), shop = shops.find(row => row.slug === offer.shopSlug);
      const id = `demo-wallet-${slug}`;
      const claim = { id, status, shop: { slug: shop.slug, name: shop.name }, revision: offer.revision,
        terms: clone(offer.terms), createdAt: new Date(at - 20 * 60_000).toISOString(),
        expiresAt: new Date(at + (status === "EXPIRED" ? -60_000 : 60 * 60_000)).toISOString(),
        receipt: null, _offerSlug: slug };
      if (["REDEEMED", "REVERSED"].includes(status)) {
        const amount = Math.max(6000, claim.terms.minimumSpendMinor);
        claim.receipt = { id: `demo-receipt-${id}`, redeemedAt: new Date(at - 10 * 60_000).toISOString(),
          shopName: shop.name, offerTitle: claim.terms.title, revision: claim.revision, currency: claim.terms.currency,
          eligibleSpendMinor: amount, discountMinor: Math.floor(amount * claim.terms.percentBps / 10_000),
          reversal: status === "REVERSED" ? { id: `demo-reversal-${id}`, reversedAt: new Date(at - 5 * 60_000).toISOString(), reason: "WRONG_COUPON" } : null };
      }
      claims.push(claim);
    }
    return { ok: true, claims: claims.map(publicClaim), page: 1, hasMore: false };
  }
  async function transport(input, options = {}) {
    if (typeof input !== "string" || !input.startsWith("/api/rewards/") || input.startsWith("//")) throw new Error("Preview accepts only its in-memory Rewards paths.");
    const url = new URL(input, "http://preview.invalid"), method = options.method || "GET";
    requests.push({ method, path: url.pathname }); // No bodies, IDs, codes or credentials are logged.
    const wait = state.delayMs;
    if (wait) await new Promise((resolve, reject) => {
      const stop = () => { clearTimeout(timer); reject(new DOMException("Cancelled", "AbortError")); };
      const timer = setTimeout(() => { options.signal?.removeEventListener("abort", stop); resolve(); }, wait);
      if (!state.ignoreAbort) options.signal?.addEventListener("abort", stop, { once: true });
    });
    if (options.signal?.aborted && !state.ignoreAbort) throw new DOMException("Cancelled", "AbortError");
    if (state.failNext) { state.failNext = false; return fail("UNAVAILABLE", "This sample request could not be completed. Please try again."); }
    const query = Object.fromEntries(url.searchParams);
    let result;
    if (method === "GET" && url.pathname === "/api/rewards/savings" && Object.keys(query).length === 0) result = savings();
    else if (method === "GET" && url.pathname === "/api/rewards/discovery/locations") result = locations(query);
    else if (method === "GET" && url.pathname === "/api/rewards/discovery/shops") result = discover(query);
    else if (method === "GET" && /^\/api\/rewards\/discovery\/shops\/[^/]+$/.test(url.pathname)) result = shopView(decodeURIComponent(url.pathname.split("/").at(-1)), query);
    else if (method === "GET" && /^\/api\/rewards\/discovery\/shops\/[^/]+\/offers\/[^/]+$/.test(url.pathname)) {
      const parts = url.pathname.split("/"), shopSlug = decodeURIComponent(parts[5]), offerSlug = decodeURIComponent(parts[7]);
      const shop = shops.find(row => row.slug === shopSlug), offer = offers.find(row => row.shopSlug === shopSlug && row.slug === offerSlug);
      result = shop && offer ? { ok: true, shop: clone(shop), offer: projectedOffer(offer) } : fail("OFFER_UNAVAILABLE", "This sample voucher is unavailable.");
    } else if (method === "POST" && url.pathname === "/api/rewards/claims") result = claimOffer(JSON.parse(options.body || "{}"));
    else if (method === "GET" && url.pathname === "/api/rewards/claims") result = { ok: true, claims: claims.map(publicClaim), page: 1, hasMore: false };
    else if (method === "POST" && /^\/api\/rewards\/claims\/[^/]+\/credential$/.test(url.pathname)) {
      const id = decodeURIComponent(url.pathname.split("/")[4]), claim = claims.find(row => row.id === id);
      result = claim?.status === "READY" ? { ok: true, claim: publicClaim(claim), token: (++tokenSequence).toString(16).padStart(64, "d"),
        tokenExpiresAt: new Date(clock().getTime() + 5 * 60_000).toISOString() } : fail("CLAIM_UNAVAILABLE", "This sample coupon is unavailable.");
    } else result = fail("INVALID_REQUEST", "That operation is not supported in the local preview.");
    return clone(result);
  }
  return Object.freeze({ initialData: locations(), transport, state, redeemLatest, reverseLatest, loadSampleWallet, requests,
    snapshot: () => ({ uses: Object.fromEntries(usage), claims: claims.map(publicClaim), requestCount: requests.length }),
    initialWallet: () => ({ ok: true, claims: claims.map(publicClaim), page: 1, hasMore: false }), initialSavings: savings });
}
