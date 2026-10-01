import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const baseUrl = process.env.INTEGRATION_BASE_URL || "http://127.0.0.1:3100";
const ciDatabase = process.env.GITHUB_ACTIONS === "true" &&
  process.env.DATABASE_URL === "postgresql://postgres:postgres@localhost:5432/ruvanas";

async function api(path, { method = "GET", cookie, body } = {}) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: { origin: baseUrl, ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual"
  });
}

test("School and Organisations cannot expose or target private Inside facilities", async () => {
  if (!ciDatabase || !process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
    throw new Error("C9 mixed-product integration runs only against the exact disposable CI database.");
  }

  const db = new PrismaClient();
  const suffix = randomUUID();
  const planIds = [];
  let organisationId;
  let userId;
  try {
    const planData = (productFamily, tierNumber, feature) => ({
      name: `Fictional C9 ${productFamily} ${suffix}`, code: `C9_${productFamily}_${suffix}`,
      productFamily, tierNumber, monthlyPriceCents: 0, storageLimitGb: 1,
      listenerLimit: 10, maxBitrateKbps: 128, stationLimit: 1, [feature]: true
    });
    const schoolPlan = await db.plan.create({ data: planData("SCHOOL", 2, "schoolRadioEnabled") });
    const organisationsPlan = await db.plan.create({ data: planData("ORGANISATIONS", 4, "organisationsEnabled") });
    planIds.push(schoolPlan.id, organisationsPlan.id);
    const organisation = await db.organisation.create({
      data: { name: `Fictional mixed school ${suffix}`, slug: `c9-school-${suffix}` }
    });
    organisationId = organisation.id;
    const password = `CI-only-${randomUUID()}!`;
    const user = await db.user.create({ data: {
      email: `c9-school-${suffix}@example.invalid`, passwordHash: await bcrypt.hash(password, 4), role: "OWNER"
    } });
    userId = user.id;
    const member = await db.organisationMember.create({ data: { organisationId, userId, role: "OWNER" } });
    await db.subscription.create({ data: { organisationId, planId: schoolPlan.id, status: "ACTIVE" } });

    const publicLocation = await db.location.create({ data: {
      organisationId, name: "Fictional school campus", slug: `c9-school-campus-${suffix}`, status: "ACTIVE",
      zones: { create: { name: "School hall", slug: "school-hall", status: "ACTIVE" } }
    }, include: { zones: true } });
    const privateFacility = await db.location.create({ data: {
      organisationId, name: "Fictional private facility", slug: `c9-private-facility-${suffix}`, status: "ACTIVE",
      zones: { create: { name: "Private wing", slug: "private-wing", status: "ACTIVE" } },
      correctionsFacility: { create: {} }
    }, include: { zones: true } });
    const media = await db.mediaAsset.create({ data: {
      organisationId, libraryType: "ORGANISATION_PROMO", name: "Fictional school announcement",
      originalName: "school.mp3", storageKey: `c9-integration/${suffix}.mp3`, mimeType: "audio/mpeg",
      sizeBytes: BigInt(1024), durationSeconds: 20, mediaType: "ANNOUNCEMENT", status: "READY"
    } });
    const promo = await db.promoAsset.create({ data: { organisationId, name: "Fictional school announcement", mediaType: "ANNOUNCEMENT" } });
    const version = await db.promoVersion.create({ data: {
      promoAssetId: promo.id, mediaAssetId: media.id, version: 1,
      status: "APPROVED", qcStatus: "PASSED", durationSeconds: 20
    } });
    const announcement = await db.schoolAnnouncement.create({ data: {
      organisationId, promoVersionId: version.id, title: "Fictional approved school notice",
      status: "APPROVED", createdByUserId: userId
    } });
    const startsAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const endsAt = new Date(startsAt.getTime() + 30 * 60 * 1000);
    const publicSlot = await db.schoolBroadcastSlot.create({ data: {
      organisationId, announcementId: announcement.id, locationId: publicLocation.id,
      startsAt, endsAt, approvedByUserId: userId
    } });
    const privateSlot = await db.schoolBroadcastSlot.create({ data: {
      organisationId, announcementId: announcement.id, zoneId: privateFacility.zones[0].id,
      startsAt, endsAt, approvedByUserId: userId
    } });
    const publicPost = await db.schoolNoticeboardPost.create({ data: {
      organisationId, announcementId: announcement.id, zoneId: publicLocation.zones[0].id,
      startsAt, endsAt, createdByUserId: userId
    } });
    const privatePost = await db.schoolNoticeboardPost.create({ data: {
      organisationId, announcementId: announcement.id, locationId: privateFacility.id,
      startsAt, endsAt, createdByUserId: userId
    } });

    const login = await api("/api/auth/login", { method: "POST", body: { email: user.email, password } });
    assert.equal(login.status, 200, await login.clone().text());
    const cookie = login.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie);

    for (const path of ["/api/school-radio/announcements", "/api/school-radio/show-builder"]) {
      const response = await api(path, { cookie });
      assert.equal(response.status, 200, await response.clone().text());
      const payload = await response.json();
      assert.ok(payload.locations.some(({ id }) => id === publicLocation.id));
      assert.ok(!payload.locations.some(({ id }) => id === privateFacility.id));
      if (path.endsWith("announcements")) {
        const listed = payload.announcements.find(({ id }) => id === announcement.id);
        assert.deepEqual(listed.broadcastSlots.map(({ id }) => id), [publicSlot.id]);
      }
    }
    const noticeboard = await api("/api/school-radio/noticeboard", { cookie });
    assert.equal(noticeboard.status, 200, await noticeboard.clone().text());
    assert.deepEqual((await noticeboard.json()).posts.map(({ id }) => id), [publicPost.id]);

    const laterStart = new Date(endsAt.getTime() + 60 * 60 * 1000);
    const laterEnd = new Date(laterStart.getTime() + 30 * 60 * 1000);
    const slotBody = (targetType, targetId) => ({
      announcementId: announcement.id, [targetType]: targetId,
      startsAt: laterStart.toISOString(), endsAt: laterEnd.toISOString()
    });
    const postBody = (targetType, targetId) => ({
      announcementId: announcement.id, [targetType]: targetId,
      startsAt: laterStart.toISOString(), endsAt: laterEnd.toISOString()
    });
    for (const [targetType, targetId] of [["locationId", privateFacility.id], ["zoneId", privateFacility.zones[0].id]]) {
      const slot = await api("/api/school-radio/broadcast-slots", { method: "POST", cookie, body: slotBody(targetType, targetId) });
      assert.equal(slot.status, 400, await slot.clone().text());
      const post = await api("/api/school-radio/noticeboard", { method: "POST", cookie, body: postBody(targetType, targetId) });
      assert.equal(post.status, 400, await post.clone().text());
    }
    for (const [path, recordId] of [["broadcast-slots", privateSlot.id], ["noticeboard", privatePost.id]]) {
      const response = await api(`/api/school-radio/${path}/${recordId}`, { method: "PATCH", cookie, body: { reason: "Fictional test cancellation" } });
      assert.equal(response.status, 404, await response.clone().text());
    }
    const normalSlot = await api("/api/school-radio/broadcast-slots", { method: "POST", cookie, body: slotBody("zoneId", publicLocation.zones[0].id) });
    assert.equal(normalSlot.status, 201, await normalSlot.clone().text());
    const normalPost = await api("/api/school-radio/noticeboard", { method: "POST", cookie, body: postBody("locationId", publicLocation.id) });
    assert.equal(normalPost.status, 201, await normalPost.clone().text());

    await db.subscription.update({ where: { organisationId }, data: { planId: organisationsPlan.id } });
    const organisationsStation = await db.station.create({ data: {
      organisationId, productFamily: "ORGANISATIONS", name: "Fictional organisation station",
      slug: `c9-organisations-station-${suffix}`, status: "ACTIVE",
      listenerLimit: 10, storageLimitGb: 1, maxBitrateKbps: 128
    } });
    const organisationsChannel = await db.channel.create({ data: {
      organisationId, stationId: organisationsStation.id, name: "Fictional organisation channel",
      slug: `c9-organisations-channel-${suffix}`, status: "ACTIVE"
    } });
    const organisationsAutoDj = await db.autoDjPolicy.create({ data: {
      organisationId, channelId: organisationsChannel.id, targetType: "ORGANISATIONS_CHANNEL"
    } });
    const historical = await db.organisationAnnouncement.create({ data: {
      organisationId, title: "Fictional historical mixed announcement", body: "Fictional only",
      surfaces: ["WEB_PLAYER"], targetLocationIds: [publicLocation.id, privateFacility.id],
      targetStationIds: [], createdByUserId: userId
    } });
    const privateBranch = await db.organisationBranchAssignment.create({ data: {
      organisationId, organisationMemberId: member.id, locationId: privateFacility.id,
      permission: "MANAGER", createdByUserId: userId
    } });
    const workspace = await api("/api/organisations/workspace", { cookie });
    assert.equal(workspace.status, 200, await workspace.clone().text());
    const data = await workspace.json();
    assert.ok(data.locations.some(({ id }) => id === publicLocation.id));
    assert.ok(!data.locations.some(({ id }) => id === privateFacility.id));
    assert.ok(!data.branchAssignments.some(({ id }) => id === privateBranch.id));
    assert.deepEqual(data.announcements.find(({ id }) => id === historical.id)?.targetLocationIds, [publicLocation.id]);
    assert.deepEqual(data.autoDjPolicies.find(({ id }) => id === organisationsAutoDj.id)?.name, organisationsChannel.name);

    const action = (body) => api("/api/organisations/workspace", { method: "POST", cookie, body });
    const privateAnnouncement = await action({ action: "CREATE_ANNOUNCEMENT", title: "Fictional general notice", body: "Fictional body", surfaces: ["WEB_PLAYER"], targetLocationIds: [privateFacility.id] });
    assert.equal(privateAnnouncement.status, 409, await privateAnnouncement.clone().text());
    const privateAssignment = await action({ action: "ASSIGN_BRANCH", organisationMemberId: member.id, locationId: privateFacility.id, permission: "MANAGER" });
    assert.equal(privateAssignment.status, 409, await privateAssignment.clone().text());
    const approveHistorical = await action({ action: "APPROVE_ANNOUNCEMENT", announcementId: historical.id });
    assert.equal(approveHistorical.status, 409, await approveHistorical.clone().text());
    const publicAnnouncement = await action({ action: "CREATE_ANNOUNCEMENT", title: "Fictional school venue notice", body: "Fictional body", surfaces: ["WEB_PLAYER"], targetLocationIds: [publicLocation.id] });
    assert.equal(publicAnnouncement.status, 201, await publicAnnouncement.clone().text());
    const publicAssignment = await action({ action: "ASSIGN_BRANCH", organisationMemberId: member.id, locationId: publicLocation.id, permission: "MANAGER" });
    assert.equal(publicAssignment.status, 200, await publicAssignment.clone().text());
  } finally {
    try {
      if (organisationId) await db.schoolNoticeboardPost.deleteMany({ where: { organisationId } });
      if (organisationId) await db.schoolBroadcastSlot.deleteMany({ where: { organisationId } });
      if (organisationId) await db.schoolAnnouncement.deleteMany({ where: { organisationId } });
      if (organisationId) await db.organisationBranchAssignment.deleteMany({ where: { organisationId } });
      if (organisationId) await db.organisationAnnouncement.deleteMany({ where: { organisationId } });
      if (organisationId) await db.promoVersion.deleteMany({ where: { promoAsset: { organisationId } } });
      if (organisationId) await db.promoAsset.deleteMany({ where: { organisationId } });
      if (organisationId) await db.mediaAsset.deleteMany({ where: { organisationId } });
      if (organisationId) await db.organisation.delete({ where: { id: organisationId } });
      if (userId) await db.user.delete({ where: { id: userId } });
      if (planIds.length) await db.plan.deleteMany({ where: { id: { in: planIds } } });
    } finally {
      await db.$disconnect();
    }
  }
});
