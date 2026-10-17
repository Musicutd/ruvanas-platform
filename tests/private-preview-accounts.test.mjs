import assert from "node:assert/strict";
import { test } from "node:test";
import bcrypt from "bcryptjs";
import {
  authenticatePreviewPassword, createPreviewTester, establishPreviewOwnerPassword,
  listPreviewTesters, PREVIEW_PASSWORD_AUTH_METHOD, PREVIEW_TESTER_LIMIT,
  updatePreviewTester, validatePreviewPassword
} from "../lib/private-preview-accounts.mjs";
import {
  assertPreviewTesterState, isPreviewTesterPlan, normalizePreviewTesterAccessMode,
  PREVIEW_ONLINE_DRAFT_PLAN, PREVIEW_ONLINE_DRAFT_PLAN_CODE, PREVIEW_TESTER_PLAN,
  previewTesterAccessMode
} from "../lib/private-preview-account-policy.mjs";

const NOW = new Date("2026-10-15T10:00:00Z");
const SECRET = "synthetic-private-preview-session-secret-at-least-32-characters";
const PASSWORD = "Synthetic-test-password-2026";
const policy = { enabled: true, valid: true, adminEmail: "owner@example.test",
  allowedEmails: new Set(["owner@example.test"]) };
const owner = { id: "owner", email: policy.adminEmail, role: "SUPER_ADMIN", name: "Owner",
  passwordHash: bcrypt.hashSync("Discarded-bootstrap-password-123", 4) };

function matches(row, where = {}) {
  return Object.entries(where).every(([key, wanted]) => {
    if (wanted && typeof wanted === "object" && !(wanted instanceof Date)) {
      if (Object.hasOwn(wanted, "not")) return row[key] !== wanted.not;
      if (Object.hasOwn(wanted, "gt")) return row[key] > wanted.gt;
      throw new Error(`Unexpected mock matcher ${key}`);
    }
    return row[key] === wanted;
  });
}

