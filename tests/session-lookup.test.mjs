import assert from "node:assert/strict";
import crypto from "node:crypto";
import { test } from "node:test";
import { getSessionFromToken, hashSessionToken, SESSION_COOKIE } from "../lib/session-lookup.js";

const now = new Date("2026-10-11T12:00:00.000Z");
const secret = "synthetic-session-secret-at-least-32-characters";
const rawToken = "a".repeat(64);

function session(overrides = {}) {
  return {
    id: "session-1", userId: "user-1", user: { id: "user-1", role: "SUBSCRIBER", email: "owner@example.com" },
    createdAt: new Date("2026-10-11T10:00:00.000Z"),
    lastSeenAt: new Date("2026-10-11T11:58:00.000Z"),
    expiresAt: new Date("2026-10-12T12:00:00.000Z"),
    revokedAt: null, authMethod: "PASSWORD", activeOrganisation: null,
    ...overrides
  };
}

function mockDb(value) {
  const calls = { find: [], update: [] };
  return {
    calls,
    session: {
      findUnique: async (query) => { calls.find.push(query); return value; },
      update: async (query) => { calls.update.push(query); return value; }
    }
  };
}

async function lookup(value, db = mockDb(value)) {
  return getSessionFromToken(rawToken, { db, secret, now });
}

test("session cookie hashing and lookup preserve the existing HMAC and include shape", async () => {
  assert.equal(SESSION_COOKIE, "ruvanas_session");
  assert.equal(hashSessionToken(rawToken, secret), crypto.createHmac("sha256", secret).update(rawToken).digest("hex"));
  assert.throws(() => hashSessionToken(rawToken, "short"), /SESSION_SECRET/);
  const active = session();
  const db = mockDb(active);
  assert.equal(await lookup(active, db), active);
  assert.equal(db.calls.find.length, 1);
  assert.equal(db.calls.find[0].where.tokenHash, hashSessionToken(rawToken, secret));
  assert.equal(db.calls.find[0].include.user, true);
  assert.equal(db.calls.find[0].include.activeOrganisation.include.enterpriseSecurityPolicy, true);
  assert.equal(db.calls.update.length, 0);
  assert.equal(await getSessionFromToken(null, { db, secret, now }), null);
  assert.equal(db.calls.find.length, 1);
});

test("revocation, expiry, enterprise idle/absolute age and SSO policy remain enforced", async () => {
  const policy = { sessionMaxAgeMinutes: 180, idleTimeoutMinutes: 20, ssoRequired: false, passwordFallback: false };
  const organisation = { enterpriseSecurityPolicy: policy };
  for (const invalid of [
    null,
    session({ revokedAt: now }),
    session({ authMethod: "PREVIEW_LOGIN_CODE" }),
    session({ expiresAt: now }),
    session({ expiresAt: new Date("2026-10-11T11:59:00.000Z") }),
    session({ createdAt: new Date("2026-10-11T08:00:00.000Z"), activeOrganisation: organisation }),
    session({ lastSeenAt: new Date("2026-10-11T11:00:00.000Z"), activeOrganisation: organisation }),
    session({ activeOrganisation: { enterpriseSecurityPolicy: { ...policy, ssoRequired: true } } })
  ]) {
    const db = mockDb(invalid);
    assert.equal(await lookup(invalid, db), null);
    assert.equal(db.calls.update.length, 0);
  }
  assert.equal((await lookup(session({ authMethod: "SSO",
    activeOrganisation: { enterpriseSecurityPolicy: { ...policy, ssoRequired: true } }
  })))?.userId, "user-1");
  assert.equal((await lookup(session({ user: { id: "user-1", role: "SUPER_ADMIN", email: "owner@example.com" },
    activeOrganisation: { enterpriseSecurityPolicy: { ...policy, ssoRequired: true } }
  })))?.userId, "user-1");
});

test("idle touch happens only after five minutes and lookup errors propagate for fail-closed middleware", async () => {
  const active = session({ lastSeenAt: new Date("2026-10-11T11:54:00.000Z") });
  const db = mockDb(active);
  assert.equal(await lookup(active, db), active);
  assert.equal(db.calls.update.length, 1);
  assert.deepEqual(db.calls.update[0], { where: { id: active.id }, data: { lastSeenAt: now } });
  assert.equal(active.lastSeenAt, now);
  const broken = mockDb(active);
  broken.session.findUnique = async () => { throw new Error("synthetic DB outage"); };
  await assert.rejects(() => lookup(active, broken), /synthetic DB outage/);
});
