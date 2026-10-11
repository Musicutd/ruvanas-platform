import assert from "node:assert/strict";
import { test } from "node:test";
import {
  hashPrivatePreviewCode,
  issuePrivatePreviewCode,
  PREVIEW_CODE_AUTH_METHOD,
  PREVIEW_CODE_PENDING_AUTH_METHOD,
  redeemPrivatePreviewCode,
  revokePrivatePreviewCodes
} from "../lib/private-preview-codes.mjs";
import { hashSessionToken } from "../lib/session-lookup.js";

const SECRET = "synthetic-preview-session-secret-32-bytes-minimum";
const NOW = new Date("2026-10-11T12:00:00.000Z");
const OWNER = { id: "owner", email: "owner@ruvanas.test", role: "SUPER_ADMIN", memberships: [] };
const OTHER_ADMIN = { id: "other-admin", email: "other@ruvanas.test", role: "SUPER_ADMIN", memberships: [] };
const TESTER = { id: "tester", email: "tester@example.test", role: "VIEWER", memberships: [] };

function policy(overrides = {}) {
  return {
    enabled: true,
    valid: true,
    adminEmail: OWNER.email,
    allowedEmails: new Set([OWNER.email, TESTER.email]),
    ...overrides
  };
}

function makeDb(users = [OWNER, OTHER_ADMIN, TESTER]) {
  let state = { users: structuredClone(users), sessions: [], audits: [] };
  let queue = Promise.resolve();
  let failNextAudit = false;
  const transactionOptions = [];

  function matches(row, where) {
    return Object.entries(where).every(([key, expected]) => {
      if (expected && typeof expected === "object" && !(expected instanceof Date)) {
        if (Object.hasOwn(expected, "gt")) return row[key] > expected.gt;
        throw new Error(`Unexpected mock filter: ${key}`);
      }
      return row[key] === expected;
    });
  }

  function tables(snapshot) {
    return {
      user: {
        findUnique: async ({ where }) => snapshot.users.find((user) => user.id === where.id) || null
      },
      session: {
        findUnique: async ({ where }) => snapshot.sessions.find((session) => session.tokenHash === where.tokenHash) || null,
        updateMany: async ({ where, data }) => {
          const rows = snapshot.sessions.filter((session) => matches(session, where));
          for (const row of rows) Object.assign(row, data);
          return { count: rows.length };
        },
        create: async ({ data }) => {
          if (!snapshot.users.some((user) => user.id === data.userId)) throw new Error("Mock user FK failed");
          if (snapshot.sessions.some((session) => session.tokenHash === data.tokenHash)) throw new Error("Mock unique hash failed");
          const created = { id: `session-${snapshot.sessions.length + 1}`, revokedAt: null, ...data };
          snapshot.sessions.push(created);
          return created;
        }
      },
      auditLog: {
        create: async ({ data }) => {
          if (failNextAudit) {
            failNextAudit = false;
            throw new Error("Synthetic audit failure");
          }
          snapshot.audits.push(data);
          return data;
        }
      }
    };
  }

  const db = {
    get state() { return state; },
    transactionOptions,
    failOneAudit() { failNextAudit = true; },
    $transaction(operation, options) {
      transactionOptions.push(options);
      const pending = queue.then(async () => {
        const snapshot = structuredClone(state);
        const result = await operation(tables(snapshot));
        state = snapshot;
        return result;
      });
      queue = pending.catch(() => {});
      return pending;
    }
  };
  return db;
}

async function rejectsCode(promise, code) {
  await assert.rejects(promise, (error) => error.code === code && !/rvp_/.test(error.message));
}

