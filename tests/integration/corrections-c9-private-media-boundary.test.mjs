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
    method, headers: { origin: baseUrl, ...(cookie ? { cookie } : {}), ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined, redirect: "manual"
  });
}

test("same-org generic media routes cannot read or delete an unsubmitted supervised Inside take", async () => {
  if (!ciDatabase || !process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
    throw new Error("C9 private media integration runs only against the exact disposable CI database.");
  }
  const db = new PrismaClient();
  const suffix = randomUUID();
  let organisationId;
  let userId;
  let planId;
  try {
    const plan = await db.plan.create({ data: {
      name: `Fictional C9 media ${suffix}`, code: `C9_MEDIA_${suffix}`,
      productFamily: "ONLINE", tierNumber: 3, monthlyPriceCents: 0,
      storageLimitGb: 1, listenerLimit: 10, maxBitrateKbps: 128, onlineRadioEnabled: true, stationLimit: 1
    } });
    planId = plan.id;
    const organisation = await db.organisation.create({ data: {
      name: `Fictional C9 private media ${suffix}`, slug: `c9-private-media-${suffix}`
    } });
    organisationId = organisation.id;
    const password = `CI-only-${randomUUID()}!`;
    const user = await db.user.create({ data: {
      email: `c9-private-media-${suffix}@example.invalid`, passwordHash: await bcrypt.hash(password, 4), role: "OWNER"
    } });
    userId = user.id;
    await db.organisationMember.create({ data: { organisationId, userId, role: "OWNER" } });
    await db.subscription.create({ data: { organisationId, planId, status: "ACTIVE" } });
    const facility = await db.location.create({ data: {
      organisationId, name: "Fictional protected facility", slug: `c9-media-facility-${suffix}`,
      correctionsFacility: { create: {} }
    } });
    const programme = await db.correctionsProgramme.create({ data: {
      organisationId, facilityId: facility.id, title: "Fictional programme", createdByUserId: userId
    } });
    const contributor = await db.correctionsContributor.create({ data: {
      organisationId, facilityId: facility.id, displayName: "Fictional contributor", createdByUserId: userId
    } });
    const project = await db.audioProject.create({ data: {
      organisationId, title: "Fictional supervised project", editDecision: {}, createdByUserId: userId
    } });
    const protectedMedia = await db.mediaAsset.create({ data: {
      organisationId, libraryType: "ORGANISATION_PROMO", name: "Fictional protected take",
      originalName: "fictional-protected.mp3", storageKey: `c9-private-media/${suffix}/protected.mp3`,
      mimeType: "audio/mpeg", sizeBytes: 1024n, durationSeconds: 20,
      mediaType: "ANNOUNCEMENT", status: "READY"
    } });
    await db.correctionsStudioSession.create({ data: {
      organisationId, facilityId: facility.id, contributorId: contributor.id,
      programmeId: programme.id, projectId: project.id, supervisorUserId: userId,
      createdByUserId: userId, capabilityScope: { purpose: "CI-only" }
    } });
    await db.audioTake.create({ data: {
      organisationId, projectId: project.id, mediaAssetId: protectedMedia.id,
      recordedByUserId: userId, sourceEditDecision: {}, status: "READY"
    } });

    const login = await api("/api/auth/login", { method: "POST", body: { email: user.email, password } });
    assert.equal(login.status, 200, await login.clone().text());
    const cookie = login.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie);
    const stream = await api(`/api/media/${protectedMedia.id}/stream`, { cookie });
    assert.equal(stream.status, 404, await stream.clone().text());
    const remove = await api(`/api/media/${protectedMedia.id}`, { method: "DELETE", cookie });
    assert.equal(remove.status, 403, await remove.clone().text());
    assert.ok(await db.mediaAsset.findUnique({ where: { id: protectedMedia.id } }));
  } finally {
    try {
      if (organisationId) {
        await db.correctionsStudioSession.deleteMany({ where: { organisationId } });
        await db.audioTake.deleteMany({ where: { organisationId } });
        await db.audioProject.deleteMany({ where: { organisationId } });
        await db.correctionsContributor.deleteMany({ where: { organisationId } });
        await db.correctionsProgramme.deleteMany({ where: { organisationId } });
        await db.organisation.delete({ where: { id: organisationId } });
      }
      if (userId) await db.user.delete({ where: { id: userId } });
      if (planId) await db.plan.delete({ where: { id: planId } });
    } finally {
      await db.$disconnect();
    }
  }
});
