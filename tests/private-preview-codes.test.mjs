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
import { PREVIEW_TESTER_PLAN, previewTesterOverrides } from "../lib/private-preview-account-policy.mjs";

const SECRET = "synthetic-preview-session-secret-32-bytes-minimum";
const NOW = new Date("2026-10-11T12:00:00.000Z");
const OWNER = { id: "owner", email: "owner@ruvanas.test", role: "SUPER_ADMIN", memberships: [] };
const OTHER_ADMIN = { id: "other-admin", email: "other@ruvanas.test", role: "SUPER_ADMIN", memberships: [] };
const SANDBOX_ID = "tester-sandbox";
const GRANT_END = new Date("2099-10-16T12:00:00.000Z");
const TESTER = {
  id: "tester", email: "tester@example.test", role: "OWNER",
  privatePreviewAccess: {
    userId: "tester", organisationId: SANDBOX_ID, enabled: true, passwordEnabled: true,
    expiresAt: GRANT_END, pillars: ["RETAIL"]
  },
  memberships: [{ organisationId: SANDBOX_ID, role: "OWNER", organisation: {
    enterpriseSecurityPolicy: null,
    subscription: {
      organisationId: SANDBOX_ID, status: "TRIAL", currentPeriodEnd: GRANT_END,
      complimentaryAccessActive: false, schoolPublicPublishingEnabled: false,
      retailMediaEnabled: false, digitalSignageEnabled: false, billingContract: null,
      plan: { ...PREVIEW_TESTER_PLAN }, ...previewTesterOverrides(["RETAIL"])
    }
  } }]
};

