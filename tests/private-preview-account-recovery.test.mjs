import assert from "node:assert/strict";
import test from "node:test";
import {
  readPrivatePreviewRecoveryPolicy,
  privatePreviewRecoveryRoute,
  privatePreviewRecoveryIdentity
} from "../lib/private-preview-account-recovery.mjs";

const NOW = new Date("2026-11-25T16:00:00.000Z");
const END = "2026-11-25T18:00:00.000Z";
const PREFIX = "RUVANAS_PRIVATE_PREVIEW_ACCOUNT_RECOVERY";
const EMAIL = "client-one@example.invalid";
function account(userId = "client-one", organisationId = "shop-one", email = EMAIL) { return { userId, organisationId, email }; }
function environment(accounts = [account()]) {
  return {
    RUVANAS_PRIVATE_PREVIEW_ENABLED: "1", RUVANAS_PRIVATE_PREVIEW_PUBLIC_SITE: "0",
    RUVANAS_PUBLIC_URL: "https://preview.example.invalid", RUVANAS_PUBLIC_COMING_SOON_URL: "https://public.example.invalid/",
    RUVANAS_PRIVATE_PREVIEW_ALLOWED_EMAILS: "owner@example.invalid", RUVANAS_PRIVATE_PREVIEW_ADMIN_EMAIL: "owner@example.invalid",
    RUVANAS_RETAIL_REWARDS_ENABLED: "false", RUVANAS_RETAIL_REWARDS_PILOT_ADMIN_ENABLED: "false",
    RUVANAS_RETAIL_REWARDS_PILOT_PREVIEW_ENABLED: "false",
    [`${PREFIX}_ENABLED`]: "true", [`${PREFIX}_ACCOUNTS`]: JSON.stringify(accounts), [`${PREFIX}_EXPIRES_AT`]: END
  };
}
function user() {
  return { id: "client-one", email: EMAIL, role: "OWNER", privatePreviewAccess: null,
    memberships: [{ id: "member-one", userId: "client-one", organisationId: "shop-one", role: "OWNER",
      organisation: { id: "shop-one", enterpriseSecurityPolicy: null } }] };
}

test("recovery opt-in is independent of Rewards and gives only an immutable exact account scope", () => {
  const env = environment(), before = JSON.stringify(env), policy = readPrivatePreviewRecoveryPolicy(env, NOW);
  assert.equal(policy.enabled, true);
  assert.equal(policy.valid, true);
  assert.deepEqual(policy.accounts, [account()]);
  assert.equal(policy.expiresAt.toISOString(), END);
  assert.equal(Object.isFrozen(policy), true);
  assert.equal(Object.isFrozen(policy.accounts), true);
  assert.equal(Object.isFrozen(policy.accounts[0]), true);
  assert.equal(JSON.stringify(env), before);
  assert.deepEqual(privatePreviewRecoveryIdentity(user(), env, NOW), {
    userId: "client-one", organisationId: "shop-one", memberId: "member-one", email: EMAIL
  });
});

test("default-off, malformed flags and disabled or invalid preview cannot admit recovery", () => {
  for (const value of [undefined, "false", "TRUE", "1", true, null, " true"]) {
    const env = { ...environment(), [`${PREFIX}_ENABLED`]: value };
    assert.equal(readPrivatePreviewRecoveryPolicy(env, NOW).enabled, false, String(value));
    assert.equal(privatePreviewRecoveryIdentity(user(), env, NOW), null);
  }
  for (const patch of [
    { RUVANAS_PRIVATE_PREVIEW_ENABLED: "0" }, { RUVANAS_PRIVATE_PREVIEW_ENABLED: "invalid" },
    { RUVANAS_PUBLIC_URL: "http://public.example.invalid" }, { RUVANAS_PRIVATE_PREVIEW_ALLOWED_EMAILS: "other@example.invalid" }
  ]) assert.equal(readPrivatePreviewRecoveryPolicy({ ...environment(), ...patch }, NOW).enabled, false);
  assert.deepEqual(readPrivatePreviewRecoveryPolicy({}, NOW), { enabled: false, valid: true, accounts: [], expiresAt: null });
});

