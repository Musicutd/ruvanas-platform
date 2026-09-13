import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PUBLIC_PLAN_CATALOGUE } from "../lib/product-plan-catalogue.mjs";
import { registrationProductsFromDatabasePlans } from "../lib/registration-experience.mjs";

function databasePlans() {
  return PUBLIC_PLAN_CATALOGUE.map((plan, index) => ({
    ...plan,
    id: `plan-${index}`,
    active: true,
    publiclyAvailable: true,
    promoUploadEnabled: true,
    schoolPublicPublishingEnabled: Boolean(plan.schoolPublicPublishingEnabled),
    retailMediaEnabled: Boolean(plan.retailMediaEnabled),
    studioExternalDestinationLimit: null
  }));
}

test("database tier edits flow into customer-facing plan presentation", () => {
  const plans = databasePlans();
  plans[0] = {
    ...plans[0],
    name: "Retail Launch",
    monthlyPriceCents: 2550,
    stationLimit: 2,
    storageLimitGb: 8,
    listenerLimit: 350,
    maxBitrateKbps: 256,
    licensedMusicCatalogueLevel: "FOCUSED",
    digitalSignageEnabled: true
  };
  const retail = registrationProductsFromDatabasePlans(plans).find((product) => product.id === "RETAIL");
  assert.equal(retail.plans[0].name, "Retail Launch");
  assert.equal(retail.plans[0].priceLabel, "€25.50 / month");
  assert.equal(retail.plans[0].stationLimit, 2);
  assert.equal(retail.plans[0].storageLimitGb, 8);
  assert.equal(retail.plans[0].digitalSignageDisplayLimit, 2);
  assert.match(retail.plans[0].catalogueDescription, /Focused Licensed Music Catalogue/);
});

test("inactive database tiers are removed from public pricing and future registration", () => {
  const plans = databasePlans();
  plans[1] = { ...plans[1], active: false };
  const retail = registrationProductsFromDatabasePlans(plans).find((product) => product.id === "RETAIL");
  assert.equal(retail.plans.some((plan) => plan.code === plans[1].code), false);
  assert.equal(retail.plans.length, 4);
});

test("Super Admin plan editing locks stable authority and audits commercial changes", async () => {
  const [route, editor, page, home, register] = await Promise.all([
    readFile(new URL("../app/api/admin/plans/[planId]/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/admin/plans/PlanCatalogueEditor.js", import.meta.url), "utf8"),
    readFile(new URL("../app/admin/plans/page.js", import.meta.url), "utf8"),
    readFile(new URL("../app/page.js", import.meta.url), "utf8"),
    readFile(new URL("../app/register/page.js", import.meta.url), "utf8")
  ]);
  assert.match(route, /access\.user\.role !== "SUPER_ADMIN"/);
  assert.match(route, /expectedUpdatedAt/);
  assert.match(route, /PLAN_TIER_UPDATED/);
  assert.match(route, /Stable plan code and productFamily authority are intentionally not editable/);
  assert.match(editor, /Plan code and product family stay fixed/);
  assert.match(editor, /Licensed Music Catalogue and tools/);
  assert.match(editor, /Save tier changes/);
  assert.match(editor, /className=\{styles\.actionCell\}/);
  assert.match(editor, /scrollIntoView\(\{ behavior: "smooth", block: "start" \}\)/);
  assert.match(page, /PlanCatalogueEditor/);
  assert.match(home, /registrationProductsFromDatabasePlans/);
  assert.match(register, /registrationProductsFromDatabasePlans/);
});
