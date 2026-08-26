import assert from "node:assert/strict";
import test from "node:test";
import {
  findLocationsOutsideOrganisation,
  makeLocationGroupSlug,
  normalizeLocationIds
} from "../lib/location-groups.mjs";

test("location group slugs are stable and URL safe", () => {
  assert.equal(makeLocationGroupSlug(" Malta & Gozo Stores "), "malta-gozo-stores");
  assert.equal(makeLocationGroupSlug("---"), "");
});

test("location IDs are trimmed and deduplicated", () => {
  assert.deepEqual(normalizeLocationIds([" loc-1 ", "loc-1", "", null, "loc-2"]), ["loc-1", "loc-2"]);
  assert.deepEqual(normalizeLocationIds("loc-1"), []);
});

test("cross-organisation location IDs are rejected", () => {
  assert.deepEqual(
    findLocationsOutsideOrganisation(["loc-1", "loc-2"], [{ id: "loc-1" }]),
    ["loc-2"]
  );
});

