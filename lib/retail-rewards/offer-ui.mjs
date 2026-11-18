// Browser-safe presentation/conversion helpers; authority remains server-side.
const pad = n => String(n).padStart(2, "0");

export function decimalToMinor(value, { maximum = 100_000_000 } = {}) {
  const text = String(value).trim();
  if (!/^\d{1,9}(?:\.\d{1,2})?$/.test(text)) throw new Error("Use a positive amount with at most two decimal places.");
  const [whole, fraction = ""] = text.split(".");
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(minor) || minor > maximum) throw new Error("The amount is too large.");
  return minor;
}

export function minorToDecimal(value) {
  if (!Number.isSafeInteger(value) || value < 0) return "";
  return `${Math.floor(value / 100)}.${String(value % 100).padStart(2, "0")}`;
}

function wallParts(date, timezone) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(date);
  return Object.fromEntries(parts.filter(p => p.type !== "literal").map(p => [p.type, Number(p.value)]));
}

export function isoToWallTime(iso, timezone) {
  const p = wallParts(new Date(iso), timezone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

// Enumerate observed offsets around this date, then require exactly one matching
// instant. A missing or repeated DST wall time must not silently shift an offer.
export function wallTimeToIso(value, timezone) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(value));
  if (!match) throw new Error("Choose a complete date and time.");
  const [, y, mo, d, h, mi] = match.map(Number);
  if (y < 2000 || y > 9999) throw new Error("Choose a year between 2000 and 9999.");
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  const check = new Date(wall);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d || check.getUTCHours() !== h || check.getUTCMinutes() !== mi) throw new Error("Choose a valid date and time.");
  const offsets = new Set();
  try {
    for (let hours = -36; hours <= 36; hours += 6) {
      const probe = wall + hours * 3_600_000;
      const p = wallParts(new Date(probe), timezone);
      offsets.add(Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - probe);
    }
  } catch { throw new Error("Choose a recognised timezone, for example Europe/Malta."); }
  const matches = [...offsets].map(offset => wall - offset).filter(instant => {
    const p = wallParts(new Date(instant), timezone);
    return p.year === y && p.month === mo && p.day === d && p.hour === h && p.minute === mi && p.second === 0;
  });
  if (matches.length === 0) throw new Error("This time does not exist when the clocks change. Choose another time.");
  if (matches.length !== 1) throw new Error("This time happens twice when the clocks change. Choose a time outside that hour.");
  return new Date(matches[0]).toISOString();
}

export function offerBenefit(terms) {
  if (!terms) return "Offer";
  if (terms.type === "PERCENT_OFF") return `${Number(minorToDecimal(terms.percentBps))}% off`;
  if (terms.type === "FIXED_AMOUNT") return `${new Intl.NumberFormat("en", { style: "currency", currency: terms.currency }).format(terms.amountMinor / 100)} off`;
  return `Buy ${terms.buyQuantity}, get ${terms.getQuantity} free`;
}

export function offerDateLabel(iso, timezone) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: timezone, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
}

export function emptyOfferForm(now = new Date()) {
  const start = new Date(now); start.setUTCMinutes(0, 0, 0); start.setUTCHours(start.getUTCHours() + 1);
  const end = new Date(start.getTime() + 30 * 86_400_000);
  return { title: "", description: "", category: "FASHION", type: "PERCENT_OFF", percent: "15", amount: "10.00", buyQuantity: "1", getQuantity: "1", currency: "EUR", minimumSpend: "0.00", exclusions: "", legalTerms: "", combinable: false, startsAt: isoToWallTime(start.toISOString(), "Europe/Malta"), endsAt: isoToWallTime(end.toISOString(), "Europe/Malta"), timezone: "Europe/Malta", locationIds: [], usage: "SINGLE_USE", totalLimit: "100", perShopperLimit: "1", perShopperDailyLimit: "1", pausedClaimsPolicy: "HONOUR_ISSUED" };
}

export function termsToOfferForm(terms) {
  return { title: terms.title, description: terms.description, category: terms.category, type: terms.type, percent: minorToDecimal(terms.percentBps) || "15", amount: minorToDecimal(terms.amountMinor) || "10.00", buyQuantity: String(terms.buyQuantity ?? 1), getQuantity: String(terms.getQuantity ?? 1), currency: terms.currency, minimumSpend: minorToDecimal(terms.minimumSpendMinor), exclusions: terms.exclusions, legalTerms: terms.legalTerms, combinable: terms.combinable, startsAt: isoToWallTime(terms.startsAt, terms.timezone), endsAt: isoToWallTime(terms.endsAt, terms.timezone), timezone: terms.timezone, originalStartsAt: terms.startsAt, originalEndsAt: terms.endsAt, originalTimezone: terms.timezone, locationIds: [...terms.locationIds], usage: terms.usage, totalLimit: String(terms.totalLimit), perShopperLimit: String(terms.perShopperLimit), perShopperDailyLimit: String(terms.perShopperDailyLimit), pausedClaimsPolicy: terms.pausedClaimsPolicy };
}

function formDate(form, field, originalField) {
  if (form[originalField] && form.originalTimezone === form.timezone && isoToWallTime(form[originalField], form.timezone) === form[field]) return form[originalField];
  return wallTimeToIso(form[field], form.timezone);
}

function integer(value, label) {
  if (!/^\d{1,9}$/.test(String(value))) throw new Error(`${label} must be a whole number.`);
  return Number(value);
}

export function offerFormToTerms(form) {
  return { schemaVersion: 1, title: form.title.trim(), description: form.description.trim(), category: form.category, type: form.type,
    percentBps: form.type === "PERCENT_OFF" ? decimalToMinor(form.percent, { maximum: 10000 }) : null,
    amountMinor: form.type === "FIXED_AMOUNT" ? decimalToMinor(form.amount) : null,
    buyQuantity: form.type === "BOGO" ? integer(form.buyQuantity, "Buy quantity") : null,
    getQuantity: form.type === "BOGO" ? integer(form.getQuantity, "Free quantity") : null,
    currency: form.currency, minimumSpendMinor: decimalToMinor(form.minimumSpend), exclusions: form.exclusions.trim(), legalTerms: form.legalTerms.trim(), combinable: form.combinable,
    startsAt: formDate(form, "startsAt", "originalStartsAt"), endsAt: formDate(form, "endsAt", "originalEndsAt"), timezone: form.timezone,
    locationIds: [...form.locationIds], usage: form.usage, totalLimit: integer(form.totalLimit, "Total uses"),
    perShopperLimit: form.usage === "SINGLE_USE" ? 1 : integer(form.perShopperLimit, "Uses per shopper"),
    perShopperDailyLimit: form.usage === "SINGLE_USE" ? 1 : integer(form.perShopperDailyLimit, "Daily uses per shopper"), pausedClaimsPolicy: form.pausedClaimsPolicy };
}
