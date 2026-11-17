import assert from "node:assert/strict";
import { test } from "node:test";
import bcrypt from "bcryptjs";
import { authorizeOrdinaryOwnerSession, createOrdinaryOwnerService, ordinaryOwnerInputSchema } from "../lib/ordinary-owner-provisioning.mjs";

const NOW = new Date("2026-11-17T12:00:00Z");
const PASSWORD = "synthetic owner password";
const HASH = `$2b$12$${"a".repeat(53)}`;
const input = extra => ({ name: "Synthetic Rewards Shop", planId: "public-plan-retail-pro", ownerName: "Synthetic Owner",
  ownerEmail: "shop@example.invalid", password: PASSWORD, confirmCreate: true, ...extra });
const session = extra => ({ id: "admin-session", userId: "admin-one", authMethod: "PASSWORD", revokedAt: null,
  createdAt: new Date(+NOW - 3_600_000), lastSeenAt: new Date(+NOW - 60_000), expiresAt: new Date(+NOW + 3_600_000),
  activeOrganisation: null, user: { id: "admin-one", email: "admin@example.invalid", role: "SUPER_ADMIN", privatePreviewAccess: null }, ...extra });
const previewEnv = () => ({ NODE_ENV: "production", RUVANAS_PRIVATE_PREVIEW_ENABLED: "1",
  RUVANAS_PRIVATE_PREVIEW_ALLOWED_EMAILS: "admin@example.invalid", RUVANAS_PRIVATE_PREVIEW_ADMIN_EMAIL: "admin@example.invalid",
  RUVANAS_PUBLIC_URL: "https://preview.example.invalid", RUVANAS_PUBLIC_COMING_SOON_URL: "https://public.example.invalid/" });
function previewSession() {
  const value = session({ authMethod: "PREVIEW_PASSWORD" });
  value.user.privatePreviewAccess = { userId: value.userId, enabled: true, passwordEnabled: true, organisationId: null, expiresAt: null, pillars: [] };
  return value;
}
const plan = () => ({ id: "public-plan-retail-pro", code: "RETAIL_PRO", active: true, publiclyAvailable: true,
  productFamily: "RETAIL", retailRadioEnabled: true });

function harness(options = {}) {
  let state = { users: [], organisations: [], members: [], subscriptions: [], audits: [], credentials: [], invitations: [], plan: plan() };
  let liveSession = options.session === undefined ? session() : options.session;
  let currentTime = new Date(NOW), hashCalls = 0, transactions = 0, dbSessionReads = 0, txSessionReads = 0;
  const calls = [], env = options.env || {};
  const h = { get state() { return state; }, get session() { return liveSession; }, set session(value) { liveSession = value; },
    get now() { return currentTime; }, set now(value) { currentTime = value; }, env, calls,
    get hashCalls() { return hashCalls; }, get transactions() { return transactions; } };
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
        if (options.failCreate === model) throw Object.assign(new Error(`private failure ${PASSWORD} ${HASH}`), { code: options.failureCode });
        const row = { id: `${prefix}-${state[collection].length + 1}`, ...structuredClone(args.data) };
        state[collection].push(row);
        // Return extra fields to prove service output does not spread DB rows.
        return { ...structuredClone(row), internalDebug: "must never be returned" };
      };
    }
    return {
      session: { findUnique: async args => {
        record("session", "findUnique", args);
        const count = transaction ? ++txSessionReads : ++dbSessionReads;
        options.beforeSessionRead?.({ transaction, count, h });
        assert.ok(args.select.user.select.privatePreviewAccess.select.passwordEnabled);
        return structuredClone(liveSession);
      } },
      user: { findFirst: findInsensitive("user", "email", "users", "id"), create: create("user", "users", "owner") },
      organisation: { findFirst: findInsensitive("organisation", "slug", "organisations", "id"), create: create("organisation", "organisations", "organisation") },
      rewardShopperCredential: { findFirst: findInsensitive("rewardShopperCredential", "emailCanonical", "credentials", "shopperId") },
      rewardShopperInvitation: { findFirst: findInsensitive("rewardShopperInvitation", "emailCanonical", "invitations", "shopperId") },
      plan: { findUnique: async args => {
        record("plan", "findUnique", args);
        return state.plan?.id === args.where.id ? structuredClone(state.plan) : null;
      } },
      organisationMember: { create: create("organisationMember", "members", "member") },
      subscription: { create: create("subscription", "subscriptions", "subscription") },
      auditLog: { create: create("auditLog", "audits", "audit") },
      $queryRaw: async (parts, ...values) => {
        const sql = parts.join("?"); record("lock", sql, values);
        if (sql.includes('FROM "User"')) return liveSession?.user?.id === values[0] ? [{ id: values[0] }] : [];
        if (sql.includes('FROM "Session"')) return liveSession?.id === values[0] && liveSession?.userId === values[1] ? [{ id: values[0] }] : [];
        if (sql.includes('FROM "Plan"')) return state.plan?.id === values[0] ? [{ id: values[0] }] : [];
        if (sql.includes('FROM "PrivatePreviewAccess"')) return liveSession?.user?.privatePreviewAccess ? [{ userId: values[0] }] : [];
        if (sql.includes('FROM "EnterpriseSecurityPolicy"')) return [];
        assert.fail(`Unexpected raw query ${sql}`);
      }
    };
  }
  const db = { ...client(false), $transaction: async (work, config) => {
    assert.deepEqual(config, { isolationLevel: "Serializable" });
    transactions++;
    const snapshot = structuredClone(state);
    try { return await work(client(true)); }
    catch (error) { state = snapshot; throw error; }
  } };
  const configuration = { db, env, clock: () => currentTime,
    loadSession: async () => options.loadedSession === undefined ? structuredClone(liveSession) : structuredClone(options.loadedSession),
    hashPassword: async (password, cost) => {
      hashCalls++; assert.equal(password, options.expectedPassword ?? PASSWORD); assert.equal(cost, 12);
      options.onHash?.(h);
      if (options.hashError) throw new Error(`${PASSWORD} ${HASH}`);
      return options.hashResult === undefined ? HASH : options.hashResult;
    } };
  if (options.realHash) delete configuration.hashPassword;
  h.service = createOrdinaryOwnerService(configuration);
  return h;
}

