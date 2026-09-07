export const RUVANAS_PRODUCTS = Object.freeze(["RETAIL", "SCHOOL", "ONLINE"]);
export const LICENSED_MUSIC_CATALOGUE_LEVELS = Object.freeze([
  "NONE",
  "FOCUSED",
  "PROFESSIONAL",
  "PREMIUM"
]);

const catalogueLevelByTier = Object.freeze({
  1: "NONE",
  2: "NONE",
  3: "FOCUSED",
  4: "PROFESSIONAL",
  5: "PREMIUM"
});

function productCapabilities(product) {
  return {
    retailRadioEnabled: product === "RETAIL",
    schoolRadioEnabled: product === "SCHOOL",
    onlineRadioEnabled: product === "ONLINE"
  };
}

function definePlan({
  code,
  publicSlug,
  productFamily,
  tierNumber,
  name,
  monthlyPriceCents,
  stationLimit,
  storageLimitGb,
  listenerLimit,
  maxBitrateKbps,
  description,
  schoolPublicPublishingEnabled = false,
  retailMediaEnabled = false,
  digitalSignageEnabled = false,
  enterpriseContactRequired = false
}) {
  return Object.freeze({
    code,
    publicSlug,
    productFamily,
    tierNumber,
    name,
    monthlyPriceCents,
    stationLimit,
    storageLimitGb,
    listenerLimit,
    maxBitrateKbps,
    description,
    publiclyAvailable: true,
    enterpriseContactRequired,
    includesRuvanasCatalogue: true,
    licensedMusicCatalogueLevel: catalogueLevelByTier[tierNumber],
    promoUploadEnabled: true,
    ...productCapabilities(productFamily),
    schoolPublicPublishingEnabled,
    retailMediaEnabled,
    digitalSignageEnabled,
    active: true
  });
}