test("only the named owner can issue a 24-hour, purpose-separated code for an existing allowlisted user", async () => {
  const db = makeDb();
  await rejectsCode(issuePrivatePreviewCode(db, {
    actorUserId: OTHER_ADMIN.id, targetUserId: TESTER.id, policy: policy(), secret: SECRET, now: NOW
  }), "FORBIDDEN");
  await rejectsCode(issuePrivatePreviewCode(db, {
    actorUserId: TESTER.id, targetUserId: TESTER.id, policy: policy(), secret: SECRET, now: NOW
  }), "FORBIDDEN");
  await rejectsCode(issuePrivatePreviewCode(db, {
    actorUserId: OWNER.id, targetUserId: OTHER_ADMIN.id, policy: policy(), secret: SECRET, now: NOW
  }), "TARGET_UNAVAILABLE");
  assert.equal(db.state.sessions.length, 0);

  const issued = await issuePrivatePreviewCode(db, {
    actorUserId: OWNER.id, targetUserId: TESTER.id, policy: policy(), secret: SECRET, now: NOW
  });
  assert.match(issued.code, /^rvp_[a-f0-9]{48}$/);
  assert.equal(issued.expiresAt.toISOString(), "2026-10-12T12:00:00.000Z");
  assert.deepEqual(issued.user, { id: TESTER.id, email: TESTER.email });
  const pending = db.state.sessions[0];
  assert.equal(pending.authMethod, PREVIEW_CODE_PENDING_AUTH_METHOD);
  assert.equal(pending.tokenHash, hashPrivatePreviewCode(issued.code, SECRET));
  assert.notEqual(pending.tokenHash, hashSessionToken(issued.code, SECRET));
  assert.doesNotMatch(JSON.stringify(db.state.audits), /rvp_|private-preview-code:v1:|[a-f0-9]{64}/);
  assert.ok(db.transactionOptions.every(({ isolationLevel }) => isolationLevel === "Serializable"));
});

test("new issue revokes older pending codes without touching password sessions", async () => {
  const db = makeDb();
  db.state.sessions.push({ id: "password", userId: TESTER.id, authMethod: "PASSWORD", revokedAt: null,
    tokenHash: "normal-session", expiresAt: new Date("2026-11-11T12:00:00.000Z") });
  const first = await issuePrivatePreviewCode(db, {
    actorUserId: OWNER.id, targetUserId: TESTER.id, policy: policy(), secret: SECRET, now: NOW
  });
  await issuePrivatePreviewCode(db, {
    actorUserId: OWNER.id, targetUserId: TESTER.id, policy: policy(), secret: SECRET,
    now: new Date(NOW.getTime() + 1000)
  });
  assert.ok(db.state.sessions.find((session) => session.id === first.id).revokedAt);
  await rejectsCode(redeemPrivatePreviewCode(db, {
    code: first.code, policy: policy(), secret: SECRET, now: new Date(NOW.getTime() + 2000)
  }), "INVALID_CODE");
  assert.equal(db.state.sessions.find((session) => session.id === "password").revokedAt, null);
});

test("redemption atomically claims one pending code and creates a normal revocable preview session", async () => {
  const db = makeDb();
  const issued = await issuePrivatePreviewCode(db, {
    actorUserId: OWNER.id, targetUserId: TESTER.id, policy: policy(), secret: SECRET, now: NOW
  });
  const result = await redeemPrivatePreviewCode(db, {
    code: issued.code, policy: policy(), secret: SECRET, now: new Date(NOW.getTime() + 1000)
  });
  assert.deepEqual(result.user, { id: TESTER.id, email: TESTER.email, role: TESTER.role });
  assert.match(result.rawSessionToken, /^[a-f0-9]{64}$/);
  assert.equal(result.expiresAt.toISOString(), "2026-11-10T12:00:01.000Z");
  assert.equal(result.activeOrganisationId, null);
  const auth = db.state.sessions.find((session) => session.authMethod === PREVIEW_CODE_AUTH_METHOD);
  assert.equal(auth.tokenHash, hashSessionToken(result.rawSessionToken, SECRET));
  assert.equal(db.state.sessions.find((session) => session.id === issued.id).revokedAt.toISOString(),
    "2026-10-11T12:00:01.000Z");
  assert.doesNotMatch(JSON.stringify(db.state.audits), /rvp_|private-preview-code:v1:/);
  await rejectsCode(redeemPrivatePreviewCode(db, {
    code: issued.code, policy: policy(), secret: SECRET, now: new Date(NOW.getTime() + 2000)
  }), "INVALID_CODE");
});

