import { PUBLIC_PLAN_CATALOGUE } from "./product-plan-catalogue.mjs";

const organisationsUsd = Object.freeze({
  ORGANISATIONS_START: 2900,
  ORGANISATIONS_CONNECT: 6900,
  ORGANISATIONS_PRO: 14900,
  ORGANISATIONS_NETWORK: 34900,
  ORGANISATIONS_ENTERPRISE: 79900
});

export const REGIONAL_PRICE_BOOKS = Object.freeze({
  EUR: Object.freeze(Object.fromEntries(PUBLIC_PLAN_CATALOGUE.map((plan) => [plan.code, plan.monthlyPriceCents]))),
  USD: organisationsUsd
});

export function regionalPlanPrice(planCode, currency = "EUR") {
  const normalizedCurrency = String(currency || "").trim().toUpperCase();
  const book = REGIONAL_PRICE_BOOKS[normalizedCurrency];
  if (!book || !Object.hasOwn(book, planCode)) return null;
  return Object.freeze({ currency: normalizedCurrency, monthlyPriceCents: book[planCode] });
}
