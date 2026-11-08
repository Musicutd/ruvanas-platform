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
  ["RETAIL_START", "Retail Start", "RETAIL", 1, 1900, "FOCUSED"],
  ["RETAIL_BUSINESS", "Retail Business", "RETAIL", 2, 4900, "FOCUSED"],
  ["RETAIL_PROFESSIONAL", "Retail Professional", "RETAIL", 3, 14900, "FOCUSED"],
  ["RETAIL_ADVANCED", "Retail Advanced", "RETAIL", 4, 39900, "FOCUSED"],
  ["RETAIL_ENTERPRISE", "Retail Enterprise", "RETAIL", 5, 99900, "FOCUSED"],
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
  ["FAITH_NETWORK", "Faith Network", "FAITH", 5, 49900, "PREMIUM"],
  ["ORGANISATIONS_START", "Organisations Start", "ORGANISATIONS", 1, 2490, "NONE"],
  ["ORGANISATIONS_CONNECT", "Organisations Connect", "ORGANISATIONS", 2, 5900, "NONE"],
  ["ORGANISATIONS_PRO", "Organisations Pro", "ORGANISATIONS", 3, 12900, "FOCUSED"],
  ["ORGANISATIONS_NETWORK", "Organisations Network", "ORGANISATIONS", 4, 29900, "PROFESSIONAL"],
  ["ORGANISATIONS_ENTERPRISE", "Organisations Enterprise", "ORGANISATIONS", 5, 69900, "PREMIUM"],
  ["CORRECTIONS_ESSENTIAL", "Inside Essential", "CORRECTIONS", 1, 14900, "NONE"],
  ["CORRECTIONS_FACILITY", "Inside Facility", "CORRECTIONS", 2, 29900, "NONE"],
  ["CORRECTIONS_REHABILITATION_PRO", "Inside Rehabilitation Pro", "CORRECTIONS", 3, 59900, "FOCUSED"],
  ["CORRECTIONS_NETWORK", "Inside Network", "CORRECTIONS", 4, 119900, "PROFESSIONAL"],
  ["CORRECTIONS_JUSTICE_ENTERPRISE", "Justice Enterprise", "CORRECTIONS", 5, 249900, "PREMIUM"]
];

test("the authoritative public catalogue contains thirty-five approved product tiers", () => {
  assert.equal(validatePublicPlanCatalogue(), true);
  assert.equal(PUBLIC_PLAN_CATALOGUE.length, 35);
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
  assert.equal(new Set(PUBLIC_PLAN_CATALOGUE.map((plan) => plan.code)).size, 35);
  assert.equal(new Set(PUBLIC_PLAN_CATALOGUE.map((plan) => plan.publicSlug)).size, 35);
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
        [plan.retailRadioEnabled, plan.schoolRadioEnabled, plan.onlineRadioEnabled, plan.healthRadioEnabled, plan.faithRadioEnabled, plan.organisationsEnabled, plan.correctionsRadioEnabled].filter(Boolean).length,
        1
      );
      assert.equal(plan.enterpriseContactRequired, plan.tierNumber === 5);
    }
  }
});