export const PUBLIC_PLAN_CATALOGUE = Object.freeze([
  definePlan({
    code: "RETAIL_START",
    publicSlug: "retail-start",
    productFamily: "RETAIL",
    tierNumber: 1,
    name: "Retail Start",
    monthlyPriceCents: 1490,
    stationLimit: 1,
    storageLimitGb: 10,
    listenerLimit: 100,
    maxBitrateKbps: 192,
    description: "Entry scheduling, AutoDJ, own audio and basic promotions for one location and one zone."
  }),
  definePlan({
    code: "RETAIL_BUSINESS",
    publicSlug: "retail-business",
    productFamily: "RETAIL",
    tierNumber: 2,
    name: "Retail Business",
    monthlyPriceCents: 4900,
    stationLimit: 3,
    storageLimitGb: 50,
    listenerLimit: 500,
    maxBitrateKbps: 256,
    digitalSignageEnabled: true,
    description: "Multi-location scheduling, promotions, reporting and limited signage for a growing business."
  }),
  definePlan({
    code: "RETAIL_PROFESSIONAL",
    publicSlug: "retail-professional",
    productFamily: "RETAIL",
    tierNumber: 3,
    name: "Retail Professional",
    monthlyPriceCents: 14900,
    stationLimit: 10,
    storageLimitGb: 200,
    listenerLimit: 2000,
    maxBitrateKbps: 320,
    retailMediaEnabled: true,
    digitalSignageEnabled: true,
    description: "Advanced analytics, cross-media tools and a focused Licensed Music Catalogue for established operators."
  }),
  definePlan({
    code: "RETAIL_ADVANCED",
    publicSlug: "retail-advanced",
    productFamily: "RETAIL",
    tierNumber: 4,
    name: "Retail Advanced",
    monthlyPriceCents: 39900,
    stationLimit: 30,
    storageLimitGb: 500,
    listenerLimit: 10000,
    maxBitrateKbps: 320,
    retailMediaEnabled: true,
    digitalSignageEnabled: true,
    description: "Regional-chain controls, integrations and a professional Licensed Music Catalogue."
  }),
  definePlan({
    code: "RETAIL_ENTERPRISE",
    publicSlug: "retail-enterprise",
    productFamily: "RETAIL",
    tierNumber: 5,
    name: "Retail Enterprise",
    monthlyPriceCents: 99900,
    stationLimit: 100,
    storageLimitGb: 2000,
    listenerLimit: 50000,
    maxBitrateKbps: 320,
    retailMediaEnabled: true,
    digitalSignageEnabled: true,
    enterpriseContactRequired: true,
    description: "Negotiated enterprise scale, identity, service and premium catalogue controls."
  }),
  definePlan({
    code: "SCHOOL_START",
    publicSlug: "school-start",
    productFamily: "SCHOOL",
    tierNumber: 1,
    name: "School Start",
    monthlyPriceCents: 1990,
    stationLimit: 1,
    storageLimitGb: 25,
    listenerLimit: 100,
    maxBitrateKbps: 192,
    description: "Staff-managed school broadcasting, basic production and internal publishing."
  }),
  definePlan({
    code: "SCHOOL_CREATE",
    publicSlug: "school-create",
    productFamily: "SCHOOL",
    tierNumber: 2,
    name: "School Create",
    monthlyPriceCents: 4900,
    stationLimit: 1,
    storageLimitGb: 100,
    listenerLimit: 300,
    maxBitrateKbps: 256,
    digitalSignageEnabled: true,
    description: "Creative production, multitrack AudioLab, podcasts, newsroom and teacher approvals."
  }),
  definePlan({
    code: "SCHOOL_PRO",
    publicSlug: "school-pro",
    productFamily: "SCHOOL",
    tierNumber: 3,
    name: "School Pro",
    monthlyPriceCents: 9900,
    stationLimit: 3,
    storageLimitGb: 250,
    listenerLimit: 1000,
    maxBitrateKbps: 320,
    schoolPublicPublishingEnabled: true,
    digitalSignageEnabled: true,
    description: "Guarded student access, supervised live tools and a focused education-authorised catalogue."
  }),
  definePlan({
    code: "SCHOOL_ACADEMY",
    publicSlug: "school-academy",
    productFamily: "SCHOOL",
    tierNumber: 4,
    name: "School Academy",
    monthlyPriceCents: 24900,
    stationLimit: 10,
    storageLimitGb: 750,
    listenerLimit: 5000,
    maxBitrateKbps: 320,
    schoolPublicPublishingEnabled: true,
    digitalSignageEnabled: true,
    description: "Multi-school policy, templates, analytics, exchange and professional catalogue controls."
  }),
  definePlan({
    code: "SCHOOL_ENTERPRISE",
    publicSlug: "education-enterprise",
    productFamily: "SCHOOL",
    tierNumber: 5,
    name: "Education Enterprise",
    monthlyPriceCents: 59900,
    stationLimit: 50,
    storageLimitGb: 2000,
    listenerLimit: 20000,
    maxBitrateKbps: 320,
    schoolPublicPublishingEnabled: true,
    digitalSignageEnabled: true,
    enterpriseContactRequired: true,
    description: "Negotiated education identity, compliance, service and premium catalogue controls."
  }),
  definePlan({
    code: "ONLINE_HOBBY",
    publicSlug: "online-hobby",
    productFamily: "ONLINE",
    tierNumber: 1,
    name: "Online Hobby",
    monthlyPriceCents: 1490,
    stationLimit: 1,
    storageLimitGb: 25,
    listenerLimit: 100,
    maxBitrateKbps: 192,
    description: "A tightly bounded station using rights-cleared uploads and core automation."
  }),
  definePlan({
    code: "ONLINE_STARTER",
    publicSlug: "online-starter",
    productFamily: "ONLINE",
    tierNumber: 2,
    name: "Online Starter",
    monthlyPriceCents: 3900,
    stationLimit: 1,
    storageLimitGb: 100,
    listenerLimit: 500,
    maxBitrateKbps: 256,
    description: "More capacity with standard scheduling and live tools for a growing station."
  }),
  definePlan({
    code: "ONLINE_PROFESSIONAL",
    publicSlug: "online-professional",
    productFamily: "ONLINE",
    tierNumber: 3,
    name: "Online Professional",
    monthlyPriceCents: 8900,
    stationLimit: 3,
    storageLimitGb: 250,
    listenerLimit: 2000,
    maxBitrateKbps: 320,
    description: "Professional scheduling, live operation, analytics and a focused webcasting-authorised catalogue."
  }),
  definePlan({
    code: "ONLINE_STATION_PRO",
    publicSlug: "online-station-pro",
    productFamily: "ONLINE",
    tierNumber: 4,
    name: "Online Station Pro",
    monthlyPriceCents: 19900,
    stationLimit: 10,
    storageLimitGb: 750,
    listenerLimit: 10000,
    maxBitrateKbps: 320,
    retailMediaEnabled: true,
    description: "Larger-team operations, advertising, integrations and professional catalogue controls."
  }),
  definePlan({
    code: "ONLINE_NETWORK",
    publicSlug: "online-network",
    productFamily: "ONLINE",
    tierNumber: 5,
    name: "Online Network",
    monthlyPriceCents: 49900,
    stationLimit: 50,
    storageLimitGb: 2000,
    listenerLimit: 50000,
    maxBitrateKbps: 320,
    retailMediaEnabled: true,
    enterpriseContactRequired: true,
    description: "Negotiated multi-station scale, enterprise controls and premium catalogue reporting."
  })
]);