function noCreatedRecords(h) {
  assert.deepEqual([h.state.members, h.state.subscriptions, h.state.audits], [[], [], []]);
  assert.equal(h.state.users.filter(row => row.id?.startsWith("owner-")).length, 0);
  assert.equal(h.state.organisations.filter(row => row.id?.startsWith("organisation-")).length, 0);
}

test("creates only a new ordinary OWNER, separate tenant, one membership, TRIAL and scrubbed audit", async () => {
  const h = harness(), result = await h.service.create(input({ ownerEmail: " Shop@Example.Invalid ", slug: " Synthetic-Shop " }));
  assert.deepEqual(result, { ok: true, organisation: { id: "organisation-1", name: "Synthetic Rewards Shop", slug: "synthetic-shop" },
    owner: { id: "owner-1", name: "Synthetic Owner", email: "shop@example.invalid", role: "OWNER" } });
  assert.equal(h.hashCalls, 1); assert.equal(h.transactions, 1);
  assert.deepEqual(h.state.members, [{ id: "member-1", userId: "owner-1", organisationId: "organisation-1", role: "OWNER" }]);
  assert.deepEqual(h.state.subscriptions, [{ id: "subscription-1", organisationId: "organisation-1", planId: "public-plan-retail-pro", status: "TRIAL" }]);
  assert.deepEqual(h.state.audits[0], { id: "audit-1", organisationId: "organisation-1", actorUserId: "admin-one",
    action: "ORDINARY_OWNER_ORGANISATION_CREATED", entityType: "Organisation", entityId: "organisation-1",
    details: { ownerUserId: "owner-1", ownerRole: "OWNER", planId: "public-plan-retail-pro", subscriptionStatus: "TRIAL" } });
  assert.deepEqual(h.calls.filter(call => call.operation === "create").map(call => call.model),
    ["user", "organisation", "organisationMember", "subscription", "auditLog"]);
  const exposed = JSON.stringify({ result, audit: h.state.audits });
  for (const secret of [PASSWORD, HASH, "passwordHash", "internalDebug"]) assert.ok(!exposed.includes(secret));
  assert.equal(h.state.users[0].passwordHash, HASH);
});

test("the default password hasher stores a usable bcrypt cost 12 hash", async () => {
  const h = harness({ realHash: true }), result = await h.service.create(input());
  assert.equal(result.ok, true); assert.equal(bcrypt.getRounds(h.state.users[0].passwordHash), 12);
  assert.equal(await bcrypt.compare(PASSWORD, h.state.users[0].passwordHash), true);
  assert.equal(result.organisation.slug, "synthetic-rewards-shop");
});

