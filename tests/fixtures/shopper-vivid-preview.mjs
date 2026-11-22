// Fictional, memory-only UI preview. Never import this module into a production
// route. Its public demo codes cannot be accepted by the real checkout parser.
const clone = value => JSON.parse(JSON.stringify(value));
const fail = (code, error) => ({ ok: false, code, error });
const expiry = "2027-12-31T22:59:59.999Z";
const examples = [
  { id: "demo-dining", shopName: "Fuego Kitchen", subtitle: "Wood-fired tapas & good company", category: "Dining", benefit: "30% OFF", number: "RVS • 8842 • 9104", shopSlug: "demo-fuego-kitchen", location: "Sliema", code: "DEMO-FUEGO30", limit: 10, rule: { type: "PERCENT", bps: 3000, minimum: 2000, suggested: 6000 }, terms: "30% off eligible food when you spend €20 or more. Drinks and delivery excluded. Up to 10 uses. Cannot be combined with other offers. Valid until 31 December 2027. Fictional preview offer; no cash or voucher value." },
  { id: "demo-tech", shopName: "Volt Store", subtitle: "Audio, wearables & smart gear", category: "Tech", benefit: "€40 OFF", number: "RVS • 4519 • 3308", shopSlug: "demo-volt-store", location: "Sliema", code: "DEMO-VOLT40", limit: 1, rule: { type: "FIXED", amount: 4000, minimum: 20000, suggested: 25000 }, terms: "€40 off an eligible purchase of €200 or more. Gift cards and service plans excluded. One use. Cannot be combined with other offers. Valid until 31 December 2027. Fictional preview offer; no cash or voucher value." },
  { id: "demo-fashion", shopName: "Kova Apparel", subtitle: "Everyday style, extraordinary colour", category: "Fashion", benefit: "25% OFF", number: "RVS • 6621 • 4802", shopSlug: "demo-kova-apparel", location: "Sliema", code: "DEMO-KOVA25", limit: 5, rule: { type: "PERCENT", bps: 2500, minimum: 5000, suggested: 8000 }, terms: "25% off full-price clothing on purchases of €50 or more. Sale items and gift cards excluded. Up to 5 uses. Cannot be combined with other offers. Valid until 31 December 2027. Fictional preview offer; no cash or voucher value." },
  { id: "demo-coffee", shopName: "Roast & Co.", subtitle: "Artisan espresso & your daily pause", category: "Coffee", benefit: "2-FOR-1", number: "RVS • 2940 • 5117", shopSlug: "demo-roast-and-co", location: "Valletta", code: "DEMO-ROAST2", limit: 6, rule: { type: "PAIR", amount: 500, minimum: 1000, suggested: 1000 }, terms: "Buy two selected coffees priced at €5 each and receive one free: €10 before discount, €5 saving. One pair per redemption; extra items are not discounted. Up to 6 uses. Valid until 31 December 2027. Fictional preview offer; no cash or voucher value." },
  { id: "demo-entertainment", shopName: "Nova Cinema", subtitle: "Big screens. A brilliant night out.", category: "Entertainment", benefit: "15% OFF", number: "RVS • 9073 • 6241", shopSlug: "demo-nova-cinema", location: "Valletta", code: "DEMO-NOVA15", limit: 2, rule: { type: "PERCENT", bps: 1500, minimum: 2000, suggested: 4000 }, terms: "15% off eligible cinema tickets when you spend €20 or more. Special screenings and food excluded. Up to 2 uses. Cannot be combined with other offers. Valid until 31 December 2027. Fictional preview offer; no cash or voucher value." },
  { id: "demo-wellness", shopName: "Pulse Club", subtitle: "Rest, recover & feel your best", category: "Wellness", benefit: "€15 OFF", number: "RVS • 5738 • 2096", shopSlug: "demo-pulse-club", location: "St Julian’s", code: "DEMO-PULSE15", limit: 4, rule: { type: "FIXED", amount: 1500, minimum: 5000, suggested: 6500 }, terms: "€15 off an eligible treatment costing €50 or more. Advance booking required. Up to 4 uses. Cannot be combined with other offers. Valid until 31 December 2027. Fictional preview offer; no cash or voucher value." }
];
const cardFrom = row => ({ id: row.id, shopName: row.shopName, subtitle: row.subtitle, category: row.category,
  benefit: row.benefit, number: row.number, expires: "12/27", expiresAt: expiry, usesLeft: row.limit,
  useLimit: row.limit, terms: row.terms, code: row.code, qrPayload: `RUVANAS-DEMO:${row.code}`,
  shopSlug: row.shopSlug, location: row.location, currency: "EUR", previewOnly: true });
export const VIVID_PREVIEW_CARDS = Object.freeze(examples.map(row => Object.freeze(cardFrom(row))));

