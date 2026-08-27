import assert from "node:assert/strict";
import test from "node:test";
import {
  catalogueStorageKey,
  isCatalogueLicenceCurrent,
  parseCatalogueMetadata
} from "../lib/catalogue-upload.mjs";

const validMetadata = {
  title: "Rights-cleared track",
  artist: "Ruvanas Artist",
  album: "Catalogue Vol. 1",
  releaseYear: "2026",
  durationSeconds: "180",
  isExplicit: "false",
  rightsHolder: "Ruvanas Ltd",
  rightsReference: "LIC-2026-001",
  permittedTerritories: "Worldwide",
  licenceExpiresAt: "",
  rightsConfirmed: "true",
  publishNow: "false",
  genreIds: []
};

test("catalogue metadata requires an explicit rights confirmation", () => {
  const parsed = parseCatalogueMetadata({
    ...validMetadata,
    rightsConfirmed: "false"
  });

  assert.equal(parsed.ok, false);
  assert.match(parsed.error, /authorised/i);
});

test("catalogue metadata defaults a reviewed upload to draft", () => {
  const parsed = parseCatalogueMetadata(validMetadata);

  assert.equal(parsed.ok, true);
  assert.equal(parsed.data.status, "DRAFT");
  assert.equal(parsed.data.releaseYear, 2026);
  assert.equal(parsed.data.durationSeconds, 180);
  assert.equal(parsed.data.licenceExpiresAt, null);
});

test("catalogue metadata only becomes ready through the explicit option", () => {
  const parsed = parseCatalogueMetadata({
    ...validMetadata,
    publishNow: "true",
    licenceExpiresAt: "2027-12-31"
  });

  assert.equal(parsed.ok, true);
  assert.equal(parsed.data.status, "READY");
  assert.equal(parsed.data.licenceExpiresAt.toISOString(), "2027-12-31T00:00:00.000Z");
});

test("catalogue storage keys are checksum-addressed", () => {
  const checksum = "a".repeat(64);
  assert.equal(
    catalogueStorageKey(checksum, "mp3"),
    `catalogue/music/${checksum}.mp3`
  );
  assert.throws(() => catalogueStorageKey("../unsafe", "mp3"));
});

test("catalogue licences remain valid through their expiry date", () => {
  assert.equal(
    isCatalogueLicenceCurrent("2027-12-31", "2027-12-31T23:59:59.000Z"),
    true
  );
  assert.equal(
    isCatalogueLicenceCurrent("2027-12-31", "2028-01-01T00:00:00.000Z"),
    false
  );
  assert.equal(isCatalogueLicenceCurrent(null, "2030-01-01T00:00:00.000Z"), true);
});

