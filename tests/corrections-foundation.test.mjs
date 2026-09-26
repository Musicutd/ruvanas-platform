import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { CATALOGUE_PILLARS } from "../lib/catalogue-audience.mjs";
import { complimentaryPlanSnapshot, resolveComplimentaryPlan } from "../lib/complimentary-access.mjs";
import { resolveEntitlements } from "../lib/entitlements.mjs";
import { MUSIC_RIGHTS_USES } from "../lib/media-library-pro.mjs";
import { DISTRIBUTOR_RIGHTS_USES } from "../lib/music-distributor.mjs";
import { subscriberProductAccess, enabledSubscriberProducts } from "../lib/product-access.mjs";
import { buildCorrectionsProductOnboarding } from "../lib/product-onboarding.mjs";
import { claimPublicListenerLease } from "../lib/public-player.mjs";
import { PUBLIC_PLAN_CATALOGUE, RUVANAS_PRODUCTS, publicPlansForProduct, validatePublicPlanCatalogue } from "../lib/product-plan-catalogue.mjs";
import { parseRegistrationRequest, registrationLandingRoute } from "../lib/product-registration.mjs";
import { registrationProducts } from "../lib/registration-experience.mjs";
import { buildSubscriberNavigation, buildSubscriberProductCards } from "../lib/user-experience-navigation.mjs";

const corrections = publicPlansForProduct("CORRECTIONS");

test("C1 adds the seventh family and the five exact Corrections prices and catalogue tiers", () => {
  assert.equal(RUVANAS_PRODUCTS.length, 7);
  assert.equal(RUVANAS_PRODUCTS.at(-1), "CORRECTIONS");
  assert.equal(PUBLIC_PLAN_CATALOGUE.length, 35);
  assert.equal(validatePublicPlanCatalogue(), true);
  assert.deepEqual(corrections.map((plan) => [plan.code, plan.monthlyPriceCents, plan.licensedMusicCatalogueLevel]), [
    ["CORRECTIONS_ESSENTIAL", 14900, "NONE"],
    ["CORRECTIONS_FACILITY", 29900, "NONE"],
    ["CORRECTIONS_REHABILITATION_PRO", 59900, "FOCUSED"],
    ["CORRECTIONS_NETWORK", 119900, "PROFESSIONAL"],
    ["CORRECTIONS_JUSTICE_ENTERPRISE", 249900, "PREMIUM"]
  ]);
  assert.deepEqual(corrections.map((plan) => plan.correctionsRadioEnabled), [true, true, true, true, true]);
  assert.deepEqual(corrections.map((plan) => plan.enterpriseContactRequired), [false, false, false, false, true]);
  assert.ok(PUBLIC_PLAN_CATALOGUE.filter((plan) => plan.productFamily !== "CORRECTIONS").every((plan) => plan.correctionsRadioEnabled === false));
});

test("Corrections access is server-entitled and fails closed for legacy, inactive and overridden accounts", () => {
  const plan = corrections[2];
  const active = resolveEntitlements({ status: "ACTIVE", plan });
  assert.equal(active.correctionsRadioEnabled, true);
  assert.equal(active.studioLevel, "PRO");
  assert.equal(active.licensedMusicCatalogueLevel, "FOCUSED");
  assert.deepEqual(enabledSubscriberProducts(active).map((product) => product.key), ["CORRECTIONS"]);
  assert.equal(subscriberProductAccess(active, "CORRECTIONS").allowed, true);
  assert.equal(resolveEntitlements({ status: "ACTIVE", correctionsRadioEnabled: false, plan }).correctionsRadioEnabled, false);
  assert.equal(resolveEntitlements({ status: "SUSPENDED", plan }).correctionsRadioEnabled, false);
  assert.equal(resolveEntitlements({ status: "ACTIVE", plan: publicPlansForProduct("ONLINE")[0] }).correctionsRadioEnabled, false);
  assert.equal(subscriberProductAccess({ serviceEnabled: true }, "CORRECTIONS").allowed, false);
  assert.equal(subscriberProductAccess({ serviceEnabled: false, correctionsRadioEnabled: true }, "CORRECTIONS").allowed, false);
  assert.deepEqual(corrections.map((item) => resolveEntitlements({ status: "ACTIVE", plan: item }).studioLevel), ["BASIC", "BASIC", "PRO", "PRO", "PRO"]);
});

