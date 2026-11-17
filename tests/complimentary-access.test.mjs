import test from "node:test";
import assert from "node:assert/strict";

import {
  clearComplimentaryAccess,
  complimentaryCodeSuffix,
  complimentaryPlanProducts,
  complimentaryPlanSnapshot,
  describePlanFeatures,
  generateComplimentaryCode,
  hashComplimentaryCode,
  normaliseComplimentaryCode,
  resolveComplimentaryPlan
} from "../lib/complimentary-access.mjs";
import { resolveEntitlements } from "../lib/entitlements.mjs";
import { PUBLIC_PLAN_CATALOGUE } from "../lib/product-plan-catalogue.mjs";

test("standard Retail complimentary grants follow Focused music while preserving their saved limits", () => {
  const oldLevels = ["NONE", "NONE", "FOCUSED", "PROFESSIONAL", "PREMIUM"];
  for (const current of PUBLIC_PLAN_CATALOGUE.filter(plan => plan.productFamily === "RETAIL")) {
    const old = { ...current, licensedMusicCatalogueLevel: oldLevels[current.tierNumber - 1],
      includesRuvanasCatalogue: false, digitalSignageEnabled: true, stationLimit: 7,
      storageLimitGb: 33, listenerLimit: 71, maxBitrateKbps: 192 };
    const snapshot = complimentaryPlanSnapshot(old);
    assert.equal(snapshot.complimentaryLicensedMusicCatalogueLevel, "FOCUSED");
    const subscription = { status: "SUSPENDED", complimentaryAccessActive: true,
      ...snapshot, complimentaryLicensedMusicCatalogueLevel: old.licensedMusicCatalogueLevel,
      complimentaryIncludesCatalogue: false, complimentaryDigitalSignageEnabled: true };
    const before = structuredClone(subscription);
    const effective = resolveComplimentaryPlan(subscription);
    assert.equal(effective.licensedMusicCatalogueLevel, "FOCUSED", current.code);
    assert.equal(effective.includesRuvanasCatalogue, true);
    for (const field of ["stationLimit", "storageLimitGb", "listenerLimit", "maxBitrateKbps"]) {
      assert.equal(effective[field], old[field]);
    }
    const access = resolveEntitlements(subscription);
    assert.equal(access.licensedMusicCatalogueLevel, "FOCUSED");
    assert.equal(access.digitalSignageEnabled, false);
    assert.ok(describePlanFeatures(effective).includes("focused Licensed Music Catalogue"));
    assert.ok(!describePlanFeatures(effective).includes("Digital Signage"));
    assert.deepEqual(subscription, before, "projection does not rewrite the saved grant");
    assert.equal(resolveComplimentaryPlan({ ...subscription, complimentaryAccessActive: false }), null);
  }
});

test("Retail complimentary alignment leaves other products, custom codes and inconsistent identities alone", () => {
  const retail = PUBLIC_PLAN_CATALOGUE.find(plan => plan.code === "RETAIL_ENTERPRISE");
  const cases = [
    { ...retail, code: "CUSTOM_RETAIL_ENTERPRISE" },
    { ...retail, code: retail.publicSlug },
    { ...retail, productFamily: "ONLINE" },
    { ...retail, tierNumber: 3 },
    PUBLIC_PLAN_CATALOGUE.find(plan => plan.code === "ONLINE_NETWORK")
  ];
  for (const base of cases) {
    const original = { ...base, licensedMusicCatalogueLevel: "PREMIUM", includesRuvanasCatalogue: false };
    const snapshot = complimentaryPlanSnapshot(original);
    const effective = resolveComplimentaryPlan({ complimentaryAccessActive: true, ...snapshot });
    assert.equal(effective.licensedMusicCatalogueLevel, "PREMIUM");
    assert.equal(effective.includesRuvanasCatalogue, false);
  }
});

const tier = {
  active: true,
  name: "Premium",
  code: "PREMIUM",
  stationLimit: 5,
  storageLimitGb: 25,
  listenerLimit: 500,
  maxBitrateKbps: 320,
  includesRuvanasCatalogue: true,
  licensedMusicCatalogueLevel: "PREMIUM",
  promoUploadEnabled: true,
  retailRadioEnabled: true,
  schoolRadioEnabled: true,
  onlineRadioEnabled: true,
  schoolPublicPublishingEnabled: false,
  retailMediaEnabled: true,
  digitalSignageEnabled: true
};

test("complimentary codes are high-entropy, normalised, and hashed without storing plaintext", () => {
  const code = generateComplimentaryCode();
  assert.match(code, /^RUV-[A-F0-9]{8}-[A-F0-9]{8}-[A-F0-9]{8}$/);
  assert.equal(normaliseComplimentaryCode(code.toLowerCase()), code.replaceAll("-", ""));
  assert.equal(hashComplimentaryCode(code), hashComplimentaryCode(code.toLowerCase().replaceAll("-", " ")));
  assert.equal(complimentaryCodeSuffix(code), code.slice(-4));
  assert.notEqual(hashComplimentaryCode(code), code);
});

