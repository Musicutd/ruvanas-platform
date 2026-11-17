import assert from "node:assert/strict";
import { test } from "node:test";
import { authorizeDormantShopperSession, createDormantShopperService, dormantShopperInputSchema } from "../lib/dormant-shopper-provisioning.mjs";

const NOW = new Date("2026-11-17T12:00:00Z");
const PRIVATE_ERROR = "private database details must not escape";
const input = extra => ({ organisationId: "test-workspace", email: "shopper@example.invalid", displayName: "Synthetic Shopper", confirmCreate: true, ...extra });
const session = extra => ({ id: "admin-session", userId: "admin-one", authMethod: "PASSWORD", revokedAt: null,
  createdAt: new Date(+NOW - 3_600_000), lastSeenAt: new Date(+NOW - 60_000), expiresAt: new Date(+NOW + 3_600_000),
  activeOrganisation: null, user: { id: "admin-one", email: "admin@example.invalid", role: "SUPER_ADMIN", privatePreviewAccess: null }, ...extra });
const previewEnv = () => ({ NODE_ENV: "production", RUVANAS_PRIVATE_PREVIEW_ENABLED: "1",
  RUVANAS_PRIVATE_PREVIEW_ALLOWED_EMAILS: "admin@example.invalid", RUVANAS_PRIVATE_PREVIEW_ADMIN_EMAIL: "admin@example.invalid",
  RUVANAS_PUBLIC_URL: "https://preview.example.invalid", RUVANAS_PUBLIC_COMING_SOON_URL: "https://public.example.invalid/",
  RUVANAS_RETAIL_REWARDS_ENABLED: "false" });
function previewSession() {
  const value = session({ authMethod: "PREVIEW_PASSWORD" });
  value.user.privatePreviewAccess = { userId: value.userId, enabled: true, passwordEnabled: true, organisationId: null, expiresAt: null, pillars: [] };
  return value;
}