function policy(overrides = {}) {
  return {
    enabled: true,
    valid: true,
    adminEmail: OWNER.email,
    allowedEmails: new Set([OWNER.email]),
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
        findUnique: async ({ where, select }) => {
          assert.equal(select.privatePreviewAccess, true, "Enrollment must be freshly selected with each identity lookup");
          assert.equal(select.memberships.select.role, true);
          assert.deepEqual(select.memberships.select.organisation.select.subscription,
            { include: { plan: true, billingContract: true } });
          return snapshot.users.find((user) => user.id === where.id) || null;
        }
      },
      organisationMember: {
        count: async ({ where }) => snapshot.users.flatMap((user) => user.memberships || [])
          .filter((membership) => matches(membership, where)).length
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

test("only the named owner can issue a 24-hour, purpose-separated code for an explicitly enrolled non-admin tester", async () => {
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
  await rejectsCode(issuePrivatePreviewCode(db, {
    actorUserId: OWNER.id, targetUserId: OWNER.id, policy: policy(), secret: SECRET, now: NOW
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
  assert.deepEqual(result.user, { id: TESTER.id, email: TESTER.email, role: TESTER.role,
    privatePreviewAccess: TESTER.privatePreviewAccess });
  assert.match(result.rawSessionToken, /^[a-f0-9]{64}$/);
  assert.equal(result.expiresAt.toISOString(), "2026-11-10T12:00:01.000Z");
  assert.equal(result.activeOrganisationId, SANDBOX_ID);
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

test("SSO-only sandbox blocks code authentication; permitted password fallback stays in the same sole membership", async () => {
  const ssoOnly = { ...TESTER.memberships[0], organisation: { ...TESTER.memberships[0].organisation,
    enterpriseSecurityPolicy: { ssoRequired: true, passwordFallback: false }
  } };
  const fallback = { ...TESTER.memberships[0], organisation: { ...TESTER.memberships[0].organisation,
    enterpriseSecurityPolicy: { ssoRequired: false, passwordFallback: true }
  } };
  const db = makeDb([OWNER, { ...TESTER, memberships: [ssoOnly] }]);
  await rejectsCode(issuePrivatePreviewCode(db, {
    actorUserId: OWNER.id, targetUserId: TESTER.id, policy: policy(), secret: SECRET, now: NOW
  }), "TARGET_UNAVAILABLE");
  db.state.users.find((user) => user.id === TESTER.id).memberships = [fallback];
  const issued = await issuePrivatePreviewCode(db, {
    actorUserId: OWNER.id, targetUserId: TESTER.id, policy: policy(), secret: SECRET, now: NOW
  });
  const redeemed = await redeemPrivatePreviewCode(db, {
    code: issued.code, policy: policy(), secret: SECRET, now: NOW
  });
  assert.equal(redeemed.activeOrganisationId, SANDBOX_ID);

  const db2 = makeDb();
  const pending = await issuePrivatePreviewCode(db2, {
    actorUserId: OWNER.id, targetUserId: TESTER.id, policy: policy(), secret: SECRET, now: NOW
  });
  db2.state.users.find((user) => user.id === TESTER.id).memberships = [ssoOnly];
  await rejectsCode(redeemPrivatePreviewCode(db2, {
    code: pending.code, policy: policy(), secret: SECRET, now: NOW
  }), "INVALID_CODE");
});

test("disabling explicit tester enrollment invalidates an issued code without consuming it; owner can still revoke it", async () => {
  const db = makeDb();
  const issued = await issuePrivatePreviewCode(db, {
    actorUserId: OWNER.id, targetUserId: TESTER.id, policy: policy(), secret: SECRET, now: NOW
  });
  db.state.users.find((user) => user.id === TESTER.id).privatePreviewAccess.enabled = false;
  await rejectsCode(redeemPrivatePreviewCode(db, {
    code: issued.code, policy: policy(), secret: SECRET, now: NOW
  }), "INVALID_CODE");
  assert.equal(db.state.sessions.find((session) => session.id === issued.id).revokedAt, null);
  const revoked = await revokePrivatePreviewCodes(db, {
    actorUserId: OWNER.id, targetUserId: TESTER.id, policy: policy(), now: NOW
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

test("old pending admin codes cannot be redeemed and remain unconsumed", async () => {
  for (const target of [OWNER, OTHER_ADMIN, { ...TESTER, role: "SUPPORT" }]) {
    const db = makeDb([OWNER, { ...target, id: "legacy-target" }]);
    const code = "rvp_" + "a".repeat(48);
    db.state.sessions.push({
      id: "legacy-pending", userId: "legacy-target", tokenHash: hashPrivatePreviewCode(code, SECRET),
      authMethod: PREVIEW_CODE_PENDING_AUTH_METHOD, revokedAt: null,
      expiresAt: new Date(NOW.getTime() + 24 * 60 * 60 * 1000)
    });
    await rejectsCode(redeemPrivatePreviewCode(db, { code, policy: policy(), secret: SECRET, now: NOW }), "INVALID_CODE");
    assert.equal(db.state.sessions[0].revokedAt, null);
    assert.equal(db.state.sessions.length, 1);
    assert.equal(db.state.audits.length, 0);
  }
});

test("code issuance rejects missing, extra or foreign sandbox memberships without creating records", async () => {
  for (const memberships of [[], [
    { organisationId: "foreign-org", organisation: { enterpriseSecurityPolicy: null } }
  ], [...TESTER.memberships, {
    organisationId: "foreign-org", organisation: { enterpriseSecurityPolicy: null }
  }]]) {
    const db = makeDb([OWNER, { ...TESTER, memberships }]);
    await rejectsCode(issuePrivatePreviewCode(db, {
      actorUserId: OWNER.id, targetUserId: TESTER.id, policy: policy(), secret: SECRET, now: NOW
    }), "TARGET_UNAVAILABLE");
    assert.equal(db.state.sessions.length, 0);
    assert.equal(db.state.audits.length, 0);
  }
});

test("membership or enrollment changes after issuance cannot create a foreign or stale code session", async () => {
  for (const change of [
    (user) => { user.memberships = []; },
    (user) => { user.memberships.push({ organisationId: "foreign-org", organisation: { enterpriseSecurityPolicy: null } }); },
    (user) => { user.memberships[0].organisationId = "foreign-org"; },
    (user) => { user.privatePreviewAccess.userId = "foreign-user"; },
    (user) => { user.privatePreviewAccess.expiresAt = new Date("2020-01-01T00:00:00Z"); },
    (user) => { user.privatePreviewAccess.pillars = ["RETAIL", "RETAIL"]; },
    (user) => { user.role = "SUPER_ADMIN"; }
  ]) {
    const db = makeDb();
    const issued = await issuePrivatePreviewCode(db, {
      actorUserId: OWNER.id, targetUserId: TESTER.id, policy: policy(), secret: SECRET, now: NOW
    });
    change(db.state.users.find((user) => user.id === TESTER.id));
    await rejectsCode(redeemPrivatePreviewCode(db, {
      code: issued.code, policy: policy(), secret: SECRET, now: NOW
    }), "INVALID_CODE");
    assert.equal(db.state.sessions.find((entry) => entry.id === issued.id).revokedAt, null, change.toString());
    assert.equal(db.state.sessions.filter((entry) => entry.authMethod === PREVIEW_CODE_AUTH_METHOD).length, 0);
    assert.equal(db.state.audits.length, 1);
  }
});

test("plan, rights, period, role or shared-tenant drift blocks both issue and redemption before changing the pending code", async () => {
  const changes = [
    (db, user) => { user.memberships[0].organisation.subscription.onlineRadioEnabled = true; },
    (db, user) => { user.memberships[0].organisation.subscription.plan.licensedMusicCatalogueLevel = "FOCUSED"; },
    (db, user) => { user.memberships[0].organisation.subscription.plan.includesRuvanasCatalogue = true; },
    (db, user) => { user.memberships[0].organisation.subscription.plan.monthlyPriceCents = 1; },
    (db, user) => { user.memberships[0].organisation.subscription.billingContract = { id: "commercial-contract" }; },
    (db, user) => { user.memberships[0].organisation.subscription.complimentaryAccessActive = true; },
    (db, user) => { user.memberships[0].organisation.subscription.schoolPublicPublishingEnabled = true; },
    (db, user) => { user.memberships[0].organisation.subscription.retailMediaEnabled = true; },
    (db, user) => { user.memberships[0].organisation.subscription.digitalSignageEnabled = true; },
    (db, user) => { user.memberships[0].organisation.subscription.currentPeriodEnd = new Date(GRANT_END.getTime() + 1000); },
    (db, user) => { user.memberships[0].role = "MANAGER"; },
    (db) => { db.state.users.push({ id: "additional-member", email: "shared@example.test", role: "VIEWER",
      memberships: [{ organisationId: SANDBOX_ID, role: "VIEWER", organisation: {} }] }); }
  ];
  for (const change of changes) {
    const db = makeDb();
    const issued = await issuePrivatePreviewCode(db, {
      actorUserId: OWNER.id, targetUserId: TESTER.id, policy: policy(), secret: SECRET, now: NOW
    });
    change(db, db.state.users.find((user) => user.id === TESTER.id));
    await rejectsCode(issuePrivatePreviewCode(db, {
      actorUserId: OWNER.id, targetUserId: TESTER.id, policy: policy(), secret: SECRET, now: NOW
    }), "TARGET_UNAVAILABLE");
    await rejectsCode(redeemPrivatePreviewCode(db, {
      code: issued.code, policy: policy(), secret: SECRET, now: NOW
    }), "INVALID_CODE");
    assert.equal(db.state.sessions.length, 1, change.toString());
    assert.equal(db.state.sessions[0].revokedAt, null, change.toString());
    assert.equal(db.state.audits.length, 1, change.toString());
  }
});

test("code-only enrollment is accepted without enabling passwords and grant expiry uses the supplied operation time", async () => {
  const db = makeDb();
  db.state.users.find((user) => user.id === TESTER.id).privatePreviewAccess.passwordEnabled = false;
  const issuedAt = new Date(GRANT_END.getTime() - 30 * 1000);
  const issued = await issuePrivatePreviewCode(db, {
    actorUserId: OWNER.id, targetUserId: TESTER.id, policy: policy(), secret: SECRET, now: issuedAt
  });
  assert.ok(issued.expiresAt > GRANT_END);
  await rejectsCode(redeemPrivatePreviewCode(db, {
    code: issued.code, policy: policy(), secret: SECRET, now: GRANT_END
  }), "INVALID_CODE");
  assert.equal(db.state.sessions[0].revokedAt, null);
  assert.equal(db.state.sessions.length, 1);
  const accepted = await redeemPrivatePreviewCode(db, {
    code: issued.code, policy: policy(), secret: SECRET, now: new Date(issuedAt.getTime() + 1000)
  });
  assert.equal(accepted.activeOrganisationId, SANDBOX_ID);
  assert.equal(accepted.user.privatePreviewAccess.passwordEnabled, false);
});
