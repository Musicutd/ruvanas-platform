import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const baseUrl = process.env.INTEGRATION_BASE_URL || "http://127.0.0.1:3100";
const testAddress = `203.0.113.${Math.floor(Math.random() * 200) + 1}`;

async function post(body) {
  const response = await fetch(`${baseUrl}/api/public/corrections/requests`, {
    method: "POST", headers: { "content-type": "application/json", origin: baseUrl, "x-forwarded-for": testAddress }, body: JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() };
}

async function api(path, { method = "GET", body, cookie } = {}) {
  const response = await fetch(`${baseUrl}${path}`, { method, headers: { origin: baseUrl, "x-forwarded-for": testAddress, ...(body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, body: await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] };
}

test("C5 public intake is tier- and facility-gated, generic, duplicate-safe, and never a read API", async () => {
  const db = new PrismaClient();
  const suffix = randomUUID().slice(0, 8);
  const code = randomBytes(24).toString("base64url");
  let organisation;
  let plan;
  try {
    organisation = await db.organisation.create({ data: { name: `C5 integration ${suffix}`, slug: `c5-integration-${suffix}` } });
    plan = await db.plan.create({ data: { name: `C5 integration ${suffix}`, code: `C5_INTEGRATION_${suffix}`, productFamily: "CORRECTIONS", tierNumber: 1,
      monthlyPriceCents: 14900, storageLimitGb: 10, listenerLimit: 100, maxBitrateKbps: 128, correctionsRadioEnabled: true } });
    await db.subscription.create({ data: { organisationId: organisation.id, planId: plan.id, status: "ACTIVE" } });
    const location = await db.location.create({ data: { organisationId: organisation.id, name: "Synthetic test facility", slug: "synthetic-test-facility", countryCode: "MT",
      correctionsFacility: { create: { requestAvailability: "FAMILY_AND_INTERNAL", publicRequestCode: code, songRequestsEnabled: true } } } });
    const body = { facilityCode: code, type: "SONG", senderDisplayName: "Test sender", recipientReference: "local-reference", songTitle: "Synthetic test", consent: true };

    const tierOne = await post(body);
    assert.equal(tierOne.status, 202);
    assert.equal(await db.correctionsRequest.count({ where: { organisationId: organisation.id } }), 0);

    await db.plan.update({ where: { id: plan.id }, data: { tierNumber: 2 } });
    await db.correctionsFacility.update({ where: { locationId: location.id }, data: { requestAvailability: "DISABLED" } });
    const disabled = await post(body);
    assert.deepEqual(disabled, tierOne);
    assert.equal(await db.correctionsRequest.count({ where: { organisationId: organisation.id } }), 0);

    await db.correctionsFacility.update({ where: { locationId: location.id }, data: { requestAvailability: "FAMILY_AND_INTERNAL" } });
    const accepted = await post(body);
    assert.deepEqual(accepted, tierOne);
    const duplicate = await post(body);
    assert.deepEqual(duplicate, tierOne);
    assert.equal(await db.correctionsRequest.count({ where: { organisationId: organisation.id } }), 1);
    const request = await db.correctionsRequest.findFirst({ where: { organisationId: organisation.id } });
    assert.equal(request.status, "RECEIVED");
    assert.equal(request.onAirRecipient, null);
    assert.equal(request.trackId, null);
    assert.equal(request.programmeId, null);

    const unknown = await post({ ...body, facilityCode: randomBytes(24).toString("base64url") });
    assert.deepEqual(unknown, tierOne);
    const forbiddenType = await post({ ...body, type: "PROGRAMME" });
    assert.equal(forbiddenType.status, 400);
    assert.equal(await db.correctionsRequest.count({ where: { organisationId: organisation.id } }), 1);

    const publicRead = await fetch(`${baseUrl}/api/public/corrections/requests`);
    assert.equal(publicRead.status, 405);
    const staffRead = await fetch(`${baseUrl}/api/corrections/requests`);
    assert.equal(staffRead.status, 401);
  } finally {
    if (organisation) await db.organisation.delete({ where: { id: organisation.id } });
    if (plan) await db.plan.delete({ where: { id: plan.id } });
    await db.$disconnect();
  }
});

test("C5 staff requests, rehabilitation and development enforce review and facility authority", async () => {
  const db = new PrismaClient();
  const suffix = randomUUID().slice(0, 8);
  const password = `C5-local-${randomUUID()}!`;
  const users = [];
  const organisations = [];
  let plan;
  try {
    const hash = await bcrypt.hash(password, 4);
    plan = await db.plan.create({ data: { name: `C5 staff ${suffix}`, code: `C5_STAFF_${suffix}`, productFamily: "CORRECTIONS", tierNumber: 2,
      monthlyPriceCents: 29900, storageLimitGb: 10, listenerLimit: 100, maxBitrateKbps: 128, correctionsRadioEnabled: true } });
    async function member(role, label, organisation) {
      const user = await db.user.create({ data: { name: label, email: `${label.toLowerCase()}-${suffix}@example.invalid`, passwordHash: hash, role } });
      users.push(user);
      await db.organisationMember.create({ data: { organisationId: organisation.id, userId: user.id, role } });
      return user;
    }
    async function organisation(label) {
      const result = await db.organisation.create({ data: { name: `C5 ${label} ${suffix}`, slug: `c5-${label.toLowerCase()}-${suffix}` } });
      organisations.push(result);
      await db.subscription.create({ data: { organisationId: result.id, planId: plan.id, status: "ACTIVE" } });
      return result;
    }
    const first = await organisation("First");
    const second = await organisation("Second");
    const owner = await member("OWNER", "Owner", first);
    const manager = await member("MANAGER", "Manager", first);
    const viewer = await member("VIEWER", "Viewer", first);
    const outsider = await member("OWNER", "Outsider", second);
    const location = await db.location.create({ data: { organisationId: first.id, name: "Synthetic review facility", slug: "synthetic-review-facility", countryCode: "MT",
      correctionsFacility: { create: { requestAvailability: "INTERNAL_ONLY", messageRequestsEnabled: true } } } });
    const managerMember = await db.organisationMember.findUnique({ where: { userId_organisationId: { userId: manager.id, organisationId: first.id } } });
    await db.correctionsFacilityGrant.create({ data: { organisationId: first.id, organisationMemberId: managerMember.id, facilityId: location.id, permission: "MANAGER", createdByUserId: owner.id } });

    async function cookieFor(user) {
      const login = await api("/api/auth/login", { method: "POST", body: { email: user.email, password } });
      assert.equal(login.status, 200, JSON.stringify(login.body));
      assert.ok(login.cookie);
      return login.cookie;
    }
    const ownerCookie = await cookieFor(owner);
    const managerCookie = await cookieFor(manager);
    const viewerCookie = await cookieFor(viewer);
    const outsiderCookie = await cookieFor(outsider);

    const created = await api("/api/corrections/requests", { method: "POST", cookie: ownerCookie, body: { facilityId: location.id, type: "MESSAGE", message: "Private original wording", recipientReference: "private-local-ref" } });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const id = created.body.request.id;
    const publicList = await api("/api/corrections/requests", { cookie: viewerCookie });
    assert.equal(publicList.status, 200);
    assert.equal(publicList.body.requests.length, 0);
    assert.equal((await api(`/api/corrections/requests/${id}`, { cookie: viewerCookie })).status, 403);
    assert.equal((await api(`/api/corrections/requests/${id}`, { cookie: outsiderCookie })).status, 404);
    assert.equal((await api(`/api/corrections/requests/${id}`, { method: "POST", cookie: viewerCookie, body: { action: "APPROVE", onAirMessage: "Safe" } })).status, 403);

    const screen = await api(`/api/corrections/requests/${id}`, { method: "POST", cookie: ownerCookie, body: { action: "SCREEN" } });
    assert.equal(screen.status, 200, JSON.stringify(screen.body));
    const approved = await api(`/api/corrections/requests/${id}`, { method: "POST", cookie: ownerCookie, body: { action: "APPROVE", onAirRecipient: "First name only", onAirMessage: "Safe approved wording" } });
    assert.equal(approved.status, 200, JSON.stringify(approved.body));
    const final = await api(`/api/corrections/requests/${id}`, { cookie: ownerCookie });
    assert.equal(final.body.request.status, "APPROVED");
    assert.equal(final.body.request.originalMessage, "Private original wording");
    assert.equal(final.body.request.recipientReference, "private-local-ref");
    assert.equal(final.body.request.onAirMessage, "Safe approved wording");
    assert.deepEqual(final.body.request.decisions.map((item) => item.action), ["SCREEN", "APPROVE"]);
    assert.equal((await api(`/api/corrections/requests/${id}`, { method: "POST", cookie: ownerCookie, body: { action: "SCHEDULE" } })).status, 409);
    assert.equal((await api(`/api/corrections/requests/${id}`, { method: "POST", cookie: ownerCookie, body: { action: "PLAYED" } })).status, 409);

    const media = await db.mediaAsset.create({ data: { organisationId: first.id, libraryType: "ORGANISATION_PROMO", name: "Synthetic education audio", originalName: "synthetic.mp3",
      storageKey: `c5-integration/${suffix}.mp3`, mimeType: "audio/mpeg", sizeBytes: BigInt(1024), durationSeconds: 60, mediaType: "ANNOUNCEMENT", status: "READY" } });
    const promo = await db.promoAsset.create({ data: { organisationId: first.id, name: "Synthetic education", mediaType: "ANNOUNCEMENT" } });
    await db.promoVersion.create({ data: { promoAssetId: promo.id, mediaAssetId: media.id, version: 1, status: "APPROVED", qcStatus: "PASSED" } });
    const rehab = await api("/api/corrections/rehabilitation", { method: "POST", cookie: ownerCookie, body: { facilityId: location.id, categoryCode: "EDUCATION", mediaAssetId: media.id,
      title: "Synthetic life skills", providerName: "Test provider" } });
    assert.equal(rehab.status, 201, JSON.stringify(rehab.body));
    const contentId = rehab.body.content.id;
    assert.equal((await api(`/api/corrections/rehabilitation/${contentId}`, { method: "POST", cookie: ownerCookie, body: { action: "SUBMIT" } })).status, 200);
    assert.equal((await api(`/api/corrections/rehabilitation/${contentId}`, { method: "POST", cookie: ownerCookie, body: { action: "APPROVE" } })).status, 403);
    assert.equal((await api(`/api/corrections/rehabilitation/${contentId}`, { method: "POST", cookie: viewerCookie, body: { action: "APPROVE" } })).status, 403);
    assert.equal((await api(`/api/corrections/rehabilitation/${contentId}`, { method: "POST", cookie: managerCookie, body: { action: "APPROVE" } })).status, 200);
    assert.equal((await db.correctionsRehabContent.findUnique({ where: { id: contentId } })).status, "APPROVED");

    const contributor = await db.correctionsContributor.create({ data: { organisationId: first.id, facilityId: location.id, displayName: "Synthetic contributor", createdByUserId: owner.id } });
    assert.equal((await api(`/api/corrections/contributors/${contributor.id}/development`, { cookie: outsiderCookie })).status, 404);
    assert.equal((await api(`/api/corrections/contributors/${contributor.id}/development`, { method: "PATCH", cookie: viewerCookie, body: { moduleCode: "STUDIO_INTRODUCTION", status: "COMPLETED" } })).status, 403);
    const milestone = await api(`/api/corrections/contributors/${contributor.id}/development`, { method: "PATCH", cookie: managerCookie, body: { moduleCode: "STUDIO_INTRODUCTION", status: "COMPLETED" } });
    assert.equal(milestone.status, 200, JSON.stringify(milestone.body));
    const profile = await api(`/api/corrections/contributors/${contributor.id}/development`, { cookie: managerCookie });
    assert.equal(profile.status, 200);
    assert.equal(profile.body.evidence.modulesCompleted, 1);
    assert.equal(profile.body.pathway[0].record.status, "COMPLETED");
  } finally {
    for (const org of organisations) {
      await db.correctionsRequestDecision.deleteMany({ where: { organisationId: org.id } });
      await db.correctionsRequest.deleteMany({ where: { organisationId: org.id } });
      await db.correctionsContributorMilestone.deleteMany({ where: { contributor: { organisationId: org.id } } });
      await db.correctionsRehabContent.deleteMany({ where: { organisationId: org.id } });
      await db.promoVersion.deleteMany({ where: { promoAsset: { organisationId: org.id } } });
      await db.promoAsset.deleteMany({ where: { organisationId: org.id } });
      await db.mediaAsset.deleteMany({ where: { organisationId: org.id } });
      await db.organisation.delete({ where: { id: org.id } });
    }
    for (const user of users) await db.user.delete({ where: { id: user.id } });
    if (plan) await db.plan.delete({ where: { id: plan.id } });
    await db.$disconnect();
  }
});