test("Retail packs retain commercial limits while including Focused music without displays on every tier", () => {
  const retail = publicPlansForProduct("RETAIL");
  assert.deepEqual(retail.map((plan) => plan.monthlyPriceCents), [1900, 4900, 14900, 39900, 99900]);
  assert.deepEqual(retail.map((plan) => plan.stationLimit), [1, 3, 10, 30, 100]);
  assert.deepEqual(retail.map((plan) => plan.storageLimitGb), [5, 15, 100, 200, 2000]);
  assert.deepEqual(retail.map((plan) => plan.maxBitrateKbps), [128, 256, 320, 320, 320]);
  assert.deepEqual(retail.map((plan) => plan.digitalSignageEnabled), [false, false, false, false, false]);
  assert.deepEqual(retail.map((plan) => plan.licensedMusicCatalogueLevel), ["FOCUSED", "FOCUSED", "FOCUSED", "FOCUSED", "FOCUSED"]);
  assert.deepEqual(retail.map((plan) => plan.listenerLimit), [100, 500, 2000, 10000, 50000]);
  assert.deepEqual(retail.map((plan) => plan.retailMediaEnabled), [false, false, true, true, true]);
  for (const plan of retail) {
    const stored = publicPlanDatabaseData(plan);
    assert.equal(stored.licensedMusicCatalogueLevel, "FOCUSED");
    assert.equal(stored.digitalSignageEnabled, false);
    assert.doesNotMatch(plan.description, /signage|display|professional Licensed|premium catalogue/i);
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

test("Retail validation rejects catalogue or display drift without changing other product progression", () => {
  const wrongCatalogue = PUBLIC_PLAN_CATALOGUE.map((plan) => ({ ...plan }));
  wrongCatalogue[0].licensedMusicCatalogueLevel = "NONE";
  assert.throws(() => validatePublicPlanCatalogue(wrongCatalogue), /Invalid Licensed Music Catalogue level/);
  const displays = PUBLIC_PLAN_CATALOGUE.map((plan) => ({ ...plan }));
  displays[4].digitalSignageEnabled = true;
  assert.throws(() => validatePublicPlanCatalogue(displays), /Digital displays are not included/);
  for (const product of RUVANAS_PRODUCTS.filter(product => product !== "RETAIL")) {
    assert.deepEqual(publicPlansForProduct(product).map(plan => plan.licensedMusicCatalogueLevel),
      ["NONE", "NONE", "FOCUSED", "PROFESSIONAL", "PREMIUM"]);
  }
});

test("Retail plan migration only updates catalogue and display flags for its five standard plans", async () => {
  const migration = await readFile(new URL("../prisma/migrations/20261209000000_retail_focused_catalogue_audio_only/migration.sql", import.meta.url), "utf8");
  const sql = migration.replace(/--[^\n]*/g, "");
  assert.match(sql, /UPDATE "Plan"/);
  assert.match(sql, /WHERE "productFamily" = 'RETAIL'/);
  assert.deepEqual([...sql.matchAll(/'(RETAIL_[A-Z]+)'/g)].map(match => match[1]), publicPlansForProduct("RETAIL").map(plan => plan.code));
  const assignments = sql.split(/\bSET\b/)[1].split(/\bWHERE\b/)[0];
  assert.deepEqual([...assignments.matchAll(/"(\w+)"\s*=/g)].map(match => match[1]),
    ["licensedMusicCatalogueLevel", "digitalSignageEnabled", "updatedAt"]);
  assert.match(assignments, /"licensedMusicCatalogueLevel" = 'FOCUSED'/);
  assert.match(assignments, /"digitalSignageEnabled" = false/);
  assert.doesNotMatch(sql, /\b(DELETE|INSERT|DROP|ALTER)\b|"Subscription"|"Station"|"Track"/);
});

test("the database migrations and Super Admin controls expose the authoritative catalogue safely", async () => {
  const [baseMigration, healthFaithMigration, organisationsMigration, correctionsMigration, retailPackMigration, adminPage, organisationRoute] = await Promise.all([
    readFile(new URL("../prisma/migrations/20261027000000_stage_29r_2_product_capabilities/migration.sql", import.meta.url), "utf8"),
    readFile(new URL("../prisma/migrations/20261112010000_health_faith_expansion/migration.sql", import.meta.url), "utf8"),
    readFile(new URL("../prisma/migrations/20261113010000_organisations_expansion/migration.sql", import.meta.url), "utf8"),
    readFile(new URL("../prisma/migrations/20261126010000_corrections_public_plans/migration.sql", import.meta.url), "utf8"),
    readFile(new URL("../prisma/migrations/20261116000000_retail_plan_pack_update/migration.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/admin/plans/page.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/organisations/route.js", import.meta.url), "utf8")
  ]);

  for (const plan of PUBLIC_PLAN_CATALOGUE) {
    assert.match(`${baseMigration}\n${healthFaithMigration}\n${organisationsMigration}\n${correctionsMigration}`, new RegExp(`'${plan.code}'`));
  }
  assert.match(organisationsMigration, /ON CONFLICT \("code"\) DO UPDATE/);
  assert.match(retailPackMigration, /WHEN 'RETAIL_START' THEN 1900/);
  assert.match(retailPackMigration, /WHEN 'RETAIL_BUSINESS' THEN 15/);
  assert.match(retailPackMigration, /"digitalSignageEnabled" = true/);
  assert.match(baseMigration, /Existing legacy plans remain non-public/);
  assert.match(adminPage, /Licensed Music Catalogue/);
  assert.match(adminPage, /adminUser\?\.role !== "SUPER_ADMIN"/);
  assert.doesNotMatch(adminPage, /supplier/i);
  assert.match(organisationRoute, /planId: z\.string\(\)\.trim\(\)\.min\(1\)\.max\(191\)/);
  assert.match(organisationRoute, /where: \{ id: parsed\.data\.planId, active: true \}/);
  assert.doesNotMatch(organisationRoute, /planId: z\.string\(\)\.cuid\(\)/);
});