function harness(options = {}) {
  let state = { shoppers: [], setups: [], audits: [], users: [], credentials: [], invitations: [],
    organisations: [{ id: "test-workspace", name: "Synthetic Test Shop" }] };
  let liveSession = options.session === undefined ? session() : options.session;
  let currentTime = new Date(NOW), transactions = 0, dbSessionReads = 0, txSessionReads = 0;
  const calls = [], env = options.env || { RUVANAS_RETAIL_REWARDS_ENABLED: "false" };
  const h = { get state() { return state; }, get session() { return liveSession; }, set session(value) { liveSession = value; },
    get now() { return currentTime; }, set now(value) { currentTime = value; }, env, calls,
    get transactions() { return transactions; } };
  function client(transaction) {
    const record = (model, operation, args) => calls.push({ model, operation, args: structuredClone(args), transaction });
    function findInsensitive(model, key, collection, projection) {
      return async args => {
        record(model, "findFirst", args);
        assert.equal(args.where[key].mode, "insensitive");
        const match = state[collection].find(row => row[key].toLowerCase() === args.where[key].equals.toLowerCase());
        return match ? { [projection]: match[projection] } : null;
      };
    }
    function create(model, collection, prefix) {
      return async args => {
        record(model, "create", args);
        options.beforeCreate?.(model, h);
        if (options.failCreate === model) throw Object.assign(new Error(PRIVATE_ERROR), { code: options.failureCode });
        if (options.onceSerializationFailure === model && transactions === 1) throw Object.assign(new Error(PRIVATE_ERROR), { code: "P2034" });
        const row = { ...(prefix ? { id: `${prefix}-${state[collection].length + 1}` } : {}), ...structuredClone(args.data) };
        state[collection].push(row);
        return { ...structuredClone(row), internalDebug: PRIVATE_ERROR, ...(options.corruptResult?.(model) || {}) };
      };
    }
    return {
      session: { findUnique: async args => {
        record("session", "findUnique", args);
        const count = transaction ? ++txSessionReads : ++dbSessionReads;
        options.beforeSessionRead?.({ transaction, count, h });
        assert.ok(args.select.user.select.privatePreviewAccess.select.passwordEnabled);
        assert.ok(args.select.activeOrganisation.select.enterpriseSecurityPolicy.select.idleTimeoutMinutes);
        return structuredClone(liveSession);
      } },
      user: { findFirst: findInsensitive("user", "email", "users", "id") },
      rewardShopperCredential: { findFirst: findInsensitive("rewardShopperCredential", "emailCanonical", "credentials", "shopperId") },
      rewardShopperInvitation: { findFirst: findInsensitive("rewardShopperInvitation", "emailCanonical", "invitations", "shopperId") },
      rewardShopperSetup: { findFirst: findInsensitive("rewardShopperSetup", "emailCanonical", "setups", "shopperId"),
        create: create("rewardShopperSetup", "setups") },
      organisation: { findUnique: async args => {
        record("organisation", "findUnique", args);
        return structuredClone(state.organisations.find(row => row.id === args.where.id) || null);
      } },
      rewardShopper: { create: create("rewardShopper", "shoppers", "prepared-shopper") },
      auditLog: { create: create("auditLog", "audits", "audit") },
      $queryRaw: async (parts, ...values) => {
        const sql = parts.join("?"); record("lock", sql, values);
        if (sql.includes('FROM "Organisation"')) return state.organisations.some(row => row.id === values[0]) ? [{ id: values[0] }] : [];
        if (sql.includes('FROM "User"')) return liveSession?.user?.id === values[0] ? [{ id: values[0] }] : [];
        if (sql.includes('FROM "Session"')) return liveSession?.id === values[0] && liveSession?.userId === values[1] ? [{ id: values[0] }] : [];
        if (sql.includes('FROM "PrivatePreviewAccess"')) return liveSession?.user?.privatePreviewAccess ? [{ userId: values[0] }] : [];
        if (sql.includes('FROM "EnterpriseSecurityPolicy"')) return [];
        assert.fail(`Unexpected raw query ${sql}`);
      }
    };
  }
  const db = { ...client(false), $transaction: async (work, config) => {
    assert.deepEqual(config, { isolationLevel: "Serializable" });
    transactions++;
    options.onTransactionStart?.(h);
    const snapshot = structuredClone(state);
    try { return await work(client(true)); }
    catch (error) { state = snapshot; throw error; }
  } };
  h.service = createDormantShopperService({ db, env, clock: () => currentTime,
    loadSession: async () => options.loadedSession === undefined ? structuredClone(liveSession) : structuredClone(options.loadedSession) });
  return h;
}
function noPreparedRecords(h) {
  assert.equal(h.state.shoppers.length, 0);
  assert.equal(h.state.setups.filter(row => row.shopperId?.startsWith("prepared-shopper")).length, 0);
  assert.equal(h.state.audits.length, 0);
}

test("prepares only a disabled shopper, email provenance and scrubbed audit while Rewards remains off", async () => {
  const h = harness(), envBefore = structuredClone(h.env);
  const result = await h.service.create(input({ email: " Shopper@Example.Invalid ", displayName: " Synthetic Shopper " }));
  assert.deepEqual(result, { ok: true, organisation: { id: "test-workspace", name: "Synthetic Test Shop" },
    shopper: { id: "prepared-shopper-1", email: "shopper@example.invalid", displayName: "Synthetic Shopper", status: "DISABLED" } });
  assert.equal(h.transactions, 1);
  assert.deepEqual(h.state.shoppers, [{ id: "prepared-shopper-1", displayName: "Synthetic Shopper", status: "DISABLED", authVersion: 1 }]);
  assert.deepEqual(h.state.setups, [{ shopperId: "prepared-shopper-1", emailCanonical: "shopper@example.invalid",
    organisationId: "test-workspace", createdByUserId: "admin-one", createdAt: NOW }]);
  assert.deepEqual(h.state.audits, [{ id: "audit-1", organisationId: "test-workspace", actorUserId: "admin-one",
    action: "DORMANT_SHOPPER_PREPARED", entityType: "RewardShopper", entityId: "prepared-shopper-1",
    details: { shopperId: "prepared-shopper-1", status: "DISABLED", accessGranted: false } }]);
  assert.deepEqual(h.calls.filter(call => call.operation === "create").map(call => call.model), ["rewardShopper", "rewardShopperSetup", "auditLog"]);
  assert.deepEqual([h.state.users, h.state.credentials, h.state.invitations], [[], [], []]);
  assert.deepEqual(h.env, envBefore);
  assert.ok(!JSON.stringify(h.state.audits).includes("shopper@example.invalid"));
  assert.ok(!JSON.stringify({ result, audit: h.state.audits }).includes(PRIVATE_ERROR));
});