export function validatePublicPlanCatalogue(plans = PUBLIC_PLAN_CATALOGUE) {
  if (!Array.isArray(plans) || plans.length !== 15) throw new Error("The public plan catalogue must contain exactly fifteen plans.");

  const codes = new Set();
  const slugs = new Set();
  for (const plan of plans) {
    if (codes.has(plan.code) || slugs.has(plan.publicSlug)) throw new Error("Plan codes and public slugs must be unique.");
    codes.add(plan.code);
    slugs.add(plan.publicSlug);
    if (!RUVANAS_PRODUCTS.includes(plan.productFamily)) throw new Error(`Unsupported product family for ${plan.code}.`);
    if (!Number.isInteger(plan.tierNumber) || plan.tierNumber < 1 || plan.tierNumber > 5) throw new Error(`Invalid tier number for ${plan.code}.`);
    if (plan.licensedMusicCatalogueLevel !== catalogueLevelByTier[plan.tierNumber]) throw new Error(`Invalid Licensed Music Catalogue level for ${plan.code}.`);
    const enabledProducts = [plan.retailRadioEnabled, plan.schoolRadioEnabled, plan.onlineRadioEnabled].filter(Boolean).length;
    if (enabledProducts !== 1) throw new Error(`${plan.code} must enable exactly one product family.`);
    if (!Number.isInteger(plan.monthlyPriceCents) || plan.monthlyPriceCents < 0) throw new Error(`Invalid monthly price for ${plan.code}.`);
  }

  for (const product of RUVANAS_PRODUCTS) {
    const tiers = plans.filter((plan) => plan.productFamily === product).map((plan) => plan.tierNumber).sort();
    if (tiers.join(",") !== "1,2,3,4,5") throw new Error(`${product} must contain tiers one through five.`);
  }

  return true;
}

export function publicPlansForProduct(product) {
  const normalized = String(product || "").trim().toUpperCase();
  return PUBLIC_PLAN_CATALOGUE.filter((plan) => plan.productFamily === normalized);
}

export function findPublicPlan(value, product = null) {
  const normalized = String(value || "").trim().toLowerCase();
  const normalizedProduct = product ? String(product).trim().toUpperCase() : null;
  return PUBLIC_PLAN_CATALOGUE.find((plan) =>
    (!normalizedProduct || plan.productFamily === normalizedProduct) &&
    (plan.code.toLowerCase() === normalized || plan.publicSlug === normalized)
  ) || null;
}

export function publicPlanDatabaseData(plan) {
  if (!plan || !PUBLIC_PLAN_CATALOGUE.includes(plan)) throw new Error("Choose a plan from the authoritative public catalogue.");
  const {
    description: _description,
    enterpriseContactRequired: _enterpriseContactRequired,
    ...data
  } = plan;
  return data;
}

validatePublicPlanCatalogue();
