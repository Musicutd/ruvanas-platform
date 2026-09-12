import {
  findPublicPlan,
  publicPlansForProduct,
  RUVANAS_PRODUCTS
} from "./product-plan-catalogue.mjs";

export const REGISTRATION_PRODUCT_CONTENT = Object.freeze([
  Object.freeze({ id: "RETAIL", slug: "retail", label: "Retail / In-house Radio", shortLabel: "Retail Radio", description: "Music, promotions, secure players, locations and optional retail-media and signage tools." }),
  Object.freeze({ id: "SCHOOL", slug: "school", label: "School Radio", shortLabel: "School Radio", description: "Supervised school broadcasting, podcasting, learning, safeguarding and controlled publishing." }),
  Object.freeze({ id: "ONLINE", slug: "online", label: "Online Radio", shortLabel: "Online Radio", description: "24/7 internet radio, live presenters, public listeners, podcasts, distribution and station operations." }),
  Object.freeze({ id: "HEALTH", slug: "health", label: "Ruvanas Health", shortLabel: "Health", description: "Hospital and wellbeing audio, moderated requests, multi-site channels, podcasts, players and displays." }),
  Object.freeze({ id: "FAITH", slug: "faith", label: "Ruvanas Faith", shortLabel: "Faith", description: "Continuous faith radio, live-service handoff, sermons, podcasts, campuses, players and displays." }),
  Object.freeze({ id: "ORGANISATIONS", slug: "organisations", label: "Ruvanas Organisations", shortLabel: "Organisations", description: "Subscriber-operated channels, announcements, events, podcasts, sponsors, displays and branch controls." })
]);

const PRODUCT_BY_ID = new Map(REGISTRATION_PRODUCT_CONTENT.map((product) => [product.id, product]));
const PRODUCT_BY_SLUG = new Map(REGISTRATION_PRODUCT_CONTENT.map((product) => [product.slug, product]));

export function formatMonthlyPlanPrice(monthlyPriceCents, { from = false } = {}) {
  const cents = Number(monthlyPriceCents);
  if (!Number.isInteger(cents) || cents < 0) return "Contact Ruvanas";
  const amount = cents / 100;
  const formatted = Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
  return `${from ? "From " : ""}€${formatted} / month`;
}

function catalogueDescription(plan) {
  if (plan.licensedMusicCatalogueLevel === "NONE") {
    return "Ruvanas core and your authorised audio; Licensed Music Catalogue not included.";
  }
  const label = plan.licensedMusicCatalogueLevel.charAt(0) + plan.licensedMusicCatalogueLevel.slice(1).toLowerCase();
  return `${label} Licensed Music Catalogue, subject to product-use and territory rights.`;
}

export function registrationPlanOptions(product) {
  const normalized = String(product || "").trim().toUpperCase();
  if (!RUVANAS_PRODUCTS.includes(normalized)) return [];
  return publicPlansForProduct(normalized).map((plan) => ({
    code: plan.code,
    publicSlug: plan.publicSlug,
    productFamily: plan.productFamily,
    tierNumber: plan.tierNumber,
    name: plan.name,
    description: plan.description,
    priceLabel: formatMonthlyPlanPrice(plan.monthlyPriceCents, { from: plan.enterpriseContactRequired }),
    stationLimit: plan.stationLimit,
    storageLimitGb: plan.storageLimitGb,
    listenerLimit: plan.listenerLimit,
    maxBitrateKbps: plan.maxBitrateKbps,
    licensedMusicCatalogueLevel: plan.licensedMusicCatalogueLevel,
    catalogueDescription: catalogueDescription(plan),
    enterpriseContactRequired: plan.enterpriseContactRequired
  }));
}

export function registrationProducts() {
  return REGISTRATION_PRODUCT_CONTENT.map((product) => ({ ...product, plans: registrationPlanOptions(product.id) }));
}

export function resolveRegistrationDeepLink({ platform, tier } = {}) {
  const normalizedPlatform = String(platform || "").trim().toLowerCase();
  const product = PRODUCT_BY_SLUG.get(normalizedPlatform) || PRODUCT_BY_ID.get(normalizedPlatform.toUpperCase()) || null;
  const enterpriseRequested = normalizedPlatform === "enterprise";
  if (!product) return { product: null, tier: null, selectedFromPricing: false, enterpriseRequested };
  const plan = findPublicPlan(tier, product.id);
  const selectablePlan = plan && !plan.enterpriseContactRequired ? plan : null;
  return {
    product: product.id,
    tier: selectablePlan?.publicSlug || null,
    selectedFromPricing: Boolean(selectablePlan),
    enterpriseRequested: Boolean(plan?.enterpriseContactRequired)
  };
}

export function productContent(product) {
  return PRODUCT_BY_ID.get(String(product || "").trim().toUpperCase()) || null;
}
