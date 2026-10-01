import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const baseUrl = process.env.INTEGRATION_BASE_URL || "http://127.0.0.1:3100";
const ciDatabase = process.env.GITHUB_ACTIONS === "true" &&
  process.env.DATABASE_URL === "postgresql://postgres:postgres@localhost:5432/ruvanas";

async function api(path, { method = "GET", cookie, body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { origin: baseUrl, ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual"
  });
  return response;
}

test("general programming cannot expose or draft schedules for private Inside facilities", async () => {
  if (!ciDatabase || !process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
    throw new Error("C9 general-programming integration runs only against the exact disposable CI database.");
  }

  const db = new PrismaClient();
  const suffix = randomUUID();
  let organisationId;
  let userId;
  const planIds = [];
  try {
    const retailPlan = await db.plan.create({ data: {
      name: `Fictional C9 retail ${suffix}`, code: `C9_RETAIL_${suffix}`, productFamily: "RETAIL", tierNumber: 1,
      monthlyPriceCents: 0, storageLimitGb: 1, listenerLimit: 10, maxBitrateKbps: 128,
      retailRadioEnabled: true, stationLimit: 1
    } });
    planIds.push(retailPlan.id);
    const insidePlan = await db.plan.create({ data: {
      name: `Fictional C9 Inside ${suffix}`, code: `C9_INSIDE_${suffix}`, productFamily: "CORRECTIONS", tierNumber: 2,
      monthlyPriceCents: 0, storageLimitGb: 1, listenerLimit: 10, maxBitrateKbps: 128,
      correctionsRadioEnabled: true, stationLimit: 1
    } });
    planIds.push(insidePlan.id);
    const organisation = await db.organisation.create({
      data: { name: `Fictional C9 programming ${suffix}`, slug: `c9-programming-${suffix}` }
    });
    organisationId = organisation.id;
    const password = `CI-only-${randomUUID()}!`;
    const user = await db.user.create({ data: {
      email: `c9-programming-${suffix}@example.invalid`, passwordHash: await bcrypt.hash(password, 4), role: "OWNER"
    } });
    userId = user.id;
    await db.organisationMember.create({ data: { organisationId, userId, role: "OWNER" } });
    await db.subscription.create({ data: { organisationId, planId: retailPlan.id, status: "ACTIVE" } });

    const normalLocation = await db.location.create({ data: {
      organisationId, name: "Fictional normal shop", slug: `c9-shop-${suffix}`, status: "ACTIVE",
      zones: { create: { name: "Shop floor", slug: "shop-floor", status: "ACTIVE" } }
    }, include: { zones: true } });
    const privateFacility = await db.location.create({ data: {
      organisationId, name: "Fictional private facility", slug: `c9-inside-${suffix}`, status: "ACTIVE",
      zones: { create: { name: "Private wing", slug: "private-wing", status: "ACTIVE" } },
      correctionsFacility: { create: {} }
    }, include: { zones: true } });
    const mode = await db.musicMode.create({ data: {
      organisationId, name: "Fictional approved mode", slug: `c9-mode-${suffix}`, status: "ACTIVE"
    } });
    const normalSchedule = await db.musicSchedule.create({ data: {
      organisationId, locationId: normalLocation.id, name: "Normal draft", timezone: "Europe/Malta",
      slots: { create: { weekday: 1, startMinute: 540, endMinute: 600, musicModeId: mode.id } }
    } });
    const privateSchedule = await db.musicSchedule.create({ data: {
      organisationId, locationId: privateFacility.id, name: "Private historical draft", timezone: "Europe/Malta",
      slots: { create: { weekday: 1, startMinute: 540, endMinute: 600, musicModeId: mode.id } }
    } });
    const normalStation = await db.station.create({ data: {
      organisationId, productFamily: "RETAIL", name: "Fictional retail station", slug: `c9-retail-station-${suffix}`,
      status: "ACTIVE", listenerLimit: 10, storageLimitGb: 1, maxBitrateKbps: 128
    } });
    const privateStation = await db.station.create({ data: {
      organisationId, productFamily: "CORRECTIONS", name: "Fictional Inside station", slug: `c9-inside-station-${suffix}`,
      status: "ACTIVE", listenerLimit: 10, storageLimitGb: 1, maxBitrateKbps: 128
    } });
    const normalChannel = await db.channel.create({ data: {
      organisationId, stationId: normalStation.id, name: "Retail channel", slug: `c9-retail-channel-${suffix}`, status: "ACTIVE"
    } });
    const privateChannel = await db.channel.create({ data: {
      organisationId, stationId: privateStation.id, name: "Inside channel", slug: `c9-inside-channel-${suffix}`,
      status: "ACTIVE", musicRightsUse: "CORRECTIONS_RADIO"
    } });
    const privateRightsChannel = await db.channel.create({ data: {
      organisationId, name: "Legacy private rights channel", slug: `c9-private-rights-${suffix}`,
      status: "ACTIVE", musicRightsUse: "CORRECTIONS_RADIO"
    } });
    await db.channelAssignment.createMany({ data: [
      { channelId: normalChannel.id, zoneId: normalLocation.zones[0].id },
      { channelId: privateChannel.id, zoneId: normalLocation.zones[0].id },
      { channelId: privateRightsChannel.id, zoneId: normalLocation.zones[0].id }
    ] });

    const login = await api("/api/auth/login", { method: "POST", body: { email: user.email, password } });
    assert.equal(login.status, 200, await login.clone().text());
    const cookie = login.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie);

    const retailView = await api("/api/programming", { cookie });
    assert.equal(retailView.status, 200, await retailView.clone().text());
    const retail = await retailView.json();
    assert.ok(retail.targets.some(({ id }) => id === normalLocation.id));
    assert.ok(retail.targets.some(({ id }) => id === normalLocation.zones[0].id));
    assert.ok(!retail.targets.some(({ id }) => id === privateFacility.id || id === privateFacility.zones[0].id));
    assert.ok(retail.schedules.some(({ id }) => id === normalSchedule.id));
    assert.ok(!retail.schedules.some(({ id }) => id === privateSchedule.id));
    assert.ok(retail.channels.some(({ id }) => id === normalChannel.id));
    assert.ok(!retail.channels.some(({ id }) => id === privateChannel.id));
    assert.ok(!retail.channels.some(({ id }) => id === privateRightsChannel.id));
    assert.ok(retail.targets.every(({ channelIds }) => !channelIds.includes(privateChannel.id) && !channelIds.includes(privateRightsChannel.id)));

    const payload = (targetType, targetId) => ({
      targetType, targetId, name: "Fictional draft", publish: false,
      slots: [{ weekday: 2, startsAt: "09:00", endsAt: "10:00", musicModeId: mode.id }]
    });
    for (const [targetType, targetId] of [["LOCATION", privateFacility.id], ["ZONE", privateFacility.zones[0].id]]) {
      const blocked = await api("/api/programming", { method: "POST", cookie, body: payload(targetType, targetId) });
      assert.equal(blocked.status, 404, await blocked.clone().text());
    }
    assert.equal(await db.musicSchedule.count({ where: { organisationId, locationId: privateFacility.id } }), 1);
    assert.equal(await db.musicSchedule.count({ where: { organisationId, zoneId: privateFacility.zones[0].id } }), 0);
    const normalDraft = await api("/api/programming", { method: "POST", cookie, body: payload("LOCATION", normalLocation.id) });
    assert.equal(normalDraft.status, 201, await normalDraft.clone().text());

    await db.subscription.update({ where: { organisationId }, data: { planId: insidePlan.id } });
    assert.equal((await api("/api/programming", { cookie })).status, 403);
    assert.equal((await api("/api/programming", { method: "POST", cookie, body: payload("LOCATION", normalLocation.id) })).status, 403);
  } finally {
    try {
      if (organisationId) await db.organisation.delete({ where: { id: organisationId } });
      if (userId) await db.user.delete({ where: { id: userId } });
      if (planIds.length) await db.plan.deleteMany({ where: { id: { in: planIds } } });
    } finally {
      await db.$disconnect();
    }
  }
});