test("concurrent redemption has exactly one winner; malformed and expired codes fail generically", async () => {
  const db = makeDb();
  const issued = await issuePrivatePreviewCode(db, {
    actorUserId: OWNER.id, targetUserId: TESTER.id, policy: policy(), secret: SECRET, now: NOW
  });
  await rejectsCode(redeemPrivatePreviewCode(db, {
    code: "rvp_not-a-code", policy: policy(), secret: SECRET, now: NOW
  }), "INVALID_CODE");
  await rejectsCode(redeemPrivatePreviewCode(db, {
    code: issued.code, policy: policy(), secret: SECRET,
    now: new Date(NOW.getTime() + 24 * 60 * 60 * 1000)
  }), "INVALID_CODE");
  const attempts = await Promise.allSettled([0, 1].map(() => redeemPrivatePreviewCode(db, {
    code: issued.code, policy: policy(), secret: SECRET, now: new Date(NOW.getTime() + 1000)
  })));
  assert.equal(attempts.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(attempts.filter((result) => result.status === "rejected" && result.reason.code === "INVALID_CODE").length, 1);
  assert.equal(db.state.sessions.filter((session) => session.authMethod === PREVIEW_CODE_AUTH_METHOD).length, 1);
});

test("owner revocation stops pending and code-auth sessions but preserves unrelated sessions", async () => {
  const db = makeDb();
  db.state.sessions.push({ id: "password", userId: TESTER.id, authMethod: "PASSWORD", revokedAt: null,
    tokenHash: "normal-session", expiresAt: new Date("2026-11-11T12:00:00.000Z") });
  const issued = await issuePrivatePreviewCode(db, {
    actorUserId: OWNER.id, targetUserId: TESTER.id, policy: policy(), secret: SECRET, now: NOW
  });
  await rejectsCode(revokePrivatePreviewCodes(db, {
    actorUserId: OTHER_ADMIN.id, targetUserId: TESTER.id, policy: policy(), now: NOW
  }), "FORBIDDEN");
  const stopped = await revokePrivatePreviewCodes(db, {
    actorUserId: OWNER.id, targetUserId: TESTER.id, policy: policy(), now: NOW
  });
  assert.deepEqual(stopped, { pendingRevokedCount: 1, sessionsRevokedCount: 0 });
  await rejectsCode(redeemPrivatePreviewCode(db, {
    code: issued.code, policy: policy(), secret: SECRET, now: NOW
  }), "INVALID_CODE");
  assert.equal(db.state.sessions.find((session) => session.id === "password").revokedAt, null);

  const second = await issuePrivatePreviewCode(db, {
    actorUserId: OWNER.id, targetUserId: TESTER.id, policy: policy(), secret: SECRET,
    now: new Date(NOW.getTime() + 1000)
  });
  await redeemPrivatePreviewCode(db, {
    code: second.code, policy: policy(), secret: SECRET, now: new Date(NOW.getTime() + 2000)
  });
  const stoppedAgain = await revokePrivatePreviewCodes(db, {
    actorUserId: OWNER.id, targetUserId: TESTER.id, policy: policy(), now: new Date(NOW.getTime() + 3000)
  });
  assert.equal(stoppedAgain.sessionsRevokedCount, 1);
  assert.equal(db.state.sessions.find((session) => session.id === "password").revokedAt, null);
});

test("SSO-only membership blocks code authentication; eligible membership remains scoped", async () => {
  const ssoOnly = { organisationId: "sso", organisation: {
    enterpriseSecurityPolicy: { ssoRequired: true, passwordFallback: false }
  } };
  const fallback = { organisationId: "fallback", organisation: {
    enterpriseSecurityPolicy: { ssoRequired: false, passwordFallback: true }
  } };
  const db = makeDb([OWNER, { ...TESTER, memberships: [ssoOnly] }]);
  await rejectsCode(issuePrivatePreviewCode(db, {
    actorUserId: OWNER.id, targetUserId: TESTER.id, policy: policy(), secret: SECRET, now: NOW
  }), "TARGET_AUTH_POLICY");
  db.state.users.find((user) => user.id === TESTER.id).memberships.push(fallback);
  const issued = await issuePrivatePreviewCode(db, {
    actorUserId: OWNER.id, targetUserId: TESTER.id, policy: policy(), secret: SECRET, now: NOW
  });
  const redeemed = await redeemPrivatePreviewCode(db, {
    code: issued.code, policy: policy(), secret: SECRET, now: NOW
  });
  assert.equal(redeemed.activeOrganisationId, "fallback");

  const db2 = makeDb();
  const pending = await issuePrivatePreviewCode(db2, {
    actorUserId: OWNER.id, targetUserId: TESTER.id, policy: policy(), secret: SECRET, now: NOW
  });
  db2.state.users.find((user) => user.id === TESTER.id).memberships.push(ssoOnly);
  await rejectsCode(redeemPrivatePreviewCode(db2, {
    code: pending.code, policy: policy(), secret: SECRET, now: NOW
  }), "INVALID_CODE");
});

test("removing a target from the preview allowlist invalidates an issued code without consuming it", async () => {
  const db = makeDb();
  const issued = await issuePrivatePreviewCode(db, {
    actorUserId: OWNER.id, targetUserId: TESTER.id, policy: policy(), secret: SECRET, now: NOW
  });
  const ownerOnly = policy({ allowedEmails: new Set([OWNER.email]) });
  await rejectsCode(redeemPrivatePreviewCode(db, {
    code: issued.code, policy: ownerOnly, secret: SECRET, now: NOW
  }), "INVALID_CODE");
  assert.equal(db.state.sessions.find((session) => session.id === issued.id).revokedAt, null);
  const revoked = await revokePrivatePreviewCodes(db, {
    actorUserId: OWNER.id, targetUserId: TESTER.id, policy: ownerOnly, now: NOW
  });
  assert.equal(revoked.pendingRevokedCount, 1);
});

test("transaction rollback leaves a code redeemable when session/audit creation fails", async () => {
  const db = makeDb();
  const issued = await issuePrivatePreviewCode(db, {
    actorUserId: OWNER.id, targetUserId: TESTER.id, policy: policy(), secret: SECRET, now: NOW
  });
  db.failOneAudit();
  await rejectsCode(redeemPrivatePreviewCode(db, {
    code: issued.code, policy: policy(), secret: SECRET, now: NOW
  }), "PREVIEW_UNAVAILABLE");
  assert.equal(db.state.sessions.find((session) => session.id === issued.id).revokedAt, null);
  assert.equal(db.state.sessions.filter((session) => session.authMethod === PREVIEW_CODE_AUTH_METHOD).length, 0);
  await redeemPrivatePreviewCode(db, {
    code: issued.code, policy: policy(), secret: SECRET, now: NOW
  });
});

test("disabled or invalid preview policy fails before any code table work", async () => {
  const db = makeDb();
  await rejectsCode(issuePrivatePreviewCode(db, {
    actorUserId: OWNER.id, targetUserId: TESTER.id, policy: policy({ enabled: false }), secret: SECRET
  }), "PREVIEW_UNAVAILABLE");
  await rejectsCode(redeemPrivatePreviewCode(db, {
    code: "rvp_" + "a".repeat(48), policy: policy({ valid: false }), secret: SECRET
  }), "PREVIEW_UNAVAILABLE");
  assert.equal(db.transactionOptions.length, 0);
});
