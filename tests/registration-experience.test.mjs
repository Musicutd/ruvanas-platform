import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PUBLIC_PLAN_CATALOGUE } from "../lib/product-plan-catalogue.mjs";
import {
  formatMonthlyPlanPrice,
  registrationPlanOptions,
  registrationProducts,
  resolveRegistrationDeepLink
} from "../lib/registration-experience.mjs";

test("the registration journey exposes all thirty approved plans from one catalogue", () => {
  const products = registrationProducts();
  assert.deepEqual(products.map((product) => product.id), ["RETAIL", "SCHOOL", "ONLINE", "HEALTH", "FAITH", "ORGANISATIONS"]);
  assert.deepEqual(products.map((product) => product.plans.length), [5, 5, 5, 5, 5, 5]);
  assert.deepEqual(
    products.flatMap((product) => product.plans.map((plan) => [plan.code, plan.name, plan.priceLabel])),
    PUBLIC_PLAN_CATALOGUE.map((plan) => [
      plan.code,
      plan.name,
      formatMonthlyPlanPrice(plan.monthlyPriceCents, { from: plan.enterpriseContactRequired })
    ])
  );
  assert.equal(formatMonthlyPlanPrice(1490), "€14.90 / month");
  assert.equal(formatMonthlyPlanPrice(99900, { from: true }), "From €999 / month");
});

test("valid pricing links preselect only a matching self-service product and tier", () => {
  assert.deepEqual(resolveRegistrationDeepLink({ platform: "retail", tier: "retail-professional" }), {
    product: "RETAIL",
    tier: "retail-professional",
    selectedFromPricing: true,
    enterpriseRequested: false
  });
  assert.deepEqual(resolveRegistrationDeepLink({ platform: "school", tier: "SCHOOL_CREATE" }), {
    product: "SCHOOL",
    tier: "school-create",
    selectedFromPricing: true,
    enterpriseRequested: false
  });
  assert.deepEqual(resolveRegistrationDeepLink({ platform: "online", tier: "online-professional" }), {
    product: "ONLINE",
    tier: "online-professional",
    selectedFromPricing: true,
    enterpriseRequested: false
  });
  assert.equal(resolveRegistrationDeepLink({ platform: "health", tier: "health-pro" }).product, "HEALTH");
  assert.equal(resolveRegistrationDeepLink({ platform: "faith", tier: "faith-pro" }).product, "FAITH");
  assert.equal(resolveRegistrationDeepLink({ platform: "organisations", tier: "organisations-pro" }).product, "ORGANISATIONS");
});

test("mismatched, invented and Enterprise links cannot create implicit plan authority", () => {
  assert.deepEqual(resolveRegistrationDeepLink({ platform: "school", tier: "retail-start" }), {
    product: "SCHOOL",
    tier: null,
    selectedFromPricing: false,
    enterpriseRequested: false
  });
  assert.deepEqual(resolveRegistrationDeepLink({ platform: "online", tier: "invented" }), {
    product: "ONLINE",
    tier: null,
    selectedFromPricing: false,
    enterpriseRequested: false
  });
  assert.deepEqual(resolveRegistrationDeepLink({ platform: "retail", tier: "retail-enterprise" }), {
    product: "RETAIL",
    tier: null,
    selectedFromPricing: false,
    enterpriseRequested: true
  });
  assert.equal(resolveRegistrationDeepLink({ platform: "enterprise" }).enterpriseRequested, true);
  assert.equal(resolveRegistrationDeepLink().product, null);
});

test("plan presentation uses customer-safe Licensed Music Catalogue wording", () => {
  for (const product of ["RETAIL", "SCHOOL", "ONLINE", "HEALTH", "FAITH", "ORGANISATIONS"]) {
    const plans = registrationPlanOptions(product);
    assert.deepEqual(plans.map((plan) => plan.tierNumber), [1, 2, 3, 4, 5]);
    assert.match(plans[0].catalogueDescription, /not included/i);
    assert.match(plans[2].catalogueDescription, /Focused Licensed Music Catalogue/);
    assert.match(plans[3].catalogueDescription, /Professional Licensed Music Catalogue/);
    assert.match(plans[4].catalogueDescription, /Premium Licensed Music Catalogue/);
    assert.doesNotMatch(JSON.stringify(plans), /supplier|provider credential|wholesale/i);
  }
});

test("registration UI preserves a guided, accessible and product-aware submission", async () => {
  const [page, journey, styles, homepage] = await Promise.all([
    readFile(new URL("../app/register/page.js", import.meta.url), "utf8"),
    readFile(new URL("../app/register/RegisterJourney.js", import.meta.url), "utf8"),
    readFile(new URL("../app/register/register.module.css", import.meta.url), "utf8"),
    readFile(new URL("../app/page.js", import.meta.url), "utf8")
  ]);

  assert.match(page, /resolveRegistrationDeepLink/);
  assert.match(page, /registrationProducts/);
  assert.match(journey, /Choose what you want to run with Ruvanas/);
  assert.match(journey, /Selected from pricing/);
  assert.match(journey, /type="radio"/);
  assert.match(journey, /<fieldset/);
  assert.match(journey, /<legend/);
  assert.match(journey, /role="alert"/);
  assert.match(journey, /tabIndex="-1"/);
  assert.match(journey, /recommendedDashboardRoute/);
  assert.match(journey, /product, tier, source:/);
  assert.match(journey, /previousStep/);
  assert.match(styles, /:focus-visible|:focus-within/);
  assert.match(styles, /@media \(max-width: 680px\)/);
  assert.match(styles, /prefers-reduced-motion/);
  assert.match(homepage, /registrationProducts/);
  assert.match(homepage, /tier\.publicSlug/);
  assert.doesNotMatch(homepage, /price: "9\.99"|price: "29"|price: "119"/);
});
