import {
  PUBLIC_PLAN_CATALOGUE,
  RUVANAS_PRODUCTS,
  findPublicPlan,
  publicPlansForProduct
} from "./product-plan-catalogue.mjs";
import { resolveEntitlements } from "./entitlements.mjs";
import { loginLandingRoute } from "./login-routing.mjs";
import { enabledSubscriberProducts } from "./product-access.mjs";

const CATALOGUE_LEVEL_BY_TIER = Object.freeze({
  1: "NONE",
  2: "NONE",
  3: "FOCUSED",
  4: "PROFESSIONAL",
  5: "PREMIUM"
});

export const PRODUCT_QA_PROFILES = Object.freeze([
  Object.freeze({
    product: "RETAIL",
    organisationName: "Ruvanas Retail QA",
    startingPlanCode: "RETAIL_PROFESSIONAL",
    landingRoute: "/dashboard/retail"
  }),
  Object.freeze({
    product: "SCHOOL",
    organisationName: "Ruvanas School QA",
    startingPlanCode: "SCHOOL_PRO",
    landingRoute: "/dashboard/school"
  }),
  Object.freeze({
    product: "ONLINE",
    organisationName: "Ruvanas Online Radio QA",
    startingPlanCode: "ONLINE_PROFESSIONAL",
    landingRoute: "/dashboard/radio"
  })
]);

export function productQaProfile(value) {
  const name = String(value || "").trim();
  return PRODUCT_QA_PROFILES.find((profile) => profile.organisationName === name) || null;
}

export function productQaTierMatrix() {
  return PRODUCT_QA_PROFILES.flatMap((profile) =>
    publicPlansForProduct(profile.product).map((plan) => Object.freeze({
      product: profile.product,
      organisationName: profile.organisationName,
      planCode: plan.code,
      planName: plan.name,
      publicSlug: plan.publicSlug,
      tierNumber: plan.tierNumber,
      landingRoute: profile.landingRoute,
      licensedMusicCatalogueLevel: CATALOGUE_LEVEL_BY_TIER[plan.tierNumber]
    }))
  );
}

export function qaSubscriptionForPlan(plan) {
  return {
    status: "TRIAL",
    retailRadioEnabled: null,
    schoolRadioEnabled: null,
    onlineRadioEnabled: null,
    schoolPublicPublishingEnabled: null,
    retailMediaEnabled: null,
    digitalSignageEnabled: null,
    complimentaryAccessActive: false,
    complimentaryAccessCodeId: null,
    billingContract: null,
    plan
  };
}

export function evaluateProductQaPlan(plan, profile) {
  if (!plan || !profile || plan.productFamily !== profile.product) {
    return Object.freeze({ passed: false, failures: ["PRODUCT_PLAN_MISMATCH"] });
  }

  const cataloguePlan = findPublicPlan(plan.code, profile.product);
  const entitlements = resolveEntitlements(qaSubscriptionForPlan(plan));
  const products = enabledSubscriberProducts(entitlements).map((product) => product.key);
  const route = loginLandingRoute({ role: "OWNER", hasMembership: true, entitlements });
  const failures = [];

  if (!cataloguePlan || plan.active !== true || plan.publiclyAvailable !== true) failures.push("PLAN_NOT_PUBLIC");
  if (cataloguePlan && [
    "publicSlug",
    "tierNumber",
    "stationLimit",
    "storageLimitGb",
    "listenerLimit",
    "maxBitrateKbps",
    "licensedMusicCatalogueLevel",
    "retailRadioEnabled",
    "schoolRadioEnabled",
    "onlineRadioEnabled",
    "schoolPublicPublishingEnabled",
    "retailMediaEnabled",
    "digitalSignageEnabled"
  ].some((field) => plan[field] !== cataloguePlan[field])) failures.push("PLAN_CONFIGURATION_DRIFT");
  if (!entitlements.serviceEnabled) failures.push("SERVICE_INACTIVE");
  if (products.length !== 1 || products[0] !== profile.product) failures.push("PRODUCT_ISOLATION_FAILED");
  if (route !== profile.landingRoute) failures.push("LANDING_ROUTE_FAILED");
  if (entitlements.licensedMusicCatalogueLevel !== CATALOGUE_LEVEL_BY_TIER[plan.tierNumber]) {
    failures.push("CATALOGUE_LEVEL_FAILED");
  }
  if (entitlements.stationLimit !== plan.stationLimit) failures.push("STATION_LIMIT_FAILED");
  if (entitlements.storageLimitGb !== plan.storageLimitGb) failures.push("STORAGE_LIMIT_FAILED");
  if (entitlements.listenerLimit !== plan.listenerLimit) failures.push("LISTENER_LIMIT_FAILED");
  if (entitlements.maxBitrateKbps !== plan.maxBitrateKbps) failures.push("BITRATE_LIMIT_FAILED");

  return Object.freeze({
    passed: failures.length === 0,
    failures: Object.freeze(failures),
    route,
    products: Object.freeze(products),
    entitlements
  });
}

