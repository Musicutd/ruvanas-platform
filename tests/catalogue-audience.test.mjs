import assert from "node:assert/strict";
import test from "node:test";
import { CATALOGUE_PILLARS, effectiveCatalogueLevel, parseCatalogueAudience } from "../lib/catalogue-audience.mjs";
import { catalogueLevelForOrganisation } from "../lib/catalogue-audience-service.js";

test("Super Admin audience requires a minimum tier and licensed pillar", () => {
  assert.equal(parseCatalogueAudience({ minimumCatalogueLevel: "NONE", permittedUses: ["RETAIL_RADIO"], permittedTerritories: "US" }).ok, false);
  assert.equal(parseCatalogueAudience({ minimumCatalogueLevel: "FOCUSED", permittedUses: [], permittedTerritories: "US" }).ok, false);
  assert.equal(parseCatalogueAudience({ minimumCatalogueLevel: "PREMIUM", permittedUses: ["UNKNOWN"], permittedTerritories: "US" }).ok, false);
  assert.equal(parseCatalogueAudience({ minimumCatalogueLevel: "FOCUSED", permittedUses: ["RETAIL_RADIO"], permittedTerritories: [] }).ok, false);
  assert.deepEqual(parseCatalogueAudience({ minimumCatalogueLevel: "PROFESSIONAL", permittedUses: ["RETAIL_RADIO", "SCHOOL_RADIO", "RETAIL_RADIO"], permittedTerritories: ["EUROPE", "US", "CA"] }).data, {
    minimumCatalogueLevel: "PROFESSIONAL", permittedUses: ["RETAIL_RADIO", "SCHOOL_RADIO"], permittedTerritories: "EUROPE,US,CA"
  });
});

test("all seven pillars have a Super Admin choice and older records default to Tier 3", () => {
  assert.equal(CATALOGUE_PILLARS.length, 7);
  assert.equal(effectiveCatalogueLevel("NONE"), "FOCUSED");
  assert.equal(effectiveCatalogueLevel("PREMIUM"), "PREMIUM");
});

test("subscriber catalogue level comes from their plan, not a shop or channel name", async () => {
  const client = { organisation: { findUnique: async ({ where }) => {
    assert.equal(where.id, "subscriber-1");
    return { subscription: { status: "ACTIVE", plan: { active: true, code: "RETAIL_4", productFamily: "RETAIL", tierNumber: 4, licensedMusicCatalogueLevel: "PROFESSIONAL" } } };
  } } };
  assert.equal(await catalogueLevelForOrganisation(client, "subscriber-1"), "PROFESSIONAL");
});
