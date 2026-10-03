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

test("same-org generic media routes hide supervised and submitted Inside media, including library metadata", async () => {
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

    async function libraryMedia(name) {
      return db.mediaAsset.create({ data: {
        organisationId, libraryType: "ORGANISATION_PROMO", name,
        originalName: `${name}.mp3`, storageKey: `c9-private-media/${suffix}/${name}.mp3`,
        mimeType: "audio/mpeg", sizeBytes: 1024n, durationSeconds: 20,
        mediaType: "ANNOUNCEMENT", status: "READY"
      } });
    }
    const ordinaryMedia = await libraryMedia("fictional-ordinary-audio");
    const supervisedOutput = await libraryMedia("fictional-supervised-output");
    const submittedOutput = await libraryMedia("fictional-submitted-output");
    const ordinaryPromo = await db.promoAsset.create({ data: {
      organisationId, name: "Fictional ordinary promo", mediaType: "ANNOUNCEMENT",
      versions: { create: { mediaAssetId: ordinaryMedia.id, version: 1, status: "APPROVED", qcStatus: "PASSED", qcNotes: "Ordinary QC note" } }
    } });
    const mixedPromo = await db.promoAsset.create({ data: {
      organisationId, name: "Fictional private mixed-version promo", mediaType: "ANNOUNCEMENT",
      versions: { create: [
        { mediaAssetId: ordinaryMedia.id, version: 1, status: "APPROVED", qcStatus: "PASSED" },
        { mediaAssetId: supervisedOutput.id, version: 2, status: "IN_REVIEW", qcNotes: "Private supervised QC note" }
      ] }
    }, include: { versions: true } });
    await db.promoAsset.update({ where: { id: mixedPromo.id }, data: {
      currentApprovedVersionId: mixedPromo.versions.find((version) => version.version === 1).id
    } });
    const submittedPromo = await db.promoAsset.create({ data: {
      organisationId, name: "Fictional historical submitted promo", mediaType: "ANNOUNCEMENT",
      versions: { create: { mediaAssetId: submittedOutput.id, version: 1, status: "IN_REVIEW", qcNotes: "Private submitted QC note" } }
    }, include: { versions: true } });
    const supervisedVersion = await db.audioProjectVersion.create({ data: {
      projectId: project.id, version: 1, state: {}, createdByUserId: userId
    } });
    await db.audioRender.create({ data: {
      organisationId, projectId: project.id, versionId: supervisedVersion.id,
      outputMediaAssetId: supervisedOutput.id,
      outputPromoVersionId: mixedPromo.versions.find((version) => version.version === 2).id,
      requestedByUserId: userId, preset: "SPEECH_MP3", status: "SUCCEEDED"
    } });
    const historicalProject = await db.audioProject.create({ data: {
      organisationId, title: "Fictional ordinary project with submitted history", editDecision: {}, createdByUserId: userId
    } });
    const historicalVersion = await db.audioProjectVersion.create({ data: {
      projectId: historicalProject.id, version: 1, state: {}, createdByUserId: userId
    } });
    const submittedRender = await db.audioRender.create({ data: {
      organisationId, projectId: historicalProject.id, versionId: historicalVersion.id,
      outputMediaAssetId: submittedOutput.id,
      outputPromoVersionId: submittedPromo.versions[0].id,
      requestedByUserId: userId, preset: "SPEECH_MP3", status: "SUCCEEDED"
    } });
    await db.correctionsSubmission.create({ data: {
      programmeId: programme.id, organisationId, facilityId: facility.id,
      revision: 1, renderId: submittedRender.id, sourceFingerprint: "fictional-ci-source",
      organisationPolicyVersion: 1, facilityPolicyVersion: 1,
      titleSnapshot: "Fictional private submitted work", evidenceSnapshot: {}, submittedByUserId: userId
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
    const library = await api("/api/media/library", { cookie });
    assert.equal(library.status, 200, await library.clone().text());
    const libraryJson = await library.json();
    assert.deepEqual(libraryJson.assets.map(({ id }) => id), [ordinaryPromo.id]);
    assert.equal(libraryJson.assets[0].versions[0].file.name, ordinaryMedia.originalName);
    for (const secret of [mixedPromo.name, submittedPromo.name, supervisedOutput.originalName, submittedOutput.originalName,
      "Private supervised QC note", "Private submitted QC note", mixedPromo.versions[0].id]) {
      assert.ok(!JSON.stringify(libraryJson).includes(secret), `Library leaked ${secret}`);
    }
  } finally {
    try {
      if (organisationId) {
        await db.correctionsSubmission.deleteMany({ where: { organisationId } });
        await db.correctionsStudioSession.deleteMany({ where: { organisationId } });
        await db.audioTake.deleteMany({ where: { organisationId } });
        await db.audioRender.deleteMany({ where: { organisationId } });
        await db.promoAsset.deleteMany({ where: { organisationId } });
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
