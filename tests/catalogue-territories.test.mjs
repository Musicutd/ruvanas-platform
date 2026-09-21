import test from "node:test";
import assert from "node:assert/strict";
import {
  catalogueTerritoriesFromForm,
  catalogueTerritoryAllows,
  limitCatalogueTerritories,
  parseCatalogueTerritories
} from "../lib/catalogue-territories.mjs";

test("Super Admin territory form accepts the three regional choices", () => {
  const form = new FormData();
  form.append("territoryRegions", "EUROPE");
  form.append("territoryRegions", "US");
  form.append("territoryRegions", "CA");
  assert.deepEqual(catalogueTerritoriesFromForm(form), { ok: true, codes: ["EUROPE", "US", "CA"] });
  assert.deepEqual(parseCatalogueTerritories("Europe, United States of America, Canada"), { ok: true, codes: ["EUROPE", "US", "CA"] });
  assert.equal(parseCatalogueTerritories("EUROPE, WORLDWIDE").ok, false);
  assert.equal(parseCatalogueTerritories("unknown continent").ok, false);
});

test("Europe is explicitly EU/EEA, UK and Switzerland; unknown customer country fails closed", () => {
  assert.equal(catalogueTerritoryAllows("EUROPE", "MT"), true);
  assert.equal(catalogueTerritoryAllows("EUROPE", "GB"), true);
  assert.equal(catalogueTerritoryAllows("EUROPE", "CH"), true);
  assert.equal(catalogueTerritoryAllows("EUROPE", "US"), false);
  assert.equal(catalogueTerritoryAllows("US, CA", "US"), true);
  assert.equal(catalogueTerritoryAllows("US, CA", "CA"), true);
  assert.equal(catalogueTerritoryAllows("US, CA", null), false);
});

test("API provider claims cannot expand Super Admin approved scope", () => {
  assert.deepEqual(limitCatalogueTerritories(["WORLDWIDE"], ["EUROPE", "US", "CA"]), ["EUROPE", "US", "CA"]);
  assert.deepEqual(limitCatalogueTerritories(["US", "CA"], ["EUROPE", "US"]), ["US"]);
  assert.deepEqual(limitCatalogueTerritories(["US"], []), []);
  assert.deepEqual(limitCatalogueTerritories(["US"], ["EUROPE"]), []);
});
