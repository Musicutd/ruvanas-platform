import test from "node:test";
import assert from "node:assert/strict";
import { readRewardsFeaturePolicy } from "../lib/retail-rewards/feature-policy.mjs";
import { rewardsDenied } from "../lib/retail-rewards/errors.mjs";

test("Rewards flags are opt-in and public claims cannot bypass the module switch", () => {
  assert.deepEqual(readRewardsFeaturePolicy(), { enabled: false, publicClaimsEnabled: false, valid: true });
  for (const enabled of [undefined, "false", "true"]) {
    for (const publicClaims of [undefined, "false", "true"]) {
      const result = readRewardsFeaturePolicy({ RUVANAS_RETAIL_REWARDS_ENABLED: enabled, RUVANAS_RETAIL_REWARDS_PUBLIC_CLAIMS_ENABLED: publicClaims });
      assert.deepEqual(result, { enabled: enabled === "true", publicClaimsEnabled: enabled === "true" && publicClaims === "true", valid: true });
      assert.equal(Object.isFrozen(result), true);
    }
  }
});

test("misspelled, truthy or broken configuration disables both Rewards switches", () => {
  for (const bad of [null, true, false, 1, 0, "1", "TRUE", "yes", " true", "false ", "", [], {}]) {
    for (const field of ["RUVANAS_RETAIL_REWARDS_ENABLED", "RUVANAS_RETAIL_REWARDS_PUBLIC_CLAIMS_ENABLED"]) {
      const result = readRewardsFeaturePolicy({ RUVANAS_RETAIL_REWARDS_ENABLED: "true", RUVANAS_RETAIL_REWARDS_PUBLIC_CLAIMS_ENABLED: "true", [field]: bad });
      assert.deepEqual(result, { enabled: false, publicClaimsEnabled: false, valid: false });
    }
  }
  for (const env of [null, [], "true", 1, { get RUVANAS_RETAIL_REWARDS_ENABLED() { throw new Error("secret"); } }]) {
    assert.deepEqual(readRewardsFeaturePolicy(env), { enabled: false, publicClaimsEnabled: false, valid: false });
  }
});

test("Rewards denial contracts are stable, immutable and never echo unknown input", () => {
  for (const [code, status] of Object.entries({ FEATURE_DISABLED: 403, INVALID_REQUEST: 400, UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_ENTITLED: 403, LOCATION_UNAVAILABLE: 404, LIMIT_REACHED: 409, UNAVAILABLE: 503 })) {
    const result = rewardsDenied(code);
    assert.equal(result.ok, false);
    assert.equal(result.status, status);
    assert.equal(result.code, code);
    assert.equal(typeof result.error, "string");
    assert.equal(Object.isFrozen(result), true);
    assert.deepEqual(Object.keys(result), ["ok", "status", "code", "error"]);
  }
  for (const input of ["secret", "__proto__", "constructor", null, {}, new Error("database-password")]) {
    assert.deepEqual(rewardsDenied(input), rewardsDenied("UNAVAILABLE"));
  }
});