test("complimentary grants preserve only the explicitly granted Corrections capability", () => {
  const snapshot = complimentaryPlanSnapshot(corrections[0]);
  assert.equal(snapshot.complimentaryCorrectionsRadioEnabled, true);
  const resolved = resolveComplimentaryPlan({
    complimentaryAccessActive: true,
    ...snapshot
  });
  assert.equal(resolved.correctionsRadioEnabled, true);
  assert.equal(resolveComplimentaryPlan({ complimentaryAccessActive: true, ...complimentaryPlanSnapshot(publicPlansForProduct("RETAIL")[0]) }).correctionsRadioEnabled, false);
});

test("registration, product card, navigation and onboarding expose no playable Corrections workflow", () => {
  const request = parseRegistrationRequest({ name: "Test", organisationName: "Facility", email: "test@example.invalid", password: "long-password", product: "corrections", tier: "corrections-essential", source: "DIRECT" });
  assert.equal(request.success, true);
  assert.equal(registrationLandingRoute("CORRECTIONS"), "/dashboard/corrections");
  assert.equal(registrationProducts().find((item) => item.id === "CORRECTIONS").plans.length, 5);
  const entitlements = { serviceEnabled: true, correctionsRadioEnabled: true };
  assert.deepEqual(buildSubscriberProductCards({ entitlements }).map((item) => item.href), ["/dashboard/corrections"]);
  const items = buildSubscriberNavigation({ entitlements }).flatMap((section) => section.items);
  assert.ok(items.some((item) => item.id === "correctionsHome"));
  for (const id of ["station", "publicPlayer", "programming", "simplePlaylists", "studio", "media", "sessions", "players"]) {
    assert.ok(!items.some((item) => item.id === id), `${id} must not be offered before Corrections policy exists`);
  }
  const onboarding = buildCorrectionsProductOnboarding({ serviceEnabled: true });
  assert.equal(onboarding.complete, false);
  assert.equal(onboarding.nextStepId, "FACILITY_POLICY");
});

test("Corrections has a separate rights identifier but no public listener or catalogue playback route", async () => {
  assert.ok(MUSIC_RIGHTS_USES.includes("CORRECTIONS_RADIO"));
  assert.ok(DISTRIBUTOR_RIGHTS_USES.includes("CORRECTIONS_RADIO"));
  assert.ok(CATALOGUE_PILLARS.some((pillar) => pillar.use === "CORRECTIONS_RADIO"));
  const [schema, enumMigration, plansMigration, page, audio, catalogue, publicService, publicStationApi, activation] = await Promise.all([
    readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8"),
    readFile(new URL("../prisma/migrations/20261126000000_corrections_product_foundation/migration.sql", import.meta.url), "utf8"),
    readFile(new URL("../prisma/migrations/20261126010000_corrections_public_plans/migration.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/corrections/page.js", import.meta.url), "utf8"),
    readFile(new URL("../lib/pillar-audio.mjs", import.meta.url), "utf8"),
    readFile(new URL("../app/api/catalogue/music/route.js", import.meta.url), "utf8"),
    readFile(new URL("../lib/public-player-service.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/public/stations/[slug]/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/stations/[stationId]/activate/route.js", import.meta.url), "utf8")
  ]);
  assert.match(schema, /CORRECTIONS_RADIO/);
  assert.match(schema, /correctionsRadioEnabled\s+Boolean\s+@default\(false\)/);
  assert.match(enumMigration, /ADD VALUE IF NOT EXISTS 'CORRECTIONS'/);
  assert.match(plansMigration, /'CORRECTIONS_JUSTICE_ENTERPRISE'/);
  assert.match(page, /requireSubscriberProduct\("CORRECTIONS"\)/);
  assert.doesNotMatch(page, /listenAction=/);
  assert.doesNotMatch(audio, /CORRECTIONS:/);
  assert.doesNotMatch(catalogue, /CORRECTIONS_RADIO/);
  assert.match(publicService, /productFamily: \{ not: "CORRECTIONS" \}/);
  assert.match(publicStationApi, /productFamily: \{ not: "CORRECTIONS" \}/);
  assert.match(activation, /station\.productFamily === "CORRECTIONS"/);
  const denied = await claimPublicListenerLease({}, { station: { productFamily: "CORRECTIONS" }, sessionId: "test" });
  assert.equal(denied.ok, false);
  assert.equal(denied.status, 403);
});
