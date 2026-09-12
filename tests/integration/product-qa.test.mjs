import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { PRODUCT_QA_PROFILES, productQaTierMatrix } from "../../lib/product-qa-acceptance.mjs";

const baseUrl = process.env.INTEGRATION_BASE_URL || "http://127.0.0.1:3100";
const prisma = new PrismaClient();

async function api(path, { method = "GET", body, cookie, clientAddress } = {}) {
  const headers = { origin: baseUrl };
  if (cookie) headers.cookie = cookie;
  if (clientAddress) headers["x-forwarded-for"] = clientAddress;
  if (body !== undefined) headers["content-type"] = "application/json";
  return fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual"
  });
}

function sessionCookie(response) {
  return response.headers.get("set-cookie")?.split(";")[0] || "";
}

test.after(async () => {
  await prisma.$disconnect();
});

test("five isolated QA tenants can traverse Tier 1–5 without billing events", async () => {
  const suffix = randomUUID();
  const adminPassword = `Qa-${randomUUID()}-admin`;
  const admin = await prisma.user.create({
    data: {
      name: "Product QA Operator",
      email: `product-qa-admin-${suffix}@example.invalid`,
      passwordHash: await bcrypt.hash(adminPassword, 4),
      role: "SUPER_ADMIN"
    }
  });
  const adminLogin = await api("/api/auth/login", {
    method: "POST",
    clientAddress: "198.51.100.200",
    body: { email: admin.email, password: adminPassword }
  });
  assert.equal(adminLogin.status, 200, await adminLogin.clone().text());
  const adminCookie = sessionCookie(adminLogin);
  assert.ok(adminCookie);

  const tenants = [];
  for (const [index, profile] of PRODUCT_QA_PROFILES.entries()) {
    const password = `Qa-${randomUUID()}-owner`;
    const registration = await api("/api/auth/register", {
      method: "POST",
      clientAddress: `198.51.100.${20 + index}`,
      body: {
        name: `${profile.product} QA Owner`,
        organisationName: profile.organisationName,
        email: `qa-${profile.product.toLowerCase()}-${suffix}@example.invalid`,
        password,
        product: profile.product,
        tier: profile.startingPlanCode.toLowerCase().replaceAll("_", "-"),
        source: "ADMIN_TEST"
      }
    });
    assert.equal(registration.status, 201, await registration.clone().text());
    const body = await registration.json();
    assert.equal(body.recommendedDashboardRoute, profile.landingRoute);
    tenants.push({ profile, password, body, cookie: sessionCookie(registration), clientAddress: `198.51.100.${40 + index}` });
  }

  assert.equal(new Set(tenants.map((tenant) => tenant.body.organisation.id)).size, PRODUCT_QA_PROFILES.length);

  for (const tenant of tenants) {
    const tiers = productQaTierMatrix().filter((row) => row.product === tenant.profile.product);
    for (const tier of tiers) {
      const switched = await api("/api/admin/product-qa", {
        method: "PATCH",
        cookie: adminCookie,
        body: {
          organisationId: tenant.body.organisation.id,
          planCode: tier.planCode
        }
      });
      assert.equal(switched.status, 200, await switched.clone().text());
      const result = await switched.json();
      assert.equal(result.acceptance.passed, true);
      assert.equal(result.product, tenant.profile.product);
      assert.equal(result.plan.tierNumber, tier.tierNumber);
      assert.equal(result.acceptance.landingRoute, tenant.profile.landingRoute);
      assert.equal(result.acceptance.licensedMusicCatalogueLevel, tier.licensedMusicCatalogueLevel);

      const login = await api("/api/auth/login", {
        method: "POST",
        clientAddress: tenant.clientAddress,
        body: { email: tenant.body.user.email, password: tenant.password }
      });
      assert.equal(login.status, 200, await login.clone().text());
      assert.equal((await login.json()).recommendedDashboardRoute, tenant.profile.landingRoute);

      const correctDashboard = await api(tenant.profile.landingRoute, { cookie: tenant.cookie });
      assert.equal(correctDashboard.status, 200, `${tier.planCode} should open ${tenant.profile.landingRoute}`);

      const accountPage = await api("/dashboard/account", { cookie: tenant.cookie });
      assert.equal(accountPage.status, 200);
      assert.match(await accountPage.text(), new RegExp(tier.planName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

      for (const other of PRODUCT_QA_PROFILES.filter((profile) => profile.product !== tenant.profile.product)) {
        const wrongDashboard = await api(other.landingRoute, { cookie: tenant.cookie });
        assert.ok([302, 303, 307, 308].includes(wrongDashboard.status));
        assert.match(wrongDashboard.headers.get("location") || "", /\/dashboard\/account\?product=/);
      }
    }
  }

  const crossTenantSwitch = await api("/api/me/organisation", {
    method: "POST",
    cookie: tenants[0].cookie,
    body: { organisationId: tenants[1].body.organisation.id }
  });
  assert.equal(crossTenantSwitch.status, 403);

  const organisationIds = tenants.map((tenant) => tenant.body.organisation.id);
  assert.equal(await prisma.auditLog.count({
    where: { organisationId: { in: organisationIds }, action: "PRODUCT_QA_TIER_SWITCHED" }
  }), 15);
  assert.equal(await prisma.billingContract.count({
    where: { subscription: { organisationId: { in: organisationIds } } }
  }), 0);
  assert.equal(await prisma.billingInvoice.count({ where: { organisationId: { in: organisationIds } } }), 0);
});
