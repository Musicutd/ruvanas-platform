import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PUBLIC_PLAN_CATALOGUE } from "../lib/product-plan-catalogue.mjs";
import {
  PRODUCT_QA_PROFILES,
  evaluateProductQaPlan,
  productQaProfile,
  productQaSubscriptionUpdate,
  productQaSwitchDecision,
  productQaTierMatrix,
  validateProductQaPolicy
} from "../lib/product-qa-acceptance.mjs";

function qaOrganisation(profile, overrides = {}) {
  return {
    id: `org-${profile.product.toLowerCase()}`,
    name: profile.organisationName,
    subscription: {
      id: `sub-${profile.product.toLowerCase()}`,
      status: "TRIAL",
      billingContract: null,
      complimentaryAccessActive: false,
      complimentaryAccessCodeId: null,
      ...overrides
    }
  };
}

test("controlled QA policy covers one Tier 3 starting tenant per Ruvanas product", () => {
  assert.equal(validateProductQaPolicy(), true);
  assert.equal(PRODUCT_QA_PROFILES.length, 6);
  assert.deepEqual(PRODUCT_QA_PROFILES.map((profile) => profile.product), ["RETAIL", "SCHOOL", "ONLINE", "HEALTH", "FAITH", "ORGANISATIONS"]);
  assert.deepEqual(PRODUCT_QA_PROFILES.map((profile) => profile.organisationName), [
    "Ruvanas Retail QA",
    "Ruvanas School QA",
    "Ruvanas Online Radio QA",
    "Ruvanas Health QA",
    "Ruvanas Faith QA",
    "Ruvanas Organisations QA"
  ]);
  assert.ok(PRODUCT_QA_PROFILES.every((profile) => !Object.hasOwn(profile, "email") && !Object.hasOwn(profile, "password")));
  assert.equal(productQaProfile("Customer organisation"), null);
});

test("the QA matrix proves product isolation, login routing, limits and Licensed Music Catalogue policy across all 30 tiers", () => {
  const matrix = productQaTierMatrix();
  assert.equal(matrix.length, 30);

  for (const profile of PRODUCT_QA_PROFILES) {
    const rows = matrix.filter((row) => row.product === profile.product);
    assert.deepEqual(rows.map((row) => row.tierNumber), [1, 2, 3, 4, 5]);
    assert.deepEqual(rows.map((row) => row.licensedMusicCatalogueLevel), [
      "NONE",
      "NONE",
      "FOCUSED",
      "PROFESSIONAL",
      "PREMIUM"
    ]);

    for (const row of rows) {
      const plan = PUBLIC_PLAN_CATALOGUE.find((item) => item.code === row.planCode);
      const evaluation = evaluateProductQaPlan(plan, profile);
      assert.equal(evaluation.passed, true, `${row.planCode}: ${evaluation.failures.join(", ")}`);
      assert.deepEqual(evaluation.products, [profile.product]);
      assert.equal(evaluation.route, profile.landingRoute);
      assert.equal(evaluation.entitlements.licensedMusicCatalogueLevel, row.licensedMusicCatalogueLevel);
      assert.equal(evaluation.entitlements.stationLimit, plan.stationLimit);
      assert.equal(evaluation.entitlements.listenerLimit, plan.listenerLimit);
      assert.equal(evaluation.entitlements.storageLimitGb, plan.storageLimitGb);
      assert.equal(evaluation.entitlements.maxBitrateKbps, plan.maxBitrateKbps);
    }
  }
});

test("QA tier switching fails closed for ordinary, billed, complimentary, non-trial and cross-product organisations", () => {
  const retail = PRODUCT_QA_PROFILES[0];
  assert.equal(productQaSwitchDecision({ organisation: qaOrganisation(retail), planCode: "RETAIL_START" }).ok, true);
  assert.equal(productQaSwitchDecision({ organisation: { ...qaOrganisation(retail), name: "Ordinary customer" }, planCode: "RETAIL_START" }).code, "NOT_QA_ORGANISATION");
  assert.equal(productQaSwitchDecision({ organisation: qaOrganisation(retail, { billingContract: { id: "billing" } }), planCode: "RETAIL_START" }).code, "BILLING_ATTACHED");
  assert.equal(productQaSwitchDecision({ organisation: qaOrganisation(retail, { status: "ACTIVE" }), planCode: "RETAIL_START" }).code, "NOT_TEST_SUBSCRIPTION");
  assert.equal(productQaSwitchDecision({ organisation: qaOrganisation(retail, { complimentaryAccessActive: true }), planCode: "RETAIL_START" }).code, "COMPLIMENTARY_ACCESS_ATTACHED");
  assert.equal(productQaSwitchDecision({ organisation: qaOrganisation(retail), planCode: "SCHOOL_START" }).code, "INVALID_QA_PLAN");
  assert.equal(productQaSwitchDecision({ organisation: qaOrganisation(retail), planCode: "invented-plan" }).code, "INVALID_QA_PLAN");
});

test("a QA tier change clears capability overrides so the chosen product plan remains authoritative", () => {
  assert.deepEqual(productQaSubscriptionUpdate("plan-retail-4"), {
    planId: "plan-retail-4",
    retailRadioEnabled: null,
    schoolRadioEnabled: null,
    onlineRadioEnabled: null,
    healthRadioEnabled: null,
    faithRadioEnabled: null,
    organisationsEnabled: null,
    schoolPublicPublishingEnabled: null,
    retailMediaEnabled: null,
    digitalSignageEnabled: null
  });
});

test("QA evaluation rejects a database plan that drifts from the authoritative catalogue", () => {
  const profile = PRODUCT_QA_PROFILES[0];
  const plan = PUBLIC_PLAN_CATALOGUE.find((item) => item.code === "RETAIL_PROFESSIONAL");
  const evaluation = evaluateProductQaPlan({ ...plan, listenerLimit: plan.listenerLimit + 1 }, profile);
  assert.equal(evaluation.passed, false);
  assert.ok(evaluation.failures.includes("PLAN_CONFIGURATION_DRIFT"));
});

test("the Super Admin control centre exposes governed switching without embedding QA identities or credentials", async () => {
  const [page, client, route, navigation] = await Promise.all([
    readFile(new URL("../app/admin/product-qa/page.js", import.meta.url), "utf8"),
    readFile(new URL("../app/admin/product-qa/ProductQaControlCentre.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/product-qa/route.js", import.meta.url), "utf8"),
    readFile(new URL("../lib/user-experience-navigation.mjs", import.meta.url), "utf8")
  ]);

  assert.match(page, /SUPER_ADMIN/);
  assert.match(client, /No billing event was created/);
  assert.match(route, /PRODUCT_QA_TIER_SWITCHED/);
  assert.match(route, /billingEventCreated: false/);
  assert.match(route, /publiclyAvailable: true/);
  assert.match(navigation, /\/admin\/product-qa/);
  assert.doesNotMatch(`${page}\n${client}\n${route}`, /qa\+[^\s"']+@/i);
  assert.doesNotMatch(`${page}\n${client}\n${route}`, /password\s*[:=]/i);
});
