import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import bcrypt from "bcryptjs";
import { createShopperAuthService, hashShopperInvitationToken } from "../lib/retail-rewards/shopper-auth-service.mjs";
import { hashShopperSessionToken } from "../lib/retail-rewards/shopper-access.mjs";
import { pilotPreviewEnvironment } from "./fixtures/rewards-pilot-preview.mjs";

const NOW = new Date("2026-11-14T12:00:00Z"), TOKEN = "cd".repeat(32), SECRET = "synthetic-shopper-auth-secret-at-least32";
const PASSWORD = "A synthetic private shopper password 42";
const PASSWORD_HASH = await bcrypt.hash(PASSWORD, 12);
const ENV = { RUVANAS_RETAIL_REWARDS_ENABLED: "true", RUVANAS_RETAIL_REWARDS_SHOPPER_ENABLED: "true",
  RUVANAS_RETAIL_REWARDS_SHOPPER_AUTH_ENABLED: "true", SESSION_SECRET: SECRET };
const clone = value => structuredClone(value);
function select(row, fields) {
  if (!row) return null;
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key,
    value === true ? clone(row[key]) : select(row[key], value.select)]));
}
function fixture({ active = false } = {}) {
  const f = { env: { ...ENV }, now: NOW, calls: [], beforeTransaction: null, sessionCreated: null, credentialFailure: null };
  f.state = {
    shopper: { id: "shopper-one", status: active ? "ACTIVE" : "DISABLED", authVersion: 1, displayName: "Existing name" },
    membership: { id: "membership-one", shopperId: "shopper-one", status: "ACTIVE", source: "MANUAL_INTERNAL",
      startsAt: new Date("2026-11-01T00:00:00Z"), expiresAt: new Date("2026-12-01T00:00:00Z"), revokedAt: null, version: 1 },
    invitation: { id: "invitation-one", shopperId: "shopper-one", emailCanonical: "shopper@example.test",
      tokenHash: hashShopperInvitationToken(TOKEN, SECRET), authVersion: 1, createdAt: new Date("2026-11-14T11:00:00Z"),
      expiresAt: new Date("2026-11-15T11:00:00Z"), acceptedAt: null, revokedAt: null },
    credential: active ? { shopperId: "shopper-one", emailCanonical: "shopper@example.test", passwordHash: PASSWORD_HASH } : null,
    enrollment: { shopperId: "shopper-one", organisationId: "org-one" }, sessions: []
  };
  function client(current) {
    return {
      rewardPilotShopperEnrollment: { async findUnique({ where }) {
        f.calls.push({ kind: "pilot-enrollment-read" }); return current().enrollment?.shopperId === where.shopperId ? clone(current().enrollment) : null;
      } },
      async $queryRaw(parts, ...values) {
        const sql = parts.join("?"); f.calls.push({ kind: "lock", sql }); const s = current();
        if (sql.includes('FROM "RewardShopper"')) return s.shopper?.id === values[0] ? [{ id: s.shopper.id }] : [];
        if (sql.includes('FROM "RewardShopperMembership"')) return s.membership?.shopperId === values[0] ? [{ id: s.membership.id }] : [];
        if (sql.includes('FROM "RewardShopperInvitation"')) return s.invitation?.id === values[0] && s.invitation.shopperId === values[1] ? [{ id: s.invitation.id }] : [];
        if (sql.includes('FROM "RewardShopperCredential"')) return s.credential?.shopperId === values[0] ? [{ shopperId: s.credential.shopperId }] : [];
        throw new Error("Unexpected table access.");
      },
      rewardShopper: {
        async findUnique({ where, select: fields }) { f.calls.push({ kind: "shopper-read" }); return current().shopper?.id === where.id ? select(current().shopper, fields) : null; },
        async update({ where, data }) { assert.equal(where.id, current().shopper.id); Object.assign(current().shopper, data); f.calls.push({ kind: "shopper-write" }); }
      },
      rewardShopperMembership: { async findUnique({ where, select: fields }) {
        f.calls.push({ kind: "membership-read" }); return current().membership?.shopperId === where.shopperId ? select(current().membership, fields) : null;
      } },
      rewardShopperInvitation: {
        async findUnique({ where, select: fields }) { f.calls.push({ kind: "invitation-read" });
          return current().invitation?.tokenHash === where.tokenHash ? select(current().invitation, fields) : null; },
        async update({ where, data }) { assert.equal(where.id, current().invitation.id); Object.assign(current().invitation, data); f.calls.push({ kind: "invitation-write" }); }
      },
      rewardShopperCredential: {
        async findUnique({ where, select: fields }) {
          f.calls.push({ kind: "credential-read" }); const s = current(), c = s.credential;
          if (!c || (where.shopperId !== undefined && where.shopperId !== c.shopperId) ||
            (where.emailCanonical !== undefined && where.emailCanonical !== c.emailCanonical)) return null;
          return select({ ...c, shopper: s.shopper }, fields);
        },
        async create({ data }) { f.calls.push({ kind: "credential-write" }); if (f.credentialFailure) throw f.credentialFailure;
          assert.equal(current().credential, null); current().credential = clone(data); }
      },
      rewardShopperSession: {
        async create({ data }) { f.calls.push({ kind: "session-write" }); current().sessions.push({ id: `session-${current().sessions.length}`, revokedAt: null, ...clone(data) }); f.sessionCreated?.(); },
        async updateMany({ where, data }) { f.calls.push({ kind: "session-revoke", where: clone(where) }); let count = 0;
          for (const session of current().sessions) if (session.tokenHash === where.tokenHash && session.revokedAt === null) { Object.assign(session, clone(data)); count++; }
          return { count }; }
      }
    };
  }
  f.db = { ...client(() => f.state), async $transaction(operation, options) {
    f.calls.push({ kind: "transaction", options }); await f.beforeTransaction?.();
    const copy = clone(f.state); const result = await operation(client(() => copy)); f.state = copy; return result;
  } };
  f.service = createShopperAuthService({ db: f.db, env: f.env, clock: () => f.now });
  f.accept = extra => f.service.acceptInvite({ token: TOKEN, password: PASSWORD, ...extra });
  f.login = extra => f.service.login({ email: "shopper@example.test", password: PASSWORD, ...extra });
  return f;
}
function noActivation(f) {
  assert.equal(f.state.shopper.status, "DISABLED"); assert.equal(f.state.credential, null);
  assert.equal(f.state.invitation.acceptedAt, null); assert.equal(f.state.sessions.length, 0);
}