test("established preview Super Admin and ordinary PASSWORD/SSO admins retain exact authority without new grants", async () => {
  const h = harness({ env: previewEnv(), session: previewSession() }), before = structuredClone(h.session);
  assert.deepEqual(authorizeDormantShopperSession(h.session, NOW, h.env), { ok: true, userId: "admin-one", sessionId: "admin-session" });
  assert.equal((await h.service.create(input())).ok, true);
  assert.deepEqual(h.session, before);
  for (const authMethod of ["PASSWORD", "SSO"]) {
    assert.equal((await harness({ session: session({ authMethod }) }).service.create(input())).ok, true);
  }
});

test("unauthenticated, expired, revoked, foreign, bootstrap and non-admin sessions perform no provisioning reads", async () => {
  const variants = [null, session({ revokedAt: NOW }), session({ expiresAt: NOW }), session({ expiresAt: new Date(NaN) }),
    session({ userId: "another-user" }), session({ createdAt: new Date(+NOW + 1) }), session({ lastSeenAt: new Date(+NOW + 1) }),
    session({ authMethod: "PREVIEW_CODE" }), session({ authMethod: "PREVIEW_PASSWORD" })];
  for (const role of ["OWNER", "SUPPORT", "MANAGER", "VIEWER", "STUDENT"]) {
    const value = session(); value.user.role = role; variants.push(value);
  }
  const previewGrant = session(); previewGrant.user.privatePreviewAccess = { userId: previewGrant.userId }; variants.push(previewGrant);
  for (const value of variants) {
    const h = harness({ session: value }), result = await h.service.create(input());
    assert.equal(result.ok, false); assert.equal(h.calls.length, 0); assert.equal(h.transactions, 0);
  }
});

test("preview testers, wrong owner, invalid policy, revoked grants and bootstrap codes cannot prepare identities", async () => {
  const mutations = [value => { value.authMethod = "PREVIEW_CODE"; }, value => { value.authMethod = "PASSWORD"; },
    value => { value.user.email = "other@example.invalid"; }, value => { value.user.role = "OWNER"; },
    value => { value.user.privatePreviewAccess = null; }, value => { value.user.privatePreviewAccess.userId = "other-user"; },
    value => { value.user.privatePreviewAccess.enabled = false; }, value => { value.user.privatePreviewAccess.passwordEnabled = false; },
    value => { value.user.privatePreviewAccess.organisationId = "test-workspace"; },
    value => { value.user.privatePreviewAccess.expiresAt = new Date(+NOW + 60_000); },
    value => { value.user.privatePreviewAccess.pillars = ["RETAIL"]; }];
  for (const mutate of mutations) {
    const current = previewSession(); mutate(current);
    const h = harness({ env: previewEnv(), session: current });
    assert.equal((await h.service.create(input())).ok, false); assert.equal(h.calls.length, 0);
  }
  const h = harness({ env: { ...previewEnv(), RUVANAS_PRIVATE_PREVIEW_ENABLED: "invalid" }, session: previewSession() });
  assert.equal((await h.service.create(input())).code, "UNAVAILABLE"); assert.equal(h.calls.length, 0);
});

test("database reload positively checks preview-grant absence and enterprise session deadlines", async () => {
  const omitted = session(); delete omitted.user.privatePreviewAccess;
  assert.equal((await harness({ loadedSession: omitted }).service.create(input())).ok, true);
  const h = harness({ session: omitted });
  assert.equal((await h.service.create(input())).code, "UNAVAILABLE"); noPreparedRecords(h);
  for (const enterpriseSecurityPolicy of [{ sessionMaxAgeMinutes: 60, idleTimeoutMinutes: 30 }, { sessionMaxAgeMinutes: 120, idleTimeoutMinutes: 1 }]) {
    const expired = harness({ session: session({ activeOrganisation: { enterpriseSecurityPolicy } }) });
    assert.equal((await expired.service.create(input())).code, "AUTH_REQUIRED"); assert.equal(expired.calls.length, 0);
  }
});

