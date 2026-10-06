import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const baseUrl = process.env.INTEGRATION_BASE_URL || "http://127.0.0.1:3100";
const ciDatabase = process.env.GITHUB_ACTIONS === "true" &&
  process.env.DATABASE_URL === "postgresql://postgres:postgres@localhost:5432/ruvanas";

async function api(path, { method = "GET", body, cookie } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      origin: baseUrl,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(cookie ? { cookie } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual"
  });
  return response;
}

test("C9 privacy inventory route is Super Admin-only, tenant-scoped, and content-free", async () => {
  if (!ciDatabase || !process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
    throw new Error("C9 inventory integration runs only against the exact disposable CI database.");
  }

  const db = new PrismaClient();
  const suffix = randomUUID();
  const password = `CI-only-${randomUUID()}!`;
  const organisations = [];
  const users = [];
  const auditIds = [];
  try {
    for (const label of ["A", "B"]) {
      organisations.push(await db.organisation.create({
        data: { name: `Fictional C9 route ${label} ${suffix}`, slug: `c9-route-${label.toLowerCase()}-${suffix}` }
      }));
    }

    async function login(role, label, organisationId = null) {
      const user = await db.user.create({ data: {
        name: `Fictional C9 ${label}`,
        email: `c9-${label}-${suffix}@example.invalid`,
        passwordHash: await bcrypt.hash(password, 4),
        role
      } });
      users.push(user);
      if (organisationId) {
        await db.organisationMember.create({ data: { organisationId, userId: user.id, role } });
      }
      const response = await api("/api/auth/login", { method: "POST", body: { email: user.email, password } });
      assert.equal(response.status, 200, await response.clone().text());
      const cookie = response.headers.get("set-cookie")?.split(";")[0];
      assert.ok(cookie);
      return cookie;
    }

    const ownerCookie = await login("OWNER", "owner", organisations[0].id);
    const supportCookie = await login("SUPPORT", "support");
    const superAdminCookie = await login("SUPER_ADMIN", "super-admin");

    for (const [organisation, action] of [
      [organisations[0], "CORRECTIONS_C9_ROUTE_PROBE"],
      [organisations[0], "CORRECTIONS_C9_ROUTE_PROBE"],
      [organisations[0], "UNRELATED_C9_ROUTE_PROBE"],
      [organisations[1], "CORRECTIONS_C9_ROUTE_PROBE"]
    ]) {
      const audit = await db.auditLog.create({ data: {
        organisationId: organisation.id,
        action,
        entityType: "C9_TEST",
        entityId: suffix,
        details: { privateMarker: "fictional-private-record-content" }
      } });
      auditIds.push(audit.id);
    }

    const pathA = `/api/admin/corrections/privacy-inventory?organisationId=${organisations[0].id}`;
    assert.equal((await api(pathA)).status, 401);
    assert.equal((await api(pathA, { cookie: ownerCookie })).status, 403);
    assert.equal((await api(pathA, { cookie: supportCookie })).status, 403);
    assert.equal((await api("/api/admin/corrections/privacy-inventory", { cookie: superAdminCookie })).status, 400);
    assert.equal((await api(`/api/admin/corrections/privacy-inventory?organisationId=${"x".repeat(129)}`,
      { cookie: superAdminCookie })).status, 400);
    assert.equal((await api("/api/admin/corrections/privacy-inventory?organisationId=missing-c9-organisation",
      { cookie: superAdminCookie })).status, 404);

    for (const [organisation, expectedAuditCount] of [[organisations[0], 2], [organisations[1], 1]]) {
      const response = await api(`/api/admin/corrections/privacy-inventory?organisationId=${organisation.id}`,
        { cookie: superAdminCookie });
      assert.equal(response.status, 200, await response.clone().text());
      assert.match(response.headers.get("cache-control") || "", /no-store/);
      const body = await response.json();
      assert.equal(body.organisationId, organisation.id);
      assert.equal(Object.keys(body.counts).length, 23);
      assert.equal(body.counts.correctionsAuditEvents, expectedAuditCount);
      assert.ok(Object.entries(body.counts).every(([key, value]) =>
        key === "correctionsAuditEvents" ? value === expectedAuditCount : value === 0));
      assert.deepEqual(Object.keys(body).sort(), ["counts", "notice", "organisationId"]);
      assert.equal(JSON.stringify(body).includes("fictional-private-record-content"), false);
      assert.equal(JSON.stringify(body).includes("@example.invalid"), false);
    }
  } finally {
    try {
      if (auditIds.length) await db.auditLog.deleteMany({ where: { id: { in: auditIds } } });
      if (organisations.length) await db.organisation.deleteMany({ where: { id: { in: organisations.map(({ id }) => id) } } });
      if (users.length) await db.user.deleteMany({ where: { id: { in: users.map(({ id }) => id) } } });
    } finally {
      await db.$disconnect();
    }
  }
});