export function productQaSwitchDecision({ organisation, planCode } = {}) {
  const profile = productQaProfile(organisation?.name);
  if (!profile) {
    return { ok: false, status: 409, code: "NOT_QA_ORGANISATION", error: "Tier testing is limited to the three designated Ruvanas QA organisations." };
  }
  if (!organisation?.subscription) {
    return { ok: false, status: 409, code: "SUBSCRIPTION_MISSING", error: "This QA organisation does not have a subscription." };
  }
  if (organisation.subscription.status !== "TRIAL") {
    return { ok: false, status: 409, code: "NOT_TEST_SUBSCRIPTION", error: "Only a non-billed QA trial subscription can use tier testing." };
  }
  if (organisation.subscription.billingContract) {
    return { ok: false, status: 409, code: "BILLING_ATTACHED", error: "Tier testing is blocked because this organisation has a billing contract." };
  }
  if (organisation.subscription.complimentaryAccessActive || organisation.subscription.complimentaryAccessCodeId) {
    return { ok: false, status: 409, code: "COMPLIMENTARY_ACCESS_ATTACHED", error: "Stop or remove complimentary access before using controlled tier testing." };
  }

  const cataloguePlan = findPublicPlan(planCode, profile.product);
  if (!cataloguePlan) {
    return { ok: false, status: 400, code: "INVALID_QA_PLAN", error: `Choose a ${profile.product.toLowerCase()} plan from the controlled Tier 1–5 catalogue.` };
  }

  return { ok: true, profile, cataloguePlan };
}

export function productQaSubscriptionUpdate(planId) {
  return Object.freeze({
    planId,
    retailRadioEnabled: null,
    schoolRadioEnabled: null,
    onlineRadioEnabled: null,
    schoolPublicPublishingEnabled: null,
    retailMediaEnabled: null,
    digitalSignageEnabled: null
  });
}

export function validateProductQaPolicy() {
  if (PRODUCT_QA_PROFILES.length !== 3) throw new Error("Exactly three product QA profiles are required.");
  if (new Set(PRODUCT_QA_PROFILES.map((profile) => profile.product)).size !== RUVANAS_PRODUCTS.length) {
    throw new Error("Each Ruvanas product must have one QA profile.");
  }
  if (productQaTierMatrix().length !== PUBLIC_PLAN_CATALOGUE.length) {
    throw new Error("The QA matrix must cover all public plans.");
  }
  for (const profile of PRODUCT_QA_PROFILES) {
    const startingPlan = findPublicPlan(profile.startingPlanCode, profile.product);
    if (!startingPlan || startingPlan.tierNumber !== 3) throw new Error(`${profile.product} must start on Tier 3.`);
  }
  return true;
}

validateProductQaPolicy();