test("deadline is an exact UTC ISO timestamp, must still be future and cannot exceed 24 hours", () => {
  const check = (expiry, now = NOW) => readPrivatePreviewRecoveryPolicy({ ...environment(), [`${PREFIX}_EXPIRES_AT`]: expiry }, now);
  for (const expiry of [undefined, null, 123, "", "2026-11-25", "2026-11-25T18:00", "2026-11-25T18:00:00+00:00",
    "2026-11-25T18:00:00.0Z", "2026-11-25T18:00:00.0000Z", " 2026-11-25T18:00:00Z", "2026-11-31T18:00:00Z",
    NOW.toISOString(), "2026-11-25T15:59:59.999Z", "2026-11-26T16:00:00.001Z"]) {
    assert.equal(check(expiry).enabled, false, String(expiry));
  }
  assert.equal(check("2026-11-25T18:00:00Z").enabled, true);
  assert.equal(check("2026-11-26T16:00:00.000Z").enabled, true);
  assert.equal(check(END, new Date("2026-11-25T17:59:59.999Z")).enabled, true);
  assert.equal(check(END, new Date(END)).enabled, false);
  assert.equal(check(END, new Date("invalid")).enabled, false);
  assert.equal(check(END, NOW.toISOString()).enabled, false);
});

test("account list has one to ten unique strict ID pairs with canonical email and no implicit or extra fields", () => {
  const invalid = [[], null, {}, [{ userId: "client-one" }], [{ organisationId: "shop-one" }],
    [{ userId: "client-one", organisationId: "shop-one" }], [{ ...account(), unexpected: true }],
    [account(" client-one")], [account("../client")], [account("client-one", "")], [account(1)],
    [account("a".repeat(192))], [null], [[]], [account(), account()],
    [account(), account("client-one", "shop-one", "renamed@example.invalid")],
    Array.from({ length: 11 }, (_, i) => account(`user-${i}`, `org-${i}`, `user-${i}@example.invalid`))];
  for (const accounts of invalid) assert.equal(readPrivatePreviewRecoveryPolicy(environment(accounts), NOW).enabled, false, JSON.stringify(accounts));
  for (const raw of [undefined, "not-json", " ".repeat(16_385), '[{"userId":"client-one","organisationId":"shop-one","email":"client-one@example.invalid","__proto__":{}}]']) {
    assert.equal(readPrivatePreviewRecoveryPolicy({ ...environment(), [`${PREFIX}_ACCOUNTS`]: raw }, NOW).enabled, false);
  }
  assert.equal(readPrivatePreviewRecoveryPolicy(environment(Array.from({ length: 10 }, (_, i) =>
    account(`user-${i}`, `org-${i}`, `user-${i}@example.invalid`))), NOW).enabled, true);
  for (const email of [undefined, null, "", "not-an-email", "CLIENT-ONE@example.invalid", " client-one@example.invalid", "client-one@example.invalid ",
    "client-one@éxample.invalid", "client-one\n@example.invalid", `${"a".repeat(245)}@example.invalid`]) {
    assert.equal(readPrivatePreviewRecoveryPolicy(environment([{ ...account(), email }]), NOW).enabled, false, String(email));
  }
});