test("invitation tokens use a separate HMAC domain from shopper and business sessions", () => {
  const result = hashShopperInvitationToken(TOKEN, SECRET);
  assert.equal(result, createHmac("sha256", SECRET).update(`ruvanas-rewards-shopper-invitation:v1:${TOKEN}`).digest("hex"));
  assert.notEqual(result, hashShopperSessionToken(TOKEN, SECRET));
  assert.notEqual(result, createHmac("sha256", SECRET).update(TOKEN).digest("hex"));
  for (const token of [null, TOKEN.toUpperCase(), `${TOKEN} `, TOKEN.slice(1)]) assert.throws(() => hashShopperInvitationToken(token, SECRET));
  assert.throws(() => hashShopperInvitationToken(TOKEN, "short"));
});

test("disabled or invalid auth gates do no database, clock or expensive password work", async () => {
  const originalHash = bcrypt.hash, originalCompare = bcrypt.compare;
  bcrypt.hash = bcrypt.compare = () => { throw new Error("Password work forbidden"); };
  try {
    for (const env of [{}, { ...ENV, RUVANAS_RETAIL_REWARDS_SHOPPER_AUTH_ENABLED: "1" },
      { ...ENV, RUVANAS_RETAIL_REWARDS_ENABLED: "false" }, { ...ENV, RUVANAS_RETAIL_REWARDS_SHOPPER_ENABLED: "false" }]) {
      const service = createShopperAuthService({ env, clock() { throw new Error("Clock forbidden"); }, db: new Proxy({}, { get() { throw new Error("DB forbidden"); } }) });
      assert.equal((await service.acceptInvite({ token: TOKEN, password: PASSWORD })).code, "FEATURE_DISABLED");
      assert.equal((await service.login({ email: "shopper@example.test", password: PASSWORD })).code, "FEATURE_DISABLED");
      assert.equal((await service.logout({ token: TOKEN })).code, "FEATURE_DISABLED");
    }
  } finally { bcrypt.hash = originalHash; bcrypt.compare = originalCompare; }
});

