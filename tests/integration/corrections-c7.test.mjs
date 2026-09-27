import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const baseUrl = process.env.INTEGRATION_BASE_URL || "http://127.0.0.1:3100";

async function api(path, { method = "GET", body, cookie } = {}) {
  const response = await fetch(`${baseUrl}${path}`, { method, headers: { origin: baseUrl,
    ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] };
}

test("C7 network routes require current Tier 4 and explicit cross-facility authority", async () => {
  const databaseUrl = process.env.DATABASE_URL || "";
  if (process.env.GITHUB_ACTIONS !== "true" || databaseUrl !== "postgresql://postgres:postgres@localhost:5432/ruvanas" ||
      !process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
    throw new Error("C7 integration runs only against the isolated GitHub Actions test database.");
  }
  const db = new PrismaClient();
  const suffix = randomUUID().slice(0, 8);
  const password = `C7-test-${randomUUID()}!`;
  const users = [];
  let authority, outsider, plan;
  try {
    plan = await db.plan.create({ data: { name: `C7 ${suffix}`, code: `C7_${suffix}`, productFamily: "CORRECTIONS", tierNumber: 4,
      monthlyPriceCents: 49900, storageLimitGb: 10, listenerLimit: 100, maxBitrateKbps: 128, correctionsRadioEnabled: true, stationLimit: 4 } });
    authority = await db.organisation.create({ data: { name: `Synthetic C7 authority ${suffix}`, slug: `c7-${suffix}` } });
    outsider = await db.organisation.create({ data: { name: `Synthetic C7 outsider ${suffix}`, slug: `c7-other-${suffix}` } });
    await db.subscription.createMany({ data: [authority, outsider].map((organisation) => ({ organisationId: organisation.id, planId: plan.id, status: "ACTIVE" })) });
    async function member(role, label, organisation = authority) {
      const user = await db.user.create({ data: { name: label, email: `${label}-${suffix}@example.invalid`, passwordHash: await bcrypt.hash(password, 4), role } });
      const membership = await db.organisationMember.create({ data: { organisationId: organisation.id, userId: user.id, role } });
      users.push(user);
      const login = await api("/api/auth/login", { method: "POST", body: { email: user.email, password } });
      assert.equal(login.status, 200, JSON.stringify(login.body));
      return { user, membership, cookie: login.cookie };
    }
    const owner = await member("OWNER", "c7-owner");
    const manager = await member("MANAGER", "c7-manager");
    const contributor = await member("CONTENT_EDITOR", "c7-contributor");
    const otherOwner = await member("OWNER", "c7-other", outsider);
    const facilities = [];
    for (const name of ["A", "B", "C"]) {
      const facility = await db.location.create({ data: { organisationId: authority.id, name: `Synthetic facility ${name}`, slug: `c7-${name.toLowerCase()}-${suffix}`,
        status: "ACTIVE", timezone: "Europe/Malta", countryCode: "MT", zones: { create: { name: "Wing 1", slug: "wing-1", status: "ACTIVE" } },
        correctionsFacility: { create: { policyConfiguredAt: new Date() } } } });
      facilities.push(facility);
    }
    const foreign = await db.location.create({ data: { organisationId: outsider.id, name: "Foreign facility", slug: `c7-foreign-${suffix}`,
      status: "ACTIVE", timezone: "Europe/Malta", countryCode: "MT", correctionsFacility: { create: { policyConfiguredAt: new Date() } } } });
    const group = await db.locationGroup.create({ data: { organisationId: authority.id, name: "Northern facilities", slug: `north-${suffix}`,
      locations: { create: [{ locationId: facilities[0].id }, { locationId: facilities[1].id }] } } });
    await db.correctionsFacilityGrant.create({ data: { organisationId: authority.id, organisationMemberId: manager.membership.id,
      facilityId: facilities[0].id, permission: "MANAGER", createdByUserId: owner.user.id } });

    const ownerNetwork = await api("/api/corrections/network", { cookie: owner.cookie });
    assert.equal(ownerNetwork.status, 200, JSON.stringify(ownerNetwork.body));
    assert.equal(ownerNetwork.body.totals.facilities, 3);
    assert.equal(ownerNetwork.body.groups.find((item) => item.id === group.id)?.facilityIds.length, 2);
    assert.equal(ownerNetwork.body.permissions.distribute, true);
    assert.equal((await api("/api/corrections/network", { cookie: manager.cookie })).status, 403);
    assert.equal((await api("/api/corrections/network", { cookie: contributor.cookie })).status, 403);
    assert.equal((await api(`/api/corrections/network?facilityId=${foreign.id}`, { cookie: owner.cookie })).status, 404);
    assert.equal((await api(`/api/corrections/network/windows?facilityId=${facilities[1].id}`, { cookie: manager.cookie })).status, 403);
    assert.equal((await api(`/api/corrections/network/windows?facilityId=${facilities[0].id}`, { cookie: manager.cookie })).status, 200);
    assert.equal((await api("/api/corrections/network", { cookie: otherOwner.cookie })).body.totals.facilities, 1);

    const granted = await api("/api/corrections/network/grants", { method: "PUT", cookie: owner.cookie,
      body: { memberId: manager.membership.id, canView: true, canProgramme: true } });
    assert.equal(granted.status, 200, JSON.stringify(granted.body));
    assert.equal((await api("/api/corrections/network", { cookie: manager.cookie })).status, 200);
    assert.equal((await api("/api/corrections/network", { cookie: contributor.cookie })).status, 403);
    assert.equal((await api("/api/corrections/network/grants", { method: "PUT", cookie: manager.cookie,
      body: { memberId: contributor.membership.id, canView: true } })).status, 403);
    assert.equal((await api("/api/corrections/network/distribution", { method: "POST", cookie: manager.cookie,
      body: { programmeId: "not-approved", facilityIds: [facilities[1].id] } })).status, 403);
    assert.equal((await api("/api/corrections/network/windows", { method: "POST", cookie: manager.cookie,
      body: { facilityId: facilities[1].id, kind: "LOCAL", weekday: 1, startMinute: 600, endMinute: 660,
        allowedContentTypes: ["PROGRAMME"] } })).status, 403);

    await db.plan.update({ where: { id: plan.id }, data: { tierNumber: 3 } });
    assert.equal((await api("/api/corrections/network", { cookie: owner.cookie })).status, 403);
    assert.equal((await api("/api/corrections/network", { cookie: manager.cookie })).status, 403);
  } finally {
    if (authority) await db.auditLog.deleteMany({ where: { organisationId: authority.id } });
    if (authority) await db.organisation.delete({ where: { id: authority.id } });
    if (outsider) await db.organisation.delete({ where: { id: outsider.id } });
    for (const user of users) await db.user.delete({ where: { id: user.id } });
    if (plan) await db.plan.delete({ where: { id: plan.id } });
    await db.$disconnect();
  }
});