test("unauthenticated, expired, revoked, foreign and non-admin sessions perform no provisioning reads or hashing", async () => {
  const variants = [null, session({ revokedAt: NOW }), session({ expiresAt: NOW }), session({ expiresAt: new Date(NaN) }),
    session({ userId: "another-user" }), session({ createdAt: new Date(+NOW + 1) }), session({ lastSeenAt: new Date(+NOW + 1) }),
    session({ authMethod: "PREVIEW_CODE" }), session({ authMethod: "PREVIEW_PASSWORD" })];
  for (const role of ["OWNER", "SUPPORT", "MANAGER", "VIEWER", "STUDENT"]) {
    const value = session(); value.user.role = role; variants.push(value);
  }
  const grant = session(); grant.user.privatePreviewAccess = { userId: grant.userId }; variants.push(grant);
  for (const value of variants) {
    const h = harness({ session: value }), result = await h.service.create(input());
    assert.equal(result.ok, false); assert.equal(h.calls.length, 0); assert.equal(h.hashCalls, 0); assert.equal(h.transactions, 0);
  }
});

test("ordinary PASSWORD and SSO authority requires preview off and a positively absent stored preview grant", async () => {
  for (const authMethod of ["PASSWORD", "SSO"]) {
    const h = harness({ session: session({ authMethod }) }); assert.equal((await h.service.create(input())).ok, true);
  }
  const loaded = session(); delete loaded.user.privatePreviewAccess;
  const h = harness({ loadedSession: loaded }); assert.equal((await h.service.create(input())).ok, true);
  const missing = harness({ session: loaded });
  assert.equal((await missing.service.create(input())).code, "UNAVAILABLE"); assert.equal(missing.hashCalls, 0);
  const denied = harness({ env: previewEnv() });
  assert.equal((await denied.service.create(input())).code, "FORBIDDEN"); assert.equal(denied.calls.length, 0);
});

test("established configured preview Super Admin can provision an ordinary owner without changing preview grants", async () => {
  const current = previewSession(), before = structuredClone(current), h = harness({ env: previewEnv(), session: current });
  assert.deepEqual(authorizeOrdinaryOwnerSession(current, NOW, h.env), { ok: true, userId: "admin-one", sessionId: "admin-session" });
  assert.equal((await h.service.create(input())).ok, true); assert.deepEqual(h.session, before);
  assert.equal(Object.hasOwn(h.state.users[0], "privatePreviewAccess"), false);
});

test("preview code bootstrap, wrong configured owner, malformed grants, testers and invalid policy fail closed", async () => {
  const variants = [value => { value.authMethod = "PREVIEW_CODE"; }, value => { value.authMethod = "PASSWORD"; },
    value => { value.user.email = "other@example.invalid"; }, value => { value.user.role = "OWNER"; },
    value => { value.user.privatePreviewAccess = null; }, value => { value.user.privatePreviewAccess.userId = "other-user"; },
    value => { value.user.privatePreviewAccess.enabled = false; }, value => { value.user.privatePreviewAccess.passwordEnabled = false; },
    value => { value.user.privatePreviewAccess.organisationId = "test-organisation"; },
    value => { value.user.privatePreviewAccess.expiresAt = new Date(+NOW + 60_000); },
    value => { value.user.privatePreviewAccess.pillars = ["RETAIL"]; }, value => { value.expiresAt = NOW; }];
  for (const mutate of variants) {
    const current = previewSession(); mutate(current);
    const h = harness({ env: previewEnv(), session: current });
    assert.equal((await h.service.create(input())).ok, false); assert.equal(h.calls.length, 0);
  }
  for (const change of [{ RUVANAS_PRIVATE_PREVIEW_ENABLED: "oops" }, { RUVANAS_PRIVATE_PREVIEW_ADMIN_EMAIL: "other@example.invalid" },
    { RUVANAS_PRIVATE_PREVIEW_ALLOWED_EMAILS: "other@example.invalid" }]) {
    const h = harness({ env: { ...previewEnv(), ...change }, session: previewSession() });
    assert.equal((await h.service.create(input())).ok, false); assert.equal(h.calls.length, 0);
  }
});