function database() {
  let state = { user: [structuredClone(owner)], plan: [], organisation: [], organisationMember: [],
    subscription: [], privatePreviewAccess: [], session: [], passwordResetToken: [], auditLog: [] };
  let queue = Promise.resolve();
  let failAudit = false;
  const options = [];
  function tables(snapshot) {
    function userView(row) {
      if (!row) return null;
      return { ...row,
        privatePreviewAccess: snapshot.privatePreviewAccess.find((entry) => entry.userId === row.id) || null,
        memberships: snapshot.organisationMember.filter((entry) => entry.userId === row.id).map((entry) => {
          const organisation = snapshot.organisation.find((record) => record.id === entry.organisationId);
          const subscription = snapshot.subscription.find((record) => record.organisationId === entry.organisationId);
          return { ...entry, organisation: { ...organisation, enterpriseSecurityPolicy: null,
            subscription: subscription ? { ...subscription, billingContract: null,
              plan: snapshot.plan.find((record) => record.id === subscription.planId) } : null } };
        })
      };
    }
    const result = {};
    for (const name of Object.keys(snapshot)) {
      const decorate = (row) => name === "user" ? userView(row) : row;
      result[name] = {
        findUnique: async ({ where }) => decorate(snapshot[name].find((row) => matches(row, where))) || null,
        count: async ({ where } = {}) => snapshot[name].filter((row) => matches(row, where)).length,
        findMany: async ({ where, take } = {}) => snapshot[name].filter((row) => matches(row, where))
          .slice(0, take).map((row) => name === "privatePreviewAccess"
            ? { ...row, user: userView(snapshot.user.find((entry) => entry.id === row.userId)) } : decorate(row)),
        create: async ({ data }) => {
          if (name === "auditLog" && failAudit) { failAudit = false; throw new Error("Synthetic audit failure"); }
          const created = { id: `${name}-${snapshot[name].length + 1}`, revokedAt: null, usedAt: null, ...data };
          snapshot[name].push(created);
          return decorate(created);
        },
        update: async ({ where, data }) => {
          const row = snapshot[name].find((entry) => matches(entry, where));
          if (!row) throw new Error("Mock row absent");
          Object.assign(row, data);
          return decorate(row);
        },
        updateMany: async ({ where, data }) => {
          const rows = snapshot[name].filter((entry) => matches(entry, where));
          rows.forEach((row) => Object.assign(row, data));
          return { count: rows.length };
        },
        upsert: async ({ where, create, update }) => {
          const existing = snapshot[name].find((entry) => matches(entry, where));
          if (existing) { Object.assign(existing, update); return existing; }
          return result[name].create({ data: create });
        }
      };
    }
    return result;
  }
  const db = {
    get state() { return state; }, options,
    failNextAudit() { failAudit = true; },
    $transaction(operation, config) {
      options.push(config);
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
  for (const name of Object.keys(state)) {
    db[name] = Object.fromEntries(Object.keys(tables(state)[name]).map((method) =>
      [method, (...args) => tables(state)[name][method](...args)]));
  }
  return db;
}

function create(db, overrides = {}) {
  return createPreviewTester(db, { actorUserId: owner.id, policy, email: "tester@example.test",
    name: "Preview Tester", password: PASSWORD, pillars: ["SCHOOL", "ONLINE"], now: NOW, ...overrides });
}

async function rejects(promise, code) {
  await assert.rejects(promise, (error) => error.code === code && error.message === code);
}

function bootstrapSession(db, overrides = {}) {
  const session = { id: "owner-bootstrap", userId: owner.id, authMethod: "PREVIEW_CODE", revokedAt: null,
    expiresAt: new Date("2026-10-16T10:00:00Z"), ...overrides };
  db.state.session.push(session);
  return session;
}

test("password bounds account for bcrypt UTF-8 byte truncation without returning the password", () => {
  assert.deepEqual(validatePreviewPassword("x".repeat(12)), { ok: true });
  assert.deepEqual(validatePreviewPassword("x".repeat(72)), { ok: true });
  for (const input of [undefined, 123, "x".repeat(11), "x".repeat(73), "🔐".repeat(19)]) {
    assert.equal(validatePreviewPassword(input).ok, false);
    assert.doesNotMatch(JSON.stringify(validatePreviewPassword(input)), /password"\s*:/);
  }
  assert.equal(validatePreviewPassword("🔐".repeat(18)).ok, true);
});

test("owner creates isolated multi-pillar tester with zero-cost hidden plan and no music/publication rights", async () => {
  const db = database();
  const created = await create(db);
  assert.deepEqual(created.pillars, ["SCHOOL", "ONLINE"]);
  assert.equal(created.accessMode, "READ_ONLY");
  assert.equal(created.email, "tester@example.test");
  assert.equal(created.expiresAt.toISOString(), "2026-11-14T10:00:00.000Z");
  assert.equal(db.state.user.length, 2);
  assert.equal(db.state.organisation.length, 1);
  assert.equal(db.state.organisationMember[0].userId, created.id);
  assert.equal(db.state.organisationMember[0].role, "OWNER");
  assert.equal(db.state.user[1].role, "OWNER");
  assert.equal(await bcrypt.compare(PASSWORD, db.state.user[1].passwordHash), true);
  const plan = db.state.plan[0];
  assert.equal(plan.monthlyPriceCents, 0);
  assert.equal(plan.publiclyAvailable, false);
  assert.equal(plan.licensedMusicCatalogueLevel, "NONE");
  for (const key of ["includesRuvanasCatalogue", "schoolPublicPublishingEnabled", "promoUploadEnabled",
    "retailRadioEnabled", "schoolRadioEnabled", "onlineRadioEnabled", "correctionsRadioEnabled"]) {
    assert.equal(plan[key], false);
  }
  assert.equal(db.state.subscription[0].schoolRadioEnabled, true);
  assert.equal(db.state.subscription[0].onlineRadioEnabled, true);
  assert.equal(db.state.subscription[0].healthRadioEnabled, false);
  assert.equal(db.state.subscription[0].schoolPublicPublishingEnabled, false);
  assert.doesNotMatch(JSON.stringify(created), /passwordHash|token|Synthetic-test|\$2[ab]\$/i);
  assert.doesNotMatch(JSON.stringify(db.state.auditLog), /Synthetic-test|passwordHash|\$2[ab]\$/);
  assert.ok(db.options.every((config) => config.isolationLevel === "Serializable"));
});

test("owner identity is reloaded and existing users are never overwritten", async () => {
  const db = database();
  await rejects(create(db, { actorUserId: "outsider" }), "FORBIDDEN");
  db.state.user[0].role = "SUPPORT";
  await rejects(create(db), "FORBIDDEN");
  db.state.user[0].role = "SUPER_ADMIN";
  const before = db.state.user[0].passwordHash;
  await rejects(create(db, { email: policy.adminEmail }), "ACCOUNT_EXISTS");
  assert.equal(db.state.user[0].passwordHash, before);
  await rejects(create(db, { pillars: ["SCHOOL", "SCHOOL"] }), "INVALID_PILLARS");
  await rejects(create(db, { pillars: ["SUPER_ADMIN"] }), "INVALID_PILLARS");
  await rejects(create(db, { pillars: [] }), "INVALID_PILLARS");
  assert.equal(db.state.organisation.length, 0);
});

test("tester cap and changed preview plan fail closed, transaction failures leave no partial tenant", async () => {
  const db = database();
  await create(db);
  db.state.plan[0].monthlyPriceCents = 1;
  await rejects(create(db, { email: "another@example.test" }), "PREVIEW_PLAN_CHANGED");
  db.state.plan[0].monthlyPriceCents = 0;
  while (db.state.privatePreviewAccess.length < PREVIEW_TESTER_LIMIT) {
    db.state.privatePreviewAccess.push({ userId: `cap-${db.state.privatePreviewAccess.length}`, organisationId: "synthetic" });
  }
  await rejects(create(db, { email: "another@example.test" }), "TESTER_LIMIT");
  const broken = database();
  broken.failNextAudit();
  await rejects(create(broken), "PREVIEW_UNAVAILABLE");
  assert.equal(broken.state.user.length, 1);
  assert.equal(broken.state.organisation.length, 0);
  assert.equal(broken.state.plan.length, 0);
});

test("tester login uses its isolated tenant and preview password session, never returns a hash", async () => {
  const db = database();
  const created = await create(db);
  const signedIn = await authenticatePreviewPassword(db, { policy, email: " TESTER@EXAMPLE.TEST ", password: PASSWORD,
    secret: SECRET, now: NOW });
  assert.equal(signedIn.user.id, created.id);
  assert.equal(signedIn.activeOrganisationId, db.state.organisation[0].id);
  assert.match(signedIn.rawSessionToken, /^[a-f0-9]{64}$/);
  assert.equal(db.state.session[0].authMethod, PREVIEW_PASSWORD_AUTH_METHOD);
  assert.notEqual(db.state.session[0].tokenHash, signedIn.rawSessionToken);
  assert.doesNotMatch(JSON.stringify(signedIn), /passwordHash|\$2[ab]\$/);
  for (const options of [{ email: "missing@example.test" }, { password: "wrong" }, { password: "x".repeat(73) }]) {
    await rejects(authenticatePreviewPassword(db, { policy, email: created.email, password: PASSWORD,
      secret: SECRET, now: NOW, ...options }), "INVALID_CREDENTIALS");
  }
  assert.equal(db.state.session.length, 1);
});

test("disabled, expired, multi-tenant and elevated testers cannot sign in", async () => {
  const db = database();
  const created = await create(db);
  async function denied(now = NOW) {
    await rejects(authenticatePreviewPassword(db, { policy, email: created.email, password: PASSWORD,
      secret: SECRET, now }), "INVALID_CREDENTIALS");
  }
  db.state.privatePreviewAccess[0].enabled = false;
  await denied();
  db.state.privatePreviewAccess[0].enabled = true;
  await denied(new Date("2026-11-15T00:00:00Z"));
  db.state.organisationMember.push({ id: "intruder", userId: owner.id, organisationId: db.state.organisation[0].id, role: "OWNER" });
  await denied();
  db.state.organisationMember.pop();
  db.state.user[1].role = "SUPER_ADMIN";
  await denied();
  assert.equal(db.state.session.length, 0);
});

test("updates revoke every tester session and reset token, change only marked isolated tester", async () => {
  const db = database();
  const created = await create(db);
  for (const method of ["PREVIEW_PASSWORD", "PREVIEW_CODE", "PREVIEW_LOGIN_CODE", "PASSWORD"]) {
    db.state.session.push({ id: method, userId: created.id, authMethod: method, revokedAt: null });
  }
  db.state.passwordResetToken.push({ id: "reset", userId: created.id, usedAt: null });
  const changed = await updatePreviewTester(db, { actorUserId: owner.id, policy, userId: created.id,
    pillars: ["HEALTH"], enabled: false, now: NOW });
  assert.equal(changed.enabled, false);
  assert.deepEqual(changed.pillars, ["HEALTH"]);
  assert.ok(db.state.session.every((session) => session.revokedAt));
  assert.ok(db.state.passwordResetToken[0].usedAt);
  assert.equal(db.state.subscription[0].schoolRadioEnabled, false);
  assert.equal(db.state.subscription[0].healthRadioEnabled, true);
  await rejects(updatePreviewTester(db, { actorUserId: owner.id, policy, userId: owner.id,
    pillars: ["HEALTH"], enabled: false, now: NOW }), "TARGET_UNAVAILABLE");
  const listed = await listPreviewTesters(db, { actorUserId: owner.id, policy });
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, created.id);
  assert.doesNotMatch(JSON.stringify(listed), /passwordHash|tokenHash/);
  await rejects(listPreviewTesters(db, { actorUserId: "outsider", policy }), "FORBIDDEN");
});

test("owner password bootstrap is atomic, needs live owner code session, and stops old owner codes", async () => {
  const db = database();
  const bootstrap = bootstrapSession(db);
  db.state.session.push({ id: "pending-owner", userId: owner.id, authMethod: "PREVIEW_LOGIN_CODE", revokedAt: null });
  const established = await establishPreviewOwnerPassword(db, { actorUserId: owner.id, sessionId: bootstrap.id,
    policy, password: PASSWORD, secret: SECRET, now: NOW });
  assert.equal(established.user.role, "SUPER_ADMIN");
  assert.equal(established.activeOrganisationId, null);
  assert.equal(established.user.privatePreviewAccess.passwordEnabled, true);
  assert.ok(db.state.session.slice(0, 2).every((session) => session.revokedAt));
  assert.equal(db.state.session[2].authMethod, PREVIEW_PASSWORD_AUTH_METHOD);
  await rejects(establishPreviewOwnerPassword(db, { actorUserId: owner.id, sessionId: bootstrap.id,
    policy, password: PASSWORD, secret: SECRET, now: NOW }), "FORBIDDEN");
  const signedIn = await authenticatePreviewPassword(db, { policy, email: owner.email, password: PASSWORD,
    secret: SECRET, now: NOW });
  assert.equal(signedIn.user.id, owner.id);
  assert.doesNotMatch(JSON.stringify(db.state.auditLog), /Synthetic-test|passwordHash|rawSessionToken|\$2[ab]\$/);
});

test("bootstrap refuses missing, pending, revoked and expired sessions without replacing password", async () => {
  for (const overrides of [{ id: "other" }, { authMethod: "PREVIEW_LOGIN_CODE" }, { revokedAt: NOW },
    { expiresAt: NOW }, { authMethod: "PASSWORD" }]) {
    const db = database();
    bootstrapSession(db, overrides);
    const original = db.state.user[0].passwordHash;
    await rejects(establishPreviewOwnerPassword(db, { actorUserId: owner.id, sessionId: "owner-bootstrap", policy,
      password: PASSWORD, secret: SECRET, now: NOW }), "FORBIDDEN");
    assert.equal(db.state.user[0].passwordHash, original);
    assert.equal(db.state.privatePreviewAccess.length, 0);
  }
});

test("established owner password changes require current password and revoke previous password sessions", async () => {
  const db = database();
  const bootstrap = bootstrapSession(db);
  await establishPreviewOwnerPassword(db, { actorUserId: owner.id, sessionId: bootstrap.id,
    policy, password: PASSWORD, secret: SECRET, now: NOW });
  const sessionId = db.state.session.at(-1).id;
  await rejects(establishPreviewOwnerPassword(db, { actorUserId: owner.id, sessionId, policy,
    password: "Another-private-password-2026", secret: SECRET, now: NOW }), "INVALID_CREDENTIALS");
  const changed = await establishPreviewOwnerPassword(db, { actorUserId: owner.id, sessionId, policy,
    password: "Another-private-password-2026", currentPassword: PASSWORD, secret: SECRET, now: NOW });
  assert.ok(db.state.session.slice(0, -1).every((session) => session.revokedAt));
  assert.equal(changed.user.id, owner.id);
  assert.equal(db.state.session.at(-1).revokedAt, null);
});

test("failed owner audit rolls back password, marker, revocations and new session together", async () => {
  const db = database();
  bootstrapSession(db);
  const original = db.state.user[0].passwordHash;
  db.failNextAudit();
  await rejects(establishPreviewOwnerPassword(db, { actorUserId: owner.id, sessionId: "owner-bootstrap", policy,
    password: PASSWORD, secret: SECRET, now: NOW }), "PREVIEW_UNAVAILABLE");
  assert.equal(db.state.user[0].passwordHash, original);
  assert.equal(db.state.privatePreviewAccess.length, 0);
  assert.equal(db.state.session.length, 1);
  assert.equal(db.state.session[0].revokedAt, null);
});

test("concurrent owner setup has exactly one winner and no surviving legacy session", async () => {
  const db = database();
  bootstrapSession(db);
  const results = await Promise.allSettled([0, 1].map(() => establishPreviewOwnerPassword(db, {
    actorUserId: owner.id, sessionId: "owner-bootstrap", policy, password: PASSWORD, secret: SECRET, now: NOW
  })));
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected" && result.reason.code === "FORBIDDEN").length, 1);
  assert.equal(db.state.session.filter((session) => !session.revokedAt).length, 1);
  assert.equal(db.state.session.at(-1).authMethod, PREVIEW_PASSWORD_AUTH_METHOD);
});

test("changed subscription capabilities and trial integrity block login rather than broaden a tester", async () => {
  const db = database();
  const created = await create(db);
  for (const [key, value] of [["retailRadioEnabled", true], ["schoolPublicPublishingEnabled", true], ["status", "ACTIVE"]]) {
    const previous = db.state.subscription[0][key];
    db.state.subscription[0][key] = value;
    await rejects(authenticatePreviewPassword(db, { policy, email: created.email, password: PASSWORD,
      secret: SECRET, now: NOW }), "INVALID_CREDENTIALS");
    db.state.subscription[0][key] = previous;
  }
  db.state.subscription[0].currentPeriodEnd = new Date("2027-01-01T00:00:00Z");
  await rejects(authenticatePreviewPassword(db, { policy, email: created.email, password: PASSWORD,
    secret: SECRET, now: NOW }), "INVALID_CREDENTIALS");
  assert.equal(db.state.session.length, 0);
});

test("code-only testers have no usable password until the owner explicitly sets one", async () => {
  const db = database();
  const created = await create(db, { password: undefined });
  assert.equal(created.passwordEnabled, false);
  const loaded = await db.user.findUnique({ where: { id: created.id } });
  assert.equal(assertPreviewTesterState(loaded, { now: NOW, requirePassword: false }).grant.userId, created.id);
  assert.throws(() => assertPreviewTesterState(loaded, { now: NOW }), (error) => error.code === "TARGET_UNAVAILABLE");
  await rejects(authenticatePreviewPassword(db, { policy, email: created.email, password: PASSWORD,
    secret: SECRET, now: NOW }), "INVALID_CREDENTIALS");
  const stillCodeOnly = await updatePreviewTester(db, { actorUserId: owner.id, policy, userId: created.id,
    enabled: true, pillars: ["HEALTH"], now: NOW });
  assert.equal(stillCodeOnly.passwordEnabled, false);
  const enabled = await updatePreviewTester(db, { actorUserId: owner.id, policy, userId: created.id,
    enabled: true, pillars: ["HEALTH"], password: PASSWORD, now: NOW });
  assert.equal(enabled.passwordEnabled, true);
  const signedIn = await authenticatePreviewPassword(db, { policy, email: created.email, password: PASSWORD,
    secret: SECRET, now: NOW });
  assert.equal(signedIn.user.id, created.id);
});

test("access mode is derived only from an exact dedicated plan, not its code alone", () => {
  for (const [mode, plan] of [["READ_ONLY", PREVIEW_TESTER_PLAN], ["ONLINE_DRAFT", PREVIEW_ONLINE_DRAFT_PLAN]]) {
    assert.equal(previewTesterAccessMode({ ...plan, id: "synthetic-plan" }), mode);
    assert.equal(isPreviewTesterPlan(plan), true);
    for (const [key, value] of Object.entries(plan)) {
      const changed = { ...plan, [key]: typeof value === "boolean" ? !value : typeof value === "number" ? value + 1 : value === null ? "changed" : `${value}-changed` };
      assert.equal(previewTesterAccessMode(changed), null, `${mode} changed ${key}`);
      assert.equal(isPreviewTesterPlan(changed), false, `${mode} changed ${key}`);
    }
  }
  for (const value of [null, undefined, {}, { code: PREVIEW_ONLINE_DRAFT_PLAN_CODE }]) {
    assert.equal(previewTesterAccessMode(value), null);
  }
  for (const mode of [null, false, 0, {}, [], "", "online_draft", "__proto__", "toString", "ADMIN"]) {
    assert.throws(() => normalizePreviewTesterAccessMode(mode), (error) => error.code === "INVALID_ACCESS_MODE");
  }
});

test("explicit Online Radio draft account has isolated zero-storage plan and only Online capability", async () => {
  const db = database();
  const created = await create(db, { accessMode: "ONLINE_DRAFT", pillars: ["ONLINE"] });
  assert.equal(created.accessMode, "ONLINE_DRAFT");
  assert.deepEqual(created.pillars, ["ONLINE"]);
  assert.equal(db.state.plan[0].code, PREVIEW_ONLINE_DRAFT_PLAN_CODE);
  assert.equal(db.state.plan[0].storageLimitGb, 0);
  assert.equal(db.state.plan[0].monthlyPriceCents, 0);
  assert.equal(db.state.plan[0].publiclyAvailable, false);
  assert.equal(db.state.plan[0].licensedMusicCatalogueLevel, "NONE");
  assert.equal(db.state.subscription[0].onlineRadioEnabled, true);
  for (const key of ["retailRadioEnabled", "schoolRadioEnabled", "healthRadioEnabled", "faithRadioEnabled",
    "organisationsEnabled", "correctionsRadioEnabled", "schoolPublicPublishingEnabled", "retailMediaEnabled", "digitalSignageEnabled"]) {
    assert.equal(db.state.subscription[0][key], false, key);
  }
  const user = await db.user.findUnique({ where: { id: created.id } });
  assert.equal(assertPreviewTesterState(user, { now: NOW }).accessMode, "ONLINE_DRAFT");
  assert.equal(db.state.auditLog.at(-1).details.accessMode, "ONLINE_DRAFT");
  const listed = await listPreviewTesters(db, { actorUserId: owner.id, policy });
  assert.equal(listed[0].accessMode, "ONLINE_DRAFT");
  const signedIn = await authenticatePreviewPassword(db, { policy, email: created.email, password: PASSWORD, secret: SECRET, now: NOW });
  assert.equal(signedIn.activeOrganisationId, db.state.organisation[0].id);
  assert.equal(db.state.session.at(-1).authMethod, "PREVIEW_PASSWORD");
  assert.doesNotMatch(JSON.stringify(created), /passwordHash|tokenHash|Synthetic-test/);
});

test("draft mode never silently drops extra pillars or grants unsupported modes", async () => {
  const db = database();
  for (const pillars of [["RETAIL"], ["ONLINE", "RETAIL"], ["SCHOOL", "ONLINE"], ["ONLINE", "CORRECTIONS"]]) {
    await rejects(create(db, { accessMode: "ONLINE_DRAFT", pillars }), "INVALID_ACCESS_MODE_PILLARS");
  }
  for (const accessMode of [null, false, {}, "ADMIN", "online_draft"]) {
    await rejects(create(db, { accessMode, pillars: ["ONLINE"] }), "INVALID_ACCESS_MODE");
  }
  assert.equal(db.state.plan.length, 0);
  assert.equal(db.state.organisation.length, 0);
  assert.equal(db.state.auditLog.length, 0);
});

test("ordinary updates preserve the current draft mode and still revoke every session", async () => {
  const db = database();
  const created = await create(db, { accessMode: "ONLINE_DRAFT", pillars: ["ONLINE"] });
  const originalPlanId = db.state.subscription[0].planId;
  for (const authMethod of ["PREVIEW_PASSWORD", "PREVIEW_CODE", "PREVIEW_LOGIN_CODE", "PASSWORD"]) {
    db.state.session.push({ id: authMethod, userId: created.id, authMethod, revokedAt: null });
  }
  db.state.passwordResetToken.push({ id: "reset", userId: created.id, usedAt: null });
  const updated = await updatePreviewTester(db, { actorUserId: owner.id, policy, userId: created.id,
    pillars: ["ONLINE"], enabled: false, now: NOW });
  assert.equal(updated.accessMode, "ONLINE_DRAFT");
  assert.equal(db.state.subscription[0].planId, originalPlanId);
  assert.equal(db.state.plan.length, 1);
  assert.ok(db.state.session.every((session) => session.revokedAt));
  assert.ok(db.state.passwordResetToken[0].usedAt);
  assert.equal(db.state.auditLog.at(-1).details.previousAccessMode, "ONLINE_DRAFT");
  assert.equal(db.state.auditLog.at(-1).details.accessMode, "ONLINE_DRAFT");
  const before = structuredClone(db.state);
  await rejects(updatePreviewTester(db, { actorUserId: owner.id, policy, userId: created.id,
    pillars: ["ONLINE", "SCHOOL"], enabled: true, now: NOW }), "INVALID_ACCESS_MODE_PILLARS");
  assert.deepEqual(db.state, before);
});

test("only explicit validated mode changes switch plans, keeping the same isolated account", async () => {
  const db = database();
  const created = await create(db);
  const originalUserId = created.id;
  const originalOrganisationId = db.state.organisation[0].id;
  await rejects(updatePreviewTester(db, { actorUserId: owner.id, policy, userId: created.id,
    pillars: ["ONLINE", "SCHOOL"], enabled: true, accessMode: "ONLINE_DRAFT", now: NOW }), "INVALID_ACCESS_MODE_PILLARS");
  const editable = await updatePreviewTester(db, { actorUserId: owner.id, policy, userId: created.id,
    pillars: ["ONLINE"], enabled: true, accessMode: "ONLINE_DRAFT", now: NOW });
  assert.equal(editable.accessMode, "ONLINE_DRAFT");
  assert.equal(db.state.plan.length, 2);
  assert.equal(db.state.subscription[0].planId, db.state.plan.find((plan) => plan.code === PREVIEW_ONLINE_DRAFT_PLAN_CODE).id);
  assert.equal(db.state.user.length, 2);
  assert.equal(db.state.organisation.length, 1);
  assert.equal(db.state.organisation[0].id, originalOrganisationId);
  assert.equal(editable.id, originalUserId);
  const readonly = await updatePreviewTester(db, { actorUserId: owner.id, policy, userId: created.id,
    pillars: ["SCHOOL", "ONLINE"], enabled: true, accessMode: "READ_ONLY", now: NOW });
  assert.equal(readonly.accessMode, "READ_ONLY");
  assert.equal(db.state.subscription[0].planId, db.state.plan.find((plan) => plan.code === PREVIEW_TESTER_PLAN.code).id);
  assert.equal(db.state.plan.length, 2);
  const user = await db.user.findUnique({ where: { id: created.id } });
  assert.equal(assertPreviewTesterState(user, { now: NOW }).accessMode, "READ_ONLY");
});

test("a tampered draft plan or non-Online grant fails closed rather than enabling draft writes", async () => {
  const db = database();
  const created = await create(db, { accessMode: "ONLINE_DRAFT", pillars: ["ONLINE"] });
  db.state.plan[0].storageLimitGb = 1;
  await rejects(authenticatePreviewPassword(db, { policy, email: created.email, password: PASSWORD, secret: SECRET, now: NOW }), "INVALID_CREDENTIALS");
  await rejects(updatePreviewTester(db, { actorUserId: owner.id, policy, userId: created.id,
    pillars: ["ONLINE"], enabled: true, accessMode: "READ_ONLY", now: NOW }), "TARGET_UNAVAILABLE");
  const listed = await listPreviewTesters(db, { actorUserId: owner.id, policy });
  assert.equal(listed[0].accessMode, null);
  await rejects(create(db, { accessMode: "ONLINE_DRAFT", pillars: ["ONLINE"], email: "another@example.test" }), "PREVIEW_PLAN_CHANGED");
  db.state.plan[0].storageLimitGb = 0;
  db.state.privatePreviewAccess[0].pillars = ["ONLINE", "SCHOOL"];
  db.state.subscription[0].schoolRadioEnabled = true;
  const user = await db.user.findUnique({ where: { id: created.id } });
  assert.throws(() => assertPreviewTesterState(user, { now: NOW }), (error) => error.code === "TARGET_UNAVAILABLE");
});

test("failed mode-switch audit rolls back plan creation, subscription, grant and revocations", async () => {
  const db = database();
  const created = await create(db);
  db.state.session.push({ id: "old-session", userId: created.id, authMethod: "PREVIEW_PASSWORD", revokedAt: null });
  db.state.passwordResetToken.push({ id: "reset", userId: created.id, usedAt: null });
  const before = structuredClone(db.state);
  db.failNextAudit();
  await rejects(updatePreviewTester(db, { actorUserId: owner.id, policy, userId: created.id,
    pillars: ["ONLINE"], enabled: true, accessMode: "ONLINE_DRAFT", now: NOW }), "PREVIEW_UNAVAILABLE");
  assert.deepEqual(db.state, before);
});
