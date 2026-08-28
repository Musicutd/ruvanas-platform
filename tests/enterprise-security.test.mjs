import test from "node:test";
import assert from "node:assert/strict";
import {
  generateServiceApiKey,
  hashServiceApiKey,
  normalizeEmailDomains,
  normalizeServiceAccountScopes,
  scopeAllows,
  serviceAccountIsUsable,
  validateEnterprisePolicy
} from "../lib/enterprise-security.mjs";

const SECRET = "stage-5e-test-secret-that-is-longer-than-thirty-two-characters";

test("service account keys expose a prefix while storing only a stable keyed hash", () => {
  const chunks = [Buffer.alloc(6, 1), Buffer.alloc(32, 2)];
  const generated = generateServiceApiKey(SECRET, () => chunks.shift());

  assert.match(generated.rawKey, /^rvsa_[a-f0-9]{12}_[a-f0-9]{64}$/);
  assert.equal(generated.prefix, "rvsa_010101010101");
  assert.equal(generated.tokenHash, hashServiceApiKey(generated.rawKey, SECRET));
  assert.equal(generated.tokenHash.includes(generated.rawKey), false);
  assert.notEqual(generated.tokenHash, hashServiceApiKey(`${generated.rawKey}x`, SECRET));
});

test("service account scopes are allow-listed, deduplicated, and checked exactly", () => {
  const scopes = normalizeServiceAccountScopes([
    " REPORTS:READ ", "organisation:read", "reports:read", "organisation:write", null
  ]);
  assert.deepEqual(scopes, ["organisation:read", "reports:read"]);
  assert.equal(scopeAllows(scopes, "reports:read"), true);
  assert.equal(scopeAllows(scopes, "report:read"), false);
});

test("enterprise policy validation prevents unsafe timeouts and premature SSO enforcement", () => {
  const valid = validateEnterprisePolicy({
    sessionMaxAgeMinutes: 1440,
    idleTimeoutMinutes: 60,
    ssoRequired: false,
    passwordFallback: true,
    allowedEmailDomains: ["@School.Example", "school.example", "invalid"]
  });
  assert.equal(valid.ok, true);
  assert.deepEqual(valid.policy.allowedEmailDomains, ["school.example"]);
  assert.equal(validateEnterprisePolicy({ sessionMaxAgeMinutes: 30, idleTimeoutMinutes: 15 }).ok, false);
  assert.equal(validateEnterprisePolicy({ sessionMaxAgeMinutes: 60, idleTimeoutMinutes: 61 }).ok, false);
  assert.equal(validateEnterprisePolicy({ sessionMaxAgeMinutes: 1440, idleTimeoutMinutes: 60, ssoRequired: true }).ok, false);
  assert.equal(validateEnterprisePolicy({ sessionMaxAgeMinutes: 1440, idleTimeoutMinutes: 60, ssoRequired: true }, { providerReady: true }).ok, true);
});

test("revoked and expired service credentials are never usable", () => {
  const future = new Date("2030-01-01T00:00:00.000Z");
  const now = new Date("2029-01-01T00:00:00.000Z");
  const account = { status: "ACTIVE", revokedAt: null, expiresAt: future };
  const key = { status: "ACTIVE", revokedAt: null, expiresAt: future };
  assert.equal(serviceAccountIsUsable(account, key, now), true);
  assert.equal(serviceAccountIsUsable({ ...account, status: "REVOKED" }, key, now), false);
  assert.equal(serviceAccountIsUsable(account, { ...key, revokedAt: now }, now), false);
  assert.equal(serviceAccountIsUsable({ ...account, expiresAt: now }, key, now), false);
});

test("email-domain normalization rejects malformed entries", () => {
  assert.deepEqual(normalizeEmailDomains(["Example.COM", "@example.com", "localhost", "bad_domain.com"]), ["example.com"]);
});