test("session enterprise absolute and idle expiry remain enforced", () => {
  for (const policy of [{ sessionMaxAgeMinutes: 60, idleTimeoutMinutes: 30 }, { sessionMaxAgeMinutes: 120, idleTimeoutMinutes: 1 }]) {
    assert.equal(authorizeOrdinaryOwnerSession(session({ activeOrganisation: { enterpriseSecurityPolicy: policy } }), NOW).code, "AUTH_REQUIRED");
  }
  assert.equal(authorizeOrdinaryOwnerSession(session({ activeOrganisation: { enterpriseSecurityPolicy: { sessionMaxAgeMinutes: 0 } } }), NOW).code, "UNAVAILABLE");
});

test("strict input validation rejects extra fields, unsafe names/slugs, oversized values and missing confirmation before DB reads", async () => {
  for (const extra of [{ role: "SUPER_ADMIN" }, { ownerId: "existing" }, { privatePreviewAccess: null }, { confirmCreate: false },
    { name: " " }, { name: "x".repeat(161) }, { name: "Shop\0" }, { ownerName: "x".repeat(101) }, { ownerName: "x\nY" },
    { ownerEmail: `${"a".repeat(255)}@example.invalid` }, { ownerEmail: "invalid" }, { planId: "x".repeat(192) },
    { slug: "x".repeat(181) }, { slug: "x/y" }, { slug: "" }, { slug: "x--y" }, { name: "商店" }]) {
    const h = harness(), result = await h.service.create(input(extra));
    assert.equal(result.code, "INVALID_REQUEST", JSON.stringify(extra)); assert.equal(h.calls.length, 0); assert.equal(h.hashCalls, 0);
  }
});

test("passwords require 15 codepoints, at most 72 UTF-8 bytes, well formed Unicode and no NUL", async () => {
  for (const password of ["a".repeat(14), "🙂".repeat(14), "a".repeat(73), "🙂".repeat(19), `${"a".repeat(15)}\0`, `${"a".repeat(15)}\ud800`]) {
    const h = harness(), result = await h.service.create(input({ password }));
    assert.equal(result.code, "INVALID_REQUEST"); assert.equal(h.calls.length, 0); assert.equal(h.hashCalls, 0);
  }
  for (const password of ["a".repeat(15), "a".repeat(72), "🙂".repeat(15), ` ${"x".repeat(14)}`]) {
    assert.equal(ordinaryOwnerInputSchema.safeParse(input({ password })).success, true);
  }
});

test("case insensitive User, shopper credential and even revoked invitation collisions reject without hashing", async () => {
  for (const table of ["users", "credentials", "invitations"]) {
    const h = harness();
    h.state[table].push(table === "users" ? { id: "legacy-user", email: "SHOP@EXAMPLE.INVALID" } :
      { shopperId: "legacy-shopper", emailCanonical: "SHOP@EXAMPLE.INVALID", revokedAt: NOW });
    assert.equal((await h.service.create(input())).code, "EMAIL_EXISTS"); assert.equal(h.hashCalls, 0); noCreatedRecords(h);
  }
  const h = harness(); h.state.organisations.push({ id: "legacy-org", slug: "SYNTHETIC-REWARDS-SHOP" });
  assert.equal((await h.service.create(input())).code, "SLUG_EXISTS"); assert.equal(h.hashCalls, 0); noCreatedRecords(h);
});

test("plan must exist, be active, public, Retail and Retail-enabled, never a preview plan", async () => {
  for (const value of [null, { ...plan(), id: "other" }, { ...plan(), active: false }, { ...plan(), publiclyAvailable: false },
    { ...plan(), productFamily: "ONLINE" }, { ...plan(), retailRadioEnabled: false }, { ...plan(), code: "PRIVATE_PREVIEW_TESTER_V1" },
    { ...plan(), code: " private_preview_tester_v1 " }]) {
    const h = harness(); h.state.plan = value;
    assert.equal((await h.service.create(input())).code, "PLAN_UNAVAILABLE"); assert.equal(h.hashCalls, 0); noCreatedRecords(h);
  }
});

test("stored authority is rechecked before hashing and stale role, session or preview grant never creates records", async () => {
  for (const mutate of [h => { h.session.user.role = "SUPPORT"; }, h => { h.session.revokedAt = NOW; },
    h => { h.session.expiresAt = NOW; }, h => { h.session.id = "different-session"; }, h => { h.session.userId = "different-user"; },
    h => { h.session.authMethod = "SSO"; }, h => { h.session.user.privatePreviewAccess = { userId: "admin-one" }; }]) {
    const h = harness({ beforeSessionRead: ({ transaction, count, h: state }) => { if (!transaction && count === 2) mutate(state); } });
    assert.equal((await h.service.create(input())).ok, false); assert.equal(h.hashCalls, 0); noCreatedRecords(h);
  }
});