export function createVividShopperPreview({ clock = () => new Date() } = {}) {
  const saved = new Set(["demo-dining", "demo-tech", "demo-fashion"]), counts = new Map();
  const attempts = new Map(), pendingByCard = new Map(), history = []; let sequence = 0;
  const find = id => examples.find(row => row.id === id);
  const usesLeft = row => Math.max(0, row.limit - (counts.get(row.id) || 0));
  const totalSavedMinor = () => history.reduce((sum, receipt) => sum + receipt.discountMinor, 0);
  const validDate = () => { const value = clock(); if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new Error("Invalid preview clock"); return value; };
  const card = row => ({ ...cardFrom(row), usesLeft: usesLeft(row) });
  function prepareRedemption(cardId) {
    const row = find(cardId);
    if (!row) return fail("NOT_FOUND", "Choose an available demo voucher.");
    if (validDate().getTime() > Date.parse(expiry)) return fail("EXPIRED", "This example voucher has expired.");
    if (!usesLeft(row)) return fail("EXHAUSTED", "All of this voucher’s demo uses have been redeemed.");
    const previous = pendingByCard.get(row.id); if (previous) attempts.get(previous).status = "REPLACED";
    const attemptId = `demo-checkout-${++sequence}`;
    attempts.set(attemptId, { id: attemptId, cardId, status: "PENDING" }); pendingByCard.set(cardId, attemptId);
    return { ok: true, attemptId, card: card(row), minimumSpendMinor: row.rule.minimum,
      suggestedSpendMinor: row.rule.suggested, currency: "EUR",
      confirmationLabel: row.rule.type === "PAIR" ? "Two eligible €5 coffees included" : "Eligible purchase before discount" };
  }
  function confirmDemoRedemption(attemptId, spendMinor) {
    const attempt = attempts.get(attemptId);
    if (!attempt) return fail("NOT_FOUND", "Prepare this demo checkout again.");
    if (!Number.isSafeInteger(spendMinor) || spendMinor < 0 || spendMinor > 1_000_000_000) return fail("INVALID_SPEND", "Enter a valid purchase amount.");
    if (attempt.status === "CONFIRMED") {
      if (attempt.receipt.eligibleSpendMinor !== spendMinor) return fail("IDEMPOTENCY_CONFLICT", "This demo checkout was already confirmed with a different amount.");
      return { ok: true, receipt: clone(attempt.receipt), totalSavedMinor: totalSavedMinor(), usesLeft: usesLeft(find(attempt.cardId)), repeated: true };
    }
    if (attempt.status !== "PENDING" || pendingByCard.get(attempt.cardId) !== attemptId) return fail("STALE_ATTEMPT", "This demo checkout has closed. Prepare a new one.");
    const row = find(attempt.cardId), at = validDate();
    if (at.getTime() > Date.parse(expiry)) return fail("EXPIRED", "This example voucher has expired.");
    if (!usesLeft(row)) return fail("EXHAUSTED", "All of this voucher’s demo uses have been redeemed.");
    if (spendMinor < row.rule.minimum) return fail("MINIMUM_SPEND", `This demo requires a qualifying purchase of at least €${(row.rule.minimum / 100).toFixed(2)}.`);
    const discountMinor = Math.min(spendMinor, row.rule.type === "PERCENT" ? Math.floor(spendMinor * row.rule.bps / 10_000) : row.rule.amount);
    const receipt = { id: `demo-receipt-${history.length + 1}`, attemptId, cardId: row.id, shopSlug: row.shopSlug,
      shopName: row.shopName, currency: "EUR", eligibleSpendMinor: spendMinor, discountMinor,
      finalAmountMinor: spendMinor - discountMinor, redeemedAt: at.toISOString(), simulated: true };
    counts.set(row.id, (counts.get(row.id) || 0) + 1); history.push(receipt);
    attempt.status = "CONFIRMED"; attempt.receipt = receipt; pendingByCard.delete(row.id);
    return { ok: true, receipt: clone(receipt), totalSavedMinor: totalSavedMinor(), usesLeft: usesLeft(row), repeated: false };
  }
  function cancelRedemption(attemptId) {
    const attempt = attempts.get(attemptId); if (!attempt || attempt.status !== "PENDING") return false;
    attempt.status = "CANCELLED";
    if (pendingByCard.get(attempt.cardId) === attemptId) pendingByCard.delete(attempt.cardId);
    return true;
  }
  return {
    listCards: () => examples.map(card), savedIDs: () => [...saved],
    toggleSave(id) { if (!find(id)) return false; if (saved.has(id)) { saved.delete(id); return false; } saved.add(id); return true; },
    prepareRedemption, confirmDemoRedemption, cancelRedemption, totalSavedMinor,
    receipts: () => clone(history), savingsByCurrency: () => ({ EUR: totalSavedMinor() })
  };
}
