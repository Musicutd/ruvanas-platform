import test from "node:test";
import assert from "node:assert/strict";
import { pilotPreviewAdminIdentity } from "../lib/retail-rewards/pilot-preview-admin.mjs";
import { pilotPreviewBusinessIdentity } from "../lib/retail-rewards/pilot-preview-business.mjs";
import { requirePilotAdminAccess } from "../lib/retail-rewards/pilot-admin-access.mjs";
import { createPilotAdminContextLoader } from "../lib/retail-rewards/pilot-admin-context.mjs";
import { getSessionFromToken } from "../lib/session-lookup.js";
import { pilotPreviewEnvironment } from "./fixtures/rewards-pilot-preview.mjs";
import { pilotPreviewOwnerContext } from "./fixtures/rewards-pilot-preview-admin.mjs";

const NOW = new Date("2026-11-17T12:00:00Z"), ENV = pilotPreviewEnvironment();
const context = () => pilotPreviewOwnerContext(NOW);
const access = (c, env = ENV, extra = {}) => requirePilotAdminAccess({ env, clock: () => NOW,
  organisationId: "org-one", loadContext: async () => c, ...extra });

test("established configured preview owner uses the existing session only in the pilot admin boundary", async () => {
  const c = context();
  assert.deepEqual(pilotPreviewAdminIdentity(c.session, ENV, NOW), {
    userId: c.user.id, organisationId: null, role: "SUPER_ADMIN", landing: "/admin/retail-rewards/pilot"
  });
  assert.equal((await access(c)).ok, true);
  assert.equal(pilotPreviewBusinessIdentity(c.session, ENV, NOW), null, "merchant/business bridge does not adopt preview identities");
  assert.equal((await access(c, ENV, { organisationId: "other-org" })).code, "FORBIDDEN");
});

test("preview admin requires all pilot gates and valid exact preview configuration", async () => {
  for (const [key, bad] of [
    ["RUVANAS_RETAIL_REWARDS_ENABLED", "false"], ["RUVANAS_RETAIL_REWARDS_PILOT_ADMIN_ENABLED", "false"],
    ["RUVANAS_RETAIL_REWARDS_PILOT_PREVIEW_ENABLED", "false"], ["RUVANAS_RETAIL_REWARDS_PILOT_PREVIEW_ENABLED", "TRUE"],
    ["RUVANAS_RETAIL_REWARDS_PILOT_ORGANISATION_IDS", "[]"], ["RUVANAS_PRIVATE_PREVIEW_ENABLED", "0"],
    ["RUVANAS_PRIVATE_PREVIEW_ALLOWED_EMAILS", "other@example.invalid"],
    ["RUVANAS_PRIVATE_PREVIEW_ADMIN_EMAIL", "other@example.invalid"], ["RUVANAS_PUBLIC_URL", "broken"]
  ]) {
    const env = { ...ENV, [key]: bad };
    assert.equal(pilotPreviewAdminIdentity(context().session, env, NOW), null, key);
    assert.equal((await access(context(), env)).ok, false, key);
  }
});

test("malformed, bootstrap, tester, revoked, expired and substituted preview identities fail closed", async () => {
  const mutations = [
    c => c.session.authMethod = "PREVIEW_CODE", c => c.session.authMethod = "PREVIEW_LOGIN_CODE",
    c => c.session.revokedAt = NOW, c => c.session.expiresAt = NOW, c => c.session.expiresAt = "future",
    c => c.session.createdAt = new Date(+NOW + 1), c => c.session.createdAt = undefined,
    c => c.session.lastSeenAt = new Date("invalid"), c => c.session.lastSeenAt = new Date(+NOW + 1),
    c => c.session.userId = "someone-else", c => c.user.id = "someone-else", c => c.session.id = "../bad",
    c => c.user.role = "OWNER", c => c.user.role = "SUPPORT", c => c.user.email = "wrong@example.invalid",
    c => c.user.privatePreviewAccess = null, c => c.user.privatePreviewAccess.userId = "someone-else",
    c => c.user.privatePreviewAccess.enabled = false, c => c.user.privatePreviewAccess.passwordEnabled = false,
    c => c.user.privatePreviewAccess.organisationId = "org-one", c => c.user.privatePreviewAccess.expiresAt = NOW,
    c => c.user.privatePreviewAccess.pillars = ["RETAIL"], c => c.user.privatePreviewAccess.pillars = "",
    c => c.user.privatePreviewAccess.enabled = "true",
    c => c.session.activeOrganisation = { enterpriseSecurityPolicy: { sessionMaxAgeMinutes: 1, idleTimeoutMinutes: 20 } },
    c => c.session.activeOrganisation = { enterpriseSecurityPolicy: { sessionMaxAgeMinutes: 60, idleTimeoutMinutes: 0 } },
    c => { c.session.lastSeenAt = new Date(+NOW - 60_000);
      c.session.activeOrganisation = { enterpriseSecurityPolicy: { sessionMaxAgeMinutes: 60, idleTimeoutMinutes: 1 } }; }
  ];
  for (const mutate of mutations) {
    const c = context(); mutate(c);
    // A stale session user cannot override the separately fresh server user.
    assert.equal((await access(c)).ok, false, String(mutate));
    assert.equal(pilotPreviewAdminIdentity({ ...c.session, user: c.user }, ENV, NOW), null, String(mutate));
  }
});

