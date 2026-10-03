import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { activeMembershipAllowedForSession, findSessionFallbackMembership, selectActiveMembership } from "../lib/active-organisation.mjs";

const memberships = [
  { id: "membership-a", organisationId: "organisation-a" },
  { id: "membership-b", organisationId: "organisation-b" }
];

test("active organisation selection honours the session choice", () => {
  assert.equal(
    selectActiveMembership(memberships, "organisation-b")?.id,
    "membership-b"
  );
});

test("active organisation selection falls back deterministically", () => {
  assert.equal(
    selectActiveMembership(memberships, "deleted-organisation")?.id,
    "membership-a"
  );
  assert.equal(selectActiveMembership([], "organisation-a"), null);
});

test("fallback membership must satisfy its own enterprise session policy", () => {
  const now = new Date("2026-09-30T12:00:00.000Z");
  const session = {
    activeOrganisationId: "removed-organisation",
    createdAt: new Date("2026-09-30T10:00:00.000Z"),
    lastSeenAt: new Date("2026-09-30T11:45:00.000Z"),
    expiresAt: new Date("2026-10-30T12:00:00.000Z"),
    revokedAt: null,
    authMethod: "PASSWORD",
    user: { role: "OWNER" }
  };
  const selected = selectActiveMembership([
    { id: "fallback", organisationId: "organisation-b", organisation: {
      enterpriseSecurityPolicy: { ssoRequired: false, passwordFallback: true, sessionMaxAgeMinutes: 60, idleTimeoutMinutes: 30 }
    } }
  ], session.activeOrganisationId);
  assert.equal(selected?.id, "fallback");
  assert.equal(activeMembershipAllowedForSession(selected, session, now), false);
  assert.equal(activeMembershipAllowedForSession({ ...selected, organisation: {
    enterpriseSecurityPolicy: { ssoRequired: false, passwordFallback: true, sessionMaxAgeMinutes: 180, idleTimeoutMinutes: 30 }
  } }, session, now), true);
  assert.equal(activeMembershipAllowedForSession({ ...selected, organisation: {
    enterpriseSecurityPolicy: { ssoRequired: true, passwordFallback: false, sessionMaxAgeMinutes: 180, idleTimeoutMinutes: 30 }
  } }, session, now), false);
  assert.equal(activeMembershipAllowedForSession({ ...selected, organisation: {
    enterpriseSecurityPolicy: { ssoRequired: false, passwordFallback: true, sessionMaxAgeMinutes: 180, idleTimeoutMinutes: 15 }
  } }, { ...session, lastSeenAt: new Date("2026-09-30T11:44:00.000Z") }, now), false);
  assert.equal(activeMembershipAllowedForSession({ ...selected, organisation: { enterpriseSecurityPolicy: null } }, session, now), true);
  assert.equal(activeMembershipAllowedForSession({ ...selected, organisation: null }, session, now), false);
  assert.equal(activeMembershipAllowedForSession(null, session, now), false);
  assert.equal(activeMembershipAllowedForSession(selected, { ...session, revokedAt: now }, now), false);
});

test("direct session lookups load the policy of a deterministic fallback only when needed", async () => {
  const calls = [];
  const database = { organisationMember: {
    findUnique: async (input) => { calls.push({ method: "findUnique", input }); return { id: "active" }; },
    findFirst: async (input) => { calls.push({ method: "findFirst", input }); return { id: "fallback", organisation: { enterpriseSecurityPolicy: null } }; }
  } };
  const session = { userId: "user-a", activeOrganisationId: "org-a" };
  assert.equal(await findSessionFallbackMembership(database, session), null);
  assert.deepEqual(calls.map(({ method }) => method), ["findUnique"]);
  assert.deepEqual(calls[0].input.where, { userId_organisationId: { userId: "user-a", organisationId: "org-a" } });

  database.organisationMember.findUnique = async (input) => { calls.push({ method: "findUnique", input }); return null; };
  const fallback = await findSessionFallbackMembership(database, session);
  assert.equal(fallback.id, "fallback");
  assert.deepEqual(calls.slice(1).map(({ method }) => method), ["findUnique", "findFirst"]);
  assert.deepEqual(calls[2].input.where, { userId: "user-a" });
  assert.deepEqual(calls[2].input.orderBy, [{ createdAt: "asc" }, { id: "asc" }]);
  assert.equal(calls[2].input.include.organisation.include.enterpriseSecurityPolicy, true);

  calls.length = 0;
  await findSessionFallbackMembership(database, { ...session, activeOrganisationId: null });
  assert.deepEqual(calls.map(({ method }) => method), ["findFirst"]);
});

test("organisation context and switching both enforce the selected policy", () => {
  const source = readFileSync(new URL("../lib/auth.js", import.meta.url), "utf8");
  assert.match(source, /const fallback = await findSessionFallbackMembership\(prisma, session\)/);
  assert.match(source, /if \(fallback && !activeMembershipAllowedForSession\(fallback, session, now\)\) return null;/);
  assert.ok(source.indexOf("activeMembershipAllowedForSession(fallback, session, now)") < source.indexOf("await refreshSessionActivity(session, now)"));
  assert.match(source, /getCurrentSession\(\{ refreshActivity: false \}\)/);
  assert.match(source, /include: \{ \.\.\.organisationInclude, enterpriseSecurityPolicy: true \}/);
  assert.match(source, /if \(membership && !activeMembershipAllowedForSession\(membership, session\)\)/);
  assert.ok(source.indexOf("activeMembershipAllowedForSession(membership, session)") < source.indexOf("await refreshSessionActivity(session);"));
  assert.match(source, /include: \{ organisation: \{ include: \{ enterpriseSecurityPolicy: true \} \} \}/);
  assert.match(source, /if \(!activeMembershipAllowedForSession\(membership, session\)\)/);
});