test("strict input denies privileges, credentials, memberships, invites, malformed values and missing confirmation", async () => {
  for (const extra of [{ status: "ACTIVE" }, { role: "OWNER" }, { password: "not accepted here" }, { shopperId: "existing" },
    { expiresAt: NOW.toISOString() }, { invitation: true }, { membership: {} }, { confirmCreate: false },
    { organisationId: "" }, { organisationId: "unsafe/id" }, { organisationId: "x".repeat(192) },
    { email: "invalid" }, { email: `${"x".repeat(255)}@example.invalid` }, { displayName: " " },
    { displayName: "x".repeat(81) }, { displayName: "Name\0" }, { displayName: "Name\nTwo" }, { displayName: "Name\ud800" }]) {
    const h = harness(), result = await h.service.create(input(extra));
    assert.equal(result.code, "INVALID_REQUEST", JSON.stringify(extra)); assert.equal(h.calls.length, 0);
  }
  assert.equal(dormantShopperInputSchema.safeParse(input({ displayName: "購物者" })).success, true);
});

test("case-insensitive collisions across business, credential, invitation and setup identities are rejected without adoption", async () => {
  for (const collection of ["users", "credentials", "invitations", "setups"]) {
    const h = harness();
    h.state[collection].push(collection === "users" ? { id: "existing-user", email: "SHOPPER@EXAMPLE.INVALID" } :
      { shopperId: "existing-shopper", emailCanonical: "SHOPPER@EXAMPLE.INVALID", organisationId: "another-workspace", revokedAt: NOW });
    const existing = structuredClone(h.state[collection]);
    assert.equal((await h.service.create(input())).code, "EMAIL_EXISTS");
    assert.deepEqual(h.state[collection], existing); noPreparedRecords(h); assert.equal(h.transactions, 0);
  }
});

test("the selected existing workspace is required and no tenant is created, adopted or substituted", async () => {
  const h = harness();
  assert.equal((await h.service.create(input({ organisationId: "another-workspace" }))).code, "ORGANISATION_UNAVAILABLE");
  noPreparedRecords(h); assert.equal(h.transactions, 0);
  const missing = harness({ onTransactionStart: state => { state.state.organisations = []; } });
  assert.equal((await missing.service.create(input())).code, "ORGANISATION_UNAVAILABLE"); noPreparedRecords(missing);
});

test("email conflicts committed between preflight and transaction are rechecked and preserved", async () => {
  for (const collection of ["users", "credentials", "invitations", "setups"]) {
    const h = harness({ onTransactionStart: state => state.state[collection].push(collection === "users" ?
      { id: "racing-user", email: "SHOPPER@EXAMPLE.INVALID" } : { shopperId: "racing-shopper", emailCanonical: "SHOPPER@EXAMPLE.INVALID" }) });
    assert.equal((await h.service.create(input())).code, "EMAIL_EXISTS"); noPreparedRecords(h);
    assert.equal(h.state[collection].length, 1);
  }
});

test("each transaction reads all four identity stores before creating an inert shopper", async () => {
  const h = harness(); assert.equal((await h.service.create(input())).ok, true);
  const calls = h.calls.filter(call => call.transaction), firstCreate = calls.findIndex(call => call.operation === "create");
  assert.ok(firstCreate > 0);
  for (const model of ["user", "rewardShopperCredential", "rewardShopperInvitation", "rewardShopperSetup"]) {
    assert.ok(calls.slice(0, firstCreate).some(call => call.model === model && call.operation === "findFirst"));
  }
  const locks = calls.filter(call => call.model === "lock").map(call => call.operation);
  for (const table of ["Organisation", "User", "Session", "PrivatePreviewAccess", "EnterpriseSecurityPolicy"]) {
    assert.ok(locks.some(sql => sql.includes(`FROM "${table}"`)));
  }
});