test("malformed input cannot supply an email, shopper identity, role or membership to an invitation", async () => {
  const f = fixture();
  for (const extra of [{ email: "other@example.test" }, { shopperId: "other" }, { role: "SUPER_ADMIN" }, { membership: "PAID" },
    { password: "short" }, { password: "😀".repeat(19) }, { password: `${PASSWORD}\0` }, { password: `${PASSWORD}\ud800` }]) {
    assert.equal((await f.accept(extra)).code, "INVALID_REQUEST");
  }
  assert.equal(f.calls.length, 0); noActivation(f);
});

test("acceptance atomically binds the preassigned email, consumes invitation, activates and issues only a hashed finite shopper session", async () => {
  const f = fixture(); f.state.membership.expiresAt = new Date(NOW.getTime() + 3600_000);
  const result = await f.accept({ displayName: "  Shopper name  " });
  assert.equal(result.ok, true); assert.match(result.rawSessionToken, /^[a-f0-9]{64}$/); assert.equal(result.expiresAt.toISOString(), f.state.membership.expiresAt.toISOString());
  assert.equal(f.state.shopper.status, "ACTIVE"); assert.equal(f.state.shopper.displayName, "Shopper name"); assert.equal(f.state.shopper.authVersion, 1);
  assert.equal(f.state.credential.emailCanonical, "shopper@example.test"); assert.match(f.state.credential.passwordHash, /^\$2[ab]\$12\$/);
  assert.equal(await bcrypt.compare(PASSWORD, f.state.credential.passwordHash), true);
  assert.equal(f.state.invitation.acceptedAt.getTime(), NOW.getTime()); assert.equal(f.state.sessions.length, 1);
  assert.equal(f.state.sessions[0].tokenHash, hashShopperSessionToken(result.rawSessionToken, SECRET));
  assert.equal(f.state.sessions[0].authVersion, 1); assert.equal(f.state.sessions[0].createdAt.getTime(), NOW.getTime());
  assert.ok(!JSON.stringify(f.state).includes(result.rawSessionToken)); assert.ok(!JSON.stringify(f.state).includes(TOKEN)); assert.ok(!JSON.stringify(f.state).includes(PASSWORD));
  const locks = f.calls.filter(c => c.kind === "lock").map(c => c.sql);
  assert.match(locks[0], /RewardShopper".*FOR UPDATE/); assert.match(locks[1], /RewardShopperMembership.*FOR SHARE/); assert.match(locks[2], /RewardShopperInvitation/);
  assert.deepEqual(f.calls.find(c => c.kind === "transaction").options, { isolationLevel: "Serializable" });
  const replay = await f.accept(); assert.equal(replay.code, "INVITATION_UNAVAILABLE"); assert.equal(f.state.sessions.length, 1);
});

test("missing, used, revoked, future, expired and overlong invitations share one safe result", async () => {
  const changes = [f => { f.state.invitation = null; }, f => { f.state.invitation.acceptedAt = NOW; },
    f => { f.state.invitation.revokedAt = NOW; }, f => { f.state.invitation.createdAt = new Date(NOW.getTime() + 1); },
    f => { f.state.invitation.expiresAt = NOW; }, f => { f.state.invitation.expiresAt = new Date("2026-11-16T12:00:00Z"); },
    f => { f.state.invitation.emailCanonical = "UPPER@example.test"; }];
  let expected;
  for (const change of changes) {
    const f = fixture(); change(f); const result = await f.accept(); assert.equal(result.code, "INVITATION_UNAVAILABLE");
    expected ??= result; assert.deepEqual(result, expected); assert.equal(f.state.sessions.length, 0);
    assert.equal(f.calls.some(c => c.kind === "transaction"), false);
  }
});

test("acceptance denies changes to invitation, shopper and membership after password hashing", async () => {
  const changes = [s => { s.invitation.revokedAt = NOW; }, s => { s.invitation.authVersion++; }, s => { s.shopper.authVersion++; },
    s => { s.shopper.status = "SUSPENDED"; }, s => { s.membership.revokedAt = NOW; }, s => { s.membership.expiresAt = NOW; },
    s => { s.membership.source = "PAID"; }, s => { s.membership = null; }];
  for (const change of changes) {
    const f = fixture(); f.beforeTransaction = () => change(f.state);
    assert.equal((await f.accept()).code, "INVITATION_UNAVAILABLE"); assert.equal(f.state.sessions.length, 0);
    assert.equal(f.state.credential, null); assert.equal(f.state.invitation.acceptedAt, null);
  }
});

test("unique email collisions roll back activation and are not auto-merged with any account", async () => {
  const f = fixture(); f.credentialFailure = Object.assign(new Error("email and internal details"), { code: "P2002" });
  const result = await f.accept(); assert.equal(result.code, "INVITATION_UNAVAILABLE"); noActivation(f);
  assert.equal(f.calls.filter(c => c.kind === "transaction").length, 3); assert.ok(!JSON.stringify(result).includes("internal"));
});

test("membership or invitation expiry during final writes rolls back every acceptance change", async () => {
  for (const field of ["membership", "invitation"]) {
    const f = fixture(); f.state[field].expiresAt = new Date(NOW.getTime() + 1000);
    f.sessionCreated = () => { f.now = new Date(NOW.getTime() + 1000); };
    assert.equal((await f.accept()).code, "INVITATION_UNAVAILABLE"); noActivation(f);
  }
});

test("gate closure before commit rolls back acceptance and configuration failures reveal no details", async () => {
  const f = fixture(); f.sessionCreated = () => { f.env.RUVANAS_RETAIL_REWARDS_SHOPPER_AUTH_ENABLED = "false"; };
  assert.equal((await f.accept()).code, "FEATURE_DISABLED"); noActivation(f);
  const g = fixture(); g.env.SESSION_SECRET = "short"; const result = await g.accept(); assert.equal(result.code, "UNAVAILABLE"); assert.equal(g.calls.length, 0);
  const h = fixture(); h.db.rewardShopperInvitation.findUnique = async () => { throw new Error("private database connection"); };
  assert.equal((await h.accept()).code, "UNAVAILABLE"); assert.ok(!JSON.stringify(await h.accept()).includes("private database"));
});

test("login canonicalises only email and creates a new independent shopper session capped at 24 hours", async () => {
  const f = fixture({ active: true }); const result = await f.login({ email: " SHOPPER@EXAMPLE.TEST " });
  assert.equal(result.ok, true); assert.equal(result.expiresAt - NOW, 86400_000); assert.equal(f.state.sessions.length, 1);
  assert.equal(f.state.sessions[0].tokenHash, hashShopperSessionToken(result.rawSessionToken, SECRET));
  assert.equal(f.state.credential.passwordHash, PASSWORD_HASH); assert.equal(f.state.shopper.authVersion, 1);
  assert.equal(f.calls.filter(c => /shopper-write|credential-write|invitation-write/.test(c.kind)).length, 0);
});

test("missing, wrong-password, disabled and unsupported-hash sign-ins share generic failure and cost-12 comparisons", async () => {
  const cases = [f => { f.state.credential = null; }, f => { f.state.shopper.status = "DISABLED"; },
    f => { f.state.credential.passwordHash = "$2a$31$malformed"; }, f => { f.state.credential.passwordHash = "$2a$04$" + "a".repeat(53); }];
  const original = bcrypt.compare, hashes = [];
  bcrypt.compare = async (password, hash) => { hashes.push(hash); return original(password, hash); };
  try {
    let expected;
    for (const change of cases) {
      const f = fixture({ active: true }); change(f); const result = await f.login();
      assert.equal(result.code, "AUTH_FAILED"); expected ??= result; assert.deepEqual(result, expected); assert.equal(f.state.sessions.length, 0);
    }
    const wrong = fixture({ active: true }); assert.deepEqual(await wrong.login({ password: "A different synthetic private password" }), expected);
    const dummy = fixture({ active: true }); dummy.state.credential = null;
    assert.deepEqual(await dummy.login({ password: "synthetic-not-a-real-shopper-password" }), expected);
    assert.equal(hashes.length, 6); hashes.forEach(hash => assert.match(hash, /^\$2[ab]\$12\$[./A-Za-z0-9]{53}$/));
  } finally { bcrypt.compare = original; }
});

test("login rechecks credential hash, shopper version/status and active internal membership after comparison", async () => {
  const changes = [s => { s.credential.passwordHash = "$2a$12$" + "a".repeat(53); }, s => { s.shopper.authVersion++; },
    s => { s.shopper.status = "SUSPENDED"; }, s => { s.membership.revokedAt = NOW; }, s => { s.membership.expiresAt = NOW; },
    s => { s.membership.source = "PAID"; }];
  for (const change of changes) {
    const f = fixture({ active: true }); f.beforeTransaction = () => change(f.state);
    assert.equal((await f.login()).code, "AUTH_FAILED"); assert.equal(f.state.sessions.length, 0);
  }
});

test("login never commits a session whose membership expires during final writes", async () => {
  const f = fixture({ active: true }); f.state.membership.expiresAt = new Date(NOW.getTime() + 1000);
  f.sessionCreated = () => { f.now = new Date(NOW.getTime() + 1000); };
  assert.equal((await f.login()).code, "AUTH_FAILED"); assert.equal(f.state.sessions.length, 0);
});

test("expired sessions can be signed out idempotently without affecting another shopper or business identity", async () => {
  const f = fixture({ active: true }), token = "ef".repeat(32), other = "ab".repeat(32);
  f.state.sessions = [{ id: "expired", tokenHash: hashShopperSessionToken(token, SECRET), expiresAt: new Date(NOW - 1000), revokedAt: null },
    { id: "other", tokenHash: hashShopperSessionToken(other, SECRET), revokedAt: null }];
  assert.deepEqual(await f.service.logout({ token }), { ok: true }); assert.deepEqual(await f.service.logout({ token }), { ok: true });
  assert.equal(f.state.sessions[0].revokedAt.getTime(), NOW.getTime()); assert.equal(f.state.sessions[1].revokedAt, null);
  assert.deepEqual(f.calls[0].where, { tokenHash: hashShopperSessionToken(token, SECRET), revokedAt: null });
  assert.equal(f.state.shopper.authVersion, 1); assert.equal(f.calls.every(c => c.kind === "session-revoke"), true);
});

test("absent/malformed logout tokens are no-ops and a failed revoke does not report success", async () => {
  const f = fixture(); f.env.SESSION_SECRET = "short";
  for (const token of [undefined, "", "business-cookie", TOKEN.toUpperCase()]) assert.deepEqual(await f.service.logout({ token }), { ok: true });
  assert.equal(f.calls.length, 0);
  const g = fixture(); g.db.rewardShopperSession.updateMany = async () => { throw new Error("storage secret"); };
  const result = await g.service.logout({ token: TOKEN }); assert.equal(result.code, "UNAVAILABLE"); assert.ok(!JSON.stringify(result).includes("storage"));
});

test("private preview admits invitation and password login only for an enrolled shopper in the enabled pilot", async () => {
  const f = fixture(); Object.assign(f.env, pilotPreviewEnvironment());
  assert.equal((await f.accept()).ok, true);
  assert.equal((await f.login()).ok, true);
  assert.equal(f.state.sessions.length, 2);
  for (const enrolled of [null, { shopperId: "shopper-one", organisationId: "foreign-org" }]) {
    const invite = fixture(); Object.assign(invite.env, pilotPreviewEnvironment()); invite.state.enrollment = enrolled;
    assert.equal((await invite.accept()).code, "INVITATION_UNAVAILABLE"); noActivation(invite);
    const login = fixture({ active: true }); Object.assign(login.env, pilotPreviewEnvironment()); login.state.enrollment = enrolled;
    assert.equal((await login.login()).code, "AUTH_FAILED"); assert.equal(login.state.sessions.length, 0);
  }
});

test("pilot removal during hashing or before commit rolls back shopper access rather than creating an unscoped session", async () => {
  for (const operation of ["accept", "login"]) for (const stage of ["beforeTransaction", "sessionCreated"]) {
    const f = fixture({ active: operation === "login" }); Object.assign(f.env, pilotPreviewEnvironment());
    f[stage] = () => { f.env.RUVANAS_RETAIL_REWARDS_PILOT_ORGANISATION_IDS = '["different-org"]'; };
    assert.equal((await f[operation]()).code, operation === "accept" ? "INVITATION_UNAVAILABLE" : "AUTH_FAILED");
    assert.equal(f.state.sessions.length, 0);
    if (operation === "accept") noActivation(f);
  }
});