test("an active complimentary tier overrides billing without becoming a trial", () => {
  const subscription = {
    status: "SUSPENDED",
    plan: { ...tier, name: "Normal plan", code: "NORMAL", stationLimit: 1 },
    schoolRadioEnabled: false,
    retailMediaEnabled: false,
    digitalSignageEnabled: false,
    complimentaryAccessActive: true,
    complimentaryAccessActivatedAt: new Date("2026-09-02T18:00:00.000Z"),
    ...complimentaryPlanSnapshot(tier)
  };
  const entitlements = resolveEntitlements(subscription);
  assert.equal(entitlements.serviceEnabled, true);
  assert.equal(entitlements.accessReason, "COMPLIMENTARY_ACCESS");
  assert.equal(entitlements.complimentaryAccess, true);
  assert.equal(entitlements.planName, "Premium");
  assert.equal(entitlements.stationLimit, 5);
  assert.equal(entitlements.streamLimit, 5);
  assert.equal(entitlements.listenerLimit, 500);
  assert.equal(entitlements.retailRadioEnabled, true);
  assert.equal(entitlements.schoolRadioEnabled, true);
  assert.equal(entitlements.onlineRadioEnabled, true);
  assert.equal(entitlements.licensedMusicCatalogueLevel, "PREMIUM");
  assert.equal(entitlements.retailMediaEnabled, true);
  assert.equal(entitlements.digitalSignageEnabled, true);
});

test("stopping complimentary access clears every override and restores normal billing rules", () => {
  const active = {
    status: "SUSPENDED",
    plan: tier,
    complimentaryAccessActive: true,
    ...complimentaryPlanSnapshot(tier)
  };
  assert.equal(resolveComplimentaryPlan(active)?.name, "Premium");
  const stopped = { ...active, ...clearComplimentaryAccess() };
  assert.equal(resolveComplimentaryPlan(stopped), null);
  assert.equal(resolveEntitlements(stopped).serviceEnabled, false);
  assert.equal(resolveEntitlements(stopped).stationLimit, 0);
});

test("inactive tiers cannot be snapshotted for complimentary access", () => {
  assert.throws(() => complimentaryPlanSnapshot({ ...tier, active: false }), /active tier/i);
});

test("complimentary tiers identify the product dashboards they unlock", () => {
  assert.deepEqual(complimentaryPlanProducts(tier), ["Retail Radio", "School Radio", "Online Radio"]);
  assert.deepEqual(
    complimentaryPlanProducts({ ...tier, retailRadioEnabled: false, schoolRadioEnabled: false }),
    ["Online Radio"]
  );
});

test("complimentary snapshots preserve product and catalogue authority", () => {
  const snapshot = complimentaryPlanSnapshot(tier);
  assert.equal(snapshot.complimentaryRetailRadioEnabled, true);
  assert.equal(snapshot.complimentarySchoolRadioEnabled, true);
  assert.equal(snapshot.complimentaryOnlineRadioEnabled, true);
  assert.equal(snapshot.complimentaryLicensedMusicCatalogueLevel, "PREMIUM");

  const cleared = clearComplimentaryAccess();
  assert.equal(cleared.complimentaryRetailRadioEnabled, null);
  assert.equal(cleared.complimentarySchoolRadioEnabled, null);
  assert.equal(cleared.complimentaryOnlineRadioEnabled, null);
  assert.equal(cleared.complimentaryLicensedMusicCatalogueLevel, null);
});


test("Online Network complimentary access unlocks Studio Pro without changing billing", () => {
  const network = { ...tier, code: "ONLINE_NETWORK", name: "Online Network", productFamily: "ONLINE", tierNumber: 5 };
  const subscription = {
    status: "SUSPENDED",
    plan: { ...network, code: "ONLINE_START", tierNumber: 1 },
    complimentaryAccessActive: true,
    ...complimentaryPlanSnapshot(network)
  };
  const access = resolveEntitlements(subscription);
  assert.equal(access.accessReason, "COMPLIMENTARY_ACCESS");
  assert.equal(access.planTierNumber, 5);
  assert.equal(access.planProductFamily, "ONLINE");
  assert.equal(access.studioProEnabled, true);
  assert.equal(access.studioExternalDestinationLimit, 10);

  const legacy = { ...subscription, complimentaryPlanTierNumber: null, complimentaryPlanProductFamily: null };
  assert.equal(resolveEntitlements(legacy).studioProEnabled, true);

  const unknown = { ...legacy, complimentaryPlanCode: "CUSTOM_UNKNOWN", plan: { ...network, code: "OTHER" } };
  assert.equal(resolveEntitlements(unknown).studioProEnabled, false);
});