test("only exact recovery page and API methods are classified", () => {
  for (const path of ["/forgot-password", "/reset-password"]) {
    for (const method of ["GET", "HEAD"]) assert.equal(privatePreviewRecoveryRoute(path, method), "PAGE");
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS", "get", undefined]) assert.equal(privatePreviewRecoveryRoute(path, method), null);
  }
  for (const path of ["/api/auth/password-recovery/request", "/api/auth/password-recovery/reset"]) {
    assert.equal(privatePreviewRecoveryRoute(path, "POST"), "API");
    for (const method of ["GET", "HEAD", "PUT", "PATCH", "DELETE", "OPTIONS"]) assert.equal(privatePreviewRecoveryRoute(path, method), null);
  }
  for (const path of [null, "", "/forgot-password/", "/reset-password/extra", "/%72eset-password", "/reset-password?token=x",
    "/reset-password#token=x", "/\\reset-password", "/rewards", "/rewards/pilot-sign-in", "/register", "/api/auth/login",
    "/api/auth/password-recovery", "/api/auth/password-recovery/reset/", "/api/auth/password-recovery/request-extra"]) {
    for (const method of ["GET", "POST"]) assert.equal(privatePreviewRecoveryRoute(path, method), null, `${method} ${path}`);
  }
  assert.equal(privatePreviewRecoveryRoute("/reset-password", "GET", true), null);
  assert.equal(privatePreviewRecoveryRoute("/api/auth/password-recovery/reset", "POST", true), null);
});

test("only read-only Next static assets are admitted, without traversal or prefix expansion", () => {
  const asset = "/_next/static/chunks/app/reset-password/page-abc123.js";
  assert.equal(privatePreviewRecoveryRoute(asset, "GET"), "ASSET");
  assert.equal(privatePreviewRecoveryRoute(asset, "HEAD"), "ASSET");
  assert.equal(privatePreviewRecoveryRoute(asset, "POST"), null);
  assert.equal(privatePreviewRecoveryRoute(asset, "GET", true), null);
  for (const path of ["/_next/static/", "/_next/static/../private.js", "/_next/static/./a.js", "/_next/static//a.js",
    "/_next/static/%2e%2e/a.js", "/_next/static/a\\b.js", "/_next/static/a.js?x", "/_next/static/a.js#x",
    "/_next/static-other/a.js", "/_next/data/build/private.json", "/images/private.png"]) {
    assert.equal(privatePreviewRecoveryRoute(path, "GET"), null, path);
  }
});

test("identity requires ordinary global and membership roles and complete selected identity data", () => {
  for (const role of ["OWNER", "MANAGER"]) {
    const candidate = user(); candidate.role = role; candidate.memberships[0].role = role;
    assert.notEqual(privatePreviewRecoveryIdentity(candidate, environment(), NOW), null);
  }
  const mutations = [
    u => u.id = "other-user", u => u.id = "../client", u => u.email = "renamed@example.invalid", u => delete u.email,
    u => u.email = "CLIENT-ONE@example.invalid", u => u.role = "SUPER_ADMIN", u => u.role = "STUDENT",
    u => u.role = "VIEWER", u => u.role = "CONTENT_EDITOR", u => u.privatePreviewAccess = { userId: u.id },
    u => delete u.privatePreviewAccess, u => u.memberships = null, u => u.memberships = [],
    u => u.memberships[0].id = "", u => u.memberships[0].userId = "other-user",
    u => u.memberships[0].role = "VIEWER", u => u.memberships[0].role = "SUPER_ADMIN",
    u => u.memberships[0].organisationId = "other-shop", u => u.memberships[0].organisation.id = "other-shop",
    u => u.memberships[0].organisation = null, u => delete u.memberships[0].organisation.enterpriseSecurityPolicy
  ];
  for (const mutate of mutations) {
    const candidate = user(); mutate(candidate);
    assert.equal(privatePreviewRecoveryIdentity(candidate, environment(), NOW), null, String(mutate));
  }
  assert.equal(privatePreviewRecoveryIdentity(null, environment(), NOW), null);
});

