import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  findPublicPlan,
  PUBLIC_PLAN_CATALOGUE,
  publicPlanDatabaseData,
  publicPlansForProduct,
  RUVANAS_PRODUCTS,
  validatePublicPlanCatalogue
} from "../lib/product-plan-catalogue.mjs";

const expectedPlans = [
  ["RETAIL_START", "Retail Start", "RETAIL", 1, 1490, "NONE"],
  ["RETAIL_BUSINESS", "Retail Business", "RETAIL", 2, 4900, "NONE"],
  ["RETAIL_PROFESSIONAL", "Retail Professional", "RETAIL", 3, 14900, "FOCUSED"],
  ["RETAIL_ADVANCED", "Retail Advanced", "RETAIL", 4, 39900, "PROFESSIONAL"],
  ["RETAIL_ENTERPRISE", "Retail Enterprise", "RETAIL", 5, 99900, "PREMIUM"],
  ["SCHOOL_START", "School Start", "SCHOOL", 1, 1990, "NONE"],
  ["SCHOOL_CREATE", "School Create", "SCHOOL", 2, 4900, "NONE"],
  ["SCHOOL_PRO", "School Pro", "SCHOOL", 3, 9900, "FOCUSED"],
  ["SCHOOL_ACADEMY", "School Academy", "SCHOOL", 4, 24900, "PROFESSIONAL"],
  ["SCHOOL_ENTERPRISE", "Education Enterprise", "SCHOOL", 5, 59900, "PREMIUM"],
  ["ONLINE_HOBBY", "Online Hobby", "ONLINE", 1, 1490, "NONE"],
  ["ONLINE_STARTER", "Online Starter", "ONLINE", 2, 3900, "NONE"],
  ["ONLINE_PROFESSIONAL", "Online Professional", "ONLINE", 3, 8900, "FOCUSED"],
  ["ONLINE_STATION_PRO", "Online Station Pro", "ONLINE", 4, 19900, "PROFESSIONAL"],
  ["ONLINE_NETWORK", "Online Network", "ONLINE", 5, 49900, "PREMIUM"],
  ["HEALTH_START", "Health Start", "HEALTH", 1, 2900, "NONE"],
  ["HEALTH_CONNECT", "Health Connect", "HEALTH", 2, 7900, "NONE"],
  ["HEALTH_PRO", "Health Pro", "HEALTH", 3, 17900, "FOCUSED"],
  ["HEALTH_NETWORK", "Health Network", "HEALTH", 4, 44900, "PROFESSIONAL"],
  ["HEALTH_ENTERPRISE", "Health Enterprise", "HEALTH", 5, 99900, "PREMIUM"],
  ["FAITH_START", "Faith Start", "FAITH", 1, 1990, "NONE"],
  ["FAITH_CONNECT", "Faith Connect", "FAITH", 2, 4900, "NONE"],
  ["FAITH_PRO", "Faith Pro", "FAITH", 3, 9900, "FOCUSED"],
  ["FAITH_MINISTRY", "Faith Ministry", "FAITH", 4, 19900, "PROFESSIONAL"],
  ["FAITH_NETWORK", "Faith Network", "FAITH", 5, 49900, "PREMIUM"]
];

test("the authoritative public catalogue contains the twenty-five approved product tiers", () => {
  assert.equal(validatePublicPlanCatalogue(), true);
  assert.equal(PUBLIC_PLAN_CATALOGUE.length, 25);
  assert.deepEqual(
    PUBLIC_PLAN_CATALOGUE.map((plan) => [
      plan.code,
      plan.name,
      plan.productFamily,
      plan.tierNumber,
      plan.monthlyPriceCents,
      plan.licensedMusicCatalogueLevel
    ]),
    expectedPlans
  );
  assert.equal(new Set(PUBLIC_PLAN_CATALOGUE.map((plan) => plan.code)).size, 25);
  assert.equal(new Set(PUBLIC_PLAN_CATALOGUE.map((plan) => plan.publicSlug)).size, 25);
});

test("every product has five ordered tiers and exactly one product capability", () => {
  for (const product of RUVANAS_PRODUCTS) {
    const plans = publicPlansForProduct(product);
    assert.deepEqual(plans.map((plan) => plan.tierNumber), [1, 2, 3, 4, 5]);

    for (const plan of plans) {
      assert.equal(plan.publiclyAvailable, true);
      assert.equal(plan.active, true);
      assert.equal(plan.includesRuvanasCatalogue, true);
      assert.equal(
        [plan.retailRadioEnabled, plan.schoolRadioEnabled, plan.onlineRadioEnabled, plan.healthRadioEnabled, plan.faithRadioEnabled].filter(Boolean).length,
        1
      );
      assert.equal(plan.enterpriseContactRequired, plan.tierNumber === 5);
    }
  }
});

test("public plans resolve by stable code or slug and map safely to database data", () => {
  const plan = findPublicPlan("online-station-pro");
  assert.equal(plan?.code, "ONLINE_STATION_PRO");
  assert.equal(findPublicPlan("ONLINE_STATION_PRO", "ONLINE"), plan);
  assert.equal(findPublicPlan("ONLINE_STATION_PRO", "RETAIL"), null);

  const data = publicPlanDatabaseData(plan);
  assert.equal(data.code, "ONLINE_STATION_PRO");
  assert.equal(data.onlineRadioEnabled, true);
  assert.equal("description" in data, false);
  assert.equal("enterpriseContactRequired" in data, false);
  assert.throws(() => publicPlanDatabaseData({ ...plan }), /authoritative public catalogue/i);
});

test("catalogue validation rejects cross-product access and malformed tier sets", () => {
  const malformed = PUBLIC_PLAN_CATALOGUE.map((plan) => ({ ...plan }));
  malformed[0].onlineRadioEnabled = true;
  assert.throws(() => validatePublicPlanCatalogue(malformed), /exactly one product family/i);
});

test("the database migration and Super Admin controls expose the authoritative catalogue safely", async () => {
  const [baseMigration, expansionMigration, adminPage, organisationRoute] = await Promise.all([
    readFile(new URL("../prisma/migrations/20261027000000_stage_29r_2_product_capabilities/migration.sql", import.meta.url), "utf8"),
    readFile(new URL("../prisma/migrations/20261112010000_health_faith_expansion/migration.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/admin/plans/page.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/organisations/route.js", import.meta.url), "utf8")
  ]);

  for (const plan of PUBLIC_PLAN_CATALOGUE) {
    assert.match(`${baseMigration}\n${expansionMigration}`, new RegExp(`'${plan.code}'`));
  }
  assert.match(expansionMigration, /ON CONFLICT \("code"\) DO UPDATE/);
  assert.match(baseMigration, /Existing legacy plans remain non-public/);
  assert.match(adminPage, /Licensed Music Catalogue/);
  assert.match(adminPage, /adminUser\?\.role !== "SUPER_ADMIN"/);
  assert.doesNotMatch(adminPage, /supplier/i);
  assert.match(organisationRoute, /planId: z\.string\(\)\.trim\(\)\.min\(1\)\.max\(191\)/);
  assert.match(organisationRoute, /where: \{ id: parsed\.data\.planId, active: true \}/);
  assert.doesNotMatch(organisationRoute, /planId: z\.string\(\)\.cuid\(\)/);
});