test("stored session or role changes before transaction writes fail closed", async () => {
  for (const mutate of [h => { h.session.user.role = "OWNER"; }, h => { h.session.revokedAt = NOW; },
    h => { h.session.expiresAt = NOW; }, h => { h.session.id = "changed-session"; },
    h => { h.session.userId = "changed-user"; }, h => { h.session.authMethod = "SSO"; }]) {
    const h = harness({ onTransactionStart: mutate });
    assert.equal((await h.service.create(input())).ok, false); noPreparedRecords(h);
  }
});

test("failed shopper, setup or audit write rolls back all new rows and exposes no raw error", async () => {
  for (const failCreate of ["rewardShopper", "rewardShopperSetup", "auditLog"]) {
    const h = harness({ failCreate }), result = await h.service.create(input());
    assert.equal(result.code, "UNAVAILABLE"); noPreparedRecords(h);
    assert.ok(!JSON.stringify(result).includes(PRIVATE_ERROR));
  }
});

test("unexpected returned identity or activation state rolls back instead of exposing a misleading receipt", async () => {
  for (const [model, corruption] of [["rewardShopper", { status: "ACTIVE" }], ["rewardShopper", { authVersion: 2 }],
    ["rewardShopper", { displayName: "another name" }], ["rewardShopper", { id: "invalid/id" }],
    ["rewardShopperSetup", { shopperId: "another-shopper" }], ["rewardShopperSetup", { emailCanonical: "another@example.invalid" }],
    ["rewardShopperSetup", { organisationId: "another-workspace" }], ["rewardShopperSetup", { createdByUserId: "another-admin" }]]) {
    const h = harness({ corruptResult: createdModel => createdModel === model ? corruption : {} });
    assert.equal((await h.service.create(input())).code, "UNAVAILABLE"); noPreparedRecords(h);
  }
});

test("unique races retry atomically and serialization retry cannot leave an orphan shopper", async () => {
  const collision = harness({ failCreate: "rewardShopperSetup", failureCode: "P2002" });
  assert.equal((await collision.service.create(input())).code, "CONFLICT");
  assert.equal(collision.transactions, 3); noPreparedRecords(collision);
  const retry = harness({ onceSerializationFailure: "auditLog" });
  assert.equal((await retry.service.create(input())).ok, true); assert.equal(retry.transactions, 2);
  assert.equal(retry.state.shoppers.length, 1); assert.equal(retry.state.setups.length, 1); assert.equal(retry.state.audits.length, 1);
});

test("authority expiry, revocation and preview policy changes before commit roll back shopper and provenance", async () => {
  for (const mutate of [h => { h.now = new Date(+NOW + 3_600_000); }, h => { h.session.user.role = "SUPPORT"; },
    h => { h.session.user.privatePreviewAccess.enabled = false; }, h => { h.env.RUVANAS_PRIVATE_PREVIEW_ENABLED = "0"; },
    h => { h.env.RUVANAS_PRIVATE_PREVIEW_ENABLED = "invalid"; }, h => { h.env.RUVANAS_PRIVATE_PREVIEW_ADMIN_EMAIL = "other@example.invalid"; }]) {
    const h = harness({ session: previewSession(), env: previewEnv(), beforeCreate: (model, state) => { if (model === "auditLog") mutate(state); } });
    assert.equal((await h.service.create(input())).ok, false); noPreparedRecords(h);
  }
});

test("invalid and backwards clocks or loader failures fail safely without private error disclosure", async () => {
  const invalid = harness(); invalid.now = new Date(NaN);
  assert.equal((await invalid.service.create(input())).code, "UNAVAILABLE"); assert.equal(invalid.calls.length, 0);
  const backwards = harness({ beforeCreate: (model, h) => { if (model === "auditLog") h.now = new Date(+NOW - 1); } });
  assert.equal((await backwards.service.create(input())).code, "UNAVAILABLE"); noPreparedRecords(backwards);
  const absent = createDormantShopperService({ clock: () => NOW });
  assert.equal((await absent.create(input())).code, "AUTH_REQUIRED");
  const broken = createDormantShopperService({ clock: () => NOW, loadSession: async () => { throw new Error(PRIVATE_ERROR); } });
  const result = await broken.create(input()); assert.equal(result.code, "UNAVAILABLE");
  assert.ok(!JSON.stringify(result).includes(PRIVATE_ERROR));
});