test("ordinary PASSWORD and SSO Super Admin paths remain valid without preview grants", async () => {
  for (const authMethod of ["PASSWORD", "SSO"]) {
    const c = context(); c.user.privatePreviewAccess = null; c.session.authMethod = authMethod;
    const env = { ...ENV, RUVANAS_PRIVATE_PREVIEW_ENABLED: "0", RUVANAS_RETAIL_REWARDS_PILOT_PREVIEW_ENABLED: "false" };
    assert.equal((await access(c, env)).ok, true);
    c.user.privatePreviewAccess = { userId: c.user.id };
    assert.equal((await access(c, env)).code, "FORBIDDEN");
  }
});

test("transaction revalidation rejects an otherwise valid change of authentication method", async () => {
  const c = context(), previous = await access(c);
  assert.equal(previous.authMethod, "PREVIEW_PASSWORD");
  c.session.authMethod = "PASSWORD"; c.user.privatePreviewAccess = null;
  assert.equal((await access(c)).ok, true);
  assert.equal((await access(c, ENV, { previous })).code, "FORBIDDEN");
});

test("disabled admin gates do not load sessions, users or database clients", async () => {
  for (const patch of [{ RUVANAS_RETAIL_REWARDS_ENABLED: "false" }, { RUVANAS_RETAIL_REWARDS_PILOT_ADMIN_ENABLED: "false" }]) {
    let calls = 0; const env = { ...ENV, ...patch };
    const db = new Proxy({}, { get() { calls++; throw Error("Unexpected database"); } });
    const loadContext = createPilotAdminContextLoader({ db, env, token: "synthetic", readSession: async () => { calls++; throw Error("Unexpected session"); } });
    assert.equal(await loadContext(), null);
    assert.equal((await requirePilotAdminAccess({ env, clock: () => NOW, loadContext })).code, "FEATURE_DISABLED");
    assert.equal(calls, 0);
  }
});

test("real session transport and fresh full grant are re-read from the transaction client", async () => {
  const c = context(), env = { ...ENV, SESSION_SECRET: "synthetic-local-preview-owner-secret-long-enough" };
  const queries = [], base = { user: { findUnique() { throw Error("Base client must not supply transaction authority"); } } };
  const transaction = { session: {
    async findUnique(args) { queries.push(args); return structuredClone(c.session); },
    async update() { throw Error("Fresh synthetic session does not need touch"); }
  }, user: { async findUnique(args) { queries.push(args); return structuredClone(c.user); } } };
  const loadContext = createPilotAdminContextLoader({ db: base, env, token: "a".repeat(64),
    readSession: (token, options) => getSessionFromToken(token, { ...options, secret: env.SESSION_SECRET, now: NOW }) });
  const loaded = await loadContext(transaction);
  assert.equal((await access(loaded, env)).ok, true);
  assert.deepEqual(queries[1].select.privatePreviewAccess.select, { userId: true, enabled: true, passwordEnabled: true,
    organisationId: true, expiresAt: true, pillars: true });
  c.user.privatePreviewAccess.enabled = false;
  assert.equal((await access(await loadContext(transaction), env)).code, "FORBIDDEN", "fresh revoked grant wins over still-valid session relation");
});

test("context loader closes if policy changes during either await", async () => {
  for (const at of ["session", "user"]) {
    const env = { ...ENV }; let userReads = 0;
    const loadContext = createPilotAdminContextLoader({ env, token: "synthetic", readSession: async () => {
      if (at === "session") env.RUVANAS_RETAIL_REWARDS_ENABLED = "false";
      return context().session;
    }, db: { user: { async findUnique() { userReads++; env.RUVANAS_RETAIL_REWARDS_ENABLED = "false"; return context().user; } } } });
    assert.equal(await loadContext(), null); assert.equal(userReads, at === "session" ? 0 : 1);
  }
});
