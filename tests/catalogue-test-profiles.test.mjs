import test from "node:test";
import assert from "node:assert/strict";
import { CATALOGUE_TEST_PROFILES, getCatalogueTestProfile, catalogueTestProfileForAuthorization,
  catalogueTestProfileForSession, catalogueTestPreparationDeadline } from "../lib/catalogue-test-profiles.mjs";

test("diagnostic limits are fixed and the legacy default stays five minutes", () => {
  const five = getCatalogueTestProfile(), hour = getCatalogueTestProfile("ONE_HOUR");
  assert.equal(five, CATALOGUE_TEST_PROFILES.FIVE_MINUTES);
  assert.deepEqual([five.maximumSeconds, five.maximumAuthorizationSeconds, five.maximumItems, five.maximumUniqueFileBytes,
    five.maximumAudioBytes, five.maximumResources], [300, 600, 8, 100 * 1024 ** 2, 16 * 1024 ** 2, 16]);
  assert.deepEqual([hour.maximumSeconds, hour.maximumAuthorizationSeconds, hour.maximumPreparationSeconds, hour.maximumItems,
    hour.maximumUniqueFileBytes, hour.maximumAudioBytes, hour.maximumResources], [3600, 4200, 600, 40, 256 * 1024 ** 2, 64 * 1024 ** 2, 42]);
  assert.equal(hour.maximumFileBytes, five.maximumFileBytes);
  for (const object of [five, hour, CATALOGUE_TEST_PROFILES]) assert.equal(Object.isFrozen(object), true);
  for (const value of [null, "", "ONE_HOUR ", "one_hour", 3600, {}, "__proto__"]) assert.equal(getCatalogueTestProfile(value), null);
});

test("only a matching server authorization profile can increase session limits", () => {
  const five = getCatalogueTestProfile(), hour = getCatalogueTestProfile("ONE_HOUR");
  assert.equal(catalogueTestProfileForAuthorization({}), five);
  assert.equal(catalogueTestProfileForAuthorization({ maximumSeconds: 300 }), five);
  assert.equal(catalogueTestProfileForAuthorization({ profileId: "FIVE_MINUTES", maximumSeconds: 300 }), five);
  assert.equal(catalogueTestProfileForAuthorization({ profileId: "ONE_HOUR", maximumSeconds: 3600 }), hour);
  for (const authorization of [null, [], { profileId: null }, { maximumSeconds: 3600 }, { profileId: "ONE_HOUR" },
    { profileId: "ONE_HOUR", maximumSeconds: "3600" }, { profileId: "FIVE_MINUTES", maximumSeconds: 3600 }]) {
    assert.equal(catalogueTestProfileForAuthorization(authorization), null);
  }
  assert.equal(catalogueTestProfileForSession({ testProfile: hour }), five);
  assert.equal(catalogueTestProfileForSession({ profileId: "ONE_HOUR" }), null);
  assert.equal(catalogueTestProfileForSession({ authorization: null }), null);
  assert.equal(catalogueTestProfileForSession({ authorization: { profileId: "ONE_HOUR", maximumSeconds: 3600 }, profileId: "FIVE_MINUTES" }), null);
  assert.equal(catalogueTestProfileForSession({ authorization: { profileId: "ONE_HOUR", maximumSeconds: 3600 }, profileId: "ONE_HOUR", testProfile: five }), hour);
});

test("preparation never consumes the whole hour grant and clips to the remaining full audio window", () => {
  const issuedAt = "2026-10-22T12:00:00.000Z";
  const authorization = { profileId: "ONE_HOUR", maximumSeconds: 3600, issuedAt, expiresAt: "2026-10-22T13:10:00.000Z" };
  assert.equal(catalogueTestPreparationDeadline(authorization, 3600).toISOString(), "2026-10-22T12:10:00.000Z");
  assert.equal(catalogueTestPreparationDeadline({ ...authorization, expiresAt: "2026-10-22T13:02:00.000Z" }, 3600).toISOString(), "2026-10-22T12:02:00.000Z");
  assert.equal(catalogueTestPreparationDeadline({ issuedAt, expiresAt: "2026-10-22T12:10:00.000Z" }, 300).toISOString(), "2026-10-22T12:05:00.000Z");
  for (const value of [null, {}, { ...authorization, issuedAt: null }, { ...authorization, expiresAt: "invalid" }]) assert.equal(catalogueTestPreparationDeadline(value, 3600), null);
  for (const duration of [0, 3601, 3.5, "3600"]) assert.equal(catalogueTestPreparationDeadline(authorization, duration), null);
});