test("authority, collision and plan changes during password hashing are rejected inside the transaction", async () => {
  for (const mutate of [h => { h.session.user.role = "OWNER"; }, h => { h.session.revokedAt = NOW; }, h => { h.session.expiresAt = NOW; },
    h => { h.session.id = "changed-session"; }, h => { h.state.plan.active = false; },
    h => { h.state.users.push({ id: "racing-user", email: "SHOP@EXAMPLE.INVALID" }); },
    h => { h.state.invitations.push({ shopperId: "racing-shopper", emailCanonical: "SHOP@EXAMPLE.INVALID" }); },
    h => { h.state.organisations.push({ id: "racing-org", slug: "SYNTHETIC-REWARDS-SHOP" }); }]) {
    const h = harness({ onHash: mutate }), result = await h.service.create(input());
    assert.equal(result.ok, false); assert.equal(h.hashCalls, 1); noCreatedRecords(h);
  }
});

test("invalid injected hash or hash exception is safely rejected before transaction", async () => {
  for (const hashResult of [null, "plain text", HASH.replace("$12$", "$04$"), HASH.slice(1), `${HASH}\n`]) {
    const h = harness({ hashResult }), result = await h.service.create(input());
    assert.equal(result.code, "UNAVAILABLE"); assert.equal(h.transactions, 0); noCreatedRecords(h);
  }
  const h = harness({ hashError: true }), result = await h.service.create(input());
  assert.equal(result.code, "UNAVAILABLE"); assert.ok(!JSON.stringify(result).includes(PASSWORD));
});

test("write failures roll back all new records and never reveal raw error text", async () => {
  for (const failCreate of ["user", "organisation", "organisationMember", "subscription", "auditLog"]) {
    const h = harness({ failCreate }), result = await h.service.create(input());
    assert.equal(result.code, "UNAVAILABLE"); noCreatedRecords(h);
    assert.ok(!JSON.stringify(result).includes(PASSWORD)); assert.ok(!JSON.stringify(result).includes(HASH));
  }
});

test("P2002 races retry the complete transaction then return a safe conflict without partial records", async () => {
  const h = harness({ failCreate: "auditLog", failureCode: "P2002" }), result = await h.service.create(input());
  assert.equal(result.code, "CONFLICT"); assert.equal(h.transactions, 3); assert.equal(h.hashCalls, 1); noCreatedRecords(h);
  assert.ok(!JSON.stringify(result).includes(PASSWORD));
});

test("expiry, authority changes or runtime preview policy invalidation before commit roll everything back", async () => {
  for (const mutate of [h => { h.now = new Date(+NOW + 3_600_000); }, h => { h.session.user.role = "SUPPORT"; },
    h => { h.session.user.privatePreviewAccess.enabled = false; }, h => { h.env.RUVANAS_PRIVATE_PREVIEW_ENABLED = "0"; },
    h => { h.env.RUVANAS_PRIVATE_PREVIEW_ENABLED = "invalid"; }, h => { h.env.RUVANAS_PRIVATE_PREVIEW_ADMIN_EMAIL = "other@example.invalid"; }]) {
    const h = harness({ session: previewSession(), env: previewEnv(), beforeCreate: (model, state) => { if (model === "auditLog") mutate(state); } });
    assert.equal((await h.service.create(input())).ok, false); noCreatedRecords(h);
  }
});

test("invalid or backwards clocks fail closed and errors from session loading expose no private detail", async () => {
  const invalid = harness(); invalid.now = new Date(NaN);
  assert.equal((await invalid.service.create(input())).code, "UNAVAILABLE"); assert.equal(invalid.calls.length, 0);
  const backwards = harness({ onHash: h => { h.now = new Date(+NOW - 1); } });
  assert.equal((await backwards.service.create(input())).code, "UNAVAILABLE"); noCreatedRecords(backwards);
  const service = createOrdinaryOwnerService({ clock: () => NOW, loadSession: async () => { throw new Error(PASSWORD); } });
  const result = await service.create(input()); assert.equal(result.code, "UNAVAILABLE"); assert.ok(!JSON.stringify(result).includes(PASSWORD));
});