test("identity never pairs an approved user with another user's approved organisation", () => {
  const env = environment([account(), account("client-two", "shop-two", "client-two@example.invalid")]);
  const candidate = user(); candidate.memberships[0].organisationId = "shop-two"; candidate.memberships[0].organisation.id = "shop-two";
  assert.equal(privatePreviewRecoveryIdentity(candidate, env, NOW), null);
  candidate.id = "client-two"; candidate.memberships[0].userId = "client-two";
  assert.equal(privatePreviewRecoveryIdentity(candidate, env, NOW), null, "a different user's email cannot be combined with the approved IDs");
  candidate.email = "client-two@example.invalid";
  assert.deepEqual(privatePreviewRecoveryIdentity(candidate, env, NOW), { userId: "client-two", organisationId: "shop-two", memberId: "member-one", email: "client-two@example.invalid" });
});

test("identity rejects ambiguous approved memberships and bounded-query overflow", () => {
  const candidate = user(); candidate.memberships.push({ ...candidate.memberships[0], id: "member-two" });
  assert.equal(privatePreviewRecoveryIdentity(candidate, environment(), NOW), null);
  candidate.memberships[1] = { id: "member-two", userId: candidate.id, organisationId: "shop-two", role: "OWNER",
    organisation: { id: "shop-two", enterpriseSecurityPolicy: null } };
  assert.equal(privatePreviewRecoveryIdentity(candidate, environment([account(), account("client-one", "shop-two")]), NOW), null);
  assert.notEqual(privatePreviewRecoveryIdentity(candidate, environment(), NOW), null, "unapproved extra membership does not expand scope");
  candidate.memberships = Array.from({ length: 1_001 }, () => null);
  assert.equal(privatePreviewRecoveryIdentity(candidate, environment(), NOW), null);
});

test("SSO-only and malformed selected security policies cannot obtain password recovery", () => {
  for (const security of [{ ssoRequired: true, passwordFallback: false }, { ssoRequired: true },
    { ssoRequired: true, passwordFallback: "true" }, {}, [], false]) {
    const candidate = user(); candidate.memberships[0].organisation.enterpriseSecurityPolicy = security;
    assert.equal(privatePreviewRecoveryIdentity(candidate, environment(), NOW), null, JSON.stringify(security));
  }
  for (const security of [null, { ssoRequired: true, passwordFallback: true }, { ssoRequired: false, passwordFallback: false }]) {
    const candidate = user(); candidate.memberships[0].organisation.enterpriseSecurityPolicy = security;
    assert.notEqual(privatePreviewRecoveryIdentity(candidate, environment(), NOW), null);
  }
});

test("identity is re-evaluated when scope closes or expires and does not become ordinary-production authorization", () => {
  const candidate = user(), env = environment();
  assert.notEqual(privatePreviewRecoveryIdentity(candidate, env, NOW), null);
  env[`${PREFIX}_ENABLED`] = "false";
  assert.equal(privatePreviewRecoveryIdentity(candidate, env, NOW), null);
  env[`${PREFIX}_ENABLED`] = "true";
  assert.equal(privatePreviewRecoveryIdentity(candidate, env, new Date(END)), null);
  env[`${PREFIX}_ACCOUNTS`] = JSON.stringify([account("client-two")]);
  assert.equal(privatePreviewRecoveryIdentity(candidate, env, NOW), null);
  assert.equal(privatePreviewRecoveryIdentity(candidate, {}, NOW), null);
});

test("approved email is pinned to the existing identity rather than silently following a renamed account", () => {
  const candidate = user(), env = environment();
  const initial = privatePreviewRecoveryIdentity(candidate, env, NOW);
  assert.equal(initial.email, EMAIL);
  candidate.email = "renamed@example.invalid";
  assert.equal(privatePreviewRecoveryIdentity(candidate, env, NOW), null);
  env[`${PREFIX}_ACCOUNTS`] = JSON.stringify([account("client-one", "shop-one", candidate.email)]);
  const revised = privatePreviewRecoveryIdentity(candidate, env, NOW);
  assert.equal(revised.email, candidate.email);
  assert.notDeepEqual(revised, initial, "the service can detect approval-scope changes during an operation");
});
